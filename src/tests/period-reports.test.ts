import { expect, test } from "bun:test";
import {
  dailyReportInputSchema,
  type DailyReport,
  type ReportMatter,
} from "../shared/daily-report";
import {
  buildPeriodReport,
  periodRange,
  periodMarkdown,
} from "../shared/period-report";
import { openDatabase } from "../server/db/database";
import { DailyReports } from "../server/services/daily-reports";
import { WorkItemService, type Actor } from "../server/services/work-items";
import { WorkItemRepository } from "../server/repositories/work-items";
import { createTestApp } from "./helpers/app";
const actor: Actor = {
  source: "web",
  identity: "report-test",
  writable: true,
  requestId: "period-test",
};
const id = crypto.randomUUID(),
  linked = crypto.randomUUID();
function report(
  date: string,
  patch: Partial<ReportMatter> = {},
  extra: Partial<DailyReport> = {},
): DailyReport {
  return {
    ...dailyReportInputSchema.parse({
      date,
      matters: [
        {
          matterId: id,
          title: "报表开发",
          activity: `${date} 开发`,
          result: `${date} 验证通过`,
          completedQuantity: 2,
          unit: "个接口",
          progress: 30,
          ...patch,
        },
      ],
    }),
    id: crypto.randomUUID(),
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...extra,
  };
}
test("calendar ranges use Monday-Sunday and handle leap months and year boundaries", () => {
  expect(periodRange("weekly", "2026-10-18")).toEqual({
    start: "2026-10-12",
    end: "2026-10-18",
  });
  expect(periodRange("weekly", "2026-01-01")).toEqual({
    start: "2025-12-29",
    end: "2026-01-04",
  });
  expect(periodRange("monthly", "2024-02-15")).toEqual({
    start: "2024-02-01",
    end: "2024-02-29",
  });
});
test("weekly groups by identity across days, preserves daily outcomes and sums deltas only", () => {
  const rows = [
    report("2026-10-11", { progress: 10 }),
    report("2026-10-12"),
    report("2026-10-13", {
      title: "新名称",
      completedQuantity: 3,
      progress: 100,
      status: "done",
    }),
    report("2026-10-14", {
      title: "新名称",
      status: "done",
      progress: 100,
      completedQuantity: 0,
    }),
  ];
  const result = buildPeriodReport(rows, "weekly", "2026-10-15");
  expect(result.metrics).toMatchObject({
    total: 1,
    firstRecorded: 0,
    firstCompleted: 1,
    endDone: 1,
    quantities: { 个接口: 5 },
  });
  expect(result.matters[0]?.progress).toBe(100);
  expect(result.matters[0]?.days).toHaveLength(3);
  expect(result.matters[0]?.title).toBe("新名称");
  expect(periodMarkdown(result)).toContain("2026-10-13 验证通过");
  expect(periodMarkdown(result)).not.toContain("2026-10-11 验证通过");
});
test("monthly groups clipped weeks, deduplicates across weeks and excludes neighboring months", () => {
  const rows = [
    report("2026-09-30"),
    report("2026-10-01", { completedQuantity: 1 }),
    report("2026-10-05", { completedQuantity: 2 }),
    report("2026-10-19", { completedQuantity: 4, progress: 90 }),
    report("2026-11-01", { completedQuantity: 500 }),
  ];
  const result = buildPeriodReport(rows, "monthly", "2026-10-15");
  expect(result.metrics.total).toBe(1);
  expect(result.metrics.quantities).toEqual({ 个接口: 7 });
  expect(result.weeks).toHaveLength(5);
  expect(result.weeks[0]).toMatchObject({
    start: "2026-10-01",
    end: "2026-10-04",
  });
  expect(result.weeks.at(-1)).toMatchObject({
    start: "2026-10-26",
    end: "2026-10-31",
  });
  expect(result.weeks.filter((w) => w.matters.length)).toHaveLength(3);
  expect(result.matters[0]?.progress).toBe(90);
  expect(periodMarkdown(result)).toContain("全月事项汇总（跨周去重）");
});
test("linking an existing matter merges earlier unlinked days and other aliases of the work item", () => {
  const rows = [
    report("2026-10-12"),
    report("2026-10-13", { workItemId: linked }),
    report("2026-10-14", { matterId: crypto.randomUUID(), workItemId: linked }),
  ];
  const result = buildPeriodReport(rows, "weekly", "2026-10-15");
  expect(result.metrics.total).toBe(1);
  expect(result.matters[0]?.days).toHaveLength(3);
  expect(result.metrics.quantities).toEqual({ 个接口: 6 });
});
test("same titles do not merge different matters; units and missing data remain distinct", () => {
  const a = report("2026-10-12", {
    completedQuantity: null,
    progress: null,
    result: "",
  });
  const b = report("2026-10-13", {
    matterId: crypto.randomUUID(),
    unit: "篇文档",
    completedQuantity: 1,
  });
  const c = report("2026-10-14", { completedQuantity: 0, progress: null });
  const result = buildPeriodReport([a, b, c], "weekly", "2026-10-15");
  expect(result.metrics.total).toBe(2);
  expect(result.metrics.quantities).toEqual({ 个接口: 0, 篇文档: 1 });
  expect(result.metrics.missingQuantityDays).toBe(1);
  expect(result.metrics.missingResultDays).toBe(1);
  expect(result.matters[0]?.progress).toBeNull();
});
test("all active reports contribute while soft deletion and repeated completion never inflate counts", () => {
  const rows = [
    report("2026-10-11", { status: "done", progress: 100 }),
    report("2026-10-12", { status: "done", progress: 100 }),
    report("2026-10-13", { status: "done", progress: 100 }),
    report(
      "2026-10-14",
      { completedQuantity: 100 },
      { deletedAt: new Date().toISOString() },
    ),
  ];
  const result = buildPeriodReport(rows, "weekly", "2026-10-15");
  expect(result.reportCount).toBe(2);
  expect(result.metrics.firstCompleted).toBe(0);
  expect(result.metrics.quantities).toEqual({ 个接口: 4 });
  expect(result).not.toHaveProperty("finalOnly");
  expect(result).not.toHaveProperty("draftCount");
  expect(periodMarkdown(result)).not.toContain("草稿");
});
test("legacy duplicate aliases count equal daily quantity once, conflicting values are omitted with warning", () => {
  const a = report("2026-10-12", { workItemId: linked });
  a.matters.push({ ...a.matters[0]!, matterId: crypto.randomUUID() });
  const equal = buildPeriodReport([a], "weekly", "2026-10-15");
  expect(equal.metrics.total).toBe(1);
  expect(equal.metrics.quantities).toEqual({ 个接口: 2 });
  expect(equal.metrics.duplicateDays).toBe(1);
  a.matters[1]!.completedQuantity = 7;
  const conflict = buildPeriodReport([a], "weekly", "2026-10-15");
  expect(conflict.metrics.quantities).toEqual({});
  expect(conflict.metrics.missingQuantityDays).toBe(1);
  expect(conflict.matters[0]?.days).toHaveLength(2);
});
test("reports with only prose remain visible in the summary sources and export", () => {
  const row = report(
    "2026-10-12",
    {},
    { matters: [], completed: "完成业务调研" },
  );
  const summary = buildPeriodReport([row], "weekly", "2026-10-15");
  expect(summary.reportCount).toBe(1);
  expect(summary.metrics.total).toBe(0);
  expect(periodMarkdown(summary)).toContain("完成业务调研");
});
test("link validation rejects foreign or missing items and daily duplicates; snapshots survive item deletion", () => {
  const db = openDatabase(":memory:"),
    reports = new DailyReports(db),
    work = new WorkItemService(new WorkItemRepository(db));
  try {
    const item = work.create({ title: "关联事项" }, actor),
      value = report("2026-10-12", { workItemId: item.id });
    const data = dailyReportInputSchema.parse({
      date: value.date,
      matters: value.matters,
    });
    const saved = reports.save(null, data, actor);
    expect(() =>
      reports.save(
        null,
        {
          ...data,
          date: "2026-10-13",
          matters: [{ ...data.matters[0], workItemId: crypto.randomUUID() }],
        },
        actor,
      ),
    ).toThrow("关联的工作项不存在");
    expect(() =>
      reports.save(
        saved.id,
        {
          ...data,
          matters: [
            data.matters[0],
            { ...data.matters[0], matterId: crypto.randomUUID() },
          ],
          expectedVersion: 1,
        },
        actor,
      ),
    ).toThrow("不能重复记录");
    work.remove(item.id, item.version, actor);
    expect(
      reports.save(null, { ...data, date: "2026-10-13" }, actor).matters[0]
        ?.workItemId,
    ).toBe(item.id);
    expect(
      reports.summary(
        new URLSearchParams({ type: "weekly", date: "2026-10-15" }),
      ).metrics.total,
    ).toBe(1);
    const other = work.create({ title: "其他工作" }, actor);
    expect(() =>
      reports.save(
        null,
        {
          ...data,
          date: "2026-10-14",
          matters: [{ ...data.matters[0], workItemId: other.id }],
        },
        actor,
      ),
    ).toThrow("历史记录关联了其他工作项");
  } finally {
    db.close();
  }
});
test("summary REST endpoint honors workspace scope and read-only tokens", async () => {
  const credentials = {
    pairingCode: "report-period-pairing",
    readToken: "report-period-read-000000000000000000",
    writeToken: "report-period-write-00000000000000000",
  };
  const origin = "http://127.0.0.1:3237",
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
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  try {
    const a = (
        await (
          await request("/api/v1/workspaces", "POST", { name: "周报空间" })
        ).json()
      ).data.id,
      b = (
        await (
          await request("/api/v1/workspaces", "POST", { name: "其他空间" })
        ).json()
      ).data.id;
    const item = (
      await (
        await request("/api/v1/work-items", "POST", { title: "工作项" }, a)
      ).json()
    ).data;
    const data = dailyReportInputSchema.parse({
      date: "2026-10-15",
      matters: [{ ...report("2026-10-15").matters[0], workItemId: item.id }],
    });
    expect(
      (await request("/api/v1/daily-reports", "POST", data, a)).status,
    ).toBe(201);
    expect(
      (await request("/api/v1/daily-reports", "POST", data, b)).status,
    ).toBe(400);
    const path = "/api/v1/daily-reports/summary?type=weekly&date=2026-10-15";
    expect(
      (
        await (
          await request(path, "GET", undefined, a, credentials.readToken)
        ).json()
      ).data.metrics.total,
    ).toBe(1);
    expect(
      (await (await request(path, "GET", undefined, b)).json()).data.metrics
        .total,
    ).toBe(0);
    expect((await request(path, "POST", {}, a)).status).toBe(405);
    expect(
      (
        await request(
          "/api/v1/daily-reports/summary?type=weekly&date=2026-02-30",
          "GET",
          undefined,
          a,
        )
      ).status,
    ).toBe(400);
  } finally {
    await app.close();
  }
});
