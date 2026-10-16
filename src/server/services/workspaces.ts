import { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { chooseWorkspaceDirectory } from "../directory-picker";
import { z } from "zod";
import { AppError } from "../../shared/errors";
import {
  workspaceInputSchema,
  type Workspace,
  type WorkspaceSummary,
} from "../../shared/workspace";
import type { Actor } from "./work-items";
const defaultId = "00000000-0000-4000-a000-000000000001";
export class WorkspaceStore {
  readonly db: Database;
  readonly dataDir: string;
  constructor(private legacyPath: string) {
    this.dataDir = dirname(legacyPath);
    mkdirSync(this.dataDir, { recursive: true });
    this.db = new Database(join(this.dataDir, "workspaces.sqlite"), {
      create: true,
      strict: true,
    });
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,state TEXT NOT NULL,deleted_at TEXT); CREATE TABLE IF NOT EXISTS workspace_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
    this.db
      .transaction(() => {
        if (
          this.db
            .query("SELECT key FROM workspace_meta WHERE key='initialized'")
            .get()
        )
          return;
        // Only migrate a database from an older installation. A fresh install
        // starts with no spaces; users create their own from the manager page.
        if (existsSync(this.legacyPath)) {
          const now = new Date().toISOString();
          const state: Workspace = {
            id: defaultId,
            name: "默认工作空间",
            description: "",
            directory: "",
            version: 1,
            createdAt: now,
            updatedAt: now,
            lastOpenedAt: null,
          };
          this.db
            .query("INSERT INTO workspaces VALUES (?,?,NULL)")
            .run(defaultId, JSON.stringify(state));
        }
        this.db
          .query("INSERT INTO workspace_meta VALUES ('initialized','1')")
          .run();
      })
      .immediate();
  }
  get(id: string): Workspace {
    z.uuid().parse(id);
    const row = this.db
      .query("SELECT state FROM workspaces WHERE id=? AND deleted_at IS NULL")
      .get(id) as { state: string } | null;
    if (!row)
      throw new AppError("WORKSPACE_NOT_FOUND", "工作空间不存在或已删除", 404);
    return JSON.parse(row.state);
  }
  path(id: string) {
    return id === defaultId
      ? this.legacyPath
      : join(this.dataDir, "workspaces", id, "dedsiwork.sqlite");
  }
  legacyId() {
    return this.db
      .query("SELECT id FROM workspaces WHERE id=? AND deleted_at IS NULL")
      .get(defaultId)
      ? defaultId
      : undefined;
  }
  first() {
    return this.legacyId() || this.list()[0]?.id;
  }
  entries(): Workspace[] {
    return (
      this.db
        .query("SELECT state FROM workspaces WHERE deleted_at IS NULL")
        .all() as { state: string }[]
    ).map((row) => JSON.parse(row.state));
  }
  list(): WorkspaceSummary[] {
    return (
      this.db
        .query("SELECT state FROM workspaces WHERE deleted_at IS NULL")
        .all() as { state: string }[]
    )
      .map(({ state }) => {
        const workspace = JSON.parse(state) as Workspace;
        const counts = { chats: 0, items: 0, models: 0, sprints: 0, notes: 0 };
        if (existsSync(this.path(workspace.id))) {
          const db = new Database(this.path(workspace.id), { readonly: true });
          try {
            const count = (table: string, where = "") =>
              !db
                .query(
                  "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                )
                .get(table)
                ? 0
                : (
                    db
                      .query(`SELECT COUNT(*) AS n FROM ${table} ${where}`)
                      .get() as { n: number }
                  ).n;
            counts.chats = count("codex_chats");
            counts.items = count("work_items");
            counts.models = count("domain_models", "WHERE deleted_at IS NULL");
            counts.sprints = count("sprints");
            counts.notes = count("canvas_notes");
          } finally {
            db.close();
          }
        }
        return { ...workspace, counts };
      })
      .sort((a, b) =>
        (b.lastOpenedAt || b.createdAt).localeCompare(
          a.lastOpenedAt || a.createdAt,
        ),
      );
  }
  private access(actor: Actor) {
    if (!actor.writable) throw new AppError("FORBIDDEN", "需要写入权限", 403);
  }
  private save(workspace: Workspace) {
    this.db
      .query(
        "INSERT INTO workspaces VALUES (?,?,NULL) ON CONFLICT(id) DO UPDATE SET state=excluded.state",
      )
      .run(workspace.id, JSON.stringify(workspace));
    return workspace;
  }
  private directory(value: string) {
    if (!value) return "";
    const path = value.replace(/^~(?=\/|$)/, homedir());
    if (!isAbsolute(path))
      throw new AppError("INVALID_DIRECTORY", "请选择完整的本地目录");
    try {
      const resolved = realpathSync(path);
      if (!statSync(resolved).isDirectory()) throw new Error();
      return resolved;
    } catch {
      throw new AppError("INVALID_DIRECTORY", "本地目录不存在或无法访问");
    }
  }
  create(input: unknown, actor: Actor) {
    this.access(actor);
    const request = workspaceInputSchema.parse(input);
    const now = new Date().toISOString();
    return this.save({
      ...request,
      directory: this.directory(request.directory),
      id: crypto.randomUUID(),
      version: 1,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
    });
  }
  update(id: string, input: unknown, actor: Actor) {
    this.access(actor);
    const { expectedVersion, ...request } = workspaceInputSchema
      .extend({ expectedVersion: z.number().int().positive() })
      .parse(input);
    const current = this.get(id);
    if (current.version !== expectedVersion)
      throw new AppError(
        "VERSION_CONFLICT",
        "工作空间已更新，请刷新后重试",
        409,
      );
    return this.save({
      ...current,
      ...request,
      directory: this.directory(request.directory),
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    });
  }
  open(id: string, actor: Actor) {
    this.access(actor);
    const workspace = this.get(id);
    return this.save({ ...workspace, lastOpenedAt: new Date().toISOString() });
  }
  remove(id: string, input: unknown, actor: Actor) {
    this.access(actor);
    const current = this.get(id);
    const request = z
      .object({
        confirmed: z.literal(true),
        name: z.string(),
        expectedVersion: z.number().int().positive(),
      })
      .strict()
      .parse(input);
    if (request.name !== current.name)
      throw new AppError("CONFIRM_NAME", "请输入正确的工作空间名称");
    if (request.expectedVersion !== current.version)
      throw new AppError(
        "VERSION_CONFLICT",
        "工作空间已更新，请刷新后重试",
        409,
      );
    // Services must be closed first. Only remove application-owned data, never
    // current.directory, which may be a shared source checkout or a home folder.
    // Keep the catalog entry until cleanup succeeds so failed deletion can retry.
    if (id === defaultId) {
      // The migrated default space shares the data root with the global catalog
      // and credentials. Remove only its database and fallback chat directory.
      for (const suffix of ["", "-shm", "-wal", "-journal"]) {
        try {
          unlinkSync(this.path(id) + suffix);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      rmSync(join(this.dataDir, "chat-workspace"), {
        recursive: true,
        force: true,
      });
    }
    // Includes database sidecars, chat working files and any space attachments.
    rmSync(join(this.dataDir, "workspaces", id), {
      recursive: true,
      force: true,
    });
    this.db.exec("PRAGMA secure_delete=ON");
    this.db.query("DELETE FROM workspaces WHERE id=?").run(id);
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return { id };
  }
  async chooseDirectory(actor: Actor) {
    this.access(actor);
    return { directory: await chooseWorkspaceDirectory() };
  }
  close() {
    this.db.close();
  }
}
