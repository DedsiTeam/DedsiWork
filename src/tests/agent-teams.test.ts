import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db/database";
import { WorkItemService, type Actor } from "../server/services/work-items";
import { WorkItemRepository } from "../server/repositories/work-items";
import { DomainModelService } from "../server/services/domain-models";
import { DevelopmentTasks } from "../server/services/development-tasks";
import {
  AgentTeams,
  discoverAgents,
  validateTeamPlan,
} from "../server/services/agent-teams";
import { CodexChat } from "../server/codex/chat";
import type { ChatSnapshot } from "../shared/chat";
import type { TeamPlan, ProjectAgent } from "../shared/agent-team";
import { createTestApp } from "./helpers/app";

const actor: Actor = {
  source: "web",
  identity: "team-test",
  writable: true,
  requestId: "team-test",
};
const agent = (name: string): ProjectAgent => ({
  name,
  description: `${name}角色`,
  instructions: `只处理${name}`,
  file: `${name}.toml`,
  fingerprint: name,
  model: "fixture",
  effort: "low",
});
const plan = (): TeamPlan => ({
  summary: "实现两项独立能力，接口保持兼容。",
  questions: [],
  models: [],
  items: [
    {
      title: "功能需求",
      description: "完成两项能力并验收",
      type: "feature",
      priority: "normal",
    },
  ],
  tasks: [
    {
      key: "one",
      title: "能力一",
      agent: "first",
      requirement: "完成能力一并运行验证",
      files: ["src/one"],
      dependsOn: [],
      itemIndexes: [0],
    },
    {
      key: "two",
      title: "能力二",
      agent: "second",
      requirement: "完成能力二并运行验证",
      files: ["src/two"],
      dependsOn: [],
      itemIndexes: [0],
    },
  ],
});
const git = (repo: string, ...args: string[]) => {
  const result = Bun.spawnSync(["git", "-C", repo, ...args]);
  if (result.exitCode) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
};
async function until<T>(read: () => T, ready: (value: T) => boolean) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    const value = read();
    if (ready(value)) return value;
    await Bun.sleep(20);
  }
  throw new Error("等待群聊状态超时");
}

function fakeChat(chat: CodexChat, result: () => TeamPlan, hold = false) {
  const states = new Map<string, ChatSnapshot>();
  const settings = new Map<string, any>();
  chat.create = async (_input, _actor, config) => {
    const id = crypto.randomUUID();
    settings.set(id, config);
    const snapshot: ChatSnapshot = {
      revision: 1,
      chat: {
        id,
        title: "fixture",
        cwd: "",
        model: "fixture",
        updatedAt: new Date().toISOString(),
      },
      items: [],
      requests: [],
      running: false,
      stopping: false,
      error: null,
      nextCursor: null,
    };
    states.set(id, snapshot);
    return snapshot;
  };
  chat.message = async (id, input) => {
    const state = states.get(id)!;
    const text = (input as any).text;
    const readonly = settings.get(id)?.readOnly;
    state.running = hold || !readonly;
    state.items = [
      {
        id: crypto.randomUUID(),
        role: "assistant",
        type: "agentMessage",
        text: readonly
          ? text.includes("输出一个 JSON 对象")
            ? JSON.stringify(result())
            : "事实：已阅读提供的资料。建议：分别实现。风险：需在研发时核实代码。待决事项：无。"
          : "正在独立工作树研发",
      },
    ];
    state.tokenUsage = { total: readonly ? 100 : 300, known: true };
    if (readonly) {
      state.items[0]!.phase = "final_answer";
      state.items.unshift({
        id: crypto.randomUUID(),
        role: "assistant",
        type: "agentMessage",
        phase: "commentary",
        text: "正在读取资料并检查相关实现。",
      });
    }
    return state;
  };
  chat.checkpoint = (id) => states.get(id) || null;
  chat.stop = async (id) => {
    const state = states.get(id);
    if (state) state.running = false;
    return state!;
  };
  return { states, settings };
}
function setup() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "dedsiwork-team-test-"))),
    repo = join(dir, "project");
  mkdirSync(repo);
  git(repo, "init", "-b", "main");
  writeFileSync(join(repo, "README.md"), "baseline\n");
  git(repo, "add", ".");
  git(
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "baseline",
  );
  const folder = join(repo, ".codex", "agents");
  mkdirSync(folder, { recursive: true });
  for (const a of [agent("first"), agent("second")])
    writeFileSync(
      join(folder, a.file),
      `name=${JSON.stringify(a.name)}\ndescription=${JSON.stringify(a.description)}\nmodel="fixture"\nmodel_reasoning_effort="low"\ndeveloper_instructions=${JSON.stringify(a.instructions)}`,
    );
  const db = openDatabase(join(dir, "data.sqlite")),
    items = new WorkItemService(new WorkItemRepository(db)),
    models = new DomainModelService(db);
  const dev = new DevelopmentTasks(
    db,
    dir,
    items,
    models,
    join(dir, "trees"),
    () => repo,
  );
  const teams = new AgentTeams(db, dir, () => repo, items, models, dev);
  let output = plan();
  const discussion = fakeChat(teams.chat, () => output),
    execution = fakeChat(dev.chat, () => output);
  return {
    dir,
    repo,
    folder,
    db,
    items,
    models,
    dev,
    teams,
    discussion,
    execution,
    setPlan: (p: TeamPlan) => {
      output = p;
    },
    async close() {
      await teams.close();
      await dev.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("project roles reload dynamically and malformed or duplicate configurations are reported", async () => {
  const f = setup();
  try {
    const first = await discoverAgents(f.repo);
    expect(first.agents.map((a) => a.name)).toEqual(["first", "second"]);
    writeFileSync(
      join(f.folder, "first.toml"),
      'name="first"\ndescription="updated"\ndeveloper_instructions="updated role"',
    );
    writeFileSync(join(f.folder, "bad.toml"), "invalid toml !!");
    writeFileSync(
      join(f.folder, "duplicate.toml"),
      'name="second"\ndescription="duplicate"\ndeveloper_instructions="duplicate"',
    );
    const second = await discoverAgents(f.repo);
    expect(second.errors.length).toBe(2);
    expect(second.agents.find((a) => a.name === "first")!.fingerprint).not.toBe(
      first.agents[0]!.fingerprint,
    );
    expect(() => f.teams.discover({ ...actor, writable: false })).toThrow();
  } finally {
    await f.close();
  }
});
test("plans reject cycles, missing roles, invalid references and overlapping parallel ownership", () => {
  const agents = [agent("first"), agent("second")];
  for (const change of [
    (p: TeamPlan) => {
      p.tasks[0]!.dependsOn = ["two"];
      p.tasks[1]!.dependsOn = ["one"];
    },
    (p: TeamPlan) => {
      p.tasks[0]!.agent = "missing";
    },
    (p: TeamPlan) => {
      p.tasks[0]!.itemIndexes = [5];
    },
    (p: TeamPlan) => {
      p.tasks[1]!.files = ["src/one/child.ts"];
    },
    (p: TeamPlan) => {
      p.tasks[0]!.files = ["../outside.ts"];
    },
  ]) {
    const p = plan();
    change(p);
    expect(() => validateTeamPlan(p, agents)).toThrow();
  }
  const p = plan();
  p.tasks[1]!.files = ["src/one/child.ts"];
  p.tasks[1]!.dependsOn = ["one"];
  expect(validateTeamPlan(p, agents).tasks.length).toBe(2);
});
test("discussion snapshots roles, confirmation is idempotent and independent tasks use parallel isolated worktrees", async () => {
  const f = setup();
  try {
    let team = await f.teams.create(
      {
        title: "群聊",
        text: "实现两项能力",
        agents: ["first", "second"],
        maxParallel: 2,
        tokenBudget: 10000,
      },
      actor,
    );
    team = await until(
      () => f.teams.get(team.id, actor),
      (t) => t.status === "ready",
    );
    expect(team.usage).toBe(300);
    expect(team.usageKnown).toBe(true);
    expect(f.items.list({}).data.length).toBe(0);
    expect(
      [...f.discussion.settings.values()].every(
        (s) => s.readOnly && s.effort === "low",
      ),
    ).toBe(true);
    writeFileSync(
      join(f.folder, "first.toml"),
      'name="first"\ndescription="updated"\ndeveloper_instructions="new instructions"',
    );
    const request = {
      confirmed: true,
      expectedRevision: team.revision,
      baseBranch: "main",
      plan: team.plan,
    };
    team = await f.teams.confirm(team.id, request, actor);
    const again = await f.teams.confirm(team.id, request, actor);
    expect(again.tasks.map((t) => t.id)).toEqual(team.tasks.map((t) => t.id));
    expect(f.items.list({}).data.length).toBe(1);
    await until(
      () => f.dev.list(actor),
      (tasks) =>
        tasks.length === 2 && tasks.every((t) => t.status === "running"),
    );
    const tasks = f.dev.list(actor);
    expect(new Set(tasks.map((t) => t.worktree)).size).toBe(2);
    expect(tasks.every((t) => t.executionMode === "worktree")).toBe(true);
    expect(tasks.find((t) => t.team?.key === "one")!.team!.instructions).toBe(
      "只处理first",
    );
    await expect(f.dev.start(tasks[0]!.id, actor)).rejects.toBeDefined();
    expect(() =>
      f.teams.get(team.id, { ...actor, identity: "other" }),
    ).toThrow();
    const current = f.teams.get(team.id, actor);
    await f.teams.control(
      team.id,
      { action: "pause", expectedRevision: current.revision },
      actor,
    );
    await until(
      () => f.dev.list(actor),
      (tasks) =>
        tasks.every(
          (t) => !["running", "preparing", "stopping"].includes(t.status),
        ),
    );
    expect(f.teams.get(team.id, actor).status).toBe("paused");
  } finally {
    await f.close();
  }
});
test("dependencies stay queued until the prerequisite merge is in the base branch; budget exhaustion pauses active work", async () => {
  const f = setup();
  try {
    const p = plan();
    p.tasks[1]!.dependsOn = ["one"];
    f.setPlan(p);
    let team = await f.teams.create(
      {
        title: "依赖",
        text: "先完成共享契约",
        agents: ["first", "second"],
        tokenBudget: 1000,
      },
      actor,
    );
    team = await until(
      () => f.teams.get(team.id, actor),
      (t) => t.status === "ready",
    );
    team = await f.teams.confirm(
      team.id,
      {
        confirmed: true,
        expectedRevision: team.revision,
        baseBranch: "main",
        plan: team.plan,
      },
      actor,
    );
    await until(
      () => f.dev.list(actor),
      (tasks) => tasks.some((t) => t.status === "running"),
    );
    await Bun.sleep(1100);
    expect(f.dev.list(actor).find((t) => t.team?.key === "two")!.status).toBe(
      "draft",
    );
    const first = f.dev.list(actor).find((t) => t.team?.key === "one")!;
    f.execution.states.get(first.chatId!)!.tokenUsage = {
      total: 800,
      known: true,
    };
    await until(
      () => f.teams.get(team.id, actor),
      (t) => t.status === "paused",
    );
    expect(f.teams.get(team.id, actor).usage).toBeGreaterThanOrEqual(1100);
    expect(f.dev.list(actor).find((t) => t.team?.key === "two")!.status).toBe(
      "draft",
    );
  } finally {
    await f.close();
  }
});
test("unresolved questions and stale revisions create no business records", async () => {
  const f = setup();
  try {
    const p = plan();
    p.questions = ["请确认数据保留范围"];
    f.setPlan(p);
    let team = await f.teams.create(
      { title: "问题", text: "增加功能", agents: ["first", "second"] },
      actor,
    );
    team = await until(
      () => f.teams.get(team.id, actor),
      (t) => t.status === "ready",
    );
    await expect(
      f.teams.confirm(
        team.id,
        {
          confirmed: true,
          expectedRevision: team.revision,
          baseBranch: "main",
          plan: team.plan,
        },
        actor,
      ),
    ).rejects.toBeDefined();
    await expect(
      f.teams.message(
        team.id,
        { expectedRevision: team.revision - 1, text: "补充" },
        actor,
      ),
    ).rejects.toBeDefined();
    expect(f.items.list({}).data.length).toBe(0);
    expect(f.dev.list(actor).length).toBe(0);
  } finally {
    await f.close();
  }
});

test("prerequisite integration releases dependent work from the merged base commit", async () => {
  const f = setup();
  try {
    const p = plan();
    p.tasks[1]!.dependsOn = ["one"];
    f.setPlan(p);
    let team = await f.teams.create(
      {
        title: "依赖集成",
        text: "先完成接口，再实现依赖能力",
        agents: ["first", "second"],
        tokenBudget: 10000,
      },
      actor,
    );
    team = await until(
      () => f.teams.get(team.id, actor),
      (value) => value.status === "ready",
    );
    team = await f.teams.confirm(
      team.id,
      {
        confirmed: true,
        expectedRevision: team.revision,
        baseBranch: "main",
        plan: team.plan,
      },
      actor,
    );
    await until(
      () => f.dev.list(actor),
      (tasks) => tasks.some((task) => task.status === "running"),
    );
    const first = f.dev.list(actor).find((task) => task.team?.key === "one")!;
    await f.dev.stop(first.id, actor);
    await until(
      () => f.dev.get(first.id, actor),
      (task) => task.status === "stopped",
    );
    writeFileSync(join(f.repo, "contract.txt"), "confirmed interface\n");
    git(f.repo, "add", "contract.txt");
    git(
      f.repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "integrated prerequisite",
    );
    const commit = git(f.repo, "rev-parse", "HEAD");
    const saved = f.dev.get(first.id, actor);
    saved.status = "completed";
    saved.merge = {
      targetBranch: "main",
      targetCommit: commit,
      sourceCommit: commit,
      mergedAt: new Date().toISOString(),
    };
    f.db
      .query("UPDATE development_tasks SET state=? WHERE id=?")
      .run(JSON.stringify(saved), saved.id);
    let current = f.teams.get(team.id, actor);
    if (current.status === "paused")
      await f.teams.control(
        team.id,
        { action: "resume", expectedRevision: current.revision },
        actor,
      );
    const second = await until(
      () => f.dev.list(actor).find((task) => task.team?.key === "two")!,
      (task) => task.status === "running",
    );
    expect(second.baseCommit).toBe(commit);
    expect(git(second.worktree, "show", "HEAD:contract.txt")).toBe(
      "confirmed interface",
    );
  } finally {
    await f.close();
  }
});

test("token updates are monotonic, deduplicated and survive session recreation", async () => {
  const f = setup();
  const chat = new CodexChat(f.db, f.dir);
  try {
    const id = crypto.randomUUID(),
      child = crypto.randomUUID();
    const row = {
      id,
      title: "usage",
      cwd: f.repo,
      model: "fixture",
      owner: actor.identity,
      updatedAt: new Date().toISOString(),
    };
    f.db
      .query("INSERT INTO codex_chats VALUES (?,?,?,?,?,?)")
      .run(id, row.title, row.cwd, row.model, row.owner, row.updatedAt);
    const internal = chat as any;
    internal.sessions.set(id, internal.state(row));
    internal.routes.set(id, id);
    internal.routes.set(child, id);
    const update = (threadId: string, total: number) =>
      internal.onNotification({
        method: "thread/tokenUsage/updated",
        params: { threadId, tokenUsage: { total: { totalTokens: total } } },
      });
    update(id, 100);
    update(id, 100);
    update(id, 80);
    update(child, 50);
    expect(chat.checkpoint(id)!.tokenUsage).toEqual({
      total: 150,
      known: true,
    });
    expect(
      [...internal.state(row).usage.values()].reduce(
        (a: any, b: any) => a + b,
        0,
      ),
    ).toBe(150);
    f.db.query("INSERT INTO managed_chat_threads VALUES (?,?)").run(
      id,
      JSON.stringify({
        instructions: "role snapshot",
        readOnly: true,
        effort: "low",
      }),
    );
    expect(internal.policy(id).sandbox).toBe("read-only");
    await expect(
      chat.message(
        id,
        {
          text: "cannot bypass discussion controller",
          clientId: crypto.randomUUID(),
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: "MANAGED_CHAT" });
  } finally {
    await chat.close();
    await f.close();
  }
});

test("group HTTP endpoints enforce authentication, CSRF and workspace isolation", async () => {
  const origin = "http://127.0.0.1:3344",
    app = createTestApp(
      {
        origin,
        credentials: {
          pairingCode: "team-test-pairing-code",
          readToken: "team-read-token-0000000000000000000",
          writeToken: "team-write-token-000000000000000000",
        },
      },
      true,
    );
  const call = (
    path: string,
    headers: Record<string, string> = {},
    method = "GET",
    body?: unknown,
  ) =>
    app.handle(
      new Request(origin + path, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  try {
    expect((await call("/api/v1/agent-teams")).status).toBe(401);
    const session = await call("/auth/session"),
      cookie = session.headers.get("set-cookie")!.split(";")[0]!,
      csrf = (await session.json()).data.csrf;
    const first = (
      await (await call("/api/v1/workspaces", { Cookie: cookie })).json()
    ).data[0].id;
    const second = (
      await (
        await call(
          "/api/v1/workspaces",
          { Cookie: cookie, "X-CSRF-Token": csrf },
          "POST",
          { name: "second" },
        )
      ).json()
    ).data.id;
    const id = crypto.randomUUID();
    app
      .db!.query("INSERT INTO agent_teams VALUES (?,?,?)")
      .run(
        id,
        "local-user",
        JSON.stringify({
          id,
          title: "private",
          status: "ready",
          revision: 1,
          usage: 0,
          usageKnown: true,
          chats: [],
          tasks: [],
          updatedAt: new Date().toISOString(),
        }),
      );
    expect(
      (
        await call(`/api/v1/agent-teams/${id}`, {
          Cookie: cookie,
          "X-Workspace-Id": first,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`/api/v1/agent-teams/${id}`, {
          Cookie: cookie,
          "X-Workspace-Id": second,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          `/api/v1/agent-teams/${id}/confirm`,
          { Cookie: cookie, "X-Workspace-Id": first },
          "POST",
          {},
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call("/api/v1/agent-teams/agents", {
          Authorization: "Bearer team-read-token-0000000000000000000",
          "X-Workspace-Id": first,
        })
      ).status,
    ).toBe(403);
  } finally {
    await app.close();
  }
});
