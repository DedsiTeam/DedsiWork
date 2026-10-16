import { expect, test } from "bun:test";
import { openDatabase } from "../server/db/database";
import { WorkItemRepository } from "../server/repositories/work-items";
import { WorkItemService, type Actor } from "../server/services/work-items";
import { DomainModelService } from "../server/services/domain-models";
import { AssistantService } from "../server/services/assistant";
import {
  chatProposalContent,
  chatProposalSchema,
} from "../shared/chat-proposal";
const actor: Actor = {
  source: "web",
  identity: "test",
  writable: true,
  requestId: "test",
};
function fixture() {
  const db = openDatabase(":memory:");
  const items = new WorkItemService(new WorkItemRepository(db));
  const models = new DomainModelService(db);
  const assistant = new AssistantService(db, items, models);
  const requirement = items.create(
    { title: "订单管理", type: "feature" },
    actor,
  );
  const model = models.create(
    {
      name: "订单",
      description: "订单模型",
      elements: [
        {
          id: crypto.randomUUID(),
          kind: "aggregate_root",
          name: "订单",
          description: "订单",
          fields: [],
        },
      ],
    },
    actor,
  );
  const proposal = chatProposalSchema.parse({
    kind: "development_items",
    sourceItems: [{ id: requirement.id, version: requirement.version }],
    sourceModels: [{ id: model.id, version: model.version }],
    items: [
      {
        title: "订单管理研发",
        type: "task",
        priority: "normal",
        description: "实现订单管理前后端、持久化及验收标准",
      },
    ],
  });
  const preview = (message = "reply") =>
    assistant.fromChat(
      "chat",
      message,
      0,
      proposal,
      [{ id: "user", role: "user", text: "根据需求和领域模型生成研发任务" }],
      actor,
    );
  return {
    db,
    items,
    models,
    assistant,
    requirement,
    model,
    proposal,
    preview,
    async close() {
      await assistant.close();
      db.close();
    },
  };
}
test("development proposal parses complete payload and hides incomplete streams", async () => {
  const f = fixture();
  try {
    const json = JSON.stringify(f.proposal);
    const content = chatProposalContent(
      `已整理研发任务。\n\n\`\`\`dedsiwork\n${json}\n\`\`\``,
    );
    expect(content.proposals[0]?.proposal.kind).toBe("development_items");
    expect(content.text).toBe("已整理研发任务。");
    expect(
      chatProposalContent(`\`\`\`dedsiwork\n${json.slice(0, 100)}`).pending,
    ).toBe(true);
    expect(
      chatProposalSchema.safeParse({ ...f.proposal, sourceModels: [] }).success,
    ).toBe(false);
    expect(
      chatProposalSchema.safeParse({
        ...f.proposal,
        items: [
          {
            title: "错误类型",
            description: "",
            priority: "normal",
            type: "feature",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      chatProposalSchema.safeParse({
        kind: "work_items",
        items: [
          {
            title: "旧草稿",
            description: "",
            priority: "normal",
            type: "feature",
          },
        ],
      }).success,
    ).toBe(true);
  } finally {
    await f.close();
  }
});
test("preview creates no work items; confirmation is editable, traced and idempotent", async () => {
  const f = fixture();
  try {
    const flow = f.preview();
    expect(flow.intent).toBe("development");
    expect(flow.sources[0]?.id).toBe(f.requirement.id);
    expect(flow.sourceModels?.[0]?.id).toBe(f.model.id);
    expect(f.items.list({}).meta.total).toBe(1);
    expect(f.preview().id).toBe(flow.id);
    const request = {
      confirmed: true,
      expectedRevision: flow.revision,
      items: flow.drafts.map((item) => ({ ...item, title: "已编辑研发任务" })),
    };
    const saved = f.assistant.confirm(flow.id, request, actor);
    expect(f.assistant.confirm(flow.id, request, actor).createdItems).toEqual(
      saved.createdItems,
    );
    expect(f.items.list({}).meta.total).toBe(2);
    const item = f.items.get(saved.createdItems[0]!.id);
    expect(item.type).toBe("task");
    expect(item.title).toBe("已编辑研发任务");
    expect(item.status).toBe("todo");
    expect(f.assistant.provenance("work-items", item.id, actor)?.flowId).toBe(
      flow.id,
    );
    expect(() =>
      f.assistant.read(flow.id, { ...actor, identity: "other" }),
    ).toThrow("不存在");
  } finally {
    await f.close();
  }
});
test("development proposals reject missing, changed and wrong-type requirements", async () => {
  const f = fixture();
  try {
    const flow = f.preview();
    expect(() =>
      f.assistant.confirm(
        flow.id,
        {
          confirmed: true,
          expectedRevision: flow.revision,
          items: flow.drafts.map((item) => ({ ...item, type: "feature" })),
        },
        actor,
      ),
    ).toThrow("任务类型");
    f.items.update(
      f.requirement.id,
      { expectedVersion: 1, title: "新需求" },
      actor,
    );
    expect(() =>
      f.assistant.confirm(
        flow.id,
        {
          confirmed: true,
          expectedRevision: flow.revision,
          items: flow.drafts,
        },
        actor,
      ),
    ).toThrow("来源需求已变更");
    expect(() => f.preview("new-reply")).toThrow("需求已更新");
    f.items.remove(f.requirement.id, 2, actor);
    expect(() => f.preview("missing-reply")).toThrow();
    expect(f.items.list({}).meta.total).toBe(0);
  } finally {
    await f.close();
  }
});

test("model changes and cross-workspace references cannot silently create development items", async () => {
  const f = fixture(),
    other = fixture();
  try {
    const flow = f.preview();
    expect(() =>
      other.assistant.fromChat("chat", "cross-space", 0, f.proposal, [], actor),
    ).toThrow();
    f.db
      .query("UPDATE domain_models SET version=version+1 WHERE id=?")
      .run(f.model.id);
    expect(() =>
      f.assistant.confirm(
        flow.id,
        {
          confirmed: true,
          expectedRevision: flow.revision,
          items: flow.drafts,
        },
        actor,
      ),
    ).toThrow("来源领域模型已变更");
    expect(f.items.list({}).meta.total).toBe(1);
  } finally {
    await f.close();
    await other.close();
  }
});
