import { afterEach, beforeEach, expect, test } from "bun:test";
import { openDatabase } from "../server/db/database";
import { DailyReports } from "../server/services/daily-reports";
import { ReportAI, type ReportAIEngine } from "../server/services/report-ai";
import {
  composeAIReport,
  reportNarrativeSchema,
  type ReportNarrative,
} from "../shared/report-ai";
import type { PeriodReport } from "../shared/period-report";
import type { ModelGenerationJob } from "../shared/domain-model-ai";
import type { Actor } from "../server/services/work-items";
import { createTestApp } from "./helpers/app";
const actor: Actor = {
  source: "web",
  identity: "report-ai-test",
  writable: true,
  requestId: "report-ai-test",
};
let db: ReturnType<typeof openDatabase>, reports: DailyReports, ai: ReportAI;
let prompt: string,
  closed: boolean,
  jobs: Map<
    string,
    Omit<ModelGenerationJob, "result"> & { result?: ReportNarrative }
  >;
const query = { type: "weekly", date: "2026-10-15" } as const;
function narrative(source: PeriodReport): ReportNarrative {
  return {
    overview: "本期围绕日报功能持续推进，已完成开发与验证。",
    matters: source.matters.map((item) => ({
      key: item.key,
      summary: "完成了列表开发，并推进到联调阶段。",
      results: "列表可正常查询，接口验证通过。",
      nextSteps: "",
    })),
    weeks: source.weeks.map((week) => ({
      start: week.start,
      summary: week.reportCount
        ? "本周推进日报功能开发并形成可验证的成果。"
        : "本周暂无日报记录。",
    })),
    closing: "",
  };
}
function input(date = "2026-10-15") {
  return {
    date,
    matters: [
      {
        matterId: "b34cc4e1-2742-4e95-a07f-e397abce5eb1",
        title: "日报开发",
        activity: "完成列表开发",
        result: "接口验证通过",
        completedQuantity: 3,
        unit: "个接口",
        status: "done",
        progress: 100,
      },
    ],
  };
}
beforeEach(() => {
  db = openDatabase(":memory:");
  reports = new DailyReports(db);
  jobs = new Map();
  prompt = "";
  closed = false;
  const engine: ReportAIEngine = {
    generate: (value: unknown) => {
      prompt = (value as { prompt: string }).prompt;
      const job = {
        id: crypto.randomUUID(),
        status: "queued" as const,
        stage: "连接中",
        createdAt: new Date().toISOString(),
      };
      jobs.set(job.id, job);
      return job;
    },
    get: (id: string) => {
      const job = jobs.get(id);
      if (!job) throw new Error("missing job");
      return job;
    },
    cancel: async (id: string) => {
      const job = jobs.get(id)!;
      job.status = "cancelled";
      return job;
    },
    status: async () => ({ ready: true, account: "测试账号", models: [] }),
    signIn: async () => ({ opened: true }),
    close: async () => {
      closed = true;
    },
  };
  ai = new ReportAI(reports, engine);
});
afterEach(async () => {
  await ai.close();
  db.close();
});
test("AI receives authoritative period data, and final text includes validated amounts and outcomes", () => {
  reports.save(null, input(), actor);
  const job = ai.generate({ ...query, note: "简洁一些" }, actor);
  const sent = JSON.parse(prompt);
  expect(sent.report.metrics.quantities).toEqual({ 个接口: 3 });
  expect(sent.additionalWritingRequest).toBe("简洁一些");
  const source = reports.summary(new URLSearchParams(query));
  jobs.get(job.id)!.result = narrative(source);
  jobs.get(job.id)!.status = "completed";
  const result = ai.get(job.id, actor);
  expect(result.status).toBe("completed");
  expect(result.result?.markdown).toContain("期间新增完成量：3 个接口");
  expect(result.result?.markdown).toContain("累计进度：100%");
  expect(result.result?.markdown).toContain("列表可正常查询，接口验证通过");
  expect(result.stale).toBe(false);
});
test("changed source is flagged stale while generation retains original snapshot", () => {
  const saved = reports.save(null, input(), actor),
    job = ai.generate(query, actor),
    source = reports.summary(new URLSearchParams(query));
  const changed = input();
  changed.matters[0]!.completedQuantity = 9;
  reports.save(saved.id, { ...changed, expectedVersion: saved.version }, actor);
  jobs.get(job.id)!.result = narrative(source);
  jobs.get(job.id)!.status = "completed";
  const result = ai.get(job.id, actor);
  expect(result.stale).toBe(true);
  expect(result.result?.markdown).toContain("期间新增完成量：3 个接口");
  expect(result.result?.markdown).not.toContain("9 个接口");
});
test("monthly narrative validates complete week and matter coverage", () => {
  reports.save(null, input(), actor);
  const source = reports.summary(
      new URLSearchParams({ type: "monthly", date: query.date }),
    ),
    text = narrative(source);
  expect(composeAIReport(source, text)).toContain("各周工作与成果");
  expect(composeAIReport(source, text)).toContain("全月事项成果（跨周去重）");
  expect(() => composeAIReport(source, { ...text, weeks: [] })).toThrow(
    "事项或周次",
  );
  expect(() => composeAIReport(source, { ...text, matters: [] })).toThrow(
    "事项或周次",
  );
  expect(() =>
    composeAIReport(source, {
      ...text,
      matters: [...text.matters, ...text.matters],
    }),
  ).toThrow("事项或周次");
});
test("invalid AI output fails instead of showing a fabricated or incomplete report", () => {
  reports.save(null, input(), actor);
  const job = ai.generate(query, actor),
    source = reports.summary(new URLSearchParams(query));
  jobs.get(job.id)!.result = { ...narrative(source), matters: [] };
  jobs.get(job.id)!.status = "completed";
  expect(ai.get(job.id, actor).status).toBe("failed");
  expect(ai.get(job.id, actor).result).toBeUndefined();
});
test("unknown fields, empty periods, oversized instructions and read-only actors cannot start jobs", () => {
  expect(() => ai.generate(query, actor)).toThrow("没有可整理的日报");
  reports.save(null, input(), actor);
  expect(() =>
    ai.generate({ ...query, report: { fake: true } }, actor),
  ).toThrow();
  expect(() =>
    ai.generate({ ...query, note: "长".repeat(2001) }, actor),
  ).toThrow();
  expect(() => ai.generate(query, { ...actor, writable: false })).toThrow(
    "需要写入权限",
  );
  expect(jobs.size).toBe(0);
});
test("jobs are owner scoped; cancellation and shutdown release ownership", async () => {
  reports.save(null, input(), actor);
  const job = ai.generate(query, actor);
  expect(() => ai.get(job.id, { ...actor, identity: "another-user" })).toThrow(
    "任务不存在",
  );
  expect(() => ai.get(job.id, { ...actor, writable: false })).toThrow(
    "需要写入权限",
  );
  expect((await ai.cancel(job.id, actor)).status).toBe("cancelled");
  await ai.close();
  expect(closed).toBe(true);
  expect(() => ai.get(job.id, actor)).toThrow("任务不存在");
});
test("API denies read-only AI operations and cross-workspace job access without starting Codex", async () => {
  const credentials = {
      pairingCode: "report-ai-pairing-code",
      readToken: "report-ai-read-0000000000000000000000",
      writeToken: "report-ai-write-000000000000000000000",
    },
    origin = "http://127.0.0.1:3241",
    app = createTestApp({ credentials, origin });
  const req = (
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
    const space = (
      await (
        await req("/api/v1/workspaces", "POST", { name: "AI报告测试" })
      ).json()
    ).data.id;
    expect(
      (await req("/api/v1/daily-reports/ai/jobs", "POST", query, space)).status,
    ).toBe(400);
    expect(
      (
        await req(
          "/api/v1/daily-reports/ai/jobs",
          "POST",
          query,
          space,
          credentials.readToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await req(
          "/api/v1/daily-reports/ai/status",
          "GET",
          undefined,
          space,
          credentials.readToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await req(
          `/api/v1/daily-reports/ai/jobs/${crypto.randomUUID()}`,
          "GET",
          undefined,
          space,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await req(
          `/api/v1/daily-reports/ai/jobs/${crypto.randomUUID()}/cancel`,
          "POST",
          {},
          space,
        )
      ).status,
    ).toBe(404);
  } finally {
    await app.close();
  }
});
