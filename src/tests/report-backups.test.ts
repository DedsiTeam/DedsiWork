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
for (const version of [8, 9, 10, 11])
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
