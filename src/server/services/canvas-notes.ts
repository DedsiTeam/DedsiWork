import type { Database } from "bun:sqlite";
import { z } from "zod";
import { AppError } from "../../shared/errors";
import {
  canvasNoteInputSchema,
  canvasContentSchema,
  type CanvasNote,
  type CanvasNoteList,
} from "../../shared/canvas-note";
import type { Actor } from "./work-items";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, renameSync, rmSync } from "node:fs";
type Row = {
  id: string;
  name: string;
  content: string;
  version: number;
  created_at: string;
  updated_at: string;
};
export class CanvasNotes {
  constructor(private db: Database) {}
  private access(actor: Actor) {
    if (!actor.writable) throw new AppError("FORBIDDEN", "需要写入权限", 403);
  }
  get(id: string): CanvasNote {
    z.uuid().parse(id);
    const row = this.db
      .query("SELECT * FROM canvas_notes WHERE id=?")
      .get(id) as Row | null;
    if (!row) throw new AppError("NOT_FOUND", "无边记不存在或已删除", 404);
    return {
      id: row.id,
      name: row.name,
      content: canvasContentSchema.parse(JSON.parse(row.content)),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  list(params: URLSearchParams): CanvasNoteList {
    const q = z
      .string()
      .max(200)
      .parse(params.get("q") || "");
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(100000)
      .parse(params.get("page") || 1);
    const where = "name LIKE ? ESCAPE '\\'";
    const query = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const total = (
      this.db
        .query(`SELECT COUNT(*) AS n FROM canvas_notes WHERE ${where}`)
        .get(query) as { n: number }
    ).n;
    // Return summaries only; embedded images stay out of the management list.
    const rows = this.db
      .query(
        `SELECT id,name,version,created_at,updated_at,json_array_length(content,'$.nodes') AS nodeCount, (SELECT substr(group_concat(json_extract(value,'$.text'),' '),1,140) FROM json_each(canvas_notes.content,'$.nodes') WHERE json_extract(value,'$.text')<>'') AS preview FROM canvas_notes WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT 20 OFFSET ?`,
      )
      .all(query, (page - 1) * 20) as (Row & {
      nodeCount: number;
      preview: string | null;
    })[];
    return {
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        nodeCount: row.nodeCount,
        preview: row.preview || "",
      })),
      meta: { total, page, pageSize: 20 },
    };
  }
  save(id: string | null, input: unknown, actor: Actor) {
    this.access(actor);
    const value = (
      id
        ? canvasNoteInputSchema.extend({
            expectedVersion: z.number().int().positive(),
          })
        : canvasNoteInputSchema
    ).parse(input);
    return this.db
      .transaction(() => {
        if (
          id &&
          this.get(id).version !==
            (value as typeof value & { expectedVersion: number })
              .expectedVersion
        )
          throw new AppError(
            "VERSION_CONFLICT",
            "无边记已在其他窗口修改，请保留当前内容后重新打开",
            409,
          );
        const now = new Date().toISOString();
        if (id)
          this.db
            .query(
              "UPDATE canvas_notes SET name=?,content=?,version=version+1,updated_at=? WHERE id=?",
            )
            .run(value.name, JSON.stringify(value.content), now, id);
        else {
          id = crypto.randomUUID();
          this.db
            .query("INSERT INTO canvas_notes VALUES (?,?,?,1,?,?)")
            .run(id, value.name, JSON.stringify(value.content), now, now);
        }
        return this.get(id!);
      })
      .immediate();
  }
  remove(id: string, input: unknown, actor: Actor) {
    this.access(actor);
    const value = z
      .object({
        confirmed: z.literal(true),
        expectedVersion: z.number().int().positive(),
      })
      .strict()
      .parse(input);
    return this.db
      .transaction(() => {
        if (this.get(id).version !== value.expectedVersion)
          throw new AppError(
            "VERSION_CONFLICT",
            "无边记已更新，请刷新后重新确认删除",
            409,
          );
        this.db.query("DELETE FROM canvas_notes WHERE id=?").run(id);
        return { deleted: true };
      })
      .immediate();
  }
  async exportImage(input: unknown, actor: Actor) {
    this.access(actor);
    const value = z
      .object({
        name: z.string().max(80),
        data: z
          .string()
          .max(7000000)
          .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/),
      })
      .strict()
      .parse(input);
    const bytes = Buffer.from(
      value.data.slice(value.data.indexOf(",") + 1),
      "base64",
    );
    if (
      bytes.length < 24 ||
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      bytes.readUInt32BE(16) > 8192 ||
      bytes.readUInt32BE(20) > 8192
    )
      throw new AppError("INVALID_IMAGE", "导出图片无效或尺寸超过 8192 像素");
    if (process.platform !== "darwin")
      throw new AppError("UNSUPPORTED_PLATFORM", "当前平台暂不支持保存图片");
    const name =
      (value.name.replace(/[\\/:\x00-\x1f]/g, "_") || "无边记") + ".png";
    let path: string;
    try {
      path = (
        await promisify(execFile)("/usr/bin/osascript", [
          "-e",
          `POSIX path of (choose file name with prompt "导出无边记图片" default name ${JSON.stringify(name)})`,
        ])
      ).stdout.trim();
    } catch (error) {
      if (String((error as { stderr?: string }).stderr).includes("-128"))
        return { cancelled: true };
      throw new AppError("FILE_PICKER_FAILED", "无法打开保存窗口，请重试");
    }
    if (!path) return { cancelled: true };
    if (!path.toLowerCase().endsWith(".png")) path += ".png";
    const temporary = path + "." + crypto.randomUUID() + ".tmp";
    try {
      writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
      renameSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
    return { cancelled: false, path };
  }
}
