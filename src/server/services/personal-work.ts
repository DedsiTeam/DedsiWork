import type { Database } from "bun:sqlite";
import { z } from "zod";
import { AppError } from "../../shared/errors";
import { PAGE_SIZE } from "../../shared/pagination";
import {
  focusInput,
  sourceInput,
  type SearchEntry,
  type FocusEntry,
  type PersonalOverview,
  type WorkCard,
} from "../../shared/personal-work";
import { WorkItemService, type Actor } from "./work-items";
import { CanvasNotes } from "./canvas-notes";
import { DomainModelService } from "./domain-models";
import { Bookmarks } from "./bookmarks";
import type { DevelopmentTasks } from "./development-tasks";
import type { CodexChat } from "../codex/chat";
export function installPersonalWork(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS personal_focus (item_id TEXT PRIMARY KEY REFERENCES work_items(id) ON DELETE CASCADE,bucket TEXT NOT NULL,date TEXT NOT NULL,version INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS personal_sources (chat_id TEXT NOT NULL REFERENCES codex_chats(id) ON DELETE CASCADE,kind TEXT NOT NULL,source_id TEXT NOT NULL,title TEXT NOT NULL,href TEXT NOT NULL,source_version INTEGER NOT NULL,PRIMARY KEY(chat_id,kind,source_id));`);
}
export class PersonalWork {
  constructor(
    private db: Database,
    private items: WorkItemService,
  ) {
    installPersonalWork(db);
  }
  focus() {
    return this.db
      .query(
        `SELECT w.id,w.title,w.status,w.priority,f.bucket,f.date,f.version FROM personal_focus f JOIN work_items w ON w.id=f.item_id WHERE w.deleted_at IS NULL AND w.status NOT IN ('done','cancelled') AND f.bucket<>'none' ORDER BY f.date,w.updated_at DESC`,
      )
      .all() as FocusEntry[];
  }
  focusState(id: string) {
    this.items.get(id);
    return (
      this.db
        .query("SELECT bucket,date,version FROM personal_focus WHERE item_id=?")
        .get(id) || { bucket: "none", date: "", version: 0 }
    );
  }
  setFocus(input: unknown, actor: Actor) {
    if (!actor.writable) throw new AppError("FORBIDDEN", "需要写入权限", 403);
    const v = focusInput.parse(input);
    return this.db
      .transaction(() => {
        const item = this.items.get(v.itemId);
        if (v.bucket !== "none" && ["done", "cancelled"].includes(item.status))
          throw new AppError("INVALID_STATUS", "已结束工作项无需加入计划");
        const current = this.db
          .query("SELECT version FROM personal_focus WHERE item_id=?")
          .get(v.itemId) as { version: number } | null;
        if ((current?.version || 0) !== v.expectedVersion)
          throw new AppError(
            "VERSION_CONFLICT",
            "计划已更新，请刷新后重试",
            409,
          );
        this.db
          .query(
            "INSERT INTO personal_focus VALUES (?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET bucket=excluded.bucket,date=excluded.date,version=excluded.version",
          )
          .run(v.itemId, v.bucket, v.date, v.expectedVersion + 1);
        return this.focusState(v.itemId);
      })
      .immediate();
  }
  context(input: unknown): SearchEntry {
    const v = sourceInput.parse(input);
    if (v.kind === "item") {
      const i = this.items.get(v.id);
      return {
        id: i.id,
        kind: v.kind,
        title: i.title,
        text: i.description,
        version: i.version,
        href: `/work-items/${i.id}`,
      };
    }
    if (v.kind === "model") {
      const m = new DomainModelService(this.db).get(v.id);
      return {
        id: m.id,
        kind: v.kind,
        title: m.name,
        text: JSON.stringify(m),
        version: m.version,
        href: `/domain-models/${m.id}`,
      };
    }
    if (v.kind === "note") {
      const n = new CanvasNotes(this.db).get(v.id);
      if (
        v.nodeIds?.some((id) => !n.content.nodes.some((node) => node.id === id))
      )
        throw new AppError(
          "SOURCE_CHANGED",
          "选中的笔记内容已变化，请重新选择",
          409,
        );
      const text = n.content.nodes
        .filter((node) => !v.nodeIds?.length || v.nodeIds.includes(node.id))
        .map((node) => node.text)
        .filter(Boolean)
        .join("\n");
      if (!text.trim())
        throw new AppError(
          "EMPTY_SOURCE",
          "所选资料没有可用文字，请选择文字内容",
        );
      if (text.length > 20000)
        throw new AppError(
          "SOURCE_TOO_LARGE",
          "资料过长，请选择部分文字后再继续",
        );
      return {
        id: n.id,
        kind: v.kind,
        title: n.name,
        text,
        version: n.version,
        href: `/notes/${n.id}`,
      };
    }
    const state = new Bookmarks(this.db).get();
    const b = state.groups.flatMap((g) => g.links).find((b) => b.id === v.id);
    if (!b) throw new AppError("NOT_FOUND", "网址不存在", 404);
    return {
      id: b.id,
      kind: v.kind,
      title: b.title,
      text: `网址：${b.url}\n说明：${b.description}\n仅提供网址与用户说明，网页正文尚未读取。`,
      version: state.version,
      href: "/bookmarks",
    };
  }
  link(input: unknown, actor: Actor) {
    if (!actor.writable) throw new AppError("FORBIDDEN", "需要写入权限", 403);
    const v = z
      .object({
        chatId: z.uuid(),
        sources: z.array(sourceInput).min(1).max(12),
      })
      .strict()
      .parse(input);
    if (
      !this.db
        .query("SELECT id FROM codex_chats WHERE id=? AND owner=?")
        .get(v.chatId, actor.identity)
    )
      throw new AppError("NOT_FOUND", "对话不存在", 404);
    this.db
      .transaction(() => {
        for (const s of v.sources) {
          const c = this.context(s);
          this.db
            .query(
              "INSERT INTO personal_sources VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING",
            )
            .run(v.chatId, c.kind, c.id, c.title, c.href, c.version);
        }
      })
      .immediate();
    return { linked: true };
  }
  related(itemId: string, actor: Actor) {
    this.items.get(itemId);
    const sources = this.db
      .query(
        `SELECT DISTINCT p.* FROM personal_sources p JOIN codex_chats c ON c.id=p.chat_id WHERE c.owner=? AND (p.chat_id IN (SELECT chat_id FROM personal_sources WHERE kind='item' AND source_id=?) OR p.chat_id IN (SELECT json_extract(f.state,'$.chatId') FROM assistant_flows f JOIN assistant_work_item_links l ON l.flow_id=f.id WHERE l.item_id=? AND f.owner=?))`,
      )
      .all(actor.identity, itemId, itemId, actor.identity) as {
      chat_id: string;
      title: string;
      href: string;
      source_version: number;
    }[];
    const tasks = this.db
      .query(
        "SELECT state FROM development_tasks WHERE owner=? ORDER BY updated_at DESC",
      )
      .all(actor.identity) as { state: string }[];
    const models = this.db
      .query(
        `SELECT DISTINCT m.id,m.name AS title,m.version FROM assistant_model_links l JOIN assistant_flows f ON f.id=l.flow_id JOIN domain_models m ON m.id=l.model_id WHERE f.owner=? AND m.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(l.sources) WHERE json_extract(value,'$.id')=?) ORDER BY m.updated_at DESC`,
      )
      .all(actor.identity, itemId) as {
      id: string;
      title: string;
      version: number;
    }[];
    return {
      sources,
      models,
      tasks: tasks
        .map((r) => JSON.parse(r.state))
        .filter((t) =>
          t.sources.items.some((i: { id: string }) => i.id === itemId),
        )
        .map((t) => ({ id: t.id, title: t.title, status: t.status })),
    };
  }
  search(params: URLSearchParams) {
    const q = z
      .string()
      .trim()
      .max(200)
      .parse(params.get("q") || "");
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(100000)
      .parse(params.get("page") || 1);
    const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = this.db
      .query(
        `SELECT id,'item' AS kind,title,substr(description,1,220) AS text,version,'/work-items/'||id AS href FROM work_items WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
      UNION ALL SELECT id,'model',name,substr(description,1,220),version,'/domain-models/'||id FROM domain_models WHERE deleted_at IS NULL AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
      UNION ALL SELECT id,'note',name,substr((SELECT group_concat(json_extract(value,'$.text'),' ') FROM json_each(canvas_notes.content,'$.nodes')),1,220),version,'/notes/'||id FROM canvas_notes WHERE name LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM json_each(canvas_notes.content,'$.nodes') WHERE json_extract(value,'$.text') LIKE ? ESCAPE '\\')`,
      )
      .all(
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
      ) as SearchEntry[];
    const bookmarks = new Bookmarks(this.db).get();
    for (const b of bookmarks.groups.flatMap((g) => g.links))
      if (
        `${b.title} ${b.url} ${b.description}`
          .toLowerCase()
          .includes(q.toLowerCase())
      )
        rows.push({
          id: b.id,
          kind: "bookmark",
          title: b.title,
          text: `${b.description} ${b.url}`,
          version: bookmarks.version,
          href: "/bookmarks",
        });
    rows.sort(
      (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
    );
    return {
      data: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      meta: { total: rows.length, page, pageSize: PAGE_SIZE },
    };
  }
  overview(
    actor: Actor,
    development: DevelopmentTasks,
    chat: CodexChat,
  ): PersonalOverview {
    const tasks = development.list(actor);
    const card = (t: (typeof tasks)[number]): WorkCard => ({
      id: t.id,
      title: t.title,
      status: t.status,
      href: `/development-tasks/${t.id}`,
      detail: t.error || "",
      updatedAt: t.updatedAt,
    });
    const attention = tasks
      .filter((t) =>
        ["waiting", "review", "failed", "interrupted"].includes(t.status),
      )
      .map(card);
    const running = tasks
      .filter((t) => ["preparing", "running", "stopping"].includes(t.status))
      .map(card);
    for (const c of chat.list(actor)) {
      const s = chat.checkpoint(c.id);
      if (!s) continue;
      const row = {
        id: c.id,
        title: c.title,
        status: s.requests.length ? "waiting" : s.error ? "failed" : "running",
        href: `/assistant/thread/${c.id}`,
        detail:
          s.error ||
          (s.requests.length
            ? `${s.requests.length} 个问题需要回答`
            : "Codex 正在处理"),
        updatedAt: c.updatedAt,
      };
      if (s.requests.length || s.error) attention.push(row);
      else if (s.running) running.push(row);
    }
    return {
      focus: this.focus(),
      attention: attention.sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
      running,
      delivered: tasks
        .filter((t) => ["review", "completed"].includes(t.status))
        .map(card),
    };
  }
}
