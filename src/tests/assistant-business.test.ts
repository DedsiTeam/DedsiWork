import { expect, test } from "bun:test";
import { openDatabase } from "../server/db/database";
import { WorkItemService, type Actor } from "../server/services/work-items";
import { WorkItemRepository } from "../server/repositories/work-items";
import { DomainModelService } from "../server/services/domain-models";
import { AssistantService } from "../server/services/assistant";
import { AssistantBusiness } from "../server/services/assistant-business";
import {
  chatProposalSchema,
  chatProposalContent,
} from "../shared/chat-proposal";
import type { AssistantFlow } from "../shared/assistant";
const actor: Actor = {
  source: "web",
  identity: "test",
  writable: true,
  requestId: "test",
};
const sprint = {
  name: "迭代一",
  goal: "完成订单",
  startDate: "2026-10-16",
  endDate: "2026-10-23",
};
function fixture() {
  const db = openDatabase(":memory:");
  const items = new WorkItemService(new WorkItemRepository(db));
  const assistant = new AssistantService(db, items, new DomainModelService(db));
  const business = new AssistantBusiness(db, items);
  const preview = (operation: unknown) =>
    assistant.fromChat(
      "chat",
      crypto.randomUUID(),
      0,
      chatProposalSchema.parse({ kind: "business_action", operation }),
      [],
      actor,
    );
  const confirm = (flow: AssistantFlow, deleting = false) =>
    assistant.confirmBusiness(
      flow.id,
      {
        confirmed: true,
        expectedRevision: flow.revision,
        ...(deleting ? { deleteConfirmed: true } : {}),
      },
      actor,
    );
  const run = (operation: unknown, deleting = false) =>
    confirm(preview(operation), deleting);
  return {
    db,
    items,
    assistant,
    business,
    preview,
    confirm,
    run,
    async close() {
      await assistant.close();
      db.close();
    },
  };
}
test("bookmark conversation supports preview and confirmed CRUD without replacing unrelated groups", async () => {
  const f = fixture();
  try {
    const flow = f.preview({
      action: "bookmark_group_create",
      expectedVersion: 0,
      title: "文档",
    });
    expect(f.business.bookmarks.get().groups).toHaveLength(0);
    f.confirm(flow);
    f.confirm(flow);
    let state = f.business.bookmarks.get();
    expect(state.groups).toHaveLength(1);
    const groupId = state.groups[0]!.id;
    f.run({
      action: "bookmark_create",
      expectedVersion: state.version,
      groupId,
      bookmark: {
        title: "文档",
        url: "https://example.com",
        description: "参考资料",
      },
    });
    state = f.business.bookmarks.get();
    const id = state.groups[0]!.links[0]!.id;
    f.run({
      action: "bookmark_group_create",
      expectedVersion: state.version,
      title: "保留",
    });
    f.run({
      action: "bookmark_update",
      expectedVersion: f.business.bookmarks.get().version,
      groupId,
      id,
      bookmark: {
        title: "更新名称",
        url: "https://example.org",
        description: "已更新",
      },
    });
    f.run({
      action: "bookmark_group_update",
      expectedVersion: f.business.bookmarks.get().version,
      groupId,
      title: "开发文档",
    });
    state = f.business.bookmarks.get();
    const removal = f.preview({
      action: "bookmark_delete",
      expectedVersion: state.version,
      groupId,
      id,
    });
    expect(
      removal.businessPreview!.rows.some((row) =>
        row.after.includes("https://example.org"),
      ),
    ).toBe(true);
    expect(() => f.confirm(removal)).toThrow("二次确认");
    f.confirm(removal, true);
    f.confirm(removal, true);
    expect(f.business.bookmarks.get().groups[0]!.links).toHaveLength(0);
    f.run(
      {
        action: "bookmark_group_delete",
        expectedVersion: f.business.bookmarks.get().version,
        groupId,
      },
      true,
    );
    expect(
      f.business.bookmarks.get().groups.map((group) => group.title),
    ).toEqual(["保留"]);
  } finally {
    await f.close();
  }
});
test("business confirmation protects ownership, versions, read-only users and URL validation", async () => {
  const f = fixture();
  try {
    const flow = f.preview({
      action: "bookmark_group_create",
      expectedVersion: 0,
      title: "草稿",
    });
    for (const who of [
      { ...actor, identity: "other" },
      { ...actor, writable: false },
    ])
      expect(() =>
        f.assistant.confirmBusiness(
          flow.id,
          { confirmed: true, expectedRevision: 1 },
          who,
        ),
      ).toThrow();
    f.run({
      action: "bookmark_group_create",
      expectedVersion: 0,
      title: "其他修改",
    });
    expect(() => f.confirm(flow)).toThrow("已变更");
    expect(f.assistant.read(flow.id, actor).businessResult).toBeUndefined();
    expect(f.business.bookmarks.get().groups).toHaveLength(1);
    expect(() =>
      f.preview({
        action: "bookmark_create",
        expectedVersion: 1,
        groupId: crypto.randomUUID(),
        bookmark: { title: "危险", url: "javascript:alert(1)" },
      }),
    ).toThrow();
    expect(() =>
      f.preview({
        action: "bookmark_delete",
        expectedVersion: 1,
        groupId: crypto.randomUUID(),
        id: crypto.randomUUID(),
      }),
    ).toThrow("不存在");
    const parsed = chatProposalContent(
      "```dedsiwork\n" +
        JSON.stringify({
          kind: "business_action",
          operation: { action: "sprint_create", sprint },
        }) +
        "\n```",
    );
    expect(parsed.proposals[0]!.proposal.kind).toBe("business_action");
    expect(parsed.text).toBe("");
  } finally {
    await f.close();
  }
});
test("sprint conversation supports create, update, membership, move, finish and empty deletion", async () => {
  const f = fixture();
  try {
    const create = f.preview({ action: "sprint_create", sprint });
    expect(f.business.sprints.list().data).toHaveLength(0);
    f.confirm(create);
    f.confirm(create);
    expect(f.business.sprints.list().data).toHaveLength(1);
    const id = f.business.sprints.list().data[0]!.id;
    const version = () => f.business.sprints.get(id).version;
    f.run({
      action: "sprint_update",
      id,
      expectedVersion: version(),
      sprint: { ...sprint, name: "订单冲刺" },
    });
    const item = f.items.create({ title: "订单需求", type: "feature" }, actor);
    f.run({
      action: "sprint_add_items",
      id,
      expectedVersion: version(),
      items: [{ id: item.id, expectedVersion: item.version }],
    });
    expect(() =>
      f.preview({ action: "sprint_delete", id, expectedVersion: version() }),
    ).toThrow("没有工作项");
    f.run({
      action: "sprint_remove_items",
      id,
      expectedVersion: version(),
      items: [{ id: item.id, expectedVersion: item.version }],
    });
    expect(f.items.get(item.id).title).toBe(item.title);
    f.run({
      action: "sprint_add_items",
      id,
      expectedVersion: version(),
      items: [{ id: item.id, expectedVersion: item.version }],
    });
    f.run({ action: "sprint_start", id, expectedVersion: version() });
    f.run({
      action: "sprint_move_item",
      id,
      expectedVersion: version(),
      itemId: item.id,
      itemVersion: item.version,
      status: "in_progress",
    });
    expect(f.items.get(item.id).status).toBe("in_progress");
    f.run({
      action: "sprint_finish",
      id,
      expectedVersion: version(),
      targetSprintId: null,
    });
    expect(f.business.sprints.get(id).state).toBe("closed");
    expect(f.business.sprints.membership(item.id)).toBeNull();
    expect(() =>
      f.preview({ action: "sprint_delete", id, expectedVersion: version() }),
    ).toThrow("没有工作项");
    f.run({
      action: "sprint_create",
      sprint: { ...sprint, name: "可删除的空冲刺" },
    });
    const empty = f.business.sprints
      .list()
      .data.find((s) => s.state === "planned")!;
    const removal = f.preview({
      action: "sprint_delete",
      id: empty.id,
      expectedVersion: empty.version,
    });
    expect(() => f.confirm(removal)).toThrow("二次确认");
    f.confirm(removal, true);
    expect(() => f.business.sprints.get(empty.id)).toThrow();
  } finally {
    await f.close();
  }
});
test("sprint failures roll back and preserve drafts for review", async () => {
  const f = fixture();
  try {
    const s = f.business.sprints.create(sprint, actor);
    const item = f.items.create({ title: "工作项" }, actor);
    const flow = f.preview({
      action: "sprint_add_items",
      id: s.id,
      expectedVersion: s.version,
      items: [{ id: item.id, expectedVersion: item.version }],
    });
    f.items.update(
      item.id,
      { expectedVersion: item.version, title: "新版本" },
      actor,
    );
    expect(() => f.confirm(flow)).toThrow("工作项已变更");
    expect(f.business.sprints.board(s.id).items).toHaveLength(0);
    const finish = f.preview({
      action: "sprint_finish",
      id: s.id,
      expectedVersion: s.version,
    });
    expect(() => f.confirm(finish)).toThrow("进行中的冲刺");
    expect(f.assistant.read(finish.id, actor).businessResult).toBeUndefined();
  } finally {
    await f.close();
  }
});
