import { test, expect } from "bun:test";
import { openDatabase } from "../server/db/database";
import { WorkItemService, type Actor } from "../server/services/work-items";
import { WorkItemRepository } from "../server/repositories/work-items";
import { PersonalWork } from "../server/services/personal-work";
const actor: Actor = {
  identity: "local",
  writable: true,
  source: "web",
  requestId: "review-test",
};
function fixture() {
  const db = openDatabase(":memory:");
  const items = new WorkItemService(new WorkItemRepository(db));
  return { db, items, personal: new PersonalWork(db, items) };
}
test("related sources include companion materials and remain owner scoped", () => {
  const { db, items, personal } = fixture();
  try {
    const first = items.create({ title: "需求" }, actor),
      second = items.create({ title: "补充资料" }, actor);
    const chatId = crypto.randomUUID();
    db.query(
      "INSERT INTO codex_chats(id,title,cwd,model,owner,updated_at) VALUES (?,?,?,?,?,?)",
    ).run(
      chatId,
      "讨论",
      "/tmp",
      null,
      actor.identity,
      new Date().toISOString(),
    );
    personal.link(
      {
        chatId,
        sources: [
          { kind: "item", id: first.id },
          { kind: "item", id: second.id },
        ],
      },
      actor,
    );
    expect(
      personal
        .related(first.id, actor)
        .sources.map((s) => s.title)
        .sort(),
    ).toEqual(["补充资料", "需求"].sort());
    expect(
      personal.related(first.id, { ...actor, identity: "other" }).sources,
    ).toHaveLength(0);
    expect(() =>
      personal.link(
        { chatId, sources: [{ kind: "item", id: first.id }] },
        { ...actor, identity: "other" },
      ),
    ).toThrow("对话不存在");
  } finally {
    db.close();
  }
});
test("focus plans reject stale updates and read-only writers, search paginates literal wildcards", () => {
  const { db, items, personal } = fixture();
  try {
    const first = items.create({ title: "100% 完成" }, actor);
    const input = {
      itemId: first.id,
      bucket: "today",
      date: "2026-10-17",
      expectedVersion: 0,
    };
    personal.setFocus(input, actor);
    expect(() => personal.setFocus(input, actor)).toThrow("计划已更新");
    expect(() =>
      personal.setFocus(
        { ...input, expectedVersion: 1 },
        { ...actor, writable: false },
      ),
    ).toThrow("需要写入权限");
    expect(new PersonalWork(db, items).focus()[0]?.id).toBe(first.id);
    for (let i = 0; i < 14; i++) items.create({ title: `文档 ${i}` }, actor);
    const page = personal.search(new URLSearchParams({ page: "2" }));
    expect(page.meta.total).toBe(15);
    expect(page.data).toHaveLength(3);
    expect(page.meta.pageSize).toBe(12);
    const literal = personal.search(new URLSearchParams({ q: "%" }));
    expect(literal.data.map((i) => i.id)).toEqual([first.id]);
  } finally {
    db.close();
  }
});

test("related models follow explicit item sources and exclude deleted or other-owner models", () => {
  const { db, items, personal } = fixture();
  try {
    const item = items.create({ title: "需求" }, actor);
    const expected: string[] = [];
    for (const [owner, deleted] of [
      [actor.identity, false],
      ["other", false],
      [actor.identity, true],
    ] as const) {
      const flowId = crypto.randomUUID(),
        modelId = crypto.randomUUID(),
        now = new Date().toISOString();
      db.query("INSERT INTO assistant_flows VALUES (?,?,?,?)").run(
        flowId,
        owner,
        "{}",
        now,
      );
      db.query(
        "INSERT INTO domain_models(id,name,description,elements,version,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?)",
      ).run(modelId, "关联模型", "", "[]", 1, now, now, deleted ? now : null);
      db.query("INSERT INTO assistant_model_links VALUES (?,?,?)").run(
        modelId,
        flowId,
        JSON.stringify([
          { id: item.id, title: item.title, version: item.version },
        ]),
      );
      if (owner === actor.identity && !deleted) expected.push(modelId);
    }
    expect(personal.related(item.id, actor).models.map((m) => m.id)).toEqual(
      expected,
    );
    const unrelated = items.create({ title: "其它需求" }, actor);
    expect(personal.related(unrelated.id, actor).models).toHaveLength(0);
  } finally {
    db.close();
  }
});
