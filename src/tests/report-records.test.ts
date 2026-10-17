import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db/database";
import { ReportRecords } from "../server/services/report-records";
import type { Actor } from "../server/services/work-items";
const actor: Actor = {
  identity: "local",
  source: "web",
  writable: true,
  requestId: "test",
};
test("saved period drafts survive restart, retain history and reject stale writers", () => {
  const dir = mkdtempSync(join(tmpdir(), "report-records-")),
    path = join(dir, "db.sqlite");
  let db = openDatabase(path);
  try {
    let records = new ReportRecords(db);
    const first = records.save(
      {
        type: "weekly",
        date: "2026-10-17",
        text: "原稿",
        sourceSnapshot: '{"source":"original"}',
        expectedVersion: 0,
      },
      actor,
    );
    expect(first.date).toBe("2026-10-12");
    db.close();
    db = openDatabase(path);
    records = new ReportRecords(db);
    const list = records.list(
      new URLSearchParams({ type: "weekly", date: "2026-10-14" }),
    );
    expect(list.versions[0]?.text).toBe("原稿");
    expect(list.versions[0]?.sourceSnapshot).toContain("original");
    records.save(
      {
        type: "weekly",
        date: "2026-10-17",
        text: "新稿",
        sourceSnapshot: "{}",
        expectedVersion: 1,
      },
      actor,
    );
    expect(() =>
      records.save(
        {
          type: "weekly",
          date: "2026-10-17",
          text: "过期稿",
          sourceSnapshot: "{}",
          expectedVersion: 1,
        },
        actor,
      ),
    ).toThrow("新版本");
    expect(
      records
        .list(new URLSearchParams({ type: "weekly", date: "2026-10-17" }))
        .versions.map((d) => d.text),
    ).toEqual(["新稿", "原稿"]);
    expect(() =>
      records.save(
        {
          type: "monthly",
          date: "2026-10-17",
          text: "无权限",
          sourceSnapshot: "{}",
          expectedVersion: 0,
        },
        { ...actor, writable: false },
      ),
    ).toThrow("权限");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("activity uses selected local day and recorded delivery time without guessing quantities", () => {
  const db = openDatabase(":memory:");
  try {
    const records = new ReportRecords(db),
      id = crypto.randomUUID();
    db.query(
      "INSERT INTO work_items (id,title,description,type,status,priority,version,created_at,updated_at) VALUES (?,?,?,'task','done','normal',1,?,?)",
    ).run(
      id,
      "任务",
      "",
      "2026-10-16T16:00:00.000Z",
      "2026-10-16T16:00:00.000Z",
    );
    for (const time of [
      "2026-10-16T15:59:59.000Z",
      "2026-10-16T16:00:00.000Z",
      "2026-10-17T16:00:00.000Z",
    ])
      db.query("INSERT INTO work_item_events VALUES (?,?,?,?,?,?,?,?)").run(
        crypto.randomUUID(),
        id,
        "update",
        "{}",
        "web",
        "local",
        time,
        "test",
      );
    const taskId = crypto.randomUUID();
    const state = {
      id: taskId,
      title: "交付",
      status: "review",
      attention: { status: "review", createdAt: "2026-10-17T01:00:00.000Z" },
      updatedAt: "2026-10-18T01:00:00.000Z",
    };
    db.query("INSERT INTO development_tasks VALUES (?,?,?,?)").run(
      taskId,
      actor.identity,
      JSON.stringify(state),
      state.updatedAt,
    );
    const otherId = crypto.randomUUID();
    db.query("INSERT INTO development_tasks VALUES (?,?,?,?)").run(
      otherId,
      "another",
      JSON.stringify({ ...state, id: otherId }),
      state.updatedAt,
    );
    const result = records.activity(
      new URLSearchParams({ date: "2026-10-17", offset: "-480" }),
      actor,
    );
    expect(result.total).toBe(2);
    expect(result.candidates[0]?.matter.activity).toContain("1 次");
    for (const c of result.candidates) {
      expect(c.matter.completedQuantity).toBeNull();
      expect(c.matter.progress).toBeNull();
      expect(c.matter.status).toBe("in_progress");
      expect(c.matter.activity).toContain(c.href);
    }
    db.query("UPDATE development_tasks SET state=? WHERE id=?").run(
      JSON.stringify({
        ...state,
        status: "completed",
        attention: null,
        deliveryHistory: [
          { createdAt: "2026-10-17T01:00:00.000Z" },
          { createdAt: "2026-10-18T01:00:00.000Z" },
        ],
      }),
      taskId,
    );
    const completed = records.activity(
      new URLSearchParams({ date: "2026-10-17", offset: "-480" }),
      actor,
    );
    expect(
      completed.candidates.some((candidate) => candidate.id === taskId),
    ).toBe(true);
    expect(
      completed.candidates.find((candidate) => candidate.id === taskId)?.matter
        .activity,
    ).toContain("当天已记录研发交付");
    expect(
      records.activity(
        new URLSearchParams({ date: "2026-10-17", offset: "-480", page: "2" }),
        actor,
      ).candidates,
    ).toEqual([]);
  } finally {
    db.close();
  }
});
