import { Database } from "bun:sqlite";

export function openDatabase(path: string) {
  const db = new Database(path, { create: true, strict: true });
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  if (
    !db.query("SELECT version FROM schema_migrations WHERE version=1").get()
  ) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE work_items (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('task','bug','feature')),
          status TEXT NOT NULL CHECK(status IN ('todo','in_progress','blocked','done','cancelled')),
          priority TEXT NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
          due_at TEXT, version INTEGER NOT NULL CHECK(version>0),
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
        );
        CREATE INDEX work_items_updated ON work_items(deleted_at, updated_at DESC, id DESC);
        CREATE INDEX work_items_status ON work_items(status, deleted_at);
        CREATE TABLE work_item_events (
          id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id),
          action TEXT NOT NULL, changes TEXT NOT NULL, source TEXT NOT NULL,
          actor TEXT NOT NULL, created_at TEXT NOT NULL, request_id TEXT NOT NULL
        );
        CREATE INDEX events_item ON work_item_events(work_item_id, created_at DESC);
        CREATE TABLE idempotency_records (
          actor TEXT NOT NULL, request_key TEXT NOT NULL, input TEXT NOT NULL,
          result TEXT NOT NULL, PRIMARY KEY(actor,request_key)
        );
      `);
      db.query("INSERT INTO schema_migrations VALUES (1, ?)").run(
        new Date().toISOString(),
      );
    }).immediate();
  }
  return db;
}
