import type { Database } from "bun:sqlite";
import type { CodexChat } from "../codex/chat";
import { AppError } from "../../shared/errors";
import { PAGE_SIZE } from "../../shared/pagination";
import {
  renderWorkflow,
  workflowRunSchema,
  type WorkflowRun,
} from "../../shared/ai-workflow";
import type { Actor } from "./work-items";

export function initializeWorkflowExecution(db: Database) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS workflow_runs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL);`,
  );
}
type Chat = Pick<CodexChat, "create" | "message" | "readChat" | "stop">;
export class WorkflowExecution {
  private closed = false;
  private pending = new Set<Promise<unknown>>();
  private track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    void operation
      .finally(() => this.pending.delete(operation))
      .catch(() => {});
    return operation;
  }
  private page(value: number) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 1000000)
      throw new AppError("INVALID_PAGE", "页码必须为有效的正整数");
    return value;
  }
  private hasTable(name: string) {
    return !!this.db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name);
  }

  constructor(
    private db: Database,
    private chat: Chat,
  ) {}
  private access(actor: Actor) {
    if (this.closed) throw new AppError("CLOSED", "服务正在关闭", 503);
    if (!actor.writable) throw new AppError("FORBIDDEN", "需要写入权限", 403);
  }
  private write(run: WorkflowRun, owner: string) {
    run.updatedAt = new Date().toISOString();
    this.db
      .query(
        "INSERT INTO workflow_runs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state WHERE json_extract(workflow_runs.state,'$.status') != 'cancelled' OR json_extract(excluded.state,'$.status')='cancelled'",
      )
      .run(run.id, owner, JSON.stringify(run));
  }
  private get(id: string, actor: Actor) {
    this.access(actor);
    const row = this.db
      .query("SELECT state FROM workflow_runs WHERE id=? AND owner=?")
      .get(id, actor.identity) as { state: string } | null;
    if (!row) throw new AppError("NOT_FOUND", "运行记录不存在", 404);
    return JSON.parse(row.state) as WorkflowRun;
  }
  start(input: unknown, actor: Actor) {
    return this.track(this.performStart(input, actor));
  }
  private async performStart(input: unknown, actor: Actor) {
    this.access(actor);
    if (this.closed) throw new AppError("CLOSED", "服务正在关闭", 503);
    const request = workflowRunSchema.parse(input);
    const prompt = renderWorkflow(
      request.template,
      request.values,
      request.sources,
      request.notes,
    );
    const now = new Date().toISOString();
    const run: WorkflowRun = {
      ...request,
      id: crypto.randomUUID(),
      chatId: null,
      status: "starting",
      createdAt: now,
      updatedAt: now,
      error: null,
      result: "",
    };
    this.write(run, actor.identity);
    try {
      const snapshot = await this.chat.create({}, actor);
      run.chatId = snapshot.chat.id;
      this.write(run, actor.identity);
      if (this.closed) throw new Error("客户端已关闭，请手动重新运行");
      await this.chat.message(
        run.chatId,
        { text: prompt, clientId: run.id },
        actor,
      );
      run.status = "running";
    } catch (error) {
      run.status = "failed";
      run.error = (error as Error).message;
    }
    this.write(run, actor.identity);
    return run;
  }
  list(actor: Actor, page = 1) {
    return this.track(this.performList(actor, page));
  }
  private async performList(actor: Actor, page: number) {
    this.access(actor);
    const offset = (this.page(page) - 1) * PAGE_SIZE;
    const rows = this.db
      .query(
        "SELECT state FROM workflow_runs WHERE owner=? ORDER BY json_extract(state,'$.createdAt') DESC LIMIT ? OFFSET ?",
      )
      .all(actor.identity, PAGE_SIZE, offset) as { state: string }[];
    const runs = rows.map((row) => JSON.parse(row.state) as WorkflowRun);
    for (const run of runs) {
      if (!run.chatId || !["running", "waiting"].includes(run.status)) continue;
      try {
        const snapshot = await this.chat.readChat(run.chatId, actor);
        if (!snapshot) continue;
        run.status = snapshot.error
          ? "failed"
          : snapshot.requests.length
            ? "waiting"
            : snapshot.running
              ? "running"
              : "completed";
        run.error = snapshot.error;
        run.result = snapshot.items
          .filter((item) => item.role === "assistant")
          .map((item) => item.text)
          .join("\n\n")
          .slice(-60000);
        this.write(run, actor.identity);
      } catch (error) {
        run.error = (error as Error).message;
        if (error instanceof AppError && error.status === 404) {
          run.status = "interrupted";
          this.write(run, actor.identity);
        }
      }
    }
    for (const run of runs) {
      const persisted = this.db
        .query("SELECT state FROM workflow_runs WHERE id=?")
        .get(run.id) as { state: string };
      if (persisted) Object.assign(run, JSON.parse(persisted.state));
      run.artifacts = [];
      if (!run.chatId || !this.hasTable("assistant_flows")) continue;
      const flows = this.db
        .query(
          "SELECT state FROM assistant_flows WHERE owner=? AND json_extract(state,'$.chatId')=?",
        )
        .all(actor.identity, run.chatId) as { state: string }[];
      for (const row of flows) {
        const flow = JSON.parse(row.state);
        for (const item of flow.createdItems || [])
          run.artifacts.push({
            label: item.title,
            url: `/work-items/${item.id}`,
          });
        if (flow.modelId)
          run.artifacts.push({
            label: flow.modelDraft?.name || "领域模型",
            url: `/domain-models/${flow.modelId}`,
          });
        if (
          flow.businessResult?.url?.startsWith("/") &&
          !flow.businessResult.url.startsWith("//")
        )
          run.artifacts.push(flow.businessResult);
      }
      run.artifacts = [
        ...new Map(run.artifacts.map((item) => [item.url, item])).values(),
      ];
    }
    const total = (
      this.db
        .query("SELECT COUNT(*) AS total FROM workflow_runs WHERE owner=?")
        .get(actor.identity) as { total: number }
    ).total;
    return { items: runs, total, page: Math.max(1, page), pageSize: PAGE_SIZE };
  }
  async rerun(id: string, actor: Actor) {
    const { template, values, sources, notes } = this.get(id, actor);
    return this.start({ template, values, sources, notes }, actor);
  }
  cancel(id: string, actor: Actor) {
    return this.track(this.performCancel(id, actor));
  }
  private async performCancel(id: string, actor: Actor) {
    const run = this.get(id, actor);
    if (["starting", "running", "waiting"].includes(run.status)) {
      if (run.status === "starting")
        throw new AppError("BUSY", "正在建立会话，请稍后取消", 409);
      if (run.chatId) {
        try {
          await this.chat.stop(run.chatId, actor);
        } catch (error) {
          if (!(error instanceof AppError && error.status === 404)) throw error;
        }
      }
      run.status = "cancelled";
      this.write(run, actor.identity);
    }
    return run;
  }
  recoverInterruptedRuns() {
    this.db.exec(
      `UPDATE workflow_runs SET state=json_set(state,'$.status','interrupted','$.error','上次运行因客户端关闭而中断，请查看对话后决定是否重跑') WHERE json_extract(state,'$.status') IN ('starting','running','waiting')`,
    );
  }
  async close() {
    this.closed = true;
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}
