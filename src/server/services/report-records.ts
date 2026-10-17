import type { Database } from "bun:sqlite";
import { z } from "zod";
import { reportDateSchema } from "../../shared/daily-report";
import { periodRange } from "../../shared/period-report";
import {
  reportDraftInputSchema,
  type ReportDraft,
  type ReportDraftList,
  type ReportActivity,
  type ReportActivityList,
} from "../../shared/report-records";
import { PAGE_SIZE } from "../../shared/pagination";
import { AppError } from "../../shared/errors";
import type { DevelopmentTask } from "../../shared/development-task";
import type { Actor } from "./work-items";
export function installReportRecords(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS report_drafts (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, date TEXT NOT NULL, text TEXT NOT NULL,
    source_snapshot TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(type,date,version));`);
}
const columns =
  "id,type,date,text,source_snapshot AS sourceSnapshot,version,created_at AS createdAt";
export class ReportRecords {
  constructor(private db: Database) {
    installReportRecords(db);
  }
  list(params: URLSearchParams): ReportDraftList {
    const q = z
      .object({
        type: z.enum(["weekly", "monthly"]),
        date: reportDateSchema,
        page: z.coerce.number().int().min(1).default(1),
      })
      .parse(Object.fromEntries(params));
    const date = periodRange(q.type, q.date).start;
    const row = this.db
      .query(
        "SELECT count(*) AS total,coalesce(max(version),0) AS version FROM report_drafts WHERE type=? AND date=?",
      )
      .get(q.type, date) as { total: number; version: number };
    return {
      ...row,
      page: q.page,
      pageSize: PAGE_SIZE,
      versions: this.db
        .query(
          `SELECT ${columns} FROM report_drafts WHERE type=? AND date=? ORDER BY version DESC LIMIT ? OFFSET ?`,
        )
        .all(
          q.type,
          date,
          PAGE_SIZE,
          (q.page - 1) * PAGE_SIZE,
        ) as ReportDraft[],
    };
  }
  save(input: unknown, actor: Actor): ReportDraft {
    if (!actor.writable) throw new AppError("FORBIDDEN", "需要写入权限", 403);
    const q = reportDraftInputSchema.parse(input),
      date = periodRange(q.type, q.date).start;
    return this.db
      .transaction(() => {
        const latest = this.db
          .query(
            "SELECT coalesce(max(version),0) AS version FROM report_drafts WHERE type=? AND date=?",
          )
          .get(q.type, date) as { version: number };
        if (latest.version !== q.expectedVersion)
          throw new AppError(
            "VERSION_CONFLICT",
            "文字稿已有新版本，请先读取最新版本；当前编辑内容已保留",
            409,
          );
        const draft: ReportDraft = {
          id: crypto.randomUUID(),
          type: q.type,
          date,
          text: q.text,
          sourceSnapshot: q.sourceSnapshot,
          version: latest.version + 1,
          createdAt: new Date().toISOString(),
        };
        this.db
          .query("INSERT INTO report_drafts VALUES (?,?,?,?,?,?,?)")
          .run(
            draft.id,
            draft.type,
            draft.date,
            draft.text,
            draft.sourceSnapshot,
            draft.version,
            draft.createdAt,
          );
        return draft;
      })
      .immediate();
  }
  activity(params: URLSearchParams, actor: Actor): ReportActivityList {
    const q = z
      .object({
        date: reportDateSchema,
        offset: z.coerce.number().int().min(-840).max(840).default(0),
        page: z.coerce.number().int().min(1).default(1),
      })
      .parse(Object.fromEntries(params));
    const start = new Date(
        Date.parse(`${q.date}T00:00:00Z`) + q.offset * 60000,
      ).toISOString(),
      end = new Date(Date.parse(start) + 86400000).toISOString();
    const candidates: ReportActivity[] = [];
    const events = this.db
      .query(
        `SELECT w.id,w.title,count(*) AS count FROM work_item_events e JOIN work_items w ON w.id=e.work_item_id WHERE e.created_at>=? AND e.created_at<? AND w.deleted_at IS NULL GROUP BY w.id ORDER BY max(e.created_at) DESC,w.id`,
      )
      .all(start, end) as { id: string; title: string; count: number }[];
    for (const event of events) {
      const href = `/work-items/${event.id}`;
      candidates.push({
        id: event.id,
        href,
        source: "工作项活动",
        matter: {
          matterId: event.id,
          workItemId: event.id,
          title: event.title,
          activity: `当天记录 ${event.count} 次工作项变更。来源：[工作项活动](${href})`,
          result: "",
          status: "in_progress",
          completedQuantity: null,
          unit: "",
          progress: null,
        },
      });
    }
    const tasks = this.db
      .query("SELECT state FROM development_tasks WHERE owner=?")
      .all(actor.identity) as { state: string }[];
    for (const row of tasks) {
      const task = JSON.parse(row.state) as DevelopmentTask;
      const deliveredAt = [
        task.merge?.mergedAt,
        ...(task.deliveryHistory || []).map((delivery) => delivery.createdAt),
        task.attention?.status === "review" ? task.attention.createdAt : null,
      ].find((time) => time && time >= start && time < end);
      if (!deliveredAt) continue;
      const href = `/development-tasks/${task.id}`;
      candidates.push({
        id: task.id,
        href,
        source: "研发交付",
        matter: {
          matterId: task.id,
          workItemId: null,
          title: task.title,
          activity: `${task.merge?.mergedAt === deliveredAt ? "代码已合并" : "当天已记录研发交付"}。来源：[研发任务](${href})`,
          result: "",
          status: "in_progress",
          completedQuantity: null,
          unit: "",
          progress: null,
        },
      });
    }
    return {
      candidates: candidates.slice(
        (q.page - 1) * PAGE_SIZE,
        q.page * PAGE_SIZE,
      ),
      total: candidates.length,
      page: q.page,
      pageSize: PAGE_SIZE,
    };
  }
}
