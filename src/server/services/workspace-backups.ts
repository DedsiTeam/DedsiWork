import { parseStoredDailyReport } from "../../shared/daily-report";
import { canvasNoteInputSchema } from "../../shared/canvas-note";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  statSync,
  renameSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { AppError } from "../../shared/errors";
import { workspaceInputSchema, type Workspace } from "../../shared/workspace";
import { openDatabase } from "../db/database";
import type { Actor } from "./work-items";
import type { WorkspaceStore } from "./workspaces";
import type { CodexChat } from "../codex/chat";
const LIMIT = 512 * 1024 * 1024;
const tables = [
  "work_items",
  "work_item_events",
  "idempotency_records",
  "domain_models",
  "sprints",
  "sprint_items",
  "sprint_snapshots",
  "sprint_events",
  "codex_chats",
  "work_item_agent_sessions",
  "assistant_flows",
  "assistant_work_item_links",
  "assistant_model_links",
  "chat_history_snapshots",
  "canvas_notes",
  "daily_reports",
];
const packageSchema = z
  .object({
    format: z.literal("dedsiwork-workspace"),
    version: z.literal(1),
    createdAt: z.iso.datetime(),
    workspace: workspaceInputSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    database: z.string().max(LIMIT),
  })
  .strict();
type Package = z.infer<typeof packageSchema>;
type Stage = {
  owner: string;
  dir: string;
  path: string;
  manifest: Package;
  expires: number;
  result?: Workspace;
};
export class WorkspaceBackups {
  private stages = new Map<string, Stage>();
  private savePending = false;
  constructor(private store: WorkspaceStore) {}
  private access(actor: Actor) {
    if (!actor.writable) throw new AppError("FORBIDDEN", "需要写入权限", 403);
  }
  private async pick(script: string) {
    if (process.platform !== "darwin")
      throw new AppError(
        "UNSUPPORTED_PLATFORM",
        "当前平台暂不支持备份文件选择器",
      );
    try {
      return (
        await promisify(execFile)("/usr/bin/osascript", ["-e", script])
      ).stdout.trim();
    } catch (error) {
      if (String((error as { stderr?: string }).stderr).includes("-128"))
        return "";
      throw new AppError("FILE_PICKER_FAILED", "无法打开文件选择器，请重试");
    }
  }
  private counts(db: Database) {
    const n = (table: string) =>
      (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    return {
      items: n("work_items"),
      trash: (
        db
          .query(
            "SELECT COUNT(*) AS n FROM work_items WHERE deleted_at IS NOT NULL",
          )
          .get() as { n: number }
      ).n,
      models: n("domain_models"),
      sprints: n("sprints"),
      chats: n("codex_chats"),
      notes: db
        .query(
          "SELECT name FROM sqlite_master WHERE name='canvas_notes' AND type='table'",
        )
        .get()
        ? n("canvas_notes")
        : 0,
    };
  }
  async backup(id: string, db: Database, chat: CodexChat, actor: Actor) {
    this.access(actor);
    if (this.savePending)
      throw new AppError("BACKUP_BUSY", "已有备份正在处理，请稍后重试", 409);
    this.savePending = true;
    const dir = mkdtempSync(join(tmpdir(), "dedsiwork-backup-"));
    try {
      const space = this.store.get(id);
      const date = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const name =
        space.name.replace(/[\\/:\x00-\x1f]/g, "_") + "_" + date + ".dwb";
      let output = await this.pick(
        `POSIX path of (choose file name with prompt "保存工作空间备份" default name ${JSON.stringify(name)})`,
      );
      if (!output) return { cancelled: true };
      if (!output.endsWith(".dwb")) output += ".dwb";
      if (this.store.get(id).version !== space.version)
        throw new AppError(
          "WORKSPACE_CHANGED",
          "工作空间已更新，请重新备份",
          409,
        );
      await chat.exportHistories(actor);
      // SQLite creates a consistent standalone snapshot including WAL contents.
      const snapshot = join(dir, "snapshot.sqlite");
      db.query("VACUUM INTO ?").run(snapshot);
      const database = readFileSync(snapshot);
      if (database.length > LIMIT / 2)
        throw new AppError(
          "BACKUP_TOO_LARGE",
          "工作空间数据过大，暂不支持单文件备份",
        );
      const archive: Package = {
        format: "dedsiwork-workspace",
        version: 1,
        createdAt: new Date().toISOString(),
        workspace: {
          name: space.name,
          description: space.description,
          directory: "",
        },
        sha256: createHash("sha256").update(database).digest("hex"),
        database: database.toString("base64"),
      };
      const outputTemp = output + "." + crypto.randomUUID() + ".tmp";
      try {
        writeFileSync(
          outputTemp,
          gzipSync(Buffer.from(JSON.stringify(archive))),
          { mode: 0o600, flag: "wx" },
        );
        renameSync(outputTemp, output);
      } finally {
        rmSync(outputTemp, { force: true });
      }
      return { cancelled: false, path: output };
    } finally {
      this.savePending = false;
      rmSync(dir, { recursive: true, force: true });
    }
  }
  private prune() {
    for (const [id, stage] of this.stages)
      if (stage.expires < Date.now()) {
        rmSync(stage.dir, { recursive: true, force: true });
        this.stages.delete(id);
      }
  }
  async preview(actor: Actor) {
    this.access(actor);
    this.prune();
    if (this.stages.size >= 8)
      throw new AppError(
        "RESTORE_BUSY",
        "待恢复文件过多，请关闭其他恢复窗口后重试",
        409,
      );
    const file = await this.pick(
      'POSIX path of (choose file with prompt "选择工作空间备份文件")',
    );
    if (!file) return { cancelled: true };
    if (statSync(file).size > LIMIT / 2)
      throw new AppError("BACKUP_TOO_LARGE", "备份文件过大，无法恢复");
    const dir = mkdtempSync(join(tmpdir(), "dedsiwork-restore-"));
    try {
      let archive: Package;
      try {
        archive = packageSchema.parse(
          JSON.parse(
            gunzipSync(readFileSync(file), { maxOutputLength: LIMIT }).toString(
              "utf8",
            ),
          ),
        );
      } catch {
        throw new AppError(
          "INVALID_BACKUP",
          "不是有效的工作空间备份，或备份版本不受支持",
        );
      }
      const bytes = Buffer.from(archive.database, "base64");
      if (createHash("sha256").update(bytes).digest("hex") !== archive.sha256)
        throw new AppError("BACKUP_DAMAGED", "备份校验失败，文件可能已损坏");
      const path = join(dir, "source.sqlite");
      writeFileSync(path, bytes, { mode: 0o600 });
      let counts;
      const db = new Database(path, { readonly: true });
      try {
        db.exec("PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;");
        const check = db.query("PRAGMA quick_check").get() as {
          quick_check: string;
        };
        if (
          check.quick_check !== "ok" ||
          db.query("PRAGMA foreign_key_check").all().length
        )
          throw new Error();
        const version = (
          db.query("SELECT MAX(version) AS n FROM schema_migrations").get() as {
            n: number;
          }
        ).n;
        if (![8, 9, 10, 11].includes(version)) throw new Error();
        for (const table of tables) {
          if (
            (table === "canvas_notes" && version === 8) ||
            (table === "daily_reports" && version < 10)
          )
            continue;
          const schema = db
            .query("SELECT type FROM sqlite_master WHERE name=?")
            .get(table) as { type: string } | null;
          if (schema?.type !== "table") throw new Error();
        }
        counts = this.counts(db);
        if (
          (
            db
              .query(
                "SELECT COUNT(*) AS n FROM codex_chats c LEFT JOIN chat_history_snapshots h ON c.id=h.chat_id WHERE h.chat_id IS NULL OR h.complete<>1",
              )
              .get() as { n: number }
          ).n
        )
          throw new Error();
      } catch {
        throw new AppError(
          "INVALID_BACKUP",
          "备份中的数据不完整或数据库版本不受支持",
        );
      } finally {
        db.close();
      }
      const token = crypto.randomUUID();
      this.stages.set(token, {
        owner: actor.identity,
        dir,
        path,
        manifest: archive,
        expires: Date.now() + 20 * 60 * 1000,
      });
      return {
        cancelled: false,
        token,
        name: archive.workspace.name,
        description: archive.workspace.description,
        createdAt: archive.createdAt,
        counts,
      };
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      if (error instanceof AppError) throw error;
      throw new AppError(
        "INVALID_BACKUP",
        "无法读取备份文件，文件可能已损坏或不是受支持的备份",
      );
    }
  }
  discard(input: unknown, actor: Actor) {
    const { token } = z.object({ token: z.uuid() }).strict().parse(input);
    const stage = this.stages.get(token);
    if (stage?.owner === actor.identity) {
      rmSync(stage.dir, { recursive: true, force: true });
      this.stages.delete(token);
    }
    return { discarded: true };
  }
  restore(input: unknown, actor: Actor) {
    this.access(actor);
    this.prune();
    const request = workspaceInputSchema
      .extend({ token: z.uuid(), confirmed: z.literal(true) })
      .strict()
      .parse(input);
    const stage = this.stages.get(request.token);
    if (!stage || stage.owner !== actor.identity)
      throw new AppError(
        "RESTORE_EXPIRED",
        "恢复预览已过期，请重新选择备份文件",
        409,
      );
    if (stage.result) return this.store.get(stage.result.id);
    let targetDir = "";
    try {
      const result = this.store.db
        .transaction(() => {
          const space = this.store.create(
            {
              name: request.name,
              description: request.description,
              directory: request.directory,
            },
            actor,
          );
          const targetPath = this.store.path(space.id);
          targetDir = dirname(targetPath);
          mkdirSync(targetDir, { recursive: true });
          const source = new Database(stage.path, { readonly: true }),
            target = openDatabase(targetPath);
          try {
            source.exec("PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;");
            target
              .transaction(() => {
                for (const table of tables) {
                  if (
                    (table === "canvas_notes" || table === "daily_reports") &&
                    !source
                      .query(
                        "SELECT name FROM sqlite_master WHERE name=? AND type='table'",
                      )
                      .get(table)
                  )
                    continue;
                  const columns = (
                    target.query(`PRAGMA table_info(${table})`).all() as {
                      name: string;
                    }[]
                  ).map((column) => column.name);
                  const names = columns.map((name) => `"${name}"`).join(",");
                  const statement = target.query(
                    `INSERT INTO ${table} (${names}) VALUES (${columns.map(() => "?").join(",")})`,
                  );
                  for (const row of source
                    .query(`SELECT ${names} FROM ${table}`)
                    .iterate() as Iterable<Record<string, any>>)
                    statement.run(...columns.map((column) => row[column]));
                }
                target
                  .query("UPDATE codex_chats SET owner=?,cwd=?")
                  .run(
                    actor.identity,
                    space.directory || join(targetDir, "chat-workspace"),
                  );
                target.exec(
                  "UPDATE chat_history_snapshots SET restored=1,thread_id=NULL",
                );
                target
                  .query("UPDATE assistant_flows SET owner=?")
                  .run(actor.identity);
                for (const row of target
                  .query("SELECT id,state FROM assistant_flows")
                  .all() as { id: string; state: string }[]) {
                  const state = JSON.parse(row.state);
                  if (state.jobId) {
                    state.jobId = null;
                    state.jobKind = null;
                    state.error = "未完成的生成任务未恢复，请重新生成";
                    state.revision++;
                    target
                      .query("UPDATE assistant_flows SET state=? WHERE id=?")
                      .run(JSON.stringify(state), row.id);
                  }
                }
                for (const row of target
                  .query("SELECT history FROM chat_history_snapshots")
                  .all() as { history: string }[]) {
                  z.array(
                    z
                      .object({
                        id: z.string(),
                        role: z.enum(["user", "assistant", "tool"]),
                        type: z.string(),
                        text: z.string(),
                        status: z.string().optional(),
                        images: z.array(z.string()).optional(),
                      })
                      .strict(),
                  ).parse(JSON.parse(row.history));
                }
                for (const row of target
                  .query("SELECT name,content FROM canvas_notes")
                  .all() as { name: string; content: string }[])
                  canvasNoteInputSchema.parse({
                    name: row.name,
                    content: JSON.parse(row.content),
                  });
                for (const row of target
                  .query("SELECT id,date,content FROM daily_reports")
                  .all() as { id: string; date: string; content: string }[]) {
                  const value = parseStoredDailyReport(JSON.parse(row.content));
                  if (value.date !== row.date)
                    throw new Error("日报日期与内容不一致");
                  target
                    .query("UPDATE daily_reports SET content=? WHERE id=?")
                    .run(JSON.stringify(value), row.id);
                }
                if (target.query("PRAGMA foreign_key_check").all().length)
                  throw new Error("关联数据不完整");
              })
              .immediate();
          } finally {
            target.close();
            source.close();
          }
          return space;
        })
        .immediate();
      stage.result = result;
      return result;
    } catch (error) {
      if (targetDir) rmSync(targetDir, { recursive: true, force: true });
      if (error instanceof AppError || error instanceof z.ZodError) throw error;
      throw new AppError(
        "RESTORE_FAILED",
        "恢复失败，备份数据不兼容或不完整；现有工作空间未修改",
      );
    }
  }
  close() {
    for (const stage of this.stages.values())
      rmSync(stage.dir, { recursive: true, force: true });
    this.stages.clear();
  }
}
