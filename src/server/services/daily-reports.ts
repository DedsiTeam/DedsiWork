import {
  buildPeriodReport,
  periodQuerySchema,
  matterIdentity,
} from "../../shared/period-report";
import type { Database } from "bun:sqlite";
import { z } from "zod";
import {
  dailyReportInputSchema,
  parseStoredDailyReport,
  reportDateSchema,
  type DailyReport,
  type DailyReportList,
} from "../../shared/daily-report";
import { AppError } from "../../shared/errors";
import type { Actor } from "./work-items";

type Row = {
  id: string;
  date: string;
  content: string;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
export class DailyReports {
  constructor(private db: Database) {}
  private map(row: Row): DailyReport {
    return {
      ...parseStoredDailyReport(JSON.parse(row.content)),
      date: row.date,
      id: row.id,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }
  get(id: string) {
    z.uuid().parse(id);
    const row = this.db
      .query("SELECT * FROM daily_reports WHERE id=?")
      .get(id) as Row | null;
    if (!row) throw new AppError("NOT_FOUND", "日报不存在", 404);
    return this.map(row);
  }
  list(params: URLSearchParams): DailyReportList {
    const value = z
      .object({
        q: z.string().max(200).default(""),
        date: reportDateSchema.optional(),
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional(),
        deleted: z.enum(["true", "false"]).default("false"),
        page: z.coerce.number().int().min(1).max(100000).default(1),
      })
      .parse(Object.fromEntries(params));
    const where = `deleted_at IS ${value.deleted === "true" ? "NOT " : ""}NULL AND date LIKE ? AND date LIKE ? AND content LIKE ? ESCAPE '\\'`;
    const args = [
      value.month ? `${value.month}-%` : "%",
      value.date || "%",
      `%${value.q.replace(/[\\%_]/g, "\\$&")}%`,
    ];
    const total = (
      this.db
        .query(`SELECT count(*) AS n FROM daily_reports WHERE ${where}`)
        .get(...args) as { n: number }
    ).n;
    const rows = this.db
      .query(
        `SELECT * FROM daily_reports WHERE ${where} ORDER BY date DESC,id DESC LIMIT 20 OFFSET ?`,
      )
      .all(...args, (value.page - 1) * 20) as Row[];
    return {
      data: rows.map((row) => this.map(row)),
      meta: { total, page: value.page, pageSize: 20 },
    };
  }
  private activeReports() {
    return (
      this.db
        .query(
          "SELECT * FROM daily_reports WHERE deleted_at IS NULL ORDER BY date,id",
        )
        .all() as Row[]
    ).map((row) => this.map(row));
  }
  summary(params: URLSearchParams) {
    const query = periodQuerySchema.parse(Object.fromEntries(params));
    return buildPeriodReport(this.activeReports(), query.type, query.date);
  }
  private checkLinks(content: DailyReport["matters"], id: string | null) {
    const reports = this.activeReports();
    const old = id ? this.get(id) : null;
    for (const matter of content)
      if (matter.workItemId) {
        const historical = reports.some((report) =>
          report.matters.some(
            (item) =>
              item.matterId === matter.matterId &&
              item.workItemId === matter.workItemId,
          ),
        );
        const previous = old?.matters.some(
          (item) =>
            item.matterId === matter.matterId &&
            item.workItemId === matter.workItemId,
        );
        if (
          !historical &&
          !previous &&
          !this.db
            .query(
              "SELECT id FROM work_items WHERE id=? AND deleted_at IS NULL",
            )
            .get(matter.workItemId)
        )
          throw new AppError(
            "WORK_ITEM_NOT_FOUND",
            "关联的工作项不存在或已删除，请重新选择",
            400,
          );
        if (
          reports
            .filter((report) => report.id !== id)
            .some((report) =>
              report.matters.some(
                (item) =>
                  item.matterId === matter.matterId &&
                  item.workItemId &&
                  item.workItemId !== matter.workItemId,
              ),
            )
        )
          throw new AppError(
            "MATTER_LINK_CONFLICT",
            "该事项的历史记录关联了其他工作项，请新建事项或保持原关联",
            409,
          );
      }
    const identity = matterIdentity([
      ...reports.filter((report) => report.id !== id),
      { matters: content },
    ]);
    if (new Set(content.map(identity)).size !== content.length)
      throw new AppError(
        "DUPLICATE_REPORT_MATTER",
        "同一日报不能重复记录同一事项或工作项，请合并后保存",
        400,
      );
  }
  private access(actor: Actor) {
    if (!actor.writable) throw new AppError("FORBIDDEN", "需要写入权限", 403);
  }
  private checkDate(date: string, id: string | null) {
    const duplicate = this.db
      .query(
        "SELECT id FROM daily_reports WHERE date=? AND deleted_at IS NULL AND id<>?",
      )
      .get(date, id || "");
    if (duplicate)
      throw new AppError(
        "REPORT_DATE_EXISTS",
        "该日期已有日报，请打开已有日报或选择其他日期",
        409,
      );
  }
  save(id: string | null, input: unknown, actor: Actor) {
    this.access(actor);
    const parsed = (
      id
        ? dailyReportInputSchema.extend({
            expectedVersion: z.number().int().positive(),
          })
        : dailyReportInputSchema
    ).parse(input);
    const content = dailyReportInputSchema.parse(
      (({
        expectedVersion: _,
        ...rest
      }: typeof parsed & { expectedVersion?: number }) => rest)(parsed),
    );
    return this.db
      .transaction(() => {
        if (id) {
          const previous = this.get(id);
          if (previous.deletedAt)
            throw new AppError("REPORT_DELETED", "请先恢复日报", 409);
          if (
            previous.version !==
            (parsed as typeof parsed & { expectedVersion: number })
              .expectedVersion
          )
            throw new AppError(
              "VERSION_CONFLICT",
              "日报已在其他窗口修改，当前输入已保留，请复制内容后重新打开",
              409,
            );
        }
        this.checkDate(content.date, id);
        this.checkLinks(content.matters, id);
        const now = new Date().toISOString();
        if (id)
          this.db
            .query(
              "UPDATE daily_reports SET date=?,content=?,version=version+1,updated_at=? WHERE id=?",
            )
            .run(content.date, JSON.stringify(content), now, id);
        else {
          id = crypto.randomUUID();
          this.db
            .query("INSERT INTO daily_reports VALUES (?,?,?,1,?,?,NULL)")
            .run(id, content.date, JSON.stringify(content), now, now);
        }
        return this.get(id!);
      })
      .immediate();
  }
  lifecycle(id: string, input: unknown, restore: boolean, actor: Actor) {
    this.access(actor);
    const { expectedVersion } = z
      .object({ expectedVersion: z.number().int().positive() })
      .strict()
      .parse(input);
    return this.db
      .transaction(() => {
        const report = this.get(id);
        if (report.version !== expectedVersion)
          throw new AppError(
            "VERSION_CONFLICT",
            "日报已更新，请刷新后重试",
            409,
          );
        if (restore) {
          this.checkDate(report.date, id);
          this.checkLinks(report.matters, id);
        }
        const now = new Date().toISOString();
        this.db
          .query(
            "UPDATE daily_reports SET deleted_at=?,version=version+1,updated_at=? WHERE id=?",
          )
          .run(restore ? null : now, now, id);
        return this.get(id);
      })
      .immediate();
  }
  purge(id: string, input: unknown, actor: Actor) {
    this.access(actor);
    const { expectedVersion } = z
      .object({
        expectedVersion: z.number().int().positive(),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(input);
    return this.db
      .transaction(() => {
        const report = this.get(id);
        if (report.version !== expectedVersion)
          throw new AppError(
            "VERSION_CONFLICT",
            "日报已更新，请刷新后重试",
            409,
          );
        this.db.query("DELETE FROM daily_reports WHERE id=?").run(id);
        return { id };
      })
      .immediate();
  }
}
