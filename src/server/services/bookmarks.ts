import type { Database } from "bun:sqlite";
import { bookmarkSaveSchema, type BookmarkState } from "../../shared/bookmarks";
import { AppError } from "../../shared/errors";
import type { Actor } from "./work-items";

export class Bookmarks {
  constructor(private db: Database) {}
  get(): BookmarkState {
    const row = this.db
      .query("SELECT version,groups_json FROM bookmarks WHERE id=1")
      .get() as { version: number; groups_json: string } | null;
    return row
      ? { version: row.version, groups: JSON.parse(row.groups_json) }
      : { version: 0, groups: [] };
  }
  save(input: unknown, actor: Actor): BookmarkState {
    if (!actor.writable)
      throw new AppError("FORBIDDEN", "此凭据仅允许查询", 403);
    const request = bookmarkSaveSchema.parse(input);
    return this.db
      .transaction(() => {
        const current = this.get();
        if (current.version !== request.expectedVersion)
          throw new AppError(
            "VERSION_CONFLICT",
            "网址导航已在其他页面更新，请刷新后重试",
            409,
          );
        const version = current.version + 1;
        this.db
          .query(
            "INSERT INTO bookmarks(id,version,groups_json) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,groups_json=excluded.groups_json",
          )
          .run(version, JSON.stringify(request.groups));
        return { version, groups: request.groups };
      })
      .immediate();
  }
}
