import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { WorkItem, WorkItemEvent } from "../../shared/work-item";

export const itemColumns = `id,title,description,type,status,priority,due_at AS dueAt,blocked_reason AS blockedReason,version,created_at AS createdAt,updated_at AS updatedAt,deleted_at AS deletedAt`;
export class WorkItemRepository {
  constructor(public db: Database) {}
  get(id: string) {
    return this.db
      .query<WorkItem, [string]>(
        `SELECT ${itemColumns} FROM work_items WHERE id=?`,
      )
      .get(id);
  }
  list(
    where: string,
    values: SQLQueryBindings[],
    limit: number,
    offset: number,
  ) {
    const total = (
      this.db
        .query(`SELECT COUNT(*) AS total FROM work_items WHERE ${where}`)
        .get(...values) as { total: number }
    ).total;
    const data = this.db
      .query<WorkItem, SQLQueryBindings[]>(
        `SELECT ${itemColumns} FROM work_items WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`,
      )
      .all(...values, limit, offset);
    return { data, total };
  }
  insert(item: WorkItem) {
    this.db
      .query(
        `INSERT INTO work_items (id,title,description,type,status,priority,due_at,version,created_at,updated_at,deleted_at,blocked_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        item.id,
        item.title,
        item.description,
        item.type,
        item.status,
        item.priority,
        item.dueAt,
        item.version,
        item.createdAt,
        item.updatedAt,
        item.deletedAt,
        item.blockedReason,
      );
  }
  update(item: WorkItem, expectedVersion: number) {
    return this.db
      .query(
        `UPDATE work_items SET title=?,description=?,type=?,status=?,priority=?,due_at=?,version=?,updated_at=?,deleted_at=?,blocked_reason=? WHERE id=? AND version=?`,
      )
      .run(
        item.title,
        item.description,
        item.type,
        item.status,
        item.priority,
        item.dueAt,
        item.version,
        item.updatedAt,
        item.deletedAt,
        item.blockedReason,
        item.id,
        expectedVersion,
      ).changes;
  }
  events(id: string, limit: number, offset: number) {
    const total = (
      this.db
        .query(
          "SELECT COUNT(*) AS total FROM work_item_events WHERE work_item_id=?",
        )
        .get(id) as { total: number }
    ).total;
    const rows = this.db
      .query(
        `SELECT id,work_item_id AS workItemId,action,changes,source,created_at AS createdAt,request_id AS requestId FROM work_item_events WHERE work_item_id=? ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(id, limit, offset) as (Omit<WorkItemEvent, "changes"> & {
      changes: string;
    })[];
    return {
      total,
      data: rows.map((row) => ({
        ...row,
        changes: JSON.parse(row.changes),
      })) as WorkItemEvent[],
    };
  }
}
