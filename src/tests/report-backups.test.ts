import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openDatabase } from "../server/db/database";
import { WorkspaceStore } from "../server/services/workspaces";
import { WorkspaceBackups } from "../server/services/workspace-backups";
import { DailyReports } from "../server/services/daily-reports";
import { CodexChat } from "../server/codex/chat";
import type { Actor } from "../server/services/work-items";
const actor: Actor = {
  source: "web",
  identity: "backup-report-test",
  writable: true,
  requestId: "backup-test",
};
for (const version of [8, 9, 10, 11, 12, 13, 14])
  test(`workspace backup version ${version} restores into current schema without dropping reports`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "dedsiwork-reports-backup-")),
      store = new WorkspaceStore(join(dir, "legacy.sqlite")),
      backups = new WorkspaceBackups(store);
    const space = store.create({ name: "备份来源" }, actor),
      path = store.path(space.id);
    mkdirSync(dirname(path), { recursive: true });
    const db = openDatabase(path),
      chat = new CodexChat(db, dir, () => space);
    const output = join(dir, "reports.dwb");
    Object.defineProperty(backups, "pick", { value: async () => output });
    // Legacy fixtures contain no chats; exporting is independent of restore compatibility.
    Object.defineProperty(chat, "exportHistories", { value: async () => {} });
    let savedId: string | null = null;
    try {
      if (version >= 10) {
        const saved = new DailyReports(db).save(
          null,
          {
            date: "2026-10-15",
            matters: [
              {
                matterId: crypto.randomUUID(),
                title: "备份事项",
                result: "成果保留",
                completedQuantity: 3,
                unit: "个接口",
                status: "done",
                progress: 100,
              },
            ],
          },
          actor,
        );
        savedId = saved.id;
        if (version === 10)
          db.exec(
            "UPDATE daily_reports SET content=json_set(content,'$.status','final');DELETE FROM schema_migrations WHERE version=11",
          );
      } else {
        db.exec(
          "DROP TABLE daily_reports;DELETE FROM schema_migrations WHERE version>=10",
        );
        if (version === 8)
          db.exec(
            "DROP TABLE canvas_notes;DELETE FROM schema_migrations WHERE version=9",
          );
      }
      for (const table of [
        "personal_sources",
        "personal_focus",
        "report_drafts",
        "workflow_runs",
      ])
        db.exec(`DROP TABLE IF EXISTS ${table}`);
      if (version < 14) db.exec("DROP TABLE IF EXISTS ai_workflows");
      if (version < 13) db.exec("DROP TABLE IF EXISTS bookmarks");
      if (version < 12) db.exec("DROP TABLE IF EXISTS development_tasks");
      db.query("DELETE FROM schema_migrations WHERE version>?").run(version);
      const result = await backups.backup(space.id, db, chat, actor);
      expect(result.cancelled).toBe(false);
      const preview = await backups.preview(actor);
      expect(preview.cancelled).toBe(false);
      const restored = backups.restore(
        { token: preview.token, name: `恢复 ${version}`, confirmed: true },
        actor,
      );
      const target = openDatabase(store.path(restored.id));
      try {
        const reports = new DailyReports(target);
        expect(reports.list(new URLSearchParams()).meta.total).toBe(
          version >= 10 ? 1 : 0,
        );
        if (savedId) {
          expect(reports.get(savedId)).not.toHaveProperty("status");
          expect(
            (
              target
                .query(
                  "SELECT json_type(content,'$.status') AS status FROM daily_reports WHERE id=?",
                )
                .get(savedId) as { status: null }
            ).status,
          ).toBeNull();
          expect(reports.get(savedId).matters[0]?.result).toBe("成果保留");
          expect(
            reports.summary(
              new URLSearchParams({ type: "monthly", date: "2026-10-15" }),
            ).metrics.quantities,
          ).toEqual({ 个接口: 3 });
        }
      } finally {
        target.close();
      }
    } finally {
      await chat.close();
      db.close();
      backups.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

test("OPC backup restores draft history, focus, sources and runs without retired schedules", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dedsiwork-opc-backup-")),
    store = new WorkspaceStore(join(dir, "legacy.sqlite")),
    backups = new WorkspaceBackups(store);
  const space = store.create({ name: "OPC 来源" }, actor),
    path = store.path(space.id);
  mkdirSync(dirname(path), { recursive: true });
  const db = openDatabase(path),
    chat = new CodexChat(db, dir, () => space),
    output = join(dir, "opc.dwb");
  Object.defineProperty(backups, "pick", { value: async () => output });
  Object.defineProperty(chat, "exportHistories", { value: async () => {} });
  const { ReportRecords } = await import("../server/services/report-records");
  const itemId = crypto.randomUUID(),
    chatId = crypto.randomUUID(),
    runId = crypto.randomUUID(),
    now = new Date().toISOString();
  const targetActor = { ...actor, identity: "restored-owner" };
  try {
    db.query(
      "INSERT INTO work_items (id,title,description,type,status,priority,version,created_at,updated_at) VALUES (?,?,'','task','todo','normal',1,?,?)",
    ).run(itemId, "个人计划", now, now);
    db.query(
      "INSERT INTO personal_focus VALUES (?,'today','2026-10-17',1)",
    ).run(itemId);
    db.query("INSERT INTO codex_chats VALUES (?,?,?,?,?,?)").run(
      chatId,
      "来源对话",
      "",
      null,
      actor.identity,
      now,
    );
    db.query(
      "INSERT INTO chat_history_snapshots (chat_id,history,complete) VALUES (?,'[]',1)",
    ).run(chatId);
    db.query("INSERT INTO personal_sources VALUES (?,'item',?,?,?,1)").run(
      chatId,
      itemId,
      "个人计划",
      `/work-items/${itemId}`,
    );
    const records = new ReportRecords(db),
      draft = {
        type: "weekly",
        date: "2026-10-17",
        text: "原始文字",
        sourceSnapshot: '{"reportCount":1}',
        expectedVersion: 0,
      };
    records.save(draft, actor);
    records.save({ ...draft, text: "保留的定稿", expectedVersion: 1 }, actor);
    const template = {
      id: crypto.randomUUID(),
      name: "总结",
      description: "",
      prompt: "生成摘要",
    };
    db.query("INSERT INTO workflow_runs VALUES (?,?,?)").run(
      runId,
      actor.identity,
      JSON.stringify({
        id: runId,
        template,
        values: {},
        sources: [],
        notes: "",
        chatId,
        status: "running",
        result: "已有结果",
        error: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    // Simulate a version-15 backup containing retired scheduling settings.
    db.exec(
      "DELETE FROM schema_migrations WHERE version=16; CREATE TABLE workflow_schedules (id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL)",
    );
    db.query("INSERT INTO workflow_schedules VALUES ('old',?,?)").run(
      actor.identity,
      '{"enabled":true}',
    );
    db.exec(
      "UPDATE workflow_runs SET state=json_set(state,'$.scheduleId','old')",
    );
    await backups.backup(space.id, db, chat, actor);
    const preview = await backups.preview(targetActor);
    const restored = backups.restore(
      { token: preview.token, name: "OPC 恢复", confirmed: true },
      targetActor,
    );
    const target = openDatabase(store.path(restored.id));
    try {
      expect(
        new ReportRecords(target)
          .list(new URLSearchParams({ type: "weekly", date: "2026-10-17" }))
          .versions.map((d) => [d.text, d.sourceSnapshot]),
      ).toEqual([
        ["保留的定稿", draft.sourceSnapshot],
        ["原始文字", draft.sourceSnapshot],
      ]);
      expect(
        target
          .query("SELECT bucket FROM personal_focus WHERE item_id=?")
          .get(itemId),
      ).toEqual({ bucket: "today" });
      expect(
        target
          .query("SELECT source_id FROM personal_sources WHERE chat_id=?")
          .get(chatId),
      ).toEqual({ source_id: itemId });
      expect(
        target
          .query(
            "SELECT name FROM sqlite_master WHERE name='workflow_schedules'",
          )
          .get(),
      ).toBeNull();
      const run = target
        .query("SELECT owner,state FROM workflow_runs WHERE id=?")
        .get(runId) as { owner: string; state: string };
      expect(run.owner).toBe(targetActor.identity);
      expect(JSON.parse(run.state).status).toBe("interrupted");
      expect(JSON.parse(run.state).result).toBe("已有结果");
      expect(JSON.parse(run.state).scheduleId).toBeUndefined();
      expect(target.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      target.close();
    }
  } finally {
    await chat.close();
    db.close();
    backups.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upgrade removes scheduling settings while preserving workflow results", () => {
  const dir = mkdtempSync(join(tmpdir(), "dedsiwork-retire-schedules-"));
  const path = join(dir, "workspace.sqlite");
  try {
    const legacy = openDatabase(path);
    legacy.exec(
      "DELETE FROM schema_migrations WHERE version=16; CREATE TABLE workflow_schedules (id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL)",
    );
    legacy.exec(
      `INSERT INTO workflow_schedules VALUES ('old','local','{"enabled":true}'); INSERT INTO workflow_runs VALUES ('run','local','{"scheduleId":"old","result":"已有结果","status":"completed"}')`,
    );
    legacy.close();
    const upgraded = openDatabase(path);
    try {
      expect(
        upgraded
          .query(
            "SELECT name FROM sqlite_master WHERE name='workflow_schedules'",
          )
          .get(),
      ).toBeNull();
      const row = upgraded
        .query("SELECT state FROM workflow_runs WHERE id='run'")
        .get() as { state: string };
      expect(JSON.parse(row.state)).toEqual({
        result: "已有结果",
        status: "completed",
      });
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
