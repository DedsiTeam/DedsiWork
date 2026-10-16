import { MAX_REQUEST_BODY_SIZE } from "../shared/description";
import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createTestApp } from "./helpers/app";
import type { WorkItem } from "../shared/work-item";

const credentials = {
  pairingCode: "test-pairing-code-long",
  readToken: "read-only-test-token-0000000000000000",
  writeToken: "write-test-token-00000000000000000000",
};
let app: ReturnType<typeof createTestApp>,
  server: ReturnType<typeof Bun.serve>,
  origin: string;
beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
    fetch: (req) => app.handle(req),
  });
  origin = `http://127.0.0.1:${server.port}`;
  app = createTestApp({ credentials, origin }, true);
});
afterAll(async () => {
  await server.stop(true);
  await app.close();
});
async function webSession() {
  const response = await fetch(`${origin}/auth/session`);
  expect(response.status).toBe(200);
  return {
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
    csrf: (await response.json()).data.csrf as string,
  };
}
test("local browsers connect without a pairing code and reuse or renew sessions", async () => {
  const { cookie, csrf } = await webSession();
  const reused = await fetch(`${origin}/auth/session`, {
    headers: { Cookie: cookie },
  });
  expect((await reused.json()).data.csrf).toBe(csrf);
  expect(reused.headers.get("set-cookie")).toBeNull();
  expect(
    (
      await fetch(`${origin}/api/v1/workspaces`, {
        headers: { Cookie: cookie },
      })
    ).status,
  ).toBe(200);
  const renewed = await fetch(`${origin}/auth/session`, {
    headers: { Cookie: "dedsiwork_session=expired-session" },
  });
  expect(renewed.status).toBe(200);
  expect(renewed.headers.get("set-cookie")).toContain(
    "HttpOnly; SameSite=Strict",
  );
  for (const headers of [
    new Headers({ Origin: "https://untrusted.example" }),
    new Headers({ "Sec-Fetch-Site": "cross-site" }),
    new Headers({ Host: "evil.example" }),
  ]) {
    const rejected = await fetch(`${origin}/auth/session`, { headers });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("set-cookie")).toBeNull();
  }
});
async function client(token = credentials.writeToken, modern = false) {
  const result = new Client(
    { name: "dedsiwork-integration-test", version: "1.0.0" },
    { versionNegotiation: { mode: modern ? "auto" : "legacy" } },
  );
  await result.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return result;
}
function toolResult<T>(result: Awaited<ReturnType<Client["callTool"]>>): T {
  expect(result.isError).not.toBe(true);
  return (result.structuredContent as { result: T }).result;
}
test("web authentication, CSRF and local origin boundaries", async () => {
  expect((await fetch(`${origin}/api/v1/work-items`)).status).toBe(401);
  expect((await fetch(`${origin}/mcp`, { method: "POST" })).status).toBe(401);
  expect(
    (
      await fetch(`${origin}/api/v1/work-items`, {
        headers: { Origin: "https://untrusted.example" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.handle(
        new Request(`${origin}/healthz`, { headers: { Host: "evil.example" } }),
      )
    ).status,
  ).toBe(403);
  const { cookie, csrf } = await webSession();
  expect(
    (
      await fetch(`${origin}/api/v1/work-items`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "missing csrf" }),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(`${origin}/api/v1/work-items`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "X-CSRF-Token": csrf,
          "Content-Type": "application/json",
        },
        body: "{",
      })
    ).status,
  ).toBe(400);
});
test("web create → actual MCP client read and update → web sees result and conflict", async () => {
  const { cookie, csrf } = await webSession();
  const headers = {
    Cookie: cookie,
    "X-CSRF-Token": csrf,
    "Content-Type": "application/json",
  };
  const created = await fetch(`${origin}/api/v1/work-items`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "网页与 MCP 联动",
      description: "same database",
    }),
  });
  expect(created.status).toBe(201);
  const item = (await created.json()).data as WorkItem;
  const mcp = await client();
  try {
    const tools = await mcp.listTools();
    expect(tools.tools.length).toBe(18);
    const found = toolResult<WorkItem>(
      await mcp.callTool({ name: "work_item_get", arguments: { id: item.id } }),
    );
    expect(found.description).toBe("same database");
    const changed = toolResult<WorkItem>(
      await mcp.callTool({
        name: "work_item_update",
        arguments: { id: item.id, expectedVersion: 1, status: "in_progress" },
      }),
    );
    expect(changed.version).toBe(2);
    const web = await fetch(`${origin}/api/v1/work-items/${item.id}`, {
      headers,
    });
    expect((await web.json()).data.status).toBe("in_progress");
    const stale = await fetch(`${origin}/api/v1/work-items/${item.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: "stale", expectedVersion: 1 }),
    });
    expect(stale.status).toBe(409);
    const events = await fetch(
      `${origin}/api/v1/work-items/${item.id}/events`,
      { headers },
    );
    const activity = (await events.json()).data;
    expect(activity.map((e: { source: string }) => e.source)).toEqual([
      "mcp",
      "web",
    ]);
    const gone = toolResult<WorkItem>(
      await mcp.callTool({
        name: "work_item_delete",
        arguments: { id: item.id, expectedVersion: 2 },
      }),
    );
    expect(gone.deletedAt).not.toBeNull();
    const restored = toolResult<WorkItem>(
      await mcp.callTool({
        name: "work_item_restore",
        arguments: { id: item.id, expectedVersion: 3 },
      }),
    );
    expect(restored.version).toBe(4);
  } finally {
    await mcp.close();
  }
}, 15000);
test("MCP creation is idempotent and read-only tokens reject writes", async () => {
  const mcp = await client();
  const reader = await client(credentials.readToken);
  try {
    const args = { title: "MCP 创建", requestKey: "integration-create" };
    const first = toolResult<WorkItem>(
      await mcp.callTool({ name: "work_item_create", arguments: args }),
    );
    const second = toolResult<WorkItem>(
      await mcp.callTool({ name: "work_item_create", arguments: args }),
    );
    expect(first.id).toBe(second.id);
    const found = toolResult<{ data: WorkItem[] }>(
      await reader.callTool({
        name: "work_item_list",
        arguments: { q: "MCP 创建" },
      }),
    );
    expect(found.data[0]?.id).toBe(first.id);
    expect(
      (
        await reader.callTool({
          name: "work_item_update",
          arguments: { id: first.id, title: "denied", expectedVersion: 1 },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await reader.callTool({
          name: "work_item_create",
          arguments: { title: "denied" },
        })
      ).isError,
    ).toBe(true);
  } finally {
    await mcp.close();
    await reader.close();
  }
}, 15000);
test("oversized bodies rejected by HTTP server", async () => {
  let rejected = false;
  try {
    const response = await fetch(`${origin}/api/v1/work-items`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.writeToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "oversized-unique",
        description: "x".repeat(MAX_REQUEST_BODY_SIZE + 1),
      }),
    });
    rejected = response.status === 413;
  } catch (error) {
    // Bun can reset a connection while rejecting an oversized streaming body.
    rejected = (error as { code?: string }).code === "ECONNRESET";
  }
  expect(rejected).toBe(true);
  const response = await fetch(
    `${origin}/api/v1/work-items?q=oversized-unique`,
    { headers: { Authorization: `Bearer ${credentials.readToken}` } },
  );
  expect((await response.json()).meta.total).toBe(0);
});
test("modern protocol negotiation supports tool discovery and read calls", async () => {
  const mcp = await client(credentials.readToken, true);
  try {
    expect((await mcp.listTools()).tools.length).toBe(18);
    expect(
      (await mcp.callTool({ name: "work_item_list", arguments: {} })).isError,
    ).not.toBe(true);
  } finally {
    await mcp.close();
  }
});

test("rich descriptions round trip between browser API and MCP", async () => {
  const rich =
    '<!--dedsiwork-richtext-v1--><h2>验收说明</h2><p><strong>文字与图片</strong></p><img src="data:image/png;base64,' +
    "A".repeat(300000) +
    '" alt="示意图">';
  const response = await fetch(`${origin}/api/v1/work-items`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.writeToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: "富文本跨端验证", description: rich }),
  });
  expect(response.status).toBe(201);
  const item = (await response.json()).data as WorkItem;
  const mcp = await client();
  try {
    const read = toolResult<WorkItem>(
      await mcp.callTool({ name: "work_item_get", arguments: { id: item.id } }),
    );
    expect(read.description).toBe(rich);
    const updated = toolResult<WorkItem>(
      await mcp.callTool({
        name: "work_item_update",
        arguments: {
          id: item.id,
          expectedVersion: item.version,
          description: rich + "<p>补充说明</p>",
        },
      }),
    );
    expect(updated.description).toBe(rich + "<p>补充说明</p>");
  } finally {
    await mcp.close();
  }
});

test("trash purge endpoint enforces auth, CSRF, versions and atomic batch deletion", async () => {
  const a = app.service!.create(
    { title: "purge-http-a" },
    { source: "web", identity: "test", writable: true, requestId: "test" },
  );
  const b = app.service!.create(
    { title: "purge-http-b" },
    { source: "web", identity: "test", writable: true, requestId: "test" },
  );
  const actor = {
    source: "web" as const,
    identity: "test",
    writable: true,
    requestId: "test",
  };
  app.service!.remove(a.id, 1, actor);
  app.service!.remove(b.id, 1, actor);
  const body = JSON.stringify({
    items: [
      { id: a.id, expectedVersion: 2 },
      { id: b.id, expectedVersion: 2 },
    ],
  });
  const { cookie, csrf } = await webSession();
  const send = (headers: Record<string, string>, payload = body) =>
    fetch(`${origin}/api/v1/trash/purge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: payload,
    });
  expect((await send({})).status).toBe(401);
  expect((await send({ Cookie: cookie })).status).toBe(403);
  expect(
    (await send({ Authorization: `Bearer ${credentials.readToken}` })).status,
  ).toBe(403);
  expect(
    (
      await send(
        { Cookie: cookie, "X-CSRF-Token": csrf },
        JSON.stringify({ items: [{ id: a.id, expectedVersion: 1 }] }),
      )
    ).status,
  ).toBe(409);
  const response = await send({ Cookie: cookie, "X-CSRF-Token": csrf });
  expect(response.status).toBe(200);
  expect((await response.json()).data.count).toBe(2);
  expect(() => app.service!.get(a.id, true)).toThrow();
  expect(() => app.service!.get(b.id, true)).toThrow();
});

test("sprint REST and MCP share lifecycle, ordering, conflicts and read permissions", async () => {
  const { cookie, csrf } = await webSession();
  const headers = {
    Cookie: cookie,
    "X-CSRF-Token": csrf,
    "Content-Type": "application/json",
  };
  const payload = {
    name: "跨入口冲刺",
    goal: "验证看板",
    startDate: "2026-10-14",
    endDate: "2026-10-27",
  };
  expect(
    (
      await fetch(`${origin}/api/v1/sprints`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    ).status,
  ).toBe(403);
  const response = await fetch(`${origin}/api/v1/sprints`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  expect(response.status).toBe(201);
  const sprint = (await response.json()).data;
  const mcp = await client(),
    reader = await client(credentials.readToken, true);
  try {
    const tools = (await mcp.listTools()).tools.map((t) => t.name);
    for (const name of [
      "sprint_list",
      "sprint_get",
      "sprint_create",
      "sprint_update",
      "sprint_start",
      "sprint_add_items",
      "sprint_remove_items",
      "sprint_move_item",
      "sprint_create_item",
      "sprint_finish",
    ])
      expect(tools).toContain(name);
    const created = toolResult<{ items: WorkItem[] }>(
      await mcp.callTool({
        name: "sprint_create_item",
        arguments: {
          id: sprint.id,
          expectedVersion: 1,
          item: { title: "冲刺卡片" },
          status: "in_progress",
          requestKey: "sprint-integration",
        },
      }),
    );
    const item = created.items[0]!;
    expect(item.status).toBe("in_progress");
    expect(
      (
        await fetch(`${origin}/api/v1/sprints/${sprint.id}/start`, {
          method: "POST",
          headers,
          body: JSON.stringify({ expectedVersion: 1 }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await fetch(`${origin}/api/v1/sprints/${sprint.id}/start`, {
          method: "POST",
          headers,
          body: JSON.stringify({ expectedVersion: 2 }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await reader.callTool({
          name: "sprint_move_item",
          arguments: {
            id: sprint.id,
            expectedVersion: 3,
            itemId: item.id,
            itemVersion: item.version,
            status: "done",
          },
        })
      ).isError,
    ).toBe(true);
    toolResult(
      await mcp.callTool({
        name: "sprint_move_item",
        arguments: {
          id: sprint.id,
          expectedVersion: 3,
          itemId: item.id,
          itemVersion: item.version,
          status: "done",
        },
      }),
    );
    const result = await fetch(`${origin}/api/v1/sprints/${sprint.id}`, {
      headers,
    });
    expect((await result.json()).data.items[0].status).toBe("done");
    toolResult(
      await mcp.callTool({
        name: "sprint_finish",
        arguments: { id: sprint.id, expectedVersion: 4 },
      }),
    );
    const final = toolResult<{ sprint: { state: string }; items: WorkItem[] }>(
      await reader.callTool({
        name: "sprint_get",
        arguments: { id: sprint.id },
      }),
    );
    expect(final.sprint.state).toBe("closed");
    expect(final.items[0]?.status).toBe("done");
  } finally {
    await mcp.close();
    await reader.close();
  }
}, 15000);

test("MCP understands delivery stages, pause, blocking and return reasons", async () => {
  const mcp = await client(),
    reader = await client(credentials.readToken);
  try {
    let item = toolResult<WorkItem>(
      await mcp.callTool({
        name: "work_item_create",
        arguments: { title: "workflow MCP", requestKey: "workflow-mcp" },
      }),
    );
    for (const status of [
      "in_review",
      "in_verification",
      "awaiting_acceptance",
      "paused",
    ] as const) {
      item = toolResult<WorkItem>(
        await mcp.callTool({
          name: "work_item_update",
          arguments: { id: item.id, expectedVersion: item.version, status },
        }),
      );
      expect(item.status).toBe(status);
    }
    item = toolResult<WorkItem>(
      await mcp.callTool({
        name: "work_item_update",
        arguments: {
          id: item.id,
          expectedVersion: item.version,
          status: "in_review",
          blockedReason: "等待评审人",
        },
      }),
    );
    const flagged = toolResult<{ data: WorkItem[] }>(
      await reader.callTool({
        name: "work_item_list",
        arguments: { blocked: "true", q: "workflow MCP" },
      }),
    );
    expect(flagged.data[0]?.status).toBe("in_review");
    expect(
      (
        await reader.callTool({
          name: "work_item_update",
          arguments: {
            id: item.id,
            expectedVersion: item.version,
            blockedReason: "",
          },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await mcp.callTool({
          name: "work_item_update",
          arguments: {
            id: item.id,
            expectedVersion: item.version,
            status: "in_progress",
          },
        })
      ).isError,
    ).toBe(true);
    item = toolResult<WorkItem>(
      await mcp.callTool({
        name: "work_item_update",
        arguments: {
          id: item.id,
          expectedVersion: item.version,
          status: "in_progress",
          transitionReason: "补充异常处理",
        },
      }),
    );
    expect(item.blockedReason).toBe("等待评审人");
  } finally {
    await mcp.close();
    await reader.close();
  }
});

test("empty sprint deletion works across REST and MCP and requires confirmation", async () => {
  const { cookie, csrf } = await webSession();
  const headers = {
    Cookie: cookie,
    "X-CSRF-Token": csrf,
    "Content-Type": "application/json",
  };
  const response = await fetch(`${origin}/api/v1/sprints`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "empty delete",
      startDate: "2026-10-14",
      endDate: "2026-10-27",
    }),
  });
  const sprint = (await response.json()).data;
  const body = JSON.stringify({
    expectedVersion: sprint.version,
    confirmed: true,
  });
  expect(
    (
      await fetch(`${origin}/api/v1/sprints/${sprint.id}`, {
        method: "DELETE",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(`${origin}/api/v1/sprints/${sprint.id}`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ expectedVersion: sprint.version }),
      })
    ).status,
  ).toBe(400);
  const mcp = await client(),
    reader = await client(credentials.readToken);
  try {
    const tool = (await mcp.listTools()).tools.find(
      (x) => x.name === "sprint_delete",
    );
    expect(tool?.annotations?.destructiveHint).toBe(true);
    expect(
      (
        await reader.callTool({
          name: "sprint_delete",
          arguments: {
            id: sprint.id,
            expectedVersion: sprint.version,
            confirmed: true,
          },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await mcp.callTool({
          name: "sprint_delete",
          arguments: {
            id: sprint.id,
            expectedVersion: sprint.version + 1,
            confirmed: true,
          },
        })
      ).isError,
    ).toBe(true);
    const result = toolResult<{ deleted: boolean }>(
      await mcp.callTool({
        name: "sprint_delete",
        arguments: {
          id: sprint.id,
          expectedVersion: sprint.version,
          confirmed: true,
        },
      }),
    );
    expect(result.deleted).toBe(true);
    expect(
      (await fetch(`${origin}/api/v1/sprints/${sprint.id}`, { headers }))
        .status,
    ).toBe(404);
    const empty = app.sprints!.create(
      { name: "REST delete", startDate: "2026-10-14", endDate: "2026-10-27" },
      { source: "web", identity: "test", writable: true, requestId: "test" },
    );
    expect(
      (
        await fetch(`${origin}/api/v1/sprints/${empty.id}`, {
          method: "DELETE",
          headers,
          body: JSON.stringify({
            expectedVersion: empty.version,
            confirmed: true,
          }),
        })
      ).status,
    ).toBe(200);
  } finally {
    await mcp.close();
    await reader.close();
  }
});

test("development reminders require authentication and acknowledging requires CSRF", async () => {
  expect(
    (await fetch(`${origin}/api/v1/development-notifications`)).status,
  ).toBe(401);
  const { cookie } = await webSession();
  const result = await fetch(`${origin}/api/v1/development-notifications`, {
    headers: { Cookie: cookie },
  });
  expect(result.status).toBe(200);
  expect((await result.json()).data).toEqual([]);
  const response = await fetch(
    `${origin}/api/v1/development-tasks/${crypto.randomUUID()}/acknowledge`,
    {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ notificationId: crypto.randomUUID() }),
    },
  );
  expect(response.status).toBe(403);
});
