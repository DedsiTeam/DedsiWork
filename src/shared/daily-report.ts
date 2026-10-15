import { z } from "zod";

export const reportDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, "请输入有效日期");
export const matterStatusLabels = {
  in_progress: "进行中",
  done: "已完成",
  blocked: "有阻碍",
};
export const reportMatterSchema = z
  .object({
    // Stable across days: future weekly reports group by this identity, never by title.
    matterId: z.uuid(),
    workItemId: z.uuid().nullable().default(null),
    title: z.string().trim().min(1, "请填写事项名称").max(200),
    activity: z.string().max(10000).default(""),
    result: z.string().max(10000).default(""),
    status: z.enum(["in_progress", "done", "blocked"]).default("in_progress"),
    completedQuantity: z.number().min(0).max(1e9).nullable().default(null),
    unit: z.string().trim().max(30).default(""),
    progress: z.number().min(0).max(100).nullable().default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.completedQuantity !== null && !value.unit)
      ctx.addIssue({
        code: "custom",
        path: ["unit"],
        message: "填写完成量时需要填写单位",
      });
    if (value.status === "done" && value.progress !== 100)
      ctx.addIssue({
        code: "custom",
        path: ["progress"],
        message: "已完成事项的进度应为 100%",
      });
  });
export const dailyReportInputSchema = z
  .object({
    date: reportDateSchema,
    matters: z
      .array(reportMatterSchema)
      .max(100)
      .default([])
      .refine(
        (items) =>
          new Set(items.map((item) => item.matterId)).size === items.length,
        "同一日报不能重复添加同一事项",
      ),
    completed: z.string().max(20000).default(""),
    ongoing: z.string().max(20000).default(""),
    blockers: z.string().max(20000).default(""),
    tomorrow: z.string().max(20000).default(""),
    notes: z.string().max(20000).default(""),
    // Reserved provenance for future AI drafts; manual editing preserves it.
    generation: z
      .object({
        source: z.enum(["manual", "ai"]),
        model: z.string().max(200).nullable(),
        generatedAt: z.iso.datetime().nullable(),
      })
      .strict()
      .default({ source: "manual", model: null, generatedAt: null }),
  })
  .strict();
export type ReportMatter = z.infer<typeof reportMatterSchema>;
export type DailyReportInput = z.infer<typeof dailyReportInputSchema>;
export type DailyReport = DailyReportInput & {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
export type DailyReportList = {
  data: DailyReport[];
  meta: { total: number; page: number; pageSize: number };
};
export const reportSections = {
  completed: "今日完成",
  ongoing: "进行中的工作",
  blockers: "问题与阻碍",
  tomorrow: "明日计划",
  notes: "补充记录",
} as const;
export function reportMetrics(report: DailyReportInput) {
  const quantities: Record<string, number> = Object.create(null);
  for (const item of report.matters)
    if (item.completedQuantity !== null && item.unit)
      quantities[item.unit] =
        (quantities[item.unit] || 0) + item.completedQuantity;
  return {
    total: report.matters.length,
    done: report.matters.filter((item) => item.status === "done").length,
    quantities,
  };
}
export function reportMarkdown(report: DailyReportInput) {
  const metrics = reportMetrics(report);
  const lines = [
    `# ${report.date} 日报`,
    "",
    `记录 ${metrics.total} 件事项，完成 ${metrics.done} 件。`,
    ...Object.entries(metrics.quantities).map(
      ([unit, count]) => `当日新增完成量：${Number(count.toFixed(6))} ${unit}`,
    ),
    "",
    "## 工作事项",
    "",
  ];
  report.matters.forEach((item, i) =>
    lines.push(
      `### ${i + 1}. ${item.title}`,
      `状态：${matterStatusLabels[item.status]} · 累计进度：${item.progress === null ? "未填写" : `${item.progress}%`}`,
      "",
      `当日新增完成量：${item.completedQuantity === null ? "未填写" : `${item.completedQuantity} ${item.unit}`}`,
      "",
      item.activity && `今日工作：${item.activity}`,
      "",
      item.result && `产出结果：${item.result}`,
      "",
    ),
  );
  for (const [key, label] of Object.entries(reportSections))
    lines.push(
      `## ${label}`,
      "",
      report[key as keyof typeof reportSections] || "（未填写）",
      "",
    );
  return lines.join("\n");
}

// Legacy backups may contain the removed report-level status. Matter status stays intact.
export function parseStoredDailyReport(value: unknown): DailyReportInput {
  const { status: _legacyStatus, ...content } = z
    .object({ status: z.unknown().optional() })
    .passthrough()
    .parse(value);
  return dailyReportInputSchema.parse(content);
}
