import type { Database } from "bun:sqlite";
import { AppError } from "../../shared/errors";
import {
  idSchema,
  versionSchema,
  normalizeHistoricalItem,
  type WorkItem,
} from "../../shared/work-item";
import {
  sprintSchema,
  sprintDeleteSchema,
  sprintUpdateSchema,
  sprintItemsSchema,
  sprintMoveSchema,
  sprintFinishSchema,
  sprintCreateItemSchema,
  type Sprint,
  type SprintBoard,
} from "../../shared/sprint";
import { type Actor, WorkItemService } from "./work-items";
const columns =
  "id,name,goal,start_date AS startDate,end_date AS endDate,state,version,created_at AS createdAt,updated_at AS updatedAt,closed_at AS closedAt";
export class SprintService {
  constructor(
    public db: Database,
    public work: WorkItemService,
  ) {}
  list() {
    return {
      data: this.db
        .query<Sprint, []>(
          `SELECT ${columns} FROM sprints ORDER BY CASE state WHEN 'active' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END,start_date DESC,created_at DESC`,
        )
        .all(),
    };
  }
  get(id: string) {
    idSchema.parse(id);
    const s = this.db
      .query<Sprint, [string]>(`SELECT ${columns} FROM sprints WHERE id=?`)
      .get(id);
    if (!s) throw new AppError("NOT_FOUND", "冲刺不存在", 404);
    return s;
  }
  board(id: string): SprintBoard {
    const sprint = this.get(id);
    const items =
      sprint.state === "closed"
        ? (JSON.parse(
            (
              this.db
                .query("SELECT items FROM sprint_snapshots WHERE sprint_id=?")
                .get(id) as { items: string }
            ).items,
          ) as WorkItem[])
        : this.ids(id)
            .map((x) => this.work.get(x, true))
            .filter((x) => !x.deletedAt);
    const events = this.db
      .query(
        "SELECT id,action,details,source,created_at AS createdAt FROM sprint_events WHERE sprint_id=? ORDER BY rowid DESC LIMIT 50",
      )
      .all(id) as SprintBoard["events"];
    return {
      sprint,
      items: items.map(normalizeHistoricalItem),
      events: events.map((e) => ({
        ...e,
        details: JSON.parse(e.details as string),
      })),
    };
  }
  private ids(id: string) {
    return (
      this.db
        .query(
          "SELECT item_id AS id FROM sprint_items WHERE sprint_id=? ORDER BY position,item_id",
        )
        .all(id) as { id: string }[]
    ).map((x) => x.id);
  }
  private event(id: string, action: string, details: unknown, actor: Actor) {
    this.db
      .query("INSERT INTO sprint_events VALUES (?,?,?,?,?,?,?,?)")
      .run(
        crypto.randomUUID(),
        id,
        action,
        JSON.stringify(details),
        actor.source,
        actor.identity,
        new Date().toISOString(),
        actor.requestId,
      );
  }
  private access(actor: Actor) {
    if (!actor.writable)
      throw new AppError("FORBIDDEN", "此凭据仅允许查询", 403);
  }
  private check(id: string, version: number) {
    versionSchema.parse({ expectedVersion: version });
    const s = this.get(id);
    if (s.version !== version)
      throw new AppError("VERSION_CONFLICT", "冲刺已变更，请刷新后重试", 409);
    if (s.state === "closed")
      throw new AppError("SPRINT_CLOSED", "已结束的冲刺不能修改", 409);
    return s;
  }
  private bump(id: string, action: string, details: unknown, actor: Actor) {
    this.db
      .query("UPDATE sprints SET version=version+1,updated_at=? WHERE id=?")
      .run(new Date().toISOString(), id);
    this.event(id, action, details, actor);
    return this.board(id);
  }
  create(input: unknown, actor: Actor) {
    this.access(actor);
    const p = sprintSchema.parse(input);
    return this.db
      .transaction(() => {
        const id = crypto.randomUUID(),
          now = new Date().toISOString();
        this.db
          .query("INSERT INTO sprints VALUES (?,?,?,?,?,'planned',1,?,?,NULL)")
          .run(id, p.name, p.goal, p.startDate, p.endDate, now, now);
        this.event(id, "created", p, actor);
        return this.get(id);
      })
      .immediate();
  }
  deleteSprint(id: string, input: unknown, actor: Actor) {
    this.access(actor);
    const parsed = sprintDeleteSchema.parse(input);
    return this.db
      .transaction(() => {
        const sprint = this.get(id);
        if (sprint.version !== parsed.expectedVersion)
          throw new AppError(
            "VERSION_CONFLICT",
            "冲刺已变更，请刷新后重新确认删除",
            409,
          );
        if (this.board(id).items.length)
          throw new AppError(
            "SPRINT_NOT_EMPTY",
            "仅允许删除没有工作项的冲刺",
            409,
          );
        // Detach trashed memberships, keeping the work items and their history intact.
        this.db.query("DELETE FROM sprint_items WHERE sprint_id=?").run(id);
        this.db.query("DELETE FROM sprint_snapshots WHERE sprint_id=?").run(id);
        this.db.query("DELETE FROM sprint_events WHERE sprint_id=?").run(id);
        this.db.query("DELETE FROM sprints WHERE id=?").run(id);
        return { id, deleted: true };
      })
      .immediate();
  }
  update(id: string, input: unknown, actor: Actor) {
    this.access(actor);
    const p = sprintUpdateSchema.parse(input);
    return this.db
      .transaction(() => {
        this.check(id, p.expectedVersion);
        this.db
          .query(
            "UPDATE sprints SET name=?,goal=?,start_date=?,end_date=? WHERE id=?",
          )
          .run(
            p.sprint.name,
            p.sprint.goal,
            p.sprint.startDate,
            p.sprint.endDate,
            id,
          );
        return this.bump(id, "updated", p.sprint, actor);
      })
      .immediate();
  }
  start(id: string, input: unknown, actor: Actor) {
    this.access(actor);
    const p = versionSchema.parse(input);
    return this.db
      .transaction(() => {
        const s = this.check(id, p.expectedVersion);
        if (s.state !== "planned")
          throw new AppError(
            "INVALID_TRANSITION",
            "只有计划中的冲刺可以开始",
            409,
          );
        if (this.list().data.some((s) => s.state === "active"))
          throw new AppError(
            "ACTIVE_SPRINT_EXISTS",
            "请先结束当前进行中的冲刺",
            409,
          );
        this.db.query("UPDATE sprints SET state='active' WHERE id=?").run(id);
        return this.bump(id, "started", {}, actor);
      })
      .immediate();
  }
  private nextPosition(id: string) {
    return (
      this.db
        .query(
          "SELECT COALESCE(MAX(position),-1)+1 AS position FROM sprint_items WHERE sprint_id=?",
        )
        .get(id) as { position: number }
    ).position;
  }
  private available(itemId: string) {
    if (
      this.db
        .query(
          "SELECT 1 FROM sprint_items si JOIN sprints s ON s.id=si.sprint_id WHERE si.item_id=? AND s.state!='closed'",
        )
        .get(itemId)
    )
      throw new AppError(
        "ALREADY_PLANNED",
        "工作项已加入其他未结束的冲刺",
        409,
      );
  }
  add(id: string, input: unknown, actor: Actor) {
    this.access(actor);
    const p = sprintItemsSchema.parse(input);
    return this.db
      .transaction(() => {
        this.check(id, p.expectedVersion);
        let pos = this.nextPosition(id);
        for (const ref of p.items) {
          const item = this.work.get(ref.id);
          if (item.version !== ref.expectedVersion)
            throw new AppError(
              "VERSION_CONFLICT",
              "工作项已变更，请刷新后重试",
              409,
            );
          this.available(item.id);
          this.db
            .query("INSERT INTO sprint_items VALUES (?,?,?)")
            .run(id, item.id, pos++);
        }
        return this.bump(id, "items_added", p.items, actor);
      })
      .immediate();
  }
  remove(id: string, input: unknown, actor: Actor) {
    this.access(actor);
    const p = sprintItemsSchema.parse(input);
    return this.db
      .transaction(() => {
        this.check(id, p.expectedVersion);
        for (const ref of p.items) {
          const item = this.work.get(ref.id, true);
          if (item.version !== ref.expectedVersion)
            throw new AppError(
              "VERSION_CONFLICT",
              "工作项已变更，请刷新后重试",
              409,
            );
          if (!this.ids(id).includes(ref.id))
            throw new AppError("NOT_FOUND", "工作项不在此冲刺中", 404);
          this.db
            .query("DELETE FROM sprint_items WHERE sprint_id=? AND item_id=?")
            .run(id, ref.id);
        }
        return this.bump(id, "items_removed", p.items, actor);
      })
      .immediate();
  }
  move(id: string, input: unknown, actor: Actor) {
    this.access(actor);
    const p = sprintMoveSchema.parse(input);
    return this.db
      .transaction(() => {
        this.check(id, p.expectedVersion);
        const ids = this.ids(id);
        if (!ids.includes(p.itemId))
          throw new AppError("NOT_FOUND", "工作项不在此冲刺中", 404);
        if (p.beforeId === p.itemId)
          throw new AppError("INVALID_ORDER", "不能放在自身之前");
        if (p.beforeId) {
          if (
            !ids.includes(p.beforeId) ||
            this.work.get(p.beforeId).status !== p.status
          )
            throw new AppError(
              "INVALID_ORDER",
              "排序目标不在指定列，请刷新后重试",
              409,
            );
        }
        this.work.update(
          p.itemId,
          {
            status: p.status,
            transitionReason: p.reason,
            expectedVersion: p.itemVersion,
          },
          actor,
        );
        const order = ids.filter((x) => x !== p.itemId);
        order.splice(
          p.beforeId ? order.indexOf(p.beforeId) : order.length,
          0,
          p.itemId,
        );
        order.forEach((x, i) =>
          this.db
            .query(
              "UPDATE sprint_items SET position=? WHERE sprint_id=? AND item_id=?",
            )
            .run(i, id, x),
        );
        return this.bump(id, "item_moved", p, actor);
      })
      .immediate();
  }
  createItem(id: string, input: unknown, actor: Actor) {
    this.access(actor);
    const p = sprintCreateItemSchema.parse(input);
    return this.db
      .transaction(() => {
        this.check(id, p.expectedVersion);
        let item = this.work.create(p.item, actor, p.requestKey);
        this.available(item.id);
        if (p.status !== item.status)
          item = this.work.update(
            item.id,
            { status: p.status, expectedVersion: item.version },
            actor,
          );
        this.db
          .query("INSERT INTO sprint_items VALUES (?,?,?)")
          .run(id, item.id, this.nextPosition(id));
        return this.bump(id, "item_created", { itemId: item.id }, actor);
      })
      .immediate();
  }
  finish(id: string, input: unknown, actor: Actor) {
    this.access(actor);
    const p = sprintFinishSchema.parse(input);
    return this.db
      .transaction(() => {
        const s = this.check(id, p.expectedVersion);
        if (s.state !== "active")
          throw new AppError(
            "INVALID_TRANSITION",
            "只有进行中的冲刺可以结束",
            409,
          );
        if (p.targetSprintId) {
          const target = this.check(p.targetSprintId, p.targetVersion ?? 0);
          if (target.state !== "planned" || target.id === id)
            throw new AppError("INVALID_TARGET", "请选择计划中的下一冲刺", 409);
        }
        const items = this.board(id).items;
        this.db
          .query("INSERT INTO sprint_snapshots VALUES (?,?)")
          .run(id, JSON.stringify(items));
        this.db
          .query("UPDATE sprints SET state='closed',closed_at=? WHERE id=?")
          .run(new Date().toISOString(), id);
        if (p.targetSprintId) {
          let pos = this.nextPosition(p.targetSprintId);
          for (const item of items.filter(
            (x) => !["done", "cancelled"].includes(x.status),
          )) {
            this.available(item.id);
            this.db
              .query("INSERT INTO sprint_items VALUES (?,?,?)")
              .run(p.targetSprintId, item.id, pos++);
          }
          this.bump(p.targetSprintId, "items_carried", { from: id }, actor);
        }
        return this.bump(
          id,
          "closed",
          { targetSprintId: p.targetSprintId },
          actor,
        );
      })
      .immediate();
  }
}
