// Deterministic App Server peer; no external account or actual elevated command.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
const dir = process.env.DEVELOPMENT_FIXTURE_DIR!;
mkdirSync(dir, { recursive: true });
const file = join(dir, "threads.json");
const threads: Record<string, any> = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : {};
const pending = new Map<string, { threadId: string; turn: any; item: any }>();
const save = () => writeFileSync(file, JSON.stringify(threads));
const send = (value: unknown) =>
  process.stdout.write(JSON.stringify(value) + "\n");
const event = (method: string, params: unknown) => send({ method, params });
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const m = JSON.parse(line),
    p = m.params || {};
  if (!m.method) {
    const r = pending.get(String(m.id));
    if (!r) return;
    const accepted = m.result?.decision === "accept";
    writeFileSync(join(dir, `${r.turn.id}-decision.json`), JSON.stringify(m));
    if (accepted)
      writeFileSync(join(dir, `${r.turn.id}-approved.txt`), "approved");
    r.item.status = accepted ? "completed" : "declined";
    event("item/completed", {
      threadId: r.threadId,
      turnId: r.turn.id,
      item: r.item,
    });
    const message = {
      id: crypto.randomUUID(),
      type: "agentMessage",
      text: accepted
        ? "授权通过，交付待验收。"
        : "授权已拒绝，没有执行命令或修改文件。",
    };
    r.turn.items.push(message);
    r.turn.status = "completed";
    save();
    pending.delete(String(m.id));
    event("item/completed", {
      threadId: r.threadId,
      turnId: r.turn.id,
      item: message,
    });
    event("turn/completed", { threadId: r.threadId, turn: r.turn });
    return;
  }
  const reply = (result: unknown) => send({ id: m.id, result });
  if (m.method === "initialized") return;
  if (m.method === "initialize") reply({ userAgent: "development-fixture" });
  else if (m.method === "account/read")
    reply({
      account: { type: "chatgpt", email: "fixture@example.invalid" },
      requiresOpenaiAuth: false,
    });
  else if (m.method === "model/list")
    reply({
      data: [
        {
          id: "fixture",
          model: "fixture",
          displayName: "Fixture",
          isDefault: true,
        },
      ],
      nextCursor: null,
    });
  else if (m.method === "thread/start") {
    const id = crypto.randomUUID();
    threads[id] = { id, model: "fixture", turns: [] };
    save();
    reply({ thread: threads[id] });
  } else if (m.method === "thread/resume")
    reply({ thread: { ...threads[p.threadId], status: { type: "idle" } } });
  else if (m.method === "thread/read") reply({ thread: threads[p.threadId] });
  else if (m.method === "thread/items/list")
    reply({
      data: (threads[p.threadId]?.turns || [])
        .flatMap((t: any) => t.items.map((item: any) => ({ item })))
        .reverse(),
      nextCursor: null,
    });
  else if (m.method === "turn/start") {
    const text = p.input
      .filter((i: any) => i.type === "text")
      .map((i: any) => i.text)
      .join("\n");
    const user = {
      id: crypto.randomUUID(),
      type: "userMessage",
      clientId: p.clientUserMessageId,
      content: [{ type: "text", text }],
    };
    const turn = {
      id: crypto.randomUUID(),
      status: "inProgress",
      items: [user] as any[],
    };
    threads[p.threadId].turns.push(turn);
    save();
    reply({ turn });
    event("turn/started", { threadId: p.threadId, turn });
    event("item/completed", {
      threadId: p.threadId,
      turnId: turn.id,
      item: user,
    });
    if (text.includes("[HOLD]")) {
      const item = {
        id: crypto.randomUUID(),
        type: "commandExecution",
        status: "inProgress",
        command: "hold-fixture",
      };
      turn.items.push(item);
      save();
      event("item/started", { threadId: p.threadId, turnId: turn.id, item });
      return;
    }
    const isFile = text.includes("[FILE_APPROVAL]");
    const item = {
      id: crypto.randomUUID(),
      type: isFile ? "fileChange" : "commandExecution",
      status: "inProgress",
      command: "printf approval-fixture",
      changes: isFile
        ? [{ path: "fixture.txt", diff: "+approved" }]
        : undefined,
    };
    turn.items.push(item);
    save();
    event("item/started", { threadId: p.threadId, turnId: turn.id, item });
    const requestId = `approval-${turn.id}`;
    pending.set(requestId, { threadId: p.threadId, turn, item });
    event("turn/plan/updated", {
      threadId: p.threadId,
      turnId: turn.id,
      explanation: "授权集成测试",
      plan: [{ step: "等待明确授权", status: "in_progress" }],
    });
    send({
      id: requestId,
      method: isFile
        ? "item/fileChange/requestApproval"
        : "item/commandExecution/requestApproval",
      params: {
        threadId: p.threadId,
        turnId: turn.id,
        itemId: item.id,
        command: "printf approval-fixture",
        reason: "仅验证一次性授权卡片",
        availableDecisions: ["accept", "decline", "cancel"],
      },
    });
  } else if (m.method === "turn/interrupt") {
    const turn = threads[p.threadId].turns.find((t: any) => t.id === p.turnId);
    if (turn) {
      turn.status = "interrupted";
      save();
      event("turn/completed", { threadId: p.threadId, turn });
    }
    reply({});
  } else reply({});
});
lines.on("close", () => process.exit(0));
