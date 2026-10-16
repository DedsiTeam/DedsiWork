// Manual UI fixture. DEVELOPMENT_UI_DIR reuses its database after SIGKILL.
import index from "../../web/index.html";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { createApp } from "../../server/app";
import { openDatabase } from "../../server/db/database";
import { WorkspaceStore } from "../../server/services/workspaces";
import { DevelopmentTasks } from "../../server/services/development-tasks";
import { WorkItemRepository } from "../../server/repositories/work-items";
import { WorkItemService } from "../../server/services/work-items";
import { DomainModelService } from "../../server/services/domain-models";
const dir =
    process.env.DEVELOPMENT_UI_DIR ||
    mkdtempSync(join(tmpdir(), "dedsiwork-approval-ui-")),
  repo = join(dir, "repo"),
  record = join(dir, "ui.json"),
  cli = join(dir, "fixture-cli"),
  dbPath = join(dir, "dedsiwork.sqlite");
process.env.DEDSIWORK_CODEX_PATH = cli;
process.env.DEVELOPMENT_FIXTURE_DIR = join(dir, "codex");
let selection: { taskId: string; spaceId: string };
if (!existsSync(record)) {
  mkdirSync(repo);
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", "-C", repo, ...args]);
    if (result.exitCode) throw new Error(result.stderr.toString());
  };
  git("init", "-b", "main");
  writeFileSync(join(repo, "README.md"), "approval fixture\n");
  git("add", ".");
  git(
    "-c",
    "user.name=DedsiWork Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "baseline",
  );
  writeFileSync(
    cli,
    `#!${process.execPath}\nimport ${JSON.stringify(resolve(import.meta.dir, "codex-development-fixture.ts"))};\n`,
  );
  chmodSync(cli, 0o700);
  const store = new WorkspaceStore(dbPath),
    actor = {
      source: "web" as const,
      identity: "local-user",
      writable: true,
      requestId: "ui-fixture",
    };
  const space = store.create({ name: "隔离授权弹窗测试" }, actor),
    path = store.path(space.id);
  mkdirSync(dirname(path), { recursive: true });
  const db = openDatabase(path),
    dev = new DevelopmentTasks(
      db,
      dirname(path),
      new WorkItemService(new WorkItemRepository(db)),
      new DomainModelService(db),
      join(dir, "development-worktrees", space.id),
    );
  const token = crypto.randomUUID();
  (dev as any).selections.set(token, {
    owner: actor.identity,
    repository: repo,
    expires: Date.now() + 60000,
  });
  const task = await dev.create(
    {
      title: "授权允许与拒绝界面测试",
      requirement: "[APPROVAL]",
      directoryToken: token,
      baseBranch: "main",
    },
    actor,
  );
  selection = { taskId: task.id, spaceId: space.id };
  writeFileSync(record, JSON.stringify(selection));
  await dev.close();
  db.close();
  store.close();
} else selection = JSON.parse(readFileSync(record, "utf8"));
const origin = "http://127.0.0.1:3331",
  app = createApp({
    dbPath,
    origin,
    credentials: {
      pairingCode: crypto.randomUUID(),
      readToken: crypto.randomUUID(),
      writeToken: crypto.randomUUID(),
    },
  });
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 3331,
  development: true,
  routes: {
    "/*": index,
    "/api/*": (req) => app.handle(req),
    "/auth/*": (req) => app.handle(req),
  },
  fetch: (req) => app.handle(req),
});
console.log(
  JSON.stringify({
    url: `${origin}/development-tasks/${selection.taskId}?workspace=${selection.spaceId}`,
    directory: dir,
  }),
);
process.on("SIGTERM", async () => {
  await server.stop(true);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
});
