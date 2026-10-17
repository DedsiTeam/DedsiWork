import { expect, test } from "bun:test";
import { createTestApp } from "./helpers/app";
import { PAGE_SIZE } from "../shared/pagination";
const credentials = {
  pairingCode: "opc-pairing",
  readToken: "opc-read-000000000000000000000000",
  writeToken: "opc-write-00000000000000000000000",
};
async function fixture() {
  const origin = "http://127.0.0.1:3241",
    app = createTestApp({ credentials, origin });
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    space?: string,
    token = credentials.writeToken,
  ) =>
    app.handle(
      new Request(origin + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(space ? { "X-Workspace-Id": space } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
  const a = (
    await (
      await request("/api/v1/workspaces", "POST", { name: "OPC A" })
    ).json()
  ).data.id as string;
  const b = (
    await (
      await request("/api/v1/workspaces", "POST", { name: "OPC B" })
    ).json()
  ).data.id as string;
  return { app, request, a, b };
}
test("OPC focus and search reflect current workspace and reject stale/read-only updates", async () => {
  const { app, request, a, b } = await fixture();
  try {
    const item = (
      await (
        await request(
          "/api/v1/work-items",
          "POST",
          { title: "OPC 100%_计划", description: "可检索来源" },
          a,
        )
      ).json()
    ).data;
    const focus = {
      itemId: item.id,
      bucket: "today",
      date: "2026-10-17",
      expectedVersion: 0,
    };
    expect(
      (
        await request(
          "/api/v1/personal/focus",
          "PUT",
          focus,
          a,
          credentials.readToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (await request("/api/v1/personal/focus", "PUT", focus, b)).status,
    ).toBe(404);
    expect(
      (await request("/api/v1/personal/focus", "PUT", focus, a)).status,
    ).toBe(200);
    expect(
      (await request("/api/v1/personal/focus", "PUT", focus, a)).status,
    ).toBe(409);
    const overview = (
      await (
        await request("/api/v1/personal/overview", "GET", undefined, a)
      ).json()
    ).data;
    expect(overview.focus.map((f: { id: string }) => f.id)).toEqual([item.id]);
    expect(overview.running).toEqual([]);
    expect(overview.attention).toEqual([]);
    expect(
      (
        await (
          await request("/api/v1/personal/overview", "GET", undefined, b)
        ).json()
      ).data.focus,
    ).toEqual([]);
    const search = await (
      await request(
        "/api/v1/personal/search?q=" + encodeURIComponent("%_"),
        "GET",
        undefined,
        a,
        credentials.readToken,
      )
    ).json();
    expect(search.meta.pageSize).toBe(PAGE_SIZE);
    expect(search.data.map((entry: { id: string }) => entry.id)).toEqual([
      item.id,
    ]);
    expect(
      (
        await (
          await request("/api/v1/personal/search?q=OPC", "GET", undefined, b)
        ).json()
      ).meta.total,
    ).toBe(0);
    expect(
      (await request(`/api/v1/personal/focus/${item.id}`, "GET", undefined, b))
        .status,
    ).toBe(404);
    expect(
      (await request("/api/v1/personal/search?page=0", "GET", undefined, a))
        .status,
    ).toBe(400);
    expect(
      (
        await request(
          "/api/v1/personal/context",
          "POST",
          { kind: "item", id: item.id },
          b,
        )
      ).status,
    ).toBe(404);
  } finally {
    await app.close();
  }
});
test("report draft routes preserve version history, isolate spaces and enforce write access", async () => {
  const { app, request, a, b } = await fixture();
  try {
    const path = "/api/v1/daily-reports/drafts",
      query = path + "?type=weekly&date=2026-10-17";
    const input = {
      type: "weekly",
      date: "2026-10-17",
      text: "初稿",
      sourceSnapshot: '{"reportCount":1}',
      expectedVersion: 0,
    };
    expect(
      (await request(path, "POST", input, a, credentials.readToken)).status,
    ).toBe(403);
    const saved = await request(path, "POST", input, a);
    expect(saved.status).toBe(200);
    expect((await saved.json()).data.version).toBe(1);
    expect((await request(path, "POST", input, a)).status).toBe(409);
    expect(
      (
        await request(
          path,
          "POST",
          { ...input, text: "定稿", expectedVersion: 1 },
          a,
        )
      ).status,
    ).toBe(200);
    const history = (
      await (
        await request(query, "GET", undefined, a, credentials.readToken)
      ).json()
    ).data;
    expect(history.versions.map((d: { text: string }) => d.text)).toEqual([
      "定稿",
      "初稿",
    ]);
    expect(history.versions[0].sourceSnapshot).toBe(input.sourceSnapshot);
    expect(
      (await (await request(query, "GET", undefined, b)).json()).data.total,
    ).toBe(0);
    expect(
      (await request(path + "?type=weekly&date=bad", "GET", undefined, a))
        .status,
    ).toBe(400);
    expect(
      (
        await request(
          "/api/v1/daily-reports/activity?date=2026-10-17&offset=-480",
          "GET",
          undefined,
          a,
        )
      ).status,
    ).toBe(200);
  } finally {
    await app.close();
  }
});
test("workflow route validation and run controls enforce workspace/write boundaries", async () => {
  const { app, request, a, b } = await fixture();
  try {
    const root = "/api/v1/ai-workflows";
    for (const [path, method] of [
      ["/schedules", "GET"],
      ["/schedules", "POST"],
      ["/schedules/removed", "PUT"],
      ["/schedules/removed", "DELETE"],
    ]) {
      expect(
        (
          await request(
            root + path,
            method!,
            method === "GET" ? undefined : {},
            a,
          )
        ).status,
      ).toBe(404);
    }
    expect(
      (await (await request(root + "/runs", "GET", undefined, a)).json()).data
        .total,
    ).toBe(0);
    expect((await request(root + "/runs", "POST", {}, a)).status).toBe(400);
    expect(
      (await request(root + "/runs", "POST", {}, a, credentials.readToken))
        .status,
    ).toBe(403);
    const absent = crypto.randomUUID();
    for (const action of ["rerun", "cancel"]) {
      expect(
        (await request(`${root}/runs/${absent}/${action}`, "POST", {}, a))
          .status,
      ).toBe(404);
      expect(
        (
          await request(
            `${root}/runs/${absent}/${action}`,
            "POST",
            {},
            a,
            credentials.readToken,
          )
        ).status,
      ).toBe(403);
    }
  } finally {
    await app.close();
  }
});
