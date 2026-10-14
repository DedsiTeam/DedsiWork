import { afterEach, beforeEach, expect, test } from "bun:test";
import { openDatabase } from "../server/db/database";
import { WorkItemRepository } from "../server/repositories/work-items";
import { WorkItemService, type Actor } from "../server/services/work-items";
import { SprintService } from "../server/services/sprints";
let service: SprintService, work: WorkItemService;
const actor: Actor = {
  source: "web",
  identity: "test",
  writable: true,
  requestId: "test",
};
const plan = {
  name: "Sprint 01",
  goal: "完成闭环",
  startDate: "2026-10-14",
  endDate: "2026-10-27",
};
beforeEach(() => {
  const db = openDatabase(":memory:");
  work = new WorkItemService(new WorkItemRepository(db));
  service = new SprintService(db, work);
});
afterEach(() => service.db.close());
test("validates dates, versions, permissions and single active sprint", () => {
  expect(() =>
    service.create({ ...plan, endDate: "2026-10-01" }, actor),
  ).toThrow();
  expect(() => service.create(plan, { ...actor, writable: false })).toThrow(
    "仅允许查询",
  );
  const a = service.create(plan, actor),
    b = service.create({ ...plan, name: "Sprint 02" }, actor);
  expect(() =>
    service.update(a.id, { expectedVersion: 2, sprint: plan }, actor),
  ).toThrow("已变更");
  service.start(a.id, { expectedVersion: 1 }, actor);
  expect(() => service.start(b.id, { expectedVersion: 1 }, actor)).toThrow(
    "请先结束",
  );
  expect(() => service.start(a.id, { expectedVersion: 2 }, actor)).toThrow(
    "计划中",
  );
  for (const run of [
    () =>
      service.start(
        b.id,
        { expectedVersion: 1 },
        { ...actor, writable: false },
      ),
    () =>
      service.finish(
        a.id,
        { expectedVersion: 2 },
        { ...actor, writable: false },
      ),
    () =>
      service.update(
        b.id,
        { expectedVersion: 1, sprint: plan },
        { ...actor, writable: false },
      ),
  ])
    expect(run).toThrow("仅允许查询");
});
test("membership, move order, work item transitions and stale writes", () => {
  const a = service.create(plan, actor),
    b = service.create(plan, actor);
  const x = work.create({ title: "x", dueAt: "2026-10-20T00:00:00Z" }, actor),
    y = work.create({ title: "y" }, actor);
  let board = service.add(
    a.id,
    {
      expectedVersion: 1,
      items: [
        { id: x.id, expectedVersion: 1 },
        { id: y.id, expectedVersion: 1 },
      ],
    },
    actor,
  );
  expect(work.list({ unplanned: "true" }).meta.total).toBe(0);
  expect(() =>
    service.add(
      b.id,
      { expectedVersion: 1, items: [{ id: x.id, expectedVersion: 1 }] },
      actor,
    ),
  ).toThrow("其他未结束");
  expect(() =>
    service.move(
      a.id,
      {
        expectedVersion: 2,
        itemId: x.id,
        itemVersion: 9,
        status: "in_progress",
      },
      actor,
    ),
  ).toThrow("重新读取");
  board = service.move(
    a.id,
    {
      expectedVersion: 2,
      itemId: y.id,
      itemVersion: 1,
      status: "todo",
      beforeId: x.id,
    },
    actor,
  );
  expect(board.items.map((x) => x.title)).toEqual(["y", "x"]);
  board = service.move(
    a.id,
    { expectedVersion: 3, itemId: x.id, itemVersion: 1, status: "done" },
    actor,
  );
  expect(() =>
    service.move(
      a.id,
      { expectedVersion: 4, itemId: x.id, itemVersion: 2, status: "paused" },
      actor,
    ),
  ).toThrow("重新打开");
  board = service.remove(
    a.id,
    { expectedVersion: 4, items: [{ id: x.id, expectedVersion: 2 }] },
    actor,
  );
  expect(work.get(x.id).status).toBe("done");
  expect(work.get(x.id).dueAt).toBe(x.dueAt);
  expect(board.items).toHaveLength(1);
  expect(work.list({ unplanned: "true" }).data[0]?.id).toBe(x.id);
});
test("atomic batch add and create roll back when an event fails", () => {
  const s = service.create(plan, actor),
    x = work.create({ title: "x" }, actor),
    y = work.create({ title: "y" }, actor);
  expect(() =>
    service.add(
      s.id,
      {
        expectedVersion: 1,
        items: [
          { id: x.id, expectedVersion: 1 },
          { id: y.id, expectedVersion: 2 },
        ],
      },
      actor,
    ),
  ).toThrow();
  expect(service.board(s.id).items).toHaveLength(0);
  expect(service.get(s.id).version).toBe(1);
  service.db.exec(
    "CREATE TRIGGER fail_sprint_event BEFORE INSERT ON sprint_events BEGIN SELECT RAISE(ABORT,'forced failure'); END;",
  );
  expect(() =>
    service.createItem(
      s.id,
      {
        expectedVersion: 1,
        item: { title: "rollback" },
        status: "paused",
        requestKey: "rollback",
      },
      actor,
    ),
  ).toThrow("forced failure");
  expect(work.list({ q: "rollback" }).meta.total).toBe(0);
  expect(
    service.db.query("SELECT * FROM idempotency_records").all(),
  ).toHaveLength(0);
});
test("finish snapshots survive edits and purge; unfinished items carry without changing status", () => {
  const s = service.create(plan, actor),
    next = service.create(plan, actor);
  let board = service.createItem(
    s.id,
    {
      expectedVersion: 1,
      item: { title: "done" },
      status: "done",
      requestKey: "done",
    },
    actor,
  );
  const done = board.items[0]!;
  board = service.createItem(
    s.id,
    {
      expectedVersion: 2,
      item: { title: "blocked" },
      status: "paused",
      requestKey: "blocked",
    },
    actor,
  );
  const blocked = board.items.find((i) => i.title === "blocked")!;
  service.start(s.id, { expectedVersion: 3 }, actor);
  expect(() =>
    service.finish(
      s.id,
      { expectedVersion: 4, targetSprintId: next.id, targetVersion: 2 },
      actor,
    ),
  ).toThrow();
  expect(service.get(s.id).state).toBe("active");
  const ended = service.finish(
    s.id,
    { expectedVersion: 4, targetSprintId: next.id, targetVersion: 1 },
    actor,
  );
  expect(ended.sprint.state).toBe("closed");
  expect(service.board(next.id).items.map((x) => x.id)).toEqual([blocked.id]);
  expect(work.get(blocked.id).status).toBe("paused");
  work.update(
    blocked.id,
    { expectedVersion: blocked.version, title: "new title", status: "done" },
    actor,
  );
  work.remove(done.id, done.version, actor);
  work.purge(
    { items: [{ id: done.id, expectedVersion: done.version + 1 }] },
    actor,
  );
  expect(service.board(s.id).items.map((i) => i.title)).toEqual([
    "done",
    "blocked",
  ]);
  expect(() =>
    service.update(s.id, { expectedVersion: 5, sprint: plan }, actor),
  ).toThrow("已结束");
  expect(() =>
    service.add(
      s.id,
      { expectedVersion: 5, items: [{ id: blocked.id, expectedVersion: 3 }] },
      actor,
    ),
  ).toThrow("已结束");
});
test("finish to backlog and read-only tokens cannot mutate membership", () => {
  const s = service.create(plan, actor),
    x = work.create({ title: "x" }, actor),
    reader = { ...actor, writable: false };
  expect(() =>
    service.add(
      s.id,
      { expectedVersion: 1, items: [{ id: x.id, expectedVersion: 1 }] },
      reader,
    ),
  ).toThrow();
  service.add(
    s.id,
    { expectedVersion: 1, items: [{ id: x.id, expectedVersion: 1 }] },
    actor,
  );
  expect(() =>
    service.remove(
      s.id,
      { expectedVersion: 2, items: [{ id: x.id, expectedVersion: 1 }] },
      reader,
    ),
  ).toThrow();
  expect(() =>
    service.move(
      s.id,
      { expectedVersion: 2, itemId: x.id, itemVersion: 1, status: "done" },
      reader,
    ),
  ).toThrow();
  service.start(s.id, { expectedVersion: 2 }, actor);
  service.finish(s.id, { expectedVersion: 3 }, actor);
  expect(work.list({ unplanned: "true" }).data[0]?.id).toBe(x.id);
});

test("finish rolls back snapshot and carry when target activity fails", () => {
  const s = service.create(plan, actor),
    next = service.create(plan, actor);
  service.createItem(
    s.id,
    { expectedVersion: 1, item: { title: "carry" }, requestKey: "carry" },
    actor,
  );
  service.start(s.id, { expectedVersion: 2 }, actor);
  service.db.exec(
    "CREATE TRIGGER fail_carry BEFORE INSERT ON sprint_events WHEN NEW.action='items_carried' BEGIN SELECT RAISE(ABORT,'carry failure'); END;",
  );
  expect(() =>
    service.finish(
      s.id,
      { expectedVersion: 3, targetSprintId: next.id, targetVersion: 1 },
      actor,
    ),
  ).toThrow("carry failure");
  expect(service.get(s.id).state).toBe("active");
  expect(service.get(s.id).version).toBe(3);
  expect(service.board(next.id).items).toHaveLength(0);
  expect(service.db.query("SELECT * FROM sprint_snapshots").all()).toHaveLength(
    0,
  );
});

test("delivery stages, paused items and independent blocking keep workflow and audit", () => {
  const sprint = service.create(plan, actor);
  const x = work.create({ title: "delivery" }, actor);
  let board = service.add(
    sprint.id,
    { expectedVersion: 1, items: [{ id: x.id, expectedVersion: 1 }] },
    actor,
  );
  let item = x;
  for (const status of [
    "in_progress",
    "in_review",
    "in_verification",
    "awaiting_acceptance",
    "paused",
  ] as const) {
    board = service.move(
      sprint.id,
      {
        expectedVersion: board.sprint.version,
        itemId: x.id,
        itemVersion: item.version,
        status,
      },
      actor,
    );
    item = board.items[0]!;
    expect(item.status).toBe(status);
  }
  item = work.update(
    x.id,
    {
      expectedVersion: item.version,
      status: "in_verification",
      blockedReason: "等待测试环境",
    },
    actor,
  );
  expect(item.status).toBe("in_verification");
  expect(work.list({ blocked: "true" }).data[0]?.id).toBe(x.id);
  expect(() =>
    work.update(
      x.id,
      { expectedVersion: item.version, status: "in_progress" },
      actor,
    ),
  ).toThrow("原因");
  item = work.update(
    x.id,
    {
      expectedVersion: item.version,
      status: "in_progress",
      transitionReason: "验证发现兼容性问题",
    },
    actor,
  );
  expect(work.events(x.id, {}).data[0]?.changes.transitionReason?.after).toBe(
    "验证发现兼容性问题",
  );
  expect(item.blockedReason).toBe("等待测试环境");
  item = work.update(
    x.id,
    { expectedVersion: item.version, blockedReason: "" },
    actor,
  );
  expect(work.list({ blocked: "true" }).meta.total).toBe(0);
  item = work.update(
    x.id,
    { expectedVersion: item.version, status: "paused" },
    actor,
  );
  service.start(sprint.id, { expectedVersion: board.sprint.version }, actor);
  const next = service.create({ ...plan, name: "next" }, actor);
  service.finish(
    sprint.id,
    {
      expectedVersion: board.sprint.version + 1,
      targetSprintId: next.id,
      targetVersion: 1,
    },
    actor,
  );
  expect(service.board(next.id).items[0]?.status).toBe("paused");
  item = work.update(
    x.id,
    { expectedVersion: item.version, status: "cancelled" },
    actor,
  );
  expect(() =>
    work.update(
      x.id,
      { expectedVersion: item.version, blockedReason: "invalid" },
      actor,
    ),
  ).toThrow("已结束");
});

test("only confirmed empty sprints may be deleted, with version and permission checks", () => {
  const s = service.create(plan, actor),
    next = service.create({ ...plan, name: "next" }, actor);
  expect(() =>
    service.deleteSprint(s.id, { expectedVersion: 1, confirmed: false }, actor),
  ).toThrow();
  expect(() =>
    service.deleteSprint(
      s.id,
      { expectedVersion: 1, confirmed: true },
      { ...actor, writable: false },
    ),
  ).toThrow("仅允许查询");
  expect(() =>
    service.deleteSprint(s.id, { expectedVersion: 2, confirmed: true }, actor),
  ).toThrow("重新确认");
  const item = work.create({ title: "kept" }, actor);
  service.add(
    s.id,
    { expectedVersion: 1, items: [{ id: item.id, expectedVersion: 1 }] },
    actor,
  );
  expect(() =>
    service.deleteSprint(s.id, { expectedVersion: 1, confirmed: true }, actor),
  ).toThrow("重新确认");
  expect(() =>
    service.deleteSprint(s.id, { expectedVersion: 2, confirmed: true }, actor),
  ).toThrow("没有工作项");
  work.remove(item.id, 1, actor);
  expect(
    service.deleteSprint(s.id, { expectedVersion: 2, confirmed: true }, actor)
      .deleted,
  ).toBe(true);
  expect(() => service.get(s.id)).toThrow("不存在");
  expect(work.get(item.id, true).deletedAt).not.toBeNull();
  expect(work.events(item.id, {}).meta.total).toBe(2);
  expect(
    service.db.query("SELECT * FROM sprint_items WHERE sprint_id=?").all(s.id),
  ).toHaveLength(0);
  service.start(next.id, { expectedVersion: 1 }, actor);
  service.deleteSprint(next.id, { expectedVersion: 2, confirmed: true }, actor);
  const another = service.create(plan, actor);
  service.start(another.id, { expectedVersion: 1 }, actor);
  service.finish(another.id, { expectedVersion: 2 }, actor);
  service.deleteSprint(
    another.id,
    { expectedVersion: 3, confirmed: true },
    actor,
  );
  expect(service.list().data).toHaveLength(0);
});

test("nonempty historical snapshots prevent deletion even after work item purge", () => {
  const s = service.create(plan, actor),
    item = work.create({ title: "history" }, actor);
  service.add(
    s.id,
    { expectedVersion: 1, items: [{ id: item.id, expectedVersion: 1 }] },
    actor,
  );
  service.start(s.id, { expectedVersion: 2 }, actor);
  service.finish(s.id, { expectedVersion: 3 }, actor);
  work.remove(item.id, 1, actor);
  work.purge({ items: [{ id: item.id, expectedVersion: 2 }] }, actor);
  expect(() =>
    service.deleteSprint(s.id, { expectedVersion: 4, confirmed: true }, actor),
  ).toThrow("没有工作项");
  expect(service.board(s.id).items).toHaveLength(1);
});

test("failed sprint deletion rolls back all related records", () => {
  const s = service.create(plan, actor);
  service.start(s.id, { expectedVersion: 1 }, actor);
  service.finish(s.id, { expectedVersion: 2 }, actor);
  service.db.exec(
    "CREATE TRIGGER fail_delete_sprint BEFORE DELETE ON sprints BEGIN SELECT RAISE(ABORT,'delete failure'); END;",
  );
  expect(() =>
    service.deleteSprint(s.id, { expectedVersion: 3, confirmed: true }, actor),
  ).toThrow("delete failure");
  expect(service.board(s.id).events).toHaveLength(3);
  expect(
    service.db
      .query("SELECT * FROM sprint_snapshots WHERE sprint_id=?")
      .all(s.id),
  ).toHaveLength(1);
});
