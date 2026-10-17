import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  WorkflowExecution,
  initializeWorkflowExecution,
} from "../server/services/workflow-execution";
import type { Actor } from "../server/services/work-items";
import type { ChatSnapshot } from "../shared/chat";
const actor: Actor = {
  identity: "local",
  writable: true,
  source: "web",
  requestId: "test",
};
const input = {
  template: {
    id: crypto.randomUUID(),
    name: "Test",
    description: "",
    prompt: "完成 {{目标}}",
  },
  values: { 目标: "总结" },
  sources: [],
  notes: "记录",
};
function setup() {
  const db = new Database(":memory:");
  initializeWorkflowExecution(db);
  const calls: string[] = [];
  const prompts: string[] = [];
  const snapshot: ChatSnapshot = {
    revision: 1,
    chat: {
      id: crypto.randomUUID(),
      title: "test",
      cwd: "/tmp",
      model: null,
      updatedAt: new Date().toISOString(),
    },
    items: [],
    requests: [],
    running: true,
    stopping: false,
    error: null,
    nextCursor: null,
  };
  const chat = {
    async create() {
      calls.push("create");
      return structuredClone(snapshot);
    },
    async message(_id: string, request: unknown) {
      prompts.push((request as { text: string }).text);
      calls.push("message");
      return structuredClone(snapshot);
    },
    async readChat() {
      return structuredClone(snapshot);
    },
    async stop() {
      calls.push("stop");
      snapshot.running = false;
      return structuredClone(snapshot);
    },
  };
  return {
    db,
    calls,
    prompts,
    snapshot,
    service: new WorkflowExecution(db, chat),
  };
}
describe("workflow execution", () => {
  test("persists immutable inputs and derives results from Codex", async () => {
    const { db, calls, snapshot, service } = setup();
    const request = structuredClone(input);
    const run = await service.start(request, actor);
    request.template.prompt = "changed";
    expect(run.status).toBe("running");
    snapshot.running = false;
    snapshot.items = [
      {
        id: "result",
        role: "assistant",
        type: "agentMessage",
        text: "摘要草稿",
      },
    ];
    const history = await service.list(actor);
    expect(history.items[0]?.template.prompt).toBe(input.template.prompt);
    expect(history.items[0]?.status).toBe("completed");
    expect(history.items[0]?.result).toBe("摘要草稿");
    await service.rerun(run.id, actor);
    expect(calls.filter((call) => call === "message")).toHaveLength(2);
    expect((await service.list({ ...actor, identity: "other" })).total).toBe(0);
    service.close();
    db.close();
  });
  test("cancellation persists and no replay occurs after service restart", async () => {
    const { db, calls, service } = setup();
    const run = await service.start(input, actor);
    await service.cancel(run.id, actor);
    expect((await service.list(actor)).items[0]?.status).toBe("cancelled");
    const interrupted = await service.start(input, actor);
    service.recoverInterruptedRuns();
    expect(
      (await service.list(actor)).items.find(
        (item) => item.id === interrupted.id,
      )?.status,
    ).toBe("interrupted");
    expect(calls.filter((call) => call === "message")).toHaveLength(2);
    service.close();
    db.close();
  });
});

describe("workflow lifecycle and record integrity", () => {
  test("rejects invalid pages and paginates runs by twelve", async () => {
    const { db, service } = setup();
    for (const page of [NaN, Infinity, -1, 0, 1.5])
      await expect(service.list(actor, page)).rejects.toThrow("页码");
    for (let i = 0; i < 13; i++) await service.start(input, actor);
    expect((await service.list(actor)).items).toHaveLength(12);
    expect((await service.list(actor, 2)).items).toHaveLength(1);
    expect((await service.list(actor)).total).toBe(13);
    await service.close();
    db.close();
  });
  test("close waits for an in-flight Codex request before database disposal", async () => {
    const db = new Database(":memory:");
    initializeWorkflowExecution(db);
    let resolve!: (value: any) => void;
    const creation = new Promise<any>((done) => (resolve = done));
    const service = new WorkflowExecution(db, {
      create: () => creation,
      message: async () => null as any,
      readChat: async () => null,
      stop: async () => null as any,
    });
    const pending = service.start(input, actor);
    let closed = false;
    const close = service.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    resolve({ chat: { id: crypto.randomUUID() } });
    const result = await pending;
    await close;
    expect(result.status).toBe("failed");
    expect(closed).toBe(true);
    db.close();
  });
  test("cancel wins over a stale asynchronous list refresh", async () => {
    const db = new Database(":memory:");
    initializeWorkflowExecution(db);
    const snapshot: ChatSnapshot = {
      revision: 1,
      chat: {
        id: crypto.randomUUID(),
        title: "test",
        cwd: "/tmp",
        model: null,
        updatedAt: new Date().toISOString(),
      },
      items: [],
      requests: [],
      running: true,
      stopping: false,
      error: null,
      nextCursor: null,
    };
    let resolve!: (value: ChatSnapshot) => void;
    const service = new WorkflowExecution(db, {
      create: async () => snapshot,
      message: async () => snapshot,
      readChat: () =>
        new Promise((done) => {
          resolve = done;
        }),
      stop: async () => snapshot,
    });
    const run = await service.start(input, actor);
    const listing = service.list(actor);
    await service.cancel(run.id, actor);
    resolve(snapshot);
    expect((await listing).items[0]?.status).toBe("cancelled");
    await service.close();
    db.close();
  });
  test("saved artifacts come from same-owner assistant flows", async () => {
    const { db, service } = setup();
    const run = await service.start(input, actor);
    db.exec("CREATE TABLE assistant_flows (id TEXT, owner TEXT, state TEXT)");
    const state = {
      chatId: run.chatId,
      createdItems: [{ id: "item", title: "工作项" }],
      modelId: "model",
      modelDraft: { name: "模型" },
      businessResult: { label: "笔记", url: "/notes/note" },
    };
    db.query("INSERT INTO assistant_flows VALUES (?,?,?)").run(
      "flow",
      actor.identity,
      JSON.stringify(state),
    );
    db.query("INSERT INTO assistant_flows VALUES (?,?,?)").run(
      "other",
      "other",
      JSON.stringify({
        ...state,
        createdItems: [{ id: "secret", title: "secret" }],
      }),
    );
    const artifacts = (await service.list(actor)).items[0]?.artifacts;
    expect(artifacts?.map((item) => item.url)).toEqual([
      "/work-items/item",
      "/domain-models/model",
      "/notes/note",
    ]);
    await service.close();
    db.close();
  });
});
