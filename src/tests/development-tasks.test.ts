import { test, expect } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  chmodSync,
  readFileSync,
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
  const dir = mkdtempSync(join(tmpdir(), "dedsiwork-development-test-")),
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
  let dev = new DevelopmentTasks(db, dir, items, models, join(dir, "trees"));
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
      dev = new DevelopmentTasks(db, dir, items, models, join(dir, "trees"));
      return dev;
    },
    async create(requirement = "[APPROVAL]", autoStart = false) {
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

test("SIGKILL restart preserves WAL history and resumes the same worktree and chat", async () => {
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
  return f.dev.complete(task.id, actor);
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
