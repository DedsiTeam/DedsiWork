import { WorkItemService } from "../server/services/work-items";
import { WorkItemRepository } from "../server/repositories/work-items";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { openDatabase } from "../server/db/database";
import { DailyReports } from "../server/services/daily-reports";
import {
  dailyReportInputSchema,
  reportDateSchema,
  reportMarkdown,
  reportMetrics,
} from "../shared/daily-report";
import type { Actor } from "../server/services/work-items";
import { createTestApp } from "./helpers/app";
const actor: Actor = {
  source: "web",
  identity: "test",
  writable: true,
  requestId: "report-test",
};
let db: ReturnType<typeof openDatabase>, service: DailyReports;
beforeEach(() => {
  db = openDatabase(":memory:");
  service = new DailyReports(db);
});
afterEach(() => db.close());
const matterId = crypto.randomUUID();
function input(date = "2026-10-15") {
  return dailyReportInputSchema.parse({
    date,
    matters: [
      {
        matterId,
        title: "日报开发",
        activity: "完成列表接口",
        result: "接口验证通过",
        completedQuantity: 2,
        unit: "个接口",
        progress: 50,
      },
    ],
  });
}
test("calendar validation rejects rollover dates and accepts leap days", () => {
  expect(reportDateSchema.safeParse("2026-02-29").success).toBe(false);
  expect(reportDateSchema.safeParse("2024-02-29").success).toBe(true);
  expect(reportDateSchema.safeParse("2026-13-01").success).toBe(false);
});
test("one active report per date; version conflicts preserve data", () => {
  const report = service.save(null, input(), actor);
  expect(() => service.save(null, input(), actor)).toThrow("该日期已有日报");
  const saved = service.save(
    report.id,
    { ...input(), completed: "新增工作结果", expectedVersion: report.version },
    actor,
  );
  expect(saved.version).toBe(2);
  expect(() =>
    service.save(report.id, { ...input(), expectedVersion: 1 }, actor),
  ).toThrow("日报已在其他窗口修改");
  expect(service.get(report.id).completed).toBe("新增工作结果");
  expect(service.get(report.id)).not.toHaveProperty("status");
});
test("date changes and restoration cannot collide with another report", () => {
  const first = service.save(null, input(), actor);
  const second = service.save(null, input("2026-10-16"), actor);
  expect(() =>
    service.save(
      second.id,
      { ...input(), expectedVersion: second.version },
      actor,
    ),
  ).toThrow("该日期已有日报");
  const deleted = service.lifecycle(
    first.id,
    { expectedVersion: first.version },
    false,
    actor,
  );
  expect(service.list(new URLSearchParams()).meta.total).toBe(1);
  expect(
    service.list(new URLSearchParams({ deleted: "true" })).data[0]?.id,
  ).toBe(first.id);
  const replacement = service.save(null, input(), actor);
  expect(() =>
    service.lifecycle(
      first.id,
      { expectedVersion: deleted.version },
      true,
      actor,
    ),
  ).toThrow("该日期已有日报");
  service.lifecycle(
    replacement.id,
    { expectedVersion: replacement.version },
    false,
    actor,
  );
  expect(
    service.lifecycle(
      first.id,
      { expectedVersion: deleted.version },
      true,
      actor,
    ).deletedAt,
  ).toBeNull();
});
test("full text search includes outcomes; literal wildcard escaping, month and pagination", () => {
  service.save(null, input(), actor);
  const value = { ...input("2026-09-15"), notes: "100%_完成" };
  service.save(null, value, actor);
  expect(
    service.list(new URLSearchParams({ q: "验证通过", month: "2026-10" })).meta
      .total,
  ).toBe(1);
  expect(service.list(new URLSearchParams({ q: "%_" })).meta.total).toBe(1);
  for (let i = 1; i <= 21; i++)
    service.save(null, input(`2026-08-${String(i).padStart(2, "0")}`), actor);
  expect(
    service
      .list(new URLSearchParams({ date: "2026-10-15" }))
      .data.map((report) => report.date),
  ).toEqual(["2026-10-15"]);
  expect(service.list(new URLSearchParams()).data).toHaveLength(20);
  expect(service.list(new URLSearchParams({ page: "2" })).data).toHaveLength(3);
});
test("quantity validation and metrics keep units separate and retain unknown values", () => {
  const value = input();
  value.matters.push({
    ...value.matters[0]!,
    matterId: crypto.randomUUID(),
    title: "说明文档",
    completedQuantity: 1,
    unit: "篇文档",
    status: "done",
    progress: 100,
  });
  value.matters.push({
    ...value.matters[0]!,
    matterId: crypto.randomUUID(),
    completedQuantity: null,
    unit: "",
    progress: null,
  });
  expect(reportMetrics(value)).toEqual({
    total: 3,
    done: 1,
    quantities: { 个接口: 2, 篇文档: 1 },
  });
  expect(reportMarkdown(value)).toContain("累计进度：未填写");
  expect(reportMarkdown(value)).toContain("接口验证通过");
  expect(
    dailyReportInputSchema.safeParse({
      ...value,
      matters: [{ ...value.matters[0], unit: "" }],
    }).success,
  ).toBe(false);
  expect(
    dailyReportInputSchema.safeParse({
      ...value,
      matters: [{ ...value.matters[0], completedQuantity: -1 }],
    }).success,
  ).toBe(false);
  expect(
    dailyReportInputSchema.safeParse({
      ...value,
      matters: [{ ...value.matters[0], status: "done", progress: 50 }],
    }).success,
  ).toBe(false);
  expect(
    dailyReportInputSchema.safeParse({
      ...value,
      matters: [value.matters[0], value.matters[0]],
    }).success,
  ).toBe(false);
});
test("cross-day identity and future work item / AI provenance survive round trips", () => {
  const first = service.save(null, input(), actor);
  const workItem = new WorkItemService(new WorkItemRepository(db)).create(
    { title: "日报开发" },
    actor,
  );
  const second = service.save(
    null,
    {
      ...input("2026-10-16"),
      matters: [
        {
          ...first.matters[0]!,
          workItemId: workItem.id,
          completedQuantity: 3,
          progress: 100,
          status: "done",
        },
      ],
      generation: {
        source: "ai",
        model: "future-model",
        generatedAt: new Date().toISOString(),
      },
    },
    actor,
  );
  expect(service.get(second.id).matters[0]?.matterId).toBe(
    first.matters[0]?.matterId,
  );
  expect(service.get(second.id).generation.source).toBe("ai");
  expect(reportMetrics(first).quantities["个接口"]).toBe(2);
  expect(reportMetrics(second).quantities["个接口"]).toBe(3);
});
test("read-only actors cannot create, change, delete or restore", () => {
  const report = service.save(null, input(), actor),
    reader = { ...actor, writable: false };
  expect(() => service.save(null, input("2026-10-16"), reader)).toThrow(
    "需要写入权限",
  );
  expect(() =>
    service.save(report.id, { ...input(), expectedVersion: 1 }, reader),
  ).toThrow("需要写入权限");
  expect(() =>
    service.lifecycle(report.id, { expectedVersion: 1 }, false, reader),
  ).toThrow("需要写入权限");
  expect(() =>
    service.lifecycle(report.id, { expectedVersion: 1 }, true, reader),
  ).toThrow("需要写入权限");
});
test("REST routes preserve workspace isolation, auth, method and version boundaries", async () => {
  const credentials = {
    pairingCode: "report-test-pairing",
    readToken: "report-read-token-00000000000000000000",
    writeToken: "report-write-token-0000000000000000000",
  };
  const origin = "http://127.0.0.1:3219",
    app = createTestApp({ credentials, origin });
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    space?: string,
    token = credentials.writeToken,
  ) {
    return app.handle(
      new Request(origin + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(space ? { "X-Workspace-Id": space } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  }
  try {
    const a = (
      await (
        await request("/api/v1/workspaces", "POST", { name: "报表 A" })
      ).json()
    ).data.id;
    const b = (
      await (
        await request("/api/v1/workspaces", "POST", { name: "报表 B" })
      ).json()
    ).data.id;
    const created = await request("/api/v1/daily-reports", "POST", input(), a);
    expect(created.status).toBe(201);
    const report = (await created.json()).data;
    expect(
      (
        await (
          await request("/api/v1/daily-reports", "GET", undefined, b)
        ).json()
      ).meta.total,
    ).toBe(0);
    expect(
      (await request(`/api/v1/daily-reports/${report.id}`, "GET", undefined, b))
        .status,
    ).toBe(404);
    expect(
      (await request("/api/v1/daily-reports", "POST", input(), b)).status,
    ).toBe(201);
    expect(
      (
        await request(
          `/api/v1/daily-reports/${report.id}`,
          "PUT",
          { ...input(), expectedVersion: 10 },
          a,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          `/api/v1/daily-reports/${report.id}`,
          "DELETE",
          { expectedVersion: 1 },
          a,
          credentials.readToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/api/v1/daily-reports/${report.id}`,
          "DELETE",
          { expectedVersion: 1 },
          a,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/v1/daily-reports/${report.id}/restore`,
          "POST",
          { expectedVersion: 2 },
          a,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/v1/daily-reports/${report.id}/restore`,
          "GET",
          undefined,
          a,
        )
      ).status,
    ).toBe(405);
  } finally {
    await app.close();
  }
});

test("schema 10 migration removes only report status and preserves history, quantities and matter status", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "dedsiwork-report-status-")),
    path = join(dir, "reports.sqlite");
  const legacy = openDatabase(path),
    old = new DailyReports(legacy);
  const active = old.save(
    null,
    {
      ...input(),
      matters: [{ ...input().matters[0], status: "done", progress: 100 }],
    },
    actor,
  );
  const removed = old.save(null, input("2026-10-14"), actor);
  old.lifecycle(removed.id, { expectedVersion: removed.version }, false, actor);
  legacy.exec(
    "UPDATE daily_reports SET content=json_set(content,'$.status','draft');DELETE FROM schema_migrations WHERE version=11",
  );
  legacy.close();
  const upgraded = openDatabase(path);
  try {
    const reports = new DailyReports(upgraded),
      current = reports.get(active.id);
    expect(current).not.toHaveProperty("status");
    expect(current.version).toBe(active.version);
    expect(current.matters[0]?.status).toBe("done");
    expect(current.matters[0]?.completedQuantity).toBe(2);
    expect(reports.get(removed.id).deletedAt).not.toBeNull();
    expect(
      upgraded
        .query(
          "SELECT id FROM daily_reports WHERE json_type(content,'$.status') IS NOT NULL",
        )
        .all(),
    ).toHaveLength(0);
    expect(
      reports.summary(
        new URLSearchParams({ type: "weekly", date: "2026-10-15" }),
      ).reportCount,
    ).toBe(1);
    expect(() =>
      reports.save(null, { ...input("2026-10-13"), status: "draft" }, actor),
    ).toThrow();
  } finally {
    upgraded.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
