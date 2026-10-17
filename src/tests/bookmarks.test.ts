import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createTestApp } from "./helpers/app";
import { openDatabase } from "../server/db/database";
import { Bookmarks } from "../server/services/bookmarks";
import { WorkspaceStore } from "../server/services/workspaces";
import { WorkspaceBackups } from "../server/services/workspace-backups";
import { CodexChat } from "../server/codex/chat";
import { bookmarkSaveSchema } from "../shared/bookmarks";
const actor = {
  source: "web" as const,
  identity: "test",
  writable: true,
  requestId: "test",
};
const groups = [
  {
    id: crypto.randomUUID(),
    title: "开发工具",
    links: [
      {
        id: crypto.randomUUID(),
        title: "文档",
        url: "https://example.com/docs",
        description: "参考资料",
      },
    ],
  },
];

test("bookmark API isolates workspaces, rejects readonly writes and stale updates", async () => {
  const credentials = {
    pairingCode: "test-pairing-code",
    readToken: "readonly-test-token",
    writeToken: "write-test-token",
  };
  const app = createTestApp({ credentials, origin: "http://127.0.0.1:3210" });
  async function call(
    path: string,
    method = "GET",
    body?: unknown,
    workspace?: string,
    token = credentials.writeToken,
  ) {
    return app.handle(
      new Request("http://127.0.0.1:3210" + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(workspace ? { "X-Workspace-Id": workspace } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  }
  try {
    const a = (
      await (await call("/api/v1/workspaces", "POST", { name: "A" })).json()
    ).data.id;
    const b = (
      await (await call("/api/v1/workspaces", "POST", { name: "B" })).json()
    ).data.id;
    expect(
      (
        await call(
          "/api/v1/bookmarks",
          "PUT",
          { expectedVersion: 0, groups },
          a,
          credentials.readToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "/api/v1/bookmarks",
          "PUT",
          { expectedVersion: 0, groups },
          a,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          "/api/v1/bookmarks",
          "PUT",
          { expectedVersion: 0, groups: [] },
          a,
        )
      ).status,
    ).toBe(409);
    expect(
      (await (await call("/api/v1/bookmarks", "GET", undefined, b)).json()).data
        .groups,
    ).toEqual([]);
    expect(
      (
        await (
          await call(
            "/api/v1/bookmarks",
            "GET",
            undefined,
            a,
            credentials.readToken,
          )
        ).json()
      ).data.groups,
    ).toEqual(groups);
  } finally {
    await app.close();
  }
});
test("bookmark validation rejects executable URLs and duplicate IDs", () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///tmp/x",
    "not a url",
    "https://user:password@example.com",
  ]) {
    expect(
      bookmarkSaveSchema.safeParse({
        expectedVersion: 0,
        groups: [{ ...groups[0], links: [{ ...groups[0]!.links[0], url }] }],
      }).success,
    ).toBe(false);
  }
  expect(
    bookmarkSaveSchema.safeParse({
      expectedVersion: 0,
      groups: [groups[0], groups[0]],
    }).success,
  ).toBe(false);
});
for (const legacy of [false, true])
  test(`bookmarks persist through workspace backup; legacy=${legacy}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "dedsiwork-bookmarks-"));
    const store = new WorkspaceStore(join(dir, "legacy.sqlite"));
    const backups = new WorkspaceBackups(store);
    const space = store.create({ name: "导航测试" }, actor);
    mkdirSync(dirname(store.path(space.id)), { recursive: true });
    const db = openDatabase(store.path(space.id));
    const chat = new CodexChat(db, dir, () => space);
    Object.defineProperty(backups, "pick", {
      value: async () => join(dir, "navigation.dwb"),
    });
    try {
      new Bookmarks(db).save({ expectedVersion: 0, groups }, actor);
      if (legacy)
        db.exec(
          "DROP TABLE bookmarks; DROP TABLE ai_workflows; DROP TABLE personal_sources; DROP TABLE personal_focus; DROP TABLE report_drafts; DROP TABLE workflow_runs; DELETE FROM schema_migrations WHERE version>=13",
        );
      await backups.backup(space.id, db, chat, actor);
      const preview = await backups.preview(actor);
      const restored = backups.restore(
        { token: preview.token, name: "恢复导航", confirmed: true },
        actor,
      );
      const target = openDatabase(store.path(restored.id));
      try {
        expect(new Bookmarks(target).get().groups).toEqual(
          legacy ? [] : groups,
        );
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
