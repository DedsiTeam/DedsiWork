import { z } from "zod";
import {
  reportDateSchema,
  matterStatusLabels,
  type DailyReport,
  type ReportMatter,
} from "./daily-report";
export const periodQuerySchema = z
  .object({
    type: z.enum(["weekly", "monthly"]),
    date: reportDateSchema,
    finalOnly: z.enum(["true", "false"]).default("false"),
  })
  .strict();
export type PeriodType = "weekly" | "monthly";
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function weekStart(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -(day + 6) % 7);
}
export function periodRange(type: PeriodType, date: string) {
  reportDateSchema.parse(date);
  if (type === "weekly") {
    const start = weekStart(date);
    return { start, end: addDays(start, 6) };
  }
  const start = date.slice(0, 7) + "-01",
    d = new Date(`${start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return { start, end: addDays(d.toISOString().slice(0, 10), -1) };
}
export function matterIdentity(reports: Pick<DailyReport, "matters">[]) {
  const links = new Map<string, string>();
  for (const report of reports)
    for (const item of report.matters)
      if (item.workItemId) links.set(item.matterId, item.workItemId);
  return (item: ReportMatter) => {
    const workId = item.workItemId || links.get(item.matterId);
    return workId ? `work:${workId}` : `matter:${item.matterId}`;
  };
}
export type ReportObservation = ReportMatter & {
  reportId: string;
  date: string;
  reportStatus: DailyReport["status"];
};
export type MatterSummary = {
  key: string;
  title: string;
  workItemId: string | null;
  status: ReportMatter["status"];
  progress: number | null;
  quantities: Record<string, number>;
  missingQuantityDays: number;
  missingResultDays: number;
  duplicateDays: number;
  firstRecordedAt: string;
  firstCompletedAt: string | null;
  days: ReportObservation[];
};
export type PeriodGroup = {
  start: string;
  end: string;
  matters: MatterSummary[];
  reportCount: number;
  draftCount: number;
};
export type PeriodReport = PeriodGroup & {
  type: PeriodType;
  finalOnly: boolean;
  weeks: PeriodGroup[];
  metrics: {
    total: number;
    firstRecorded: number;
    firstCompleted: number;
    endDone: number;
    quantities: Record<string, number>;
    missingQuantityDays: number;
    missingResultDays: number;
    duplicateDays: number;
  };
  sources: {
    id: string;
    date: string;
    status: DailyReport["status"];
    sections: { label: string; content: string }[];
  }[];
};
function summarize(
  rows: ReportObservation[],
  prior: ReportObservation[],
  identity: ReturnType<typeof matterIdentity>,
): MatterSummary[] {
  const historyByKey = new Map<string, ReportObservation[]>();
  for (const row of prior) {
    const key = identity(row);
    if (!historyByKey.has(key)) historyByKey.set(key, []);
    historyByKey.get(key)!.push(row);
  }
  const groups = new Map<string, ReportObservation[]>();
  for (const row of rows) {
    const key = identity(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return [...groups].map(([key, days]) => {
    const history = historyByKey.get(key)!,
      latest = days.at(-1)!;
    const firstCompleted = history.find((row) => row.status === "done");
    const quantities: Record<string, number> = Object.create(null);
    const byDate = new Map<string, ReportObservation[]>();
    for (const day of days) {
      if (!byDate.has(day.date)) byDate.set(day.date, []);
      byDate.get(day.date)!.push(day);
    }
    let missingQuantityDays = 0,
      missingResultDays = 0,
      duplicateDays = 0;
    for (const daily of byDate.values()) {
      // Legacy aliases may coexist on one date. Count equal quantities once;
      // inconsistent aliases remain visible but are excluded from totals.
      const day = daily[0]!,
        conflict = daily.some(
          (row) =>
            row.completedQuantity !== day.completedQuantity ||
            row.unit !== day.unit,
        );
      if (daily.length > 1) duplicateDays++;
      if (!daily.some((row) => row.result.trim())) missingResultDays++;
      if (day.completedQuantity === null || conflict) missingQuantityDays++;
      else
        quantities[day.unit] =
          (quantities[day.unit] || 0) + day.completedQuantity;
    }
    return {
      key,
      title: latest.title,
      workItemId:
        days.find((row) => row.workItemId)?.workItemId ||
        history.find((row) => row.workItemId)?.workItemId ||
        null,
      status: latest.status,
      progress: latest.progress,
      quantities,
      missingQuantityDays,
      missingResultDays,
      duplicateDays,
      firstRecordedAt: history[0]!.date,
      firstCompletedAt: firstCompleted?.date || null,
      days,
    };
  });
}
export function buildPeriodReport(
  reports: DailyReport[],
  type: PeriodType,
  date: string,
  finalOnly = false,
): PeriodReport {
  const { start, end } = periodRange(type, date),
    identity = matterIdentity(reports.filter((r) => !r.deletedAt));
  const eligible = reports
    .filter(
      (r) =>
        !r.deletedAt && r.date <= end && (!finalOnly || r.status === "final"),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const observations = eligible.flatMap((report) =>
    report.matters.map((item) => ({
      ...item,
      reportId: report.id,
      date: report.date,
      reportStatus: report.status,
    })),
  );
  const source = eligible.filter((report) => report.date >= start);
  function group(a: string, b: string): PeriodGroup {
    const selected = source.filter((r) => r.date >= a && r.date <= b);
    return {
      start: a,
      end: b,
      matters: summarize(
        observations.filter((row) => row.date >= a && row.date <= b),
        observations.filter((row) => row.date <= b),
        identity,
      ),
      reportCount: selected.length,
      draftCount: selected.filter((r) => r.status === "draft").length,
    };
  }
  const main = group(start, end),
    quantities: Record<string, number> = Object.create(null);
  for (const item of main.matters)
    for (const [unit, n] of Object.entries(item.quantities))
      quantities[unit] = (quantities[unit] || 0) + n;
  const weeks: PeriodGroup[] = [];
  if (type === "monthly")
    for (let a = weekStart(start); a <= end; a = addDays(a, 7)) {
      const b = addDays(a, 6);
      weeks.push(group(a < start ? start : a, b > end ? end : b));
    }
  const sectionNames = {
    completed: "今日完成",
    ongoing: "进行中的工作",
    blockers: "问题与阻碍",
    tomorrow: "明日计划",
    notes: "补充记录",
  } as const;
  return {
    ...main,
    type,
    finalOnly,
    weeks,
    metrics: {
      total: main.matters.length,
      firstRecorded: main.matters.filter((m) => m.firstRecordedAt >= start)
        .length,
      firstCompleted: main.matters.filter(
        (m) =>
          m.firstCompletedAt &&
          m.firstCompletedAt >= start &&
          m.firstCompletedAt <= end,
      ).length,
      endDone: main.matters.filter((m) => m.status === "done").length,
      quantities,
      missingQuantityDays: main.matters.reduce(
        (n, m) => n + m.missingQuantityDays,
        0,
      ),
      missingResultDays: main.matters.reduce(
        (n, m) => n + m.missingResultDays,
        0,
      ),
      duplicateDays: main.matters.reduce((n, m) => n + m.duplicateDays, 0),
    },
    sources: source.map((r) => ({
      id: r.id,
      date: r.date,
      status: r.status,
      sections: Object.entries(sectionNames)
        .filter(([key]) => r[key as keyof typeof sectionNames].trim())
        .map(([key, label]) => ({
          label,
          content: r[key as keyof typeof sectionNames],
        })),
    })),
  };
}
export function quantityText(quantities: Record<string, number>) {
  return (
    Object.entries(quantities)
      .map(([unit, n]) => `${Number(n.toFixed(6))} ${unit}`)
      .join(" / ") || "未填写"
  );
}
export function periodMarkdown(report: PeriodReport) {
  const m = report.metrics,
    label = report.type === "weekly" ? "周报" : "月报";
  const lines = [
    `# ${label} · ${report.start} 至 ${report.end}`,
    "",
    `来源：${report.reportCount} 份日报（${report.draftCount} 份草稿），${report.finalOnly ? "仅定稿" : "包含草稿"}。`,
    `涉及 ${m.total} 件事项（去重）；本期首次记录 ${m.firstRecorded} 件；本期首次完成 ${m.firstCompleted} 件；期末已完成 ${m.endDone} 件。`,
    `期间新增完成量：${quantityText(m.quantities)}`,
    "",
    "首次记录与首次完成均依据已有日报；期末状态和进度取本期最后记录。未填写不计为零；不同单位分别统计。",
    "",
  ];
  function matters(items: MatterSummary[], heading: string) {
    lines.push(heading, "");
    if (!items.length) lines.push("暂无事项记录。", "");
    for (const item of items) {
      lines.push(
        `### ${item.title}`,
        "",
        `期末状态：${matterStatusLabels[item.status]} · 累计进度：${item.progress === null ? "未填写" : `${item.progress}%`}`,
        "",
        `期间新增完成量：${quantityText(item.quantities)}`,
        "",
      );
      if (
        item.missingQuantityDays ||
        item.missingResultDays ||
        item.duplicateDays
      )
        lines.push(
          `待补充/核对：${item.missingQuantityDays} 个事项日缺少有效完成量，${item.missingResultDays} 个事项日缺少结果，${item.duplicateDays} 天有重复记录。`,
          "",
        );
      for (const day of item.days)
        lines.push(
          `- ${day.date}${day.reportStatus === "draft" ? "（草稿）" : ""}：${day.activity || "未填写工作内容"}`,
          `  - 产出结果：${day.result || "未填写"}`,
          `  - 当日新增完成量：${day.completedQuantity === null ? "未填写" : `${day.completedQuantity} ${day.unit}`}；累计进度：${day.progress === null ? "未填写" : `${day.progress}%`}`,
          "",
        );
    }
  }
  if (report.type === "monthly") {
    for (const [i, week] of report.weeks.entries())
      matters(week.matters, `## 第 ${i + 1} 周 · ${week.start} 至 ${week.end}`);
    matters(report.matters, "## 全月事项汇总（跨周去重）");
  } else matters(report.matters, "## 按事项整理每日工作");
  lines.push("## 日报补充记录", "");
  for (const source of report.sources)
    if (source.sections.length) {
      lines.push(`### ${source.date}`, "");
      for (const section of source.sections)
        lines.push(`#### ${section.label}`, "", section.content, "");
    }
  return lines.join("\n");
}
