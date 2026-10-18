import { test, expect, spyOn } from "bun:test";
import { openDatabase } from "../server/db/database";
import { CanvasNotes } from "../server/services/canvas-notes";
import { CanvasAssistant } from "../server/services/canvas-assistant";
import { CodexAppServer } from "../server/codex/app-server";
import {
  canvasAssistantNodes,
  canvasAssistantResultSchema,
  type CanvasAssistantResult,
} from "../shared/canvas-assistant";
import { CanvasHistory } from "../shared/canvas-history";
import type { Actor } from "../server/services/work-items";
const actor: Actor = {
  identity: "test",
  source: "web",
  writable: true,
  requestId: "test",
};
const result: CanvasAssistantResult = {
  reply: "已准备",
  action: "prototype",
  designSpec: null,
  targetId: "",
  designUpdates: [],
  text: "",
  width: 390,
  height: 844,
  imagePrompt: "",
  elements: [
    {
      kind: "text",
      x: 24,
      y: 24,
      width: 300,
      height: 40,
      text: "清单",
      fontSize: 24,
      bold: true,
    },
    {
      kind: "rect",
      x: 24,
      y: 80,
      width: 300,
      height: 40,
      text: "",
      fontSize: 16,
      bold: false,
    },
  ],
};
class Fake extends CodexAppServer<CanvasAssistantResult> {
  constructor() {
    super("model", {
      schema: canvasAssistantResultSchema,
      normalize: (v) => canvasAssistantResultSchema.parse(v),
      instructions: "test",
      label: "test",
    });
  }
  override async start() {}
  protected override async rpc<T>(method: string): Promise<T> {
    return (
      method === "account/read"
        ? { account: {} }
        : method === "thread/start"
          ? { thread: { id: "thread" } }
          : method === "turn/start"
            ? { turn: { id: "turn", status: "inProgress" } }
            : {}
    ) as T;
  }
  completeResponse() {
    (this as any).receive((this as any).child, {
      method: "turn/completed",
      params: {
        threadId: "thread",
        turn: {
          status: "completed",
          items: [
            {
              id: "answer",
              type: "agentMessage",
              text: JSON.stringify(result),
            },
          ],
        },
      },
    });
  }
}
test("prototype batches preserve source, associate children and undo together; reject overflow and capacity", () => {
  const nodes = canvasAssistantNodes(result, { nodes: [] });
  expect(nodes).toHaveLength(3);
  expect(nodes[1]!.containerId).toBe(nodes[0]!.id);
  expect(nodes[1]!.x).toBe(nodes[0]!.x + 24);
  const textNode = nodes.find((n) => n.kind === "text")!;
  expect(textNode.fill).toBe(textNode.textColor);
  const history = new CanvasHistory({ nodes: [] });
  history.record({ nodes });
  expect(history.undo()?.nodes).toHaveLength(0);
  expect(history.redo()?.nodes).toHaveLength(3);
  expect(() =>
    canvasAssistantNodes(
      { ...result, elements: [{ ...result.elements[0]!, x: 380 }] },
      { nodes: [] },
    ),
  ).toThrow("超出");
  expect(() =>
    canvasAssistantNodes(result, {
      nodes: Array.from({ length: 199 }, () => ({
        ...nodes[0]!,
        id: crypto.randomUUID(),
      })),
    }),
  ).toThrow();
});
test("note conversation persists results, isolates owners, guards writes, and recovers interrupted jobs", async () => {
  const db = openDatabase(":memory:");
  const engine = new Fake();
  const service = new CanvasAssistant(db, engine);
  try {
    const note = new CanvasNotes(db).save(
      null,
      { name: "test", content: { nodes: [] } },
      actor,
    );
    expect(() =>
      service.send(
        note.id,
        { prompt: "创建原型", context: "[]" },
        { ...actor, writable: false },
      ),
    ).toThrow();
    const m = service.send(
      note.id,
      { prompt: "请创建手机清单原型", context: "[]" },
      actor,
    );
    await Bun.sleep(20);
    engine.completeResponse();
    const completed = service.list(note.id, actor)[0]!;
    expect(completed.status).toBe("completed");
    expect(completed.result).toEqual(result);
    expect(service.list(note.id, { ...actor, identity: "other" })).toHaveLength(
      0,
    );
    await service.update(note.id, m.id, "applied", actor);
    expect(service.list(note.id, actor)[0]?.applied).toBe(true);
    await expect(
      service.update(note.id, m.id, "applied", { ...actor, identity: "other" }),
    ).rejects.toThrow();
    const pending = service.send(
      note.id,
      { prompt: "请继续完善这个原型", context: "[]" },
      actor,
    );
    const reopened = new CanvasAssistant(db, new Fake());
    expect(
      reopened.list(note.id, actor).find((v) => v.id === pending.id)?.status,
    ).toBe("failed");
    expect(reopened.list(note.id, actor)[0]?.applied).toBe(true);
    await reopened.close();
  } finally {
    await service.close();
    db.close();
  }
});

test("clear removes only this owner's note history, cancels pending jobs and resets next context", async () => {
  const db = openDatabase(":memory:");
  const engine = new Fake();
  const service = new CanvasAssistant(db, engine);
  const generate = spyOn(engine, "generate");
  const cancel = spyOn(engine, "cancel");
  try {
    const notes = new CanvasNotes(db);
    const note = notes.save(null, { name: "clear test", content: { nodes: [] } }, actor);
    const other = notes.save(null, { name: "other", content: { nodes: [] } }, actor);
    const m = service.send(note.id, { prompt: "旧上下文", context: "[]" }, actor);
    await Bun.sleep(20);
    const original = notes.get(note.id);
    const insert = db.query("INSERT INTO canvas_assistant_messages VALUES (?,?,?,?,?)");
    insert.run(note.id, "another-owner", crypto.randomUUID(), JSON.stringify({ ...m, status: "completed" }), new Date().toISOString());
    insert.run(other.id, actor.identity, crypto.randomUUID(), JSON.stringify({ ...m, status: "completed" }), new Date().toISOString());
    await expect(service.clear(note.id, { ...actor, writable: false })).rejects.toThrow();
    expect(service.list(note.id, actor)).toHaveLength(1);
    await service.clear(note.id, actor);
    expect(cancel).toHaveBeenCalledWith(m.jobId, actor);
    expect(service.list(note.id, actor)).toEqual([]);
    expect(service.list(note.id, { ...actor, identity: "another-owner" })).toHaveLength(1);
    expect(service.list(other.id, actor)).toHaveLength(1);
    expect(notes.get(note.id)).toEqual(original);
    service.send(note.id, { prompt: "新对话", context: "当前选中内容" }, actor);
    const request = generate.mock.calls.at(-1)![0] as { prompt: string };
    expect(JSON.parse(request.prompt)).toEqual({ history: [], context: "当前选中内容", request: "新对话" });
  } finally {
    generate.mockRestore();
    cancel.mockRestore();
    await service.close();
    db.close();
  }
});
