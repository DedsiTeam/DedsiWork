import { createHash } from "node:crypto";
import { z } from "zod";
import { CodexAppServer } from "../codex/app-server";
import {
  generateReportSchema,
  reportNarrativeSchema,
  reportAIInstructions,
  composeAIReport,
  type ReportNarrative,
  type ReportAIJob,
} from "../../shared/report-ai";
import { AppError } from "../../shared/errors";
import type { Actor } from "./work-items";
import type { DailyReports } from "./daily-reports";
import type { PeriodReport } from "../../shared/period-report";
export type ReportAIEngine = Pick<
  CodexAppServer<ReportNarrative>,
  "generate" | "get" | "cancel" | "status" | "signIn" | "close"
>;
export class ReportAI {
  private jobs = new Map<
    string,
    {
      owner: string;
      createdAt: number;
      query: URLSearchParams;
      source: PeriodReport;
      digest: string;
      generatedAt?: string;
    }
  >();
  constructor(
    private reports: DailyReports,
    private engine: ReportAIEngine = new CodexAppServer<ReportNarrative>(
      "model",
      {
        schema: reportNarrativeSchema,
        requestSchema: z
          .object({
            prompt: z.string().min(1).max(180000),
            model: z.string().optional(),
          })
          .strict(),
        normalize: (value) => reportNarrativeSchema.parse(value),
        instructions: reportAIInstructions,
        label: "工作报告文字",
      },
    ),
  ) {}
  private access(actor: Actor) {
    if (!actor.writable) throw new AppError("FORBIDDEN", "需要写入权限", 403);
  }
  status(actor: Actor) {
    this.access(actor);
    return this.engine.status(actor);
  }
  signIn(actor: Actor) {
    this.access(actor);
    return this.engine.signIn(actor);
  }
  private digest(report: PeriodReport) {
    return createHash("sha256").update(JSON.stringify(report)).digest("hex");
  }
  generate(input: unknown, actor: Actor): ReportAIJob {
    this.access(actor);
    const value = generateReportSchema.parse(input),
      query = new URLSearchParams({
        type: value.type,
        date: value.date,
      }),
      source = this.reports.summary(query);
    if (!source.reportCount)
      throw new AppError(
        "NO_REPORT_DATA",
        "当前周期没有可整理的日报，请先填写日报",
        400,
      );
    // The server loads authoritative data: clients submit filters, never source facts.
    const prompt = JSON.stringify({
      report: source,
      additionalWritingRequest: value.note,
    });
    if (prompt.length > 180000)
      throw new AppError(
        "REPORT_AI_TOO_LARGE",
        "本期资料超过 AI 整理容量，请按周整理或减少日报内容；不会截断数据",
        400,
      );
    for (const [id, meta] of this.jobs)
      if (meta.createdAt < Date.now() - 30 * 60_000) this.jobs.delete(id);
    const job = this.engine.generate(
      { prompt, ...(value.model ? { model: value.model } : {}) },
      actor,
    );
    if (this.jobs.size >= 20) this.jobs.delete(this.jobs.keys().next().value!);
    this.jobs.set(job.id, {
      owner: actor.identity,
      createdAt: Date.now(),
      query,
      source,
      digest: this.digest(source),
    });
    return this.get(job.id, actor);
  }
  get(id: string, actor: Actor): ReportAIJob {
    this.access(actor);
    z.uuid().parse(id);
    const meta = this.jobs.get(id);
    if (!meta || meta.owner !== actor.identity)
      throw new AppError(
        "NOT_FOUND",
        "报告生成任务不存在或已过期，请重新生成",
        404,
      );
    const job = this.engine.get(id, actor),
      { result, ...state } = job,
      stale = this.digest(this.reports.summary(meta.query)) !== meta.digest;
    if (job.status !== "completed" || !result) return { ...state, stale };
    try {
      const markdown = composeAIReport(
        meta.source,
        reportNarrativeSchema.parse(result),
      );
      if (markdown.length > 200000)
        throw new Error("生成文字超过编辑容量，请缩小范围或要求更简洁后重试");
      meta.generatedAt ||= new Date().toISOString();
      return {
        ...state,
        stage: "报告文字已生成",
        stale,
        result: {
          markdown,
          generatedAt: meta.generatedAt,
          sourceDigest: meta.digest,
          sourceReport: {
            type: meta.source.type,
            start: meta.source.start,
            end: meta.source.end,
            reportCount: meta.source.reportCount,
          },
        },
      };
    } catch (e) {
      return {
        ...state,
        status: "failed",
        stage: "生成未完成",
        stale,
        error: (e as Error).message,
      };
    }
  }
  async cancel(id: string, actor: Actor) {
    this.get(id, actor);
    await this.engine.cancel(id, actor);
    return this.get(id, actor);
  }
  async close() {
    this.jobs.clear();
    await this.engine.close();
  }
}
