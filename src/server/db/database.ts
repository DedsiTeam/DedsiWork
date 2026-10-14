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
  if (
    !db.query("SELECT version FROM schema_migrations WHERE version=2").get()
  ) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE domain_models (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
          elements TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
        );
        CREATE INDEX domain_models_updated ON domain_models(deleted_at, updated_at DESC, id DESC);
      `);
      db.query("INSERT INTO schema_migrations VALUES (2, ?)").run(
        new Date().toISOString(),
      );
    }).immediate();
  }
  if (
    !db.query("SELECT version FROM schema_migrations WHERE version=3").get()
  ) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE sprints (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, goal TEXT NOT NULL,
          start_date TEXT NOT NULL, end_date TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('planned','active','closed')),
          version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT
        );
        CREATE UNIQUE INDEX one_active_sprint ON sprints(state) WHERE state='active';
        CREATE TABLE sprint_items (
          sprint_id TEXT NOT NULL REFERENCES sprints(id),
          item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
          position INTEGER NOT NULL, PRIMARY KEY(sprint_id,item_id)
        );
        CREATE INDEX sprint_items_item ON sprint_items(item_id);
        CREATE TABLE sprint_snapshots (sprint_id TEXT PRIMARY KEY REFERENCES sprints(id), items TEXT NOT NULL);
        CREATE TABLE sprint_events (
          id TEXT PRIMARY KEY, sprint_id TEXT NOT NULL REFERENCES sprints(id),
          action TEXT NOT NULL, details TEXT NOT NULL, source TEXT NOT NULL,
          actor TEXT NOT NULL, created_at TEXT NOT NULL, request_id TEXT NOT NULL
        );
      `);
      db.query("INSERT INTO schema_migrations VALUES (3, ?)").run(
        new Date().toISOString(),
      );
    }).immediate();
  }
  if (
    !db.query("SELECT version FROM schema_migrations WHERE version=4").get()
  ) {
    // Rebuild the CHECK constraint while keeping child tables and their references intact.
    db.exec("PRAGMA foreign_keys=OFF");
    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE work_items_new (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('task','bug','feature')),
            status TEXT NOT NULL CHECK(status IN ('todo','in_progress','in_review','in_verification','awaiting_acceptance','paused','done','cancelled')),
            priority TEXT NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
            due_at TEXT, version INTEGER NOT NULL CHECK(version>0),
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
            blocked_reason TEXT NOT NULL DEFAULT ''
          );
          INSERT INTO work_items_new SELECT id,title,description,type,
            CASE WHEN status='blocked' THEN 'in_progress' ELSE status END,
            priority,due_at,version,created_at,updated_at,deleted_at,
            CASE WHEN status='blocked' THEN '历史阻塞工作项（原阶段未记录）' ELSE '' END FROM work_items;
          DROP TABLE work_items;
          ALTER TABLE work_items_new RENAME TO work_items;
          CREATE INDEX work_items_updated ON work_items(deleted_at, updated_at DESC, id DESC);
          CREATE INDEX work_items_status ON work_items(status, deleted_at);
        `);
        if (db.query("PRAGMA foreign_key_check").all().length)
          throw new Error("迁移后的工作项关联校验失败");
        db.query("INSERT INTO schema_migrations VALUES (4, ?)").run(
          new Date().toISOString(),
        );
      }).immediate();
    } finally {
      db.exec("PRAGMA foreign_keys=ON");
    }
  }
  if (
    !db.query("SELECT version FROM schema_migrations WHERE version=5").get()
  ) {
    db.transaction(() => {
      db.exec(`CREATE TABLE codex_chats (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, cwd TEXT NOT NULL,
        model TEXT, owner TEXT NOT NULL, updated_at TEXT NOT NULL
      ); CREATE INDEX codex_chats_owner ON codex_chats(owner,updated_at DESC);`);
      db.query("INSERT INTO schema_migrations VALUES (5,?)").run(
        new Date().toISOString(),
      );
    }).immediate();
  }
  if (
    !db.query("SELECT version FROM schema_migrations WHERE version=6").get()
  ) {
    db.transaction(() => {
      db.exec(`CREATE TABLE work_item_agent_sessions (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL
      ); CREATE INDEX work_item_agent_owner ON work_item_agent_sessions(owner,updated_at DESC);`);
      db.query("INSERT INTO schema_migrations VALUES (6,?)").run(
        new Date().toISOString(),
      );
    }).immediate();
  }
  if (
    !db.query("SELECT version FROM schema_migrations WHERE version=7").get()
  ) {
    db.transaction(() => {
      db.exec(`CREATE TABLE assistant_flows (id TEXT PRIMARY KEY,owner TEXT NOT NULL,state TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE INDEX assistant_flows_owner ON assistant_flows(owner,updated_at DESC);
        CREATE TABLE assistant_work_item_links (item_id TEXT PRIMARY KEY REFERENCES work_items(id) ON DELETE CASCADE,flow_id TEXT NOT NULL REFERENCES assistant_flows(id),requirement TEXT NOT NULL);
        CREATE TABLE assistant_model_links (model_id TEXT PRIMARY KEY REFERENCES domain_models(id),flow_id TEXT NOT NULL REFERENCES assistant_flows(id),sources TEXT NOT NULL);`);
      db.query("INSERT INTO schema_migrations VALUES (7,?)").run(
        new Date().toISOString(),
      );
    }).immediate();
  }
  return db;
}
