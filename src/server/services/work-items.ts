import {
  createSchema,
  patchSchema,
  listSchema,
  pageSchema,
  idSchema,
  requestKeySchema,
  versionSchema,
  purgeSchema,
  type WorkItem,
  type WorkItemEvent,
} from "../../shared/work-item";
import { AppError } from "../../shared/errors";
import { WorkItemRepository } from "../repositories/work-items";
import type { SQLQueryBindings } from "bun:sqlite";

export type Actor = {
  source: "web" | "mcp";
  identity: string;
  writable: boolean;
  requestId: string;
};
export class WorkItemService {
  constructor(public repo: WorkItemRepository) {}
  summary() {
    const row = this.repo.db
      .query(
        `SELECT COUNT(CASE WHEN deleted_at IS NULL THEN 1 END) AS total,COUNT(CASE WHEN deleted_at IS NULL AND status='in_progress' THEN 1 END) AS inProgress,COUNT(CASE WHEN deleted_at IS NULL AND status='done' THEN 1 END) AS done,COUNT(deleted_at) AS trash FROM work_items`,
      )
      .get();
    return row;
  }
  private writeAccess(actor: Actor) {
    if (!actor.writable)
      throw new AppError("FORBIDDEN", "此凭据仅允许查询", 403);
  }
  get(id: string, includeDeleted = false) {
    idSchema.parse(id);
    const item = this.repo.get(id);
    if (!item || (item.deletedAt && !includeDeleted))
      throw new AppError("NOT_FOUND", "工作项不存在或已移入回收站", 404);
    return item;
  }
  list(input: unknown) {
    const query = listSchema.parse(input);
    const where = [
      query.deleted === "true"
        ? "deleted_at IS NOT NULL"
        : "deleted_at IS NULL",
    ];
    const values: SQLQueryBindings[] = [];
    if (query.q) {
      where.push(
        "(instr(lower(title),lower(?))>0 OR instr(lower(description),lower(?))>0)",
      );
      values.push(query.q, query.q);
    }
    for (const key of ["status", "type", "priority"] as const)
      if (query[key]) {
        where.push(`${key}=?`);
        values.push(query[key]!);
      }
    const result = this.repo.list(
      where.join(" AND "),
      values,
      query.pageSize,
      (query.page - 1) * query.pageSize,
    );
    return {
      data: result.data,
      meta: { total: result.total, page: query.page, pageSize: query.pageSize },
    };
  }
  private record(
    item: WorkItem,
    action: string,
    actor: Actor,
    changes: WorkItemEvent["changes"],
  ) {
    this.repo.db
      .query("INSERT INTO work_item_events VALUES (?,?,?,?,?,?,?,?)")
      .run(
        crypto.randomUUID(),
        item.id,
        action,
        JSON.stringify(changes),
        actor.source,
        actor.identity,
        item.updatedAt,
        actor.requestId,
      );
  }
  create(input: unknown, actor: Actor, requestKey?: string) {
    this.writeAccess(actor);
    const parsed = createSchema.parse(input);
    if (parsed.status !== "todo")
      throw new AppError("INVALID_TRANSITION", "新建工作项必须为待处理状态");
    if (requestKey !== undefined) requestKeySchema.parse(requestKey);
    const normalized = JSON.stringify(parsed);
    return this.repo.db
      .transaction(() => {
        if (requestKey) {
          const cached = this.repo.db
            .query(
              "SELECT input,result FROM idempotency_records WHERE actor=? AND request_key=?",
            )
            .get(actor.identity, requestKey) as {
            input: string;
            result: string;
          } | null;
          if (cached) {
            if (JSON.parse(cached.result).purged)
              throw new AppError(
                "PERMANENTLY_DELETED",
                "此请求创建的工作项已永久删除，请使用新的请求标识",
                410,
              );
            if (cached.input !== normalized)
              throw new AppError(
                "IDEMPOTENCY_CONFLICT",
                "相同请求标识已用于不同内容",
                409,
              );
            return JSON.parse(cached.result) as WorkItem;
          }
        }
        const now = new Date().toISOString();
        const item: WorkItem = {
          ...parsed,
          id: crypto.randomUUID(),
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        this.repo.insert(item);
        this.record(item, "created", actor, {
          title: { before: null, after: item.title },
        });
        if (requestKey)
          this.repo.db
            .query("INSERT INTO idempotency_records VALUES (?,?,?,?)")
            .run(actor.identity, requestKey, normalized, JSON.stringify(item));
        return item;
      })
      .immediate();
  }
  update(id: string, input: unknown, actor: Actor) {
    const { expectedVersion, ...patch } = patchSchema.parse(input);
    if (!Object.keys(patch).length)
      throw new AppError("EMPTY_PATCH", "请提供需要修改的字段");
    return this.mutate(id, expectedVersion, actor, "updated", (old) => {
      if (old.deletedAt) throw new AppError("DELETED", "请先恢复此工作项", 409);
      if (
        patch.status &&
        patch.status !== old.status &&
        ["done", "cancelled"].includes(old.status) &&
        patch.status !== "todo"
      )
        throw new AppError(
          "INVALID_TRANSITION",
          "已结束的工作项请先重新打开为待处理",
          409,
        );
      return { ...old, ...patch };
    });
  }
  remove(id: string, expectedVersion: number, actor: Actor) {
    return this.mutate(id, expectedVersion, actor, "deleted", (old) => {
      if (old.deletedAt)
        throw new AppError("ALREADY_DELETED", "工作项已在回收站", 409);
      return { ...old, deletedAt: new Date().toISOString() };
    });
  }
  restore(id: string, expectedVersion: number, actor: Actor) {
    return this.mutate(id, expectedVersion, actor, "restored", (old) => {
      if (!old.deletedAt)
        throw new AppError("NOT_DELETED", "工作项未被删除", 409);
      return { ...old, deletedAt: null };
    });
  }
  purge(input: unknown, actor: Actor) {
    this.writeAccess(actor);
    const { items } = purgeSchema.parse(input);
    return this.repo.db
      .transaction(() => {
        for (const target of items) {
          const item = this.get(target.id, true);
          if (!item.deletedAt)
            throw new AppError(
              "NOT_DELETED",
              "仅允许永久删除回收站中的工作项，请刷新列表",
              409,
            );
          if (item.version !== target.expectedVersion)
            throw new AppError(
              "VERSION_CONFLICT",
              "工作项已变更，请刷新列表后重新选择",
              409,
            );
        }
        for (const { id } of items) {
          this.repo.db
            .query("DELETE FROM work_item_events WHERE work_item_id=?")
            .run(id);
          // Keep only a tombstone so a retried create cannot resurrect deleted content.
          this.repo.db
            .query(
              "UPDATE idempotency_records SET input='', result=? WHERE json_extract(result,'$.id')=?",
            )
            .run(JSON.stringify({ id, purged: true }), id);
          this.repo.db.query("DELETE FROM work_items WHERE id=?").run(id);
        }
        return {
          deletedIds: items.map((item) => item.id),
          count: items.length,
        };
      })
      .immediate();
  }
  private mutate(
    id: string,
    expectedVersion: number,
    actor: Actor,
    action: string,
    transform: (item: WorkItem) => WorkItem,
  ) {
    this.writeAccess(actor);
    versionSchema.parse({ expectedVersion });
    return this.repo.db
      .transaction(() => {
        const old = this.get(id, true);
        if (old.version !== expectedVersion)
          throw new AppError(
            "VERSION_CONFLICT",
            "工作项已被更新，请重新读取后再保存",
            409,
            { currentVersion: old.version },
          );
        const item = {
          ...transform(old),
          version: old.version + 1,
          updatedAt: new Date().toISOString(),
        };
        const changes: WorkItemEvent["changes"] = {};
        for (const key of [
          "title",
          "description",
          "type",
          "status",
          "priority",
          "dueAt",
          "deletedAt",
        ] as const)
          if (old[key] !== item[key])
            changes[key] = { before: old[key], after: item[key] };
        if (!Object.keys(changes).length) return old;
        if (!this.repo.update(item, expectedVersion))
          throw new AppError("VERSION_CONFLICT", "版本冲突", 409);
        this.record(item, action, actor, changes);
        return item;
      })
      .immediate();
  }
  events(id: string, input: unknown) {
    this.get(id, true);
    const page = pageSchema.parse(input);
    const result = this.repo.events(
      id,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    return { data: result.data, meta: { ...page, total: result.total } };
  }
}
