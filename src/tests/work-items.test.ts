import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { openDatabase } from "../server/db/database";
import { WorkItemRepository } from "../server/repositories/work-items";
import { WorkItemService, type Actor } from "../server/services/work-items";

const qaRoot = resolve(import.meta.dir, "../.qa");
mkdirSync(qaRoot, { recursive: true });
let folder: string, service: WorkItemService;
const actor: Actor = {
  source: "web",
  identity: "test-user",
  writable: true,
  requestId: "test-request",
};
beforeEach(() => {
  folder = mkdtempSync(join(qaRoot, "unit-"));
  service = new WorkItemService(
    new WorkItemRepository(openDatabase(join(folder, "work.sqlite"))),
  );
});
afterEach(() => {
  service.repo.db.close();
  if (resolve(folder).startsWith(qaRoot + sep))
    rmSync(folder, { recursive: true, force: true });
});

describe("WorkItem business rules", () => {
  test("validates create inputs and applies defaults", () => {
    expect(() => service.create({ title: "  " }, actor)).toThrow();
    expect(() =>
      service.create({ title: "invalid", status: "done" }, actor),
    ).toThrow();
    const item = service.create({ title: "  第一项工作  " }, actor);
    expect(item.title).toBe("第一项工作");
    expect(item.version).toBe(1);
    expect(item.status).toBe("todo");
    expect(service.events(item.id, {}).data[0]?.action).toBe("created");
  });
  test("partial update preserves omitted values and rejects stale versions", () => {
    const item = service.create(
      {
        title: "Alpha",
        description: "保留描述",
        type: "bug",
        priority: "high",
      },
      actor,
    );
    const updated = service.update(
      item.id,
      { title: "Beta", expectedVersion: 1 },
      actor,
    );
    expect(updated.description).toBe("保留描述");
    expect(updated.type).toBe("bug");
    expect(updated.priority).toBe("high");
    expect(updated.version).toBe(2);
    expect(() =>
      service.update(item.id, { title: "stale", expectedVersion: 1 }, actor),
    ).toThrow("重新读取");
    expect(service.get(item.id).title).toBe("Beta");
    expect(service.events(item.id, {}).meta.total).toBe(2);
  });
  test("completed items must be reopened before work resumes", () => {
    const item = service.create({ title: "complete" }, actor);
    service.update(item.id, { status: "done", expectedVersion: 1 }, actor);
    expect(() =>
      service.update(
        item.id,
        { status: "in_progress", expectedVersion: 2 },
        actor,
      ),
    ).toThrow("重新打开");
    service.update(item.id, { status: "todo", expectedVersion: 2 }, actor);
    expect(service.get(item.id).status).toBe("todo");
  });
  test("soft delete, trash listing and restore keep history", () => {
    const item = service.create({ title: "recover me" }, actor);
    service.remove(item.id, 1, actor);
    expect(() => service.get(item.id)).toThrow();
    expect(service.list({}).meta.total).toBe(0);
    expect(service.list({ deleted: "true" }).data[0]?.id).toBe(item.id);
    expect(() =>
      service.update(item.id, { title: "bad", expectedVersion: 2 }, actor),
    ).toThrow("恢复");
    const restored = service.restore(item.id, 2, actor);
    expect(restored.deletedAt).toBeNull();
    expect(restored.version).toBe(3);
    expect(service.events(item.id, {}).meta.total).toBe(3);
  });
  test("idempotent retries return original result and reject different payloads", () => {
    const item = service.create({ title: "once" }, actor, "key-one");
    expect(service.create({ title: "once" }, actor, "key-one").id).toBe(
      item.id,
    );
    expect(() => service.create({ title: "twice" }, actor, "key-one")).toThrow(
      "不同内容",
    );
    expect(service.list({}).meta.total).toBe(1);
    expect(service.events(item.id, {}).meta.total).toBe(1);
  });
  test("read-only credentials cannot mutate", () => {
    const item = service.create({ title: "protected" }, actor),
      reader = { ...actor, writable: false };
    expect(() => service.create({ title: "no" }, reader)).toThrow("仅允许查询");
    expect(() =>
      service.update(item.id, { title: "no", expectedVersion: 1 }, reader),
    ).toThrow();
    expect(() => service.remove(item.id, 1, reader)).toThrow();
  });
  test("search treats special characters literally and filters before paging", () => {
    service.create({ title: "100% literal", type: "bug" }, actor);
    service.create({ title: "other", type: "task" }, actor);
    expect(service.list({ q: "%" }).meta.total).toBe(1);
    expect(service.list({ type: "bug" }).data[0]?.title).toBe("100% literal");
    expect(service.list({ pageSize: 1, page: 2 }).data.length).toBe(1);
    expect(() => service.list({ pageSize: 500 })).toThrow();
  });
  test("event failure rolls back the work item and idempotency record", () => {
    service.repo.db.exec(
      "CREATE TRIGGER fail_event BEFORE INSERT ON work_item_events BEGIN SELECT RAISE(ABORT,'forced failure'); END;",
    );
    expect(() =>
      service.create({ title: "rollback" }, actor, "rollback-key"),
    ).toThrow("forced failure");
    expect(service.list({}).meta.total).toBe(0);
    expect(
      (
        service.repo.db
          .query("SELECT count(*) AS count FROM idempotency_records")
          .get() as { count: number }
      ).count,
    ).toBe(0);
  });
  test("data survives close, reopen and offline backup restore", () => {
    const item = service.create({ title: "persistent" }, actor);
    service.repo.db.close();
    const restoredPath = join(folder, "restored.sqlite");
    copyFileSync(join(folder, "work.sqlite"), restoredPath);
    service = new WorkItemService(
      new WorkItemRepository(openDatabase(restoredPath)),
    );
    expect(service.get(item.id).title).toBe("persistent");
    expect(service.events(item.id, {}).meta.total).toBe(1);
  });
});

test("purge removes trashed items, events and cached content without resurrection", () => {
  const item = service.create(
    { title: "purge", description: "private content" },
    actor,
    "purge-key",
  );
  service.remove(item.id, 1, actor);
  expect(
    service.purge({ items: [{ id: item.id, expectedVersion: 2 }] }, actor)
      .count,
  ).toBe(1);
  expect(() => service.get(item.id, true)).toThrow();
  expect(
    service.repo.db
      .query("SELECT * FROM work_item_events WHERE work_item_id=?")
      .all(item.id),
  ).toHaveLength(0);
  const cached = service.repo.db
    .query("SELECT input,result FROM idempotency_records WHERE request_key=?")
    .get("purge-key") as { input: string; result: string };
  expect(cached.input).toBe("");
  expect(JSON.parse(cached.result)).toEqual({ id: item.id, purged: true });
  expect(() =>
    service.create(
      { title: "purge", description: "private content" },
      actor,
      "purge-key",
    ),
  ).toThrow("永久删除");
});

test("batch purge validates all targets and rolls back every mutation on failure", () => {
  const a = service.create({ title: "a" }, actor);
  const b = service.create({ title: "b" }, actor);
  service.remove(a.id, 1, actor);
  const targets = {
    items: [
      { id: a.id, expectedVersion: 2 },
      { id: b.id, expectedVersion: 2 },
    ],
  };
  expect(() => service.purge(targets, actor)).toThrow("回收站");
  expect(service.get(a.id, true).version).toBe(2);
  service.remove(b.id, 1, actor);
  expect(() =>
    service.purge({ items: [{ id: a.id, expectedVersion: 1 }] }, actor),
  ).toThrow("变更");
  expect(() => service.purge(targets, { ...actor, writable: false })).toThrow(
    "仅允许查询",
  );
  expect(() => service.purge({ items: [] }, actor)).toThrow();
  expect(() =>
    service.purge({ items: [targets.items[0], targets.items[0]] }, actor),
  ).toThrow();
  service.repo.db.exec(
    `CREATE TRIGGER prevent_purge BEFORE DELETE ON work_items WHEN old.id='${b.id}' BEGIN SELECT RAISE(ABORT,'blocked purge'); END;`,
  );
  expect(() => service.purge(targets, actor)).toThrow("blocked purge");
  expect(service.get(a.id, true).version).toBe(2);
  expect(service.events(a.id, {}).meta.total).toBe(2);
  service.repo.db.exec("DROP TRIGGER prevent_purge");
  expect(service.purge(targets, actor).count).toBe(2);
  expect(service.list({ deleted: "true" }).meta.total).toBe(0);
});
