import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createMcp } from "../server/mcp/handler";
import { SprintService } from "../server/services/sprints";
import { test, expect } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  chmodSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../server/db/database";
import { DevelopmentTasks } from "../server/services/development-tasks";
import { WorkItemService, type Actor } from "../server/services/work-items";
import { WorkItemRepository } from "../server/repositories/work-items";
import { DomainModelService } from "../server/services/domain-models";
import { WorkspaceBackups } from "../server/services/workspace-backups";
import { WorkspaceStore } from "../server/services/workspaces";
import { prepareDevelopmentSources } from "../server/services/development-sources";
import { CodexChat } from "../server/codex/chat";
const actor: Actor = {
  source: "web",
  identity: "local-user",
  writable: true,
  requestId: "development-test",
};
export const git = (dir: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", "-C", dir, ...args]);
  if (r.exitCode) throw new Error(r.stderr.toString());
  return r.stdout.toString().trim();
};
export async function until<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  timeout = 15000,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = read();
    if (predicate(v)) return v;
    await Bun.sleep(50);
  }
  throw new Error("等待状态超时");
}
export function fixture() {
  const dir = realpathSync(
      mkdtempSync(join(tmpdir(), "dedsiwork-development-test-")),
    ),
    repo = join(dir, "repo");
  mkdirSync(repo);
  git(repo, "init", "-b", "main");
  writeFileSync(join(repo, "README.md"), "baseline\n");
  git(repo, "add", ".");
  git(
    repo,
    "-c",
    "user.name=DedsiWork Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "baseline",
  );
  const cli = join(dir, "fixture-cli");
  writeFileSync(
    cli,
    `#!${process.execPath}\nimport ${JSON.stringify(resolve(import.meta.dir, "helpers/codex-development-fixture.ts"))};\n`,
  );
  chmodSync(cli, 0o700);
  const oldCli = process.env.DEDSIWORK_CODEX_PATH,
    oldState = process.env.DEVELOPMENT_FIXTURE_DIR;
  process.env.DEDSIWORK_CODEX_PATH = cli;
  process.env.DEVELOPMENT_FIXTURE_DIR = join(dir, "codex");
  const db = openDatabase(join(dir, "worker.sqlite")),
    items = new WorkItemService(new WorkItemRepository(db)),
    models = new DomainModelService(db);
  let dev = new DevelopmentTasks(
    db,
    dir,
    items,
    models,
    join(dir, "trees"),
    () => repo,
  );
  return {
    dir,
    repo,
    db,
    items,
    models,
    cli,
    get dev() {
      return dev;
    },
    reopen() {
      dev = new DevelopmentTasks(
        db,
        dir,
        items,
        models,
        join(dir, "trees"),
        () => repo,
      );
      return dev;
    },
    async create(
      requirement = "[APPROVAL]",
      autoStart = false,
      sources: { itemIds?: string[]; modelIds?: string[] } = {},
    ) {
      const token = crypto.randomUUID();
      (dev as any).selections.set(token, {
        owner: actor.identity,
        repository: repo,
        expires: Date.now() + 60000,
      });
      // Preserve legacy drafts for resume/merge tests; auto-start tests use the real entry point.
      const start = dev.start;
      if (!autoStart) dev.start = async (id, who) => dev.get(id, who);
      try {
        return await dev.create(
          {
            title: "研发测试",
            requirement,
            directoryToken: token,
            baseBranch: "main",
            ...sources,
          },
          actor,
        );
      } finally {
        dev.start = start;
      }
    },
    async close() {
      await dev.close();
      db.close();
      if (oldCli === undefined) delete process.env.DEDSIWORK_CODEX_PATH;
      else process.env.DEDSIWORK_CODEX_PATH = oldCli;
      if (oldState === undefined) delete process.env.DEVELOPMENT_FIXTURE_DIR;
      else process.env.DEVELOPMENT_FIXTURE_DIR = oldState;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
for (const method of ["command", "file"] as const)
  for (const decision of ["accept", "decline"] as const)
    test(`${method} approval ${decision}: waits, honors decision, rejects stale/other-owner requests`, async () => {
      const f = fixture();
      try {
        const task = await f.create(
          method === "file" ? "[FILE_APPROVAL]" : "[APPROVAL]",
        );
        await f.dev.start(task.id, actor);
        const waiting = await until(
          () => f.dev.get(task.id, actor),
          (t) => t.status === "waiting",
        );
        const request = waiting.snapshot!.requests[0]!;
        expect(request.method).toBe(
          method === "file"
            ? "item/fileChange/requestApproval"
            : "item/commandExecution/requestApproval",
        );
        expect(waiting.snapshot!.items.some((i) => i.type === "plan")).toBe(
          true,
        );
        expect(
          existsSync(
            join(f.dir, "codex", `${request.params.turnId}-approved.txt`),
          ),
        ).toBe(false);
        await expect(
          f.dev.answer(
            task.id,
            request.id,
            { action: "accept" },
            { ...actor, identity: "other" },
          ),
        ).rejects.toThrow("研发任务不存在");
        await f.dev.answer(task.id, request.id, { action: decision }, actor);
        const final = await until(
          () => f.dev.get(task.id, actor),
          (t) => t.status === "review",
        );
        expect(final.snapshot!.requests).toHaveLength(0);
        expect(
          existsSync(
            join(f.dir, "codex", `${request.params.turnId}-approved.txt`),
          ),
        ).toBe(decision === "accept");
        await expect(
          f.dev.answer(task.id, request.id, { action: "accept" }, actor),
        ).rejects.toThrow("执行请求已结束");
      } finally {
        await f.close();
      }
    }, 25000);

test("SIGKILL restart preserves WAL history and resumes the same workspace directory and chat", async () => {
  const f = fixture();
  let worker: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const task = await f.create("[HOLD]");
    await f.dev.close();
    worker = Bun.spawn(
      [
        process.execPath,
        resolve(import.meta.dir, "helpers/development-worker.ts"),
      ],
      {
        env: {
          ...process.env,
          DEVELOPMENT_WORKER_DIR: f.dir,
          DEVELOPMENT_TASK_ID: task.id,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const live = await until(
      () => f.dev.get(task.id, actor),
      (t) =>
        t.status === "running" &&
        !!t.snapshot?.items.some(
          (i) => i.type === "commandExecution" && i.status === "inProgress",
        ),
    );
    worker.kill("SIGKILL");
    await worker.exited;
    f.reopen();
    const interrupted = f.dev.get(task.id, actor);
    expect(interrupted.status).toBe("interrupted");
    expect(interrupted.chatId).toBe(live.chatId);
    expect(interrupted.snapshot!.items.length).toBeGreaterThan(0);
    expect(interrupted.snapshot!.requests).toHaveLength(0);
    expect(
      interrupted.snapshot!.items.some(
        (i) => i.type === "commandExecution" && i.status === "interrupted",
      ),
    ).toBe(true);
    await f.dev.start(task.id, actor);
    const resumed = await until(
      () => f.dev.get(task.id, actor),
      (t) => t.status === "waiting",
    );
    expect(resumed.chatId).toBe(live.chatId);
    expect(resumed.worktree).toBe(live.worktree);
    await f.dev.answer(
      task.id,
      resumed.snapshot!.requests[0]!.id,
      { action: "accept" },
      actor,
    );
    await until(
      () => f.dev.get(task.id, actor),
      (t) => t.status === "review",
    );
    expect(git(f.repo, "status", "--short")).toBe("");
  } finally {
    if (worker && worker.exitCode === null) {
      worker.kill("SIGKILL");
      await worker.exited;
    }
    await f.close();
  }
}, 30000);

test("backup restores development sources/history read-only, retries idempotently and rejects damage", async () => {
  const f = fixture(),
    store = new WorkspaceStore(join(f.dir, "catalog", "legacy.sqlite")),
    backups = new WorkspaceBackups(store);
  const space = store.create({ name: "研发备份来源" }, actor),
    path = store.path(space.id);
  mkdirSync(dirname(path), { recursive: true });
  const db = openDatabase(path),
    items = new WorkItemService(new WorkItemRepository(db)),
    models = new DomainModelService(db);
  const dev = new DevelopmentTasks(
      db,
      dirname(path),
      items,
      models,
      join(f.dir, "backup-trees"),
    ),
    chat = new CodexChat(db, dirname(path));
  const output = join(f.dir, "development.dwb");
  Object.defineProperty(backups, "pick", { value: async () => output });
  try {
    const item = items.create({ title: "备份工作项" }, actor);
    const token = crypto.randomUUID();
    (dev as any).selections.set(token, {
      owner: actor.identity,
      repository: f.repo,
      expires: Date.now() + 60000,
    });
    const task = await dev.create(
      {
        title: "备份研发任务",
        requirement: "[APPROVAL]",
        directoryToken: token,
        baseBranch: "main",
        itemIds: [item.id],
      },
      actor,
    );
    const waiting = await until(
      () => dev.get(task.id, actor),
      (t) => t.status === "waiting",
    );
    await dev.answer(
      task.id,
      waiting.snapshot!.requests[0]!.id,
      { action: "accept" },
      actor,
    );
    await until(
      () => dev.get(task.id, actor),
      (t) => t.status === "review",
    );
    await dev.chat.exportHistories(actor);
    await backups.backup(space.id, db, chat, actor);
    const preview = await backups.preview(actor);
    expect(preview.cancelled).toBe(false);
    expect(preview.counts?.developmentTasks).toBe(1);
    const restored = backups.restore(
        { token: preview.token, name: "恢复的研发空间", confirmed: true },
        actor,
      ),
      target = openDatabase(store.path(restored.id));
    const restoredDev = new DevelopmentTasks(
      target,
      dirname(store.path(restored.id)),
      new WorkItemService(new WorkItemRepository(target)),
      new DomainModelService(target),
      join(f.dir, "restored-trees"),
    );
    try {
      const data = restoredDev.get(task.id, actor);
      expect(data.restored).toBe(true);
      expect(data.status).toBe("interrupted");
      expect(data.sources.items[0]!.title).toBe("备份工作项");
      expect(data.snapshot!.items.length).toBeGreaterThan(0);
      await expect(restoredDev.start(task.id, actor)).rejects.toThrow(
        "恢复的任务仅供查阅",
      );
      await expect(restoredDev.openDirectory(task.id, actor)).rejects.toThrow(
        "没有可打开的研发目录",
      );
      expect(() => restoredDev.complete(task.id, actor)).toThrow();
      expect(
        backups.restore(
          { token: preview.token, name: "恢复的研发空间", confirmed: true },
          actor,
        ).id,
      ).toBe(restored.id);
    } finally {
      await restoredDev.close();
      target.close();
    }
    const archive = JSON.parse(gunzipSync(readFileSync(output)).toString());
    archive.sha256 = "0".repeat(64);
    writeFileSync(output, gzipSync(JSON.stringify(archive)));
    await expect(backups.preview(actor)).rejects.toThrow("备份校验失败");
    writeFileSync(output, "damaged archive");
    await expect(backups.preview(actor)).rejects.toThrow(
      "不是有效的工作空间备份",
    );
    expect(dev.get(task.id, actor).status).toBe("review");
  } finally {
    await dev.close();
    await chat.close();
    db.close();
    backups.close();
    store.close();
    await f.close();
  }
}, 30000);

async function acceptedTask(f: ReturnType<typeof fixture>) {
  const task = await f.create("[HOLD]");
  await f.dev.start(task.id, actor);
  await until(
    () => f.dev.get(task.id, actor),
    (t) => t.status === "running" && !!t.snapshot?.items.length,
  );
  await f.dev.stop(task.id, actor);
  await until(
    () => f.dev.get(task.id, actor),
    (t) => t.status === "stopped",
  );
  git(f.repo, "config", "user.name", "DedsiWork Test");
  git(f.repo, "config", "user.email", "test@example.invalid");
  // Historical worktrees remain readable and mergeable; new tasks never create these.
  const completed = f.dev.complete(task.id, actor);
  delete completed.executionMode;
  completed.branch = `codex/dev-${completed.id}`;
  completed.worktree = join(f.dir, "trees", completed.id);
  git(
    f.repo,
    "worktree",
    "add",
    "-b",
    completed.branch,
    completed.worktree,
    completed.baseCommit,
  );
  f.db
    .query("UPDATE development_tasks SET state=? WHERE id=?")
    .run(JSON.stringify(completed), completed.id);
  return completed;
}
test("merge preview includes untracked code without moving branches; confirmation commits and merges once", async () => {
  const f = fixture();
  try {
    const task = await acceptedTask(f),
      original = git(f.repo, "rev-parse", "HEAD");
    writeFileSync(
      join(task.worktree, "index.html"),
      "<!doctype html><h1>previewed code</h1>\n",
    );
    writeFileSync(join(task.worktree, "README.md"), "updated instructions\n");
    const index = git(task.worktree, "write-tree");
    const preview = await f.dev.merging.preview(task.id, actor);
    expect(preview.canMerge).toBe(true);
    expect(preview.files).toContain("index.html");
    expect(preview.diff).toContain("previewed code");
    expect(preview.createsCommit).toBe(true);
    expect(git(f.repo, "rev-parse", "HEAD")).toBe(original);
    expect(git(task.worktree, "rev-parse", "HEAD")).toBe(original);
    expect(git(task.worktree, "write-tree")).toBe(index);
    expect(existsSync(join(f.repo, "index.html"))).toBe(false);
    await expect(
      f.dev.merging.merge(
        task.id,
        { token: preview.token, confirmed: false },
        actor,
      ),
    ).rejects.toThrow();
    const merged = await f.dev.merging.merge(
      task.id,
      { token: preview.token, confirmed: true },
      actor,
    );
    expect(merged.merge!.targetBranch).toBe("main");
    expect(git(f.repo, "rev-parse", "HEAD")).toBe(merged.merge!.targetCommit);
    expect(git(f.repo, "show", "HEAD:index.html")).toContain("previewed code");
    expect(git(f.repo, "status", "--short")).toBe("");
    expect(merged.merge!.cleanedAt).toBeTruthy();
    expect(existsSync(task.worktree)).toBe(false);
    expect(git(f.repo, "worktree", "list", "--porcelain")).not.toContain(
      task.worktree,
    );
    expect(git(f.repo, "branch", "--list", task.branch)).toBe("");
    expect((await f.dev.changes(task.id, actor)).diff).toContain(
      "previewed code",
    );
    await expect(f.dev.openDirectory(task.id, actor)).rejects.toThrow(
      "没有可打开",
    );
    expect(
      git(f.repo, "rev-list", "--parents", "-n", "1", "HEAD").split(" "),
    ).toHaveLength(3);
    const retry = await f.dev.merging.merge(
      task.id,
      { token: preview.token, confirmed: true },
      actor,
    );
    expect(retry.merge!.targetCommit).toBe(merged.merge!.targetCommit);
    await expect(
      f.dev.merging.merge(
        task.id,
        { token: preview.token, confirmed: true },
        { ...actor, writable: false },
      ),
    ).rejects.toThrow("需要写入权限");
    // Recreate the pre-cleanup state to simulate shutdown before merge metadata persisted.
    git(f.repo, "branch", task.branch, merged.merge!.sourceCommit);
    git(f.repo, "worktree", "add", task.worktree, task.branch);
    const saved = f.dev.get(task.id, actor);
    delete saved.merge;
    f.db
      .query("UPDATE development_tasks SET state=? WHERE id=?")
      .run(JSON.stringify(saved), task.id);
    await f.dev.close();
    f.reopen();
    const recovered = await f.dev.merging.preview(task.id, actor);
    expect(recovered.alreadyMerged).toBe(true);
    const synced = await f.dev.merging.merge(
      task.id,
      { token: recovered.token, confirmed: true },
      actor,
    );
    expect(synced.merge!.targetCommit).toBe(merged.merge!.targetCommit);
    expect(git(f.repo, "rev-parse", "HEAD")).toBe(merged.merge!.targetCommit);
  } finally {
    await f.close();
  }
}, 25000);

test("merge conflicts are reported in preview without changing either checkout or branch", async () => {
  const f = fixture();
  try {
    const task = await acceptedTask(f);
    writeFileSync(join(task.worktree, "README.md"), "task version\n");
    writeFileSync(join(f.repo, "README.md"), "main version\n");
    git(f.repo, "add", ".");
    git(f.repo, "commit", "-m", "main changed");
    const main = git(f.repo, "rev-parse", "HEAD"),
      source = git(task.worktree, "rev-parse", "HEAD");
    const preview = await f.dev.merging.preview(task.id, actor);
    expect(preview.canMerge).toBe(false);
    expect(preview.token).toBeNull();
    expect(preview.conflict).toContain("CONFLICT");
    expect(git(f.repo, "rev-parse", "HEAD")).toBe(main);
    expect(git(task.worktree, "rev-parse", "HEAD")).toBe(source);
    expect(git(f.repo, "status", "--short")).toBe("");
    expect(existsSync(join(f.repo, ".git", "MERGE_HEAD"))).toBe(false);
  } finally {
    await f.close();
  }
}, 25000);

test("merge blocks dirty main, changed preview, unchecked main and unaccepted/restored tasks", async () => {
  const f = fixture();
  try {
    const task = await acceptedTask(f);
    writeFileSync(join(task.worktree, "index.html"), "first\n");
    writeFileSync(join(f.repo, "untracked.txt"), "user work\n");
    await expect(f.dev.merging.preview(task.id, actor)).rejects.toThrow(
      "原仓库有未提交",
    );
    rmSync(join(f.repo, "untracked.txt"));
    const preview = await f.dev.merging.preview(task.id, actor);
    writeFileSync(join(task.worktree, "index.html"), "changed after preview\n");
    const main = git(f.repo, "rev-parse", "HEAD");
    await expect(
      f.dev.merging.merge(
        task.id,
        { token: preview.token, confirmed: true },
        actor,
      ),
    ).rejects.toThrow("预览后发生变化");
    expect(git(f.repo, "rev-parse", "HEAD")).toBe(main);
    git(f.repo, "checkout", "-b", "other");
    await expect(f.dev.merging.preview(task.id, actor)).rejects.toThrow(
      "请先在原仓库切换到 main",
    );
    git(f.repo, "checkout", "main");
    const state = f.dev.get(task.id, actor);
    state.status = "review";
    f.db
      .query("UPDATE development_tasks SET state=? WHERE id=?")
      .run(JSON.stringify(state), task.id);
    await expect(f.dev.merging.preview(task.id, actor)).rejects.toThrow(
      "请先验收",
    );
    state.status = "completed";
    state.restored = true;
    f.db
      .query("UPDATE development_tasks SET state=? WHERE id=?")
      .run(JSON.stringify(state), task.id);
    await expect(f.dev.merging.preview(task.id, actor)).rejects.toThrow(
      "恢复的任务仅供查阅",
    );
  } finally {
    await f.close();
  }
}, 25000);

test("cleanup preserves post-merge edits and safely retries after restart", async () => {
  const f = fixture();
  try {
    const task = await acceptedTask(f);
    writeFileSync(join(task.worktree, "index.html"), "merged code\n");
    const preview = await f.dev.merging.preview(task.id, actor);
    const merged = await f.dev.merging.merge(
      task.id,
      { token: preview.token, confirmed: true },
      actor,
    );
    git(f.repo, "branch", task.branch, merged.merge!.sourceCommit);
    git(f.repo, "worktree", "add", task.worktree, task.branch);
    delete merged.merge!.cleanedAt;
    f.db
      .query("UPDATE development_tasks SET state=? WHERE id=?")
      .run(JSON.stringify(merged), task.id);
    writeFileSync(join(task.worktree, "later.txt"), "must preserve");
    const blocked = await f.dev.merging.cleanup(task.id, actor);
    expect(blocked.merge!.cleanupError).toContain("未提交修改");
    expect(blocked.merge!.cleanedAt).toBeUndefined();
    expect(readFileSync(join(task.worktree, "later.txt"), "utf8")).toBe(
      "must preserve",
    );
    await expect(
      f.dev.merging.cleanup(task.id, { ...actor, writable: false }),
    ).rejects.toThrow("需要写入权限");
    rmSync(join(task.worktree, "later.txt"));
    await f.dev.close();
    f.reopen();
    const cleaned = await f.dev.merging.cleanup(task.id, actor);
    expect(cleaned.merge!.cleanedAt).toBeTruthy();
    expect(cleaned.merge!.cleanupError).toBeUndefined();
    expect(existsSync(task.worktree)).toBe(false);
    expect(git(f.repo, "branch", "--list", task.branch)).toBe("");
    expect((await f.dev.merging.cleanup(task.id, actor)).merge!.cleanedAt).toBe(
      cleaned.merge!.cleanedAt,
    );
    expect(git(f.repo, "show", "HEAD:index.html")).toContain("merged code");
  } finally {
    await f.close();
  }
}, 25000);

test("creation starts automatically; actionable reminders persist and never accept or merge tasks", async () => {
  const f = fixture();
  try {
    const task = await f.create("[APPROVAL]", true);
    const waiting = await until(
      () => f.dev.get(task.id, actor),
      (t) => t.status === "waiting",
    );
    expect(waiting.worktree).toBeTruthy();
    expect(f.dev.notifications(actor)).toHaveLength(1);
    expect(f.dev.notifications({ ...actor, identity: "other" })).toHaveLength(
      0,
    );
    const notice = waiting.attention!;
    f.dev.acknowledge(task.id, notice.id, actor);
    f.dev.acknowledge(task.id, notice.id, actor);
    expect(f.dev.notifications(actor)).toHaveLength(0);
    expect(f.dev.get(task.id, actor).status).toBe("waiting");
    await f.dev.answer(
      task.id,
      waiting.snapshot!.requests[0]!.id,
      { action: "accept" },
      actor,
    );
    const review = await until(
      () => f.dev.get(task.id, actor),
      (t) => t.status === "review",
    );
    expect(review.attention!.id).not.toBe(notice.id);
    expect(f.dev.notifications(actor)).toHaveLength(1);
    expect(() => f.dev.acknowledge(task.id, notice.id, actor)).toThrow();
    await f.dev.close();
    f.reopen();
    expect(f.dev.notifications(actor)).toHaveLength(1);
    f.dev.acknowledge(task.id, review.attention!.id, actor);
    expect(f.dev.get(task.id, actor).status).toBe("review");
    expect(f.dev.get(task.id, actor).merge).toBeFalsy();
    expect(git(f.repo, "log", "--format=%s")).toBe("baseline");
  } finally {
    await f.close();
  }
}, 25000);

test("development repository is loaded from the workspace directory", async () => {
  const f = fixture();
  try {
    const selection = await f.dev.selectDirectory(actor);
    expect(selection.directory).toBe(realpathSync(f.repo));
    expect(selection.currentBranch).toBe("main");
    expect(selection.branches).toContain("main");
  } finally {
    await f.close();
  }
});

test("workspace chat ignores a separately supplied working directory", async () => {
  const f = fixture();
  const chat = new CodexChat(f.db, f.dir, () => ({
    id: crypto.randomUUID(),
    name: "Workspace",
    description: "",
    directory: f.repo,
    version: 1,
    createdAt: "",
    updatedAt: "",
    lastOpenedAt: null,
  }));
  const calls: any[] = [];
  (chat as any).start = async () => {};
  (chat as any).rpc = async (method: string, params: any) => {
    calls.push({ method, params });
    return { thread: { id: crypto.randomUUID() } };
  };
  try {
    const result = await chat.create({ cwd: f.dir }, actor);
    expect(result.chat.cwd).toBe(realpathSync(f.repo));
    expect(calls.find((c) => c.method === "thread/start").params.cwd).toBe(
      result.chat.cwd,
    );
  } finally {
    await chat.close();
    await f.close();
  }
});

test("direct tasks preserve local edits, create no worktree and reject merge/cleanup", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.repo, "README.md"), "existing local edit");
    writeFileSync(join(f.repo, "local.txt"), "existing untracked file");
    const before = git(f.repo, "worktree", "list", "--porcelain");
    const task = await f.create("[HOLD]");
    expect(task.executionMode).toBe("workspace");
    expect(task.worktree).toBe(f.repo);
    expect(task.branch).toBe("main");
    await f.dev.start(task.id, actor);
    const running = await until(
      () => f.dev.get(task.id, actor),
      (t) => t.status === "running" && !!t.snapshot,
    );
    expect(running.snapshot!.chat.cwd).toBe(f.repo);
    expect(git(f.repo, "worktree", "list", "--porcelain")).toBe(before);
    expect(git(f.repo, "branch", "--list", "codex/dev-*")).toBe("");
    expect(readFileSync(join(f.repo, "README.md"), "utf8")).toBe(
      "existing local edit",
    );
    expect(readFileSync(join(f.repo, "local.txt"), "utf8")).toBe(
      "existing untracked file",
    );
    const second = await f.create("[HOLD]");
    await expect(f.dev.start(second.id, actor)).rejects.toThrow("已有研发任务");
    await f.dev.stop(task.id, actor);
    await until(
      () => f.dev.get(task.id, actor),
      (t) => t.status === "stopped",
    );
    f.dev.complete(task.id, actor);
    await expect(f.dev.merging.preview(task.id, actor)).rejects.toThrow(
      "无需合并",
    );
    await expect(f.dev.merging.cleanup(task.id, actor)).rejects.toThrow(
      "不能清理",
    );
    expect(existsSync(f.repo)).toBe(true);
  } finally {
    await f.close();
  }
}, 25000);

test("development MCP awaits async operations and preserves ownership and approvals", async () => {
  const f = fixture();
  const handler = createMcp(
    f.items,
    new SprintService(f.db, f.items),
    f.models,
    f.dev,
  );
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) =>
      handler.fetch(req, {
        authInfo: {
          token: "test",
          clientId: req.headers.get("x-test-owner") || actor.identity,
          scopes: req.headers.has("x-test-readonly")
            ? ["read"]
            : ["read", "write"],
        },
      }),
  });
  const clients: Client[] = [];
  async function connect(headers: Record<string, string> = {}) {
    const c = new Client({ name: "development-mcp-test", version: "1" });
    await c.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${server.port}/mcp`),
        { requestInit: { headers } },
      ),
    );
    clients.push(c);
    return c;
  }
  function value(r: any): any {
    expect(r.isError).not.toBe(true);
    return r.structuredContent.result;
  }
  try {
    const c = await connect(),
      reader = await connect({ "x-test-readonly": "1" }),
      other = await connect({ "x-test-owner": "other" });
    expect((await c.listTools()).tools).toHaveLength(42);
    const repo = value(
      await c.callTool({ name: "development_task_repository", arguments: {} }),
    );
    expect(repo.directory).toBe(f.repo);
    expect(repo.token).toBeString();
    const input = {
      task: {
        title: "MCP Development",
        requirement: "[APPROVAL]",
        directoryToken: repo.token,
        baseBranch: repo.currentBranch,
      },
    };
    expect(
      (
        await reader.callTool({
          name: "development_task_create",
          arguments: input,
        })
      ).isError,
    ).toBe(true);
    const task = value(
      await c.callTool({ name: "development_task_create", arguments: input }),
    );
    expect(task.id).toBeString();
    const waiting = await until(
      () => f.dev.get(task.id, actor),
      (t) => t.status === "waiting",
    );
    const snapshot = value(
      await c.callTool({
        name: "development_task_get",
        arguments: { id: task.id },
      }),
    );
    expect(snapshot.snapshot.requests).toHaveLength(1);
    expect(
      (
        await other.callTool({
          name: "development_task_get",
          arguments: { id: task.id },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await reader.callTool({
          name: "development_task_stop",
          arguments: { id: task.id },
        })
      ).isError,
    ).toBe(true);
    const changes = value(
      await c.callTool({
        name: "development_task_changes",
        arguments: { id: task.id },
      }),
    );
    expect(changes.status).toBeString();
    expect(
      value(
        await c.callTool({ name: "development_task_list", arguments: {} }),
      ).some((t: any) => t.id === task.id),
    ).toBe(true);
    value(
      await c.callTool({
        name: "development_task_answer",
        arguments: {
          id: task.id,
          requestId: waiting.snapshot!.requests[0]!.id,
          action: "accept",
        },
      }),
    );
    await until(
      () => f.dev.get(task.id, actor),
      (t) => t.status === "review",
    );
    expect(
      (
        await c.callTool({
          name: "development_task_complete",
          arguments: { id: task.id },
        })
      ).isError,
    ).toBe(true);
    const done = value(
      await c.callTool({
        name: "development_task_complete",
        arguments: { id: task.id, confirmed: true },
      }),
    );
    expect(done.status).toBe("completed");
    const unsupported = await c.callTool({
      name: "development_task_merge_preview",
      arguments: { id: task.id },
    });
    expect(unsupported.isError).toBe(true);
    expect(JSON.stringify(unsupported.content)).toContain("无需合并");
  } finally {
    for (const c of clients) await c.close();
    await server.stop(true);
    await handler.close();
    await f.close();
  }
}, 25000);

test("linked item acceptance checks ownership, membership and versions atomically", async () => {
  const f = fixture();
  try {
    const task = await f.create();
    const first = f.items.create({ title: "验收一" }, actor);
    const second = f.items.create({ title: "验收二" }, actor);
    const outside = f.items.create({ title: "其他任务" }, actor);
    const refs = [first, second].map((i) => ({
      id: i.id,
      expectedVersion: i.version,
    }));
    const input = { status: "done", items: refs };
    expect(() => f.dev.updateLinkedItems(task.id, input, actor)).toThrow(
      "等待研发结束",
    );
    task.status = "review";
    task.sources.items = [first, second];
    f.db
      .query("UPDATE development_tasks SET state=? WHERE id=?")
      .run(JSON.stringify(task), task.id);
    expect(() =>
      f.dev.updateLinkedItems(task.id, input, { ...actor, writable: false }),
    ).toThrow("写入权限");
    expect(() =>
      f.dev.updateLinkedItems(task.id, input, { ...actor, identity: "other" }),
    ).toThrow("不存在");
    expect(() =>
      f.dev.updateLinkedItems(
        task.id,
        { ...input, items: [{ id: outside.id, expectedVersion: 1 }] },
        actor,
      ),
    ).toThrow("未关联");
    f.items.update(second.id, { expectedVersion: 1, title: "已变更" }, actor);
    expect(() => f.dev.updateLinkedItems(task.id, input, actor)).toThrow();
    expect(f.items.get(first.id).status).toBe("todo");
    const updated = f.dev.updateLinkedItems(
      task.id,
      { status: "awaiting_acceptance", items: [refs[0]] },
      actor,
    );
    expect(updated[0]?.status).toBe("awaiting_acceptance");
    expect(f.dev.get(task.id, actor).status).toBe("review");
    expect(f.items.events(first.id, {}).data[0]?.source).toBe("web");
  } finally {
    await f.close();
  }
});

test("large development sources persist references and resolve latest content per execution", async () => {
  const f = fixture();
  try {
    const item = f.items.create({ title: "关联需求" }, actor);
    const model = f.models.create(
      {
        name: "大模型",
        description: "资料",
        elements: [
          {
            id: crypto.randomUUID(),
            kind: "aggregate_root",
            name: "订单",
            description: "内容",
            fields: Array.from({ length: 20 }, (_, i) => ({
              id: crypto.randomUUID(),
              name: `字段${i}`,
              dataType: "string",
              description: "长".repeat(1800),
            })),
          },
        ],
      },
      actor,
    );
    const task = await f.create("实现关联需求", false, {
      itemIds: [item.id],
      modelIds: [model.id],
    });
    expect(task.sourceMode).toBe("references");
    expect(JSON.stringify(task.sources).length).toBeLessThan(1000);
    expect(task.sources.models[0]!.elements).toBeUndefined();
    f.items.update(
      item.id,
      { expectedVersion: item.version, title: "最新需求" },
      actor,
    );
    const prompt = await prepareDevelopmentSources(
      task,
      f.dir,
      f.items,
      f.models,
    );
    expect(prompt.length).toBeLessThan(1000);
    const path = JSON.parse(prompt.match(/索引文件：(.*)。先读取/)![1]!);
    const index = JSON.parse(readFileSync(path, "utf8"));
    expect(JSON.parse(readFileSync(index.items[0].path, "utf8")).title).toBe(
      "最新需求",
    );
    const modelIndex = JSON.parse(readFileSync(index.models[0].path, "utf8"));
    expect(
      JSON.parse(readFileSync(modelIndex.elements[0].path, "utf8")).fields[0]
        .description.length,
    ).toBe(1800);
    f.items.remove(item.id, 2, actor);
    await expect(
      prepareDevelopmentSources(task, f.dir, f.items, f.models),
    ).rejects.toThrow("关联资料已删除或不存在");
    // Historical tasks keep their original source, even if it has since been deleted.
    task.sourceMode = undefined;
    task.sources.items = [item];
    task.sources.models = [model];
    const legacyPrompt = await prepareDevelopmentSources(
      task,
      f.dir,
      f.items,
      f.models,
    );
    const legacyPath = JSON.parse(
      legacyPrompt.match(/索引文件：(.*)。先读取/)![1]!,
    );
    const legacyIndex = JSON.parse(readFileSync(legacyPath, "utf8"));
    expect(
      JSON.parse(readFileSync(legacyIndex.items[0].path, "utf8")).title,
    ).toBe("关联需求");
  } finally {
    await f.close();
  }
});

test("new assistant source context is set before first turn without resuming an empty thread", async () => {
  const f = fixture();
  const chat = new CodexChat(
    f.db,
    f.dir,
    undefined,
    undefined,
    async () => "稳定的资料索引",
  );
  const original = (chat as any).rpc.bind(chat);
  let starts = 0;
  (chat as any).rpc = async (method: string, params: any, ...rest: any[]) => {
    if (method === "thread/start") {
      expect(params.developerInstructions).toContain("稳定的资料索引");
      starts++;
    }
    if (method === "thread/resume")
      throw new Error("no rollout found for empty thread");
    return original(method, params, ...rest);
  };
  try {
    const created = await chat.create({ cwd: f.repo }, actor);
    await chat.message(
      created.chat.id,
      { text: "[APPROVAL]", clientId: crypto.randomUUID() },
      actor,
    );
    const result = await until(
      () => chat.checkpoint(created.chat.id)!,
      (value) => !!value.requests.length || !!value.error,
    );
    expect(result.error).toBeNull();
    expect(result.requests.length).toBeGreaterThan(0);
    expect(starts).toBe(1);
  } finally {
    await chat.close();
    await f.close();
  }
});

test("permanent task deletion validates confirmation and removes Codex thread, history and source files", async () => {
  const f = fixture();
  try {
    const task = await f.create("[APPROVAL]");
    const item = f.items.create({ title: "保留关联工作项" }, actor);
    task.sources.items = [item];
    f.db
      .query("UPDATE development_tasks SET state=? WHERE id=?")
      .run(JSON.stringify(task), task.id);
    await expect(
      f.dev.remove(
        task.id,
        { confirmed: false, expectedVersion: task.version },
        actor,
      ),
    ).rejects.toThrow();
    await expect(
      f.dev.remove(
        task.id,
        { confirmed: true, expectedVersion: task.version },
        { ...actor, identity: "other" },
      ),
    ).rejects.toThrow("不存在");
    await expect(
      f.dev.remove(
        task.id,
        { confirmed: true, expectedVersion: task.version + 1 },
        actor,
      ),
    ).rejects.toThrow("已更新");
    await f.dev.start(task.id, actor);
    const waiting = await until(
      () => f.dev.get(task.id, actor),
      (value) => value.status === "waiting",
    );
    await expect(
      f.dev.remove(
        task.id,
        { confirmed: true, expectedVersion: waiting.version },
        actor,
      ),
    ).rejects.toThrow("先停止");
    await f.dev.stop(task.id, actor);
    const stopped = await until(
      () => f.dev.get(task.id, actor),
      (value) => value.status === "stopped",
    );
    const original = (f.dev.chat as any).rpc.bind(f.dev.chat);
    let deletedThread = "";
    (f.dev.chat as any).rpc = async (
      method: string,
      params: any,
      ...rest: any[]
    ) => {
      if (method === "thread/delete") {
        deletedThread = params.threadId;
        return {};
      }
      if (method === "thread/archive")
        throw new Error("must delete, not archive");
      return original(method, params, ...rest);
    };
    expect(existsSync(join(f.dir, "development-sources", task.id))).toBe(true);
    await f.dev.remove(
      task.id,
      { confirmed: true, expectedVersion: stopped.version },
      actor,
    );
    expect(deletedThread).toBe(stopped.chatId!);
    expect(() => f.dev.get(task.id, actor)).toThrow("不存在");
    expect(
      f.db.query("SELECT id FROM codex_chats WHERE id=?").get(stopped.chatId!),
    ).toBeNull();
    expect(
      f.db
        .query("SELECT chat_id FROM chat_history_snapshots WHERE chat_id=?")
        .get(stopped.chatId!),
    ).toBeNull();
    expect(existsSync(join(f.dir, "development-sources", task.id))).toBe(false);
    expect(f.items.get(item.id).title).toBe(item.title);
    expect(existsSync(join(f.repo, "README.md"))).toBe(true);
  } finally {
    await f.close();
  }
});

test("Codex delete failures retain the task and chat for retry", async () => {
  const f = fixture();
  try {
    const task = await f.create();
    const chat = await f.dev.chat.create({ cwd: f.repo }, actor);
    task.chatId = chat.chat.id;
    f.db
      .query("UPDATE development_tasks SET state=? WHERE id=?")
      .run(JSON.stringify(task), task.id);
    const original = (f.dev.chat as any).rpc.bind(f.dev.chat);
    (f.dev.chat as any).rpc = async (method: string, ...args: any[]) => {
      if (method === "thread/delete")
        throw new Error("Codex delete unavailable");
      return original(method, ...args);
    };
    await expect(
      f.dev.remove(
        task.id,
        { confirmed: true, expectedVersion: task.version },
        actor,
      ),
    ).rejects.toThrow("Codex delete unavailable");
    expect(f.dev.get(task.id, actor).chatId).toBe(chat.chat.id);
    expect(
      f.db.query("SELECT id FROM codex_chats WHERE id=?").get(chat.chat.id),
    ).not.toBeNull();
  } finally {
    await f.close();
  }
});

test("acceptance evidence persists, checks version and rejects unrelated work items", async () => {
  const f = fixture();
  try {
    const item = f.items.create(
      { title: "验收目标", description: "按钮可用" },
      actor,
    );
    const task = await f.create("实现按钮", false, { itemIds: [item.id] });
    task.status = "review";
    task.deliveryHistory = [
      {
        id: "delivery-1",
        createdAt: new Date().toISOString(),
        completed: "实现按钮",
        verification: "未执行测试",
        remaining: "人工验收",
        raw: "report",
      },
    ];
    f.db
      .query("UPDATE development_tasks SET state=? WHERE id=?")
      .run(JSON.stringify(task), task.id);
    const saved = f.dev.saveAcceptanceEvidence(
      task.id,
      {
        itemId: item.id,
        text: "本地点击按钮，导航正常",
        expectedVersion: task.version,
      },
      actor,
    );
    expect(saved.acceptanceEvidence?.[item.id]?.deliveryId).toBe("delivery-1");
    expect(f.dev.get(task.id, actor).acceptanceEvidence?.[item.id]?.text).toBe(
      "本地点击按钮，导航正常",
    );
    expect(() =>
      f.dev.saveAcceptanceEvidence(
        task.id,
        { itemId: item.id, text: "stale", expectedVersion: task.version },
        actor,
      ),
    ).toThrow("任务已更新");
    expect(() =>
      f.dev.saveAcceptanceEvidence(
        task.id,
        {
          itemId: crypto.randomUUID(),
          text: "unrelated",
          expectedVersion: saved.version,
        },
        actor,
      ),
    ).toThrow("工作项未关联");
  } finally {
    await f.close();
  }
});
