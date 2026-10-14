import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db/database";
import { WorkItemRepository } from "../server/repositories/work-items";
import { WorkItemService, type Actor } from "../server/services/work-items";
import { SprintService } from "../server/services/sprints";
const actor: Actor = {
  source: "web",
  identity: "migration",
  writable: true,
  requestId: "migration",
};
test("version 3 database migrates legacy blocking without losing references, snapshots or retries", () => {
  const folder = mkdtempSync(join(tmpdir(), "dedsi-workflow-")),
    path = join(folder, "work.sqlite");
  let db = openDatabase(path);
  try {
    let work = new WorkItemService(new WorkItemRepository(db)),
      sprints = new SprintService(db, work);
    const item = work.create({ title: "legacy" }, actor, "legacy-key");
    const sprint = sprints.create(
      { name: "legacy sprint", startDate: "2026-10-14", endDate: "2026-10-27" },
      actor,
    );
    sprints.add(
      sprint.id,
      { expectedVersion: 1, items: [{ id: item.id, expectedVersion: 1 }] },
      actor,
    );
    sprints.start(sprint.id, { expectedVersion: 2 }, actor);
    sprints.finish(sprint.id, { expectedVersion: 3 }, actor);
    // Reproduce the old schema and an old blocked snapshot from a previous installation.
    db.exec("PRAGMA foreign_keys=OFF");
    db.transaction(() => {
      db.exec(`CREATE TABLE legacy_items (id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,type TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('todo','in_progress','blocked','done','cancelled')),priority TEXT NOT NULL,due_at TEXT,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
      INSERT INTO legacy_items SELECT id,title,description,type,'blocked',priority,due_at,version,created_at,updated_at,deleted_at FROM work_items;
      DROP TABLE work_items;
      ALTER TABLE legacy_items RENAME TO work_items;
      DELETE FROM schema_migrations WHERE version=4;`);
      db.query("UPDATE sprint_snapshots SET items=? WHERE sprint_id=?").run(
        JSON.stringify([
          { ...item, status: "blocked", blockedReason: undefined },
        ]),
        sprint.id,
      );
      db.query("UPDATE idempotency_records SET input=?, result=?").run(
        JSON.stringify({
          title: "legacy",
          description: "",
          type: "task",
          status: "todo",
          priority: "normal",
          dueAt: null,
        }),
        JSON.stringify({ ...item, blockedReason: undefined }),
      );
    }).immediate();
    db.close();
    db = openDatabase(path);
    work = new WorkItemService(new WorkItemRepository(db));
    sprints = new SprintService(db, work);
    const migrated = work.get(item.id);
    expect(migrated.status).toBe("in_progress");
    expect(migrated.blockedReason).toContain("原阶段未记录");
    expect(migrated.version).toBe(item.version);
    expect(work.events(item.id, {}).meta.total).toBe(1);
    expect(sprints.board(sprint.id).items[0]?.blockedReason).toContain(
      "原阶段未记录",
    );
    expect(db.query("SELECT * FROM sprint_items").all()).toHaveLength(1);
    expect(db.query("PRAGMA foreign_key_check").all()).toHaveLength(0);
    expect(work.create({ title: "legacy" }, actor, "legacy-key").id).toBe(
      item.id,
    );
    work.update(
      item.id,
      { expectedVersion: item.version, status: "paused" },
      actor,
    );
    db.close();
    db = openDatabase(path);
    expect(
      new WorkItemService(new WorkItemRepository(db)).get(item.id).status,
    ).toBe("paused");
  } finally {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
