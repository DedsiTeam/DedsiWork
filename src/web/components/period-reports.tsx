import { ReportAIPanel } from "./report-ai";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Download, RefreshCw } from "lucide-react";
import { api } from "../api";
import { useWorkspace } from "../workspace-context";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { matterStatusLabels } from "../../shared/daily-report";
import {
  addDays,
  periodRange,
  periodMarkdown,
  quantityText,
  type PeriodType,
  type PeriodReport,
  type MatterSummary,
} from "../../shared/period-report";
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function PeriodReports({
  type,
  onOpenReport,
}: {
  type: PeriodType;
  onOpenReport: (id: string) => Promise<void>;
}) {
  const { notify } = useWorkspace();
  const [anchor, setAnchor] = useState(localToday()),
    [finalOnly, setFinalOnly] = useState(false),
    [revision, setRevision] = useState(0);
  const [report, setReport] = useState<PeriodReport | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [preview, setPreview] = useState(false),
    [opening, setOpening] = useState(false);
  const label = type === "weekly" ? "周报" : "月报";
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setReport(null);
    setError("");
    if (!anchor) {
      setLoading(false);
      return;
    }
    api<{ data: PeriodReport }>(
      `/api/v1/daily-reports/summary?${new URLSearchParams({ type, date: anchor, finalOnly: String(finalOnly) })}`,
      { signal: controller.signal },
    )
      .then((r) => setReport(r.data))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [type, anchor, finalOnly, revision]);
  function move(direction: number) {
    const range = periodRange(type, anchor);
    if (type === "weekly") setAnchor(addDays(range.start, direction * 7));
    else {
      const d = new Date(`${range.start}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + direction);
      setAnchor(d.toISOString().slice(0, 10));
    }
  }
  async function open(id: string) {
    if (opening) return;
    setOpening(true);
    try {
      await onOpenReport(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening(false);
    }
  }
  async function copy() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(periodMarkdown(report));
      notify(`${label}数据汇总已复制`);
    } catch {
      notify("复制失败，请使用 Markdown 导出", "error");
    }
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(
        new Blob([periodMarkdown(report)], {
          type: "text/markdown;charset=utf-8",
        }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = `${report.start}-${report.end}-${label}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function matters(items: MatterSummary[]) {
    return !items.length ? (
      <p className="report-help">这个时段没有事项记录。</p>
    ) : (
      items.map((item) => (
        <article className="period-matter" key={item.key}>
          <div className="report-section-heading">
            <h3>{item.title}</h3>
            {item.workItemId && (
              <Link to={`/work-items/${item.workItemId}`}>查看关联工作项</Link>
            )}
          </div>
          <p className="period-matter-summary">
            期末状态：{matterStatusLabels[item.status]} · 累计进度：
            {item.progress === null ? "未填写" : `${item.progress}%`} ·
            期间新增完成量：<strong>{quantityText(item.quantities)}</strong>
          </p>
          {(item.missingQuantityDays > 0 ||
            item.missingResultDays > 0 ||
            item.duplicateDays > 0) && (
            <p className="period-data-warning">
              {item.missingQuantityDays} 个事项日缺少有效完成量，
              {item.missingResultDays} 个事项日缺少产出结果
              {item.duplicateDays > 0
                ? `，${item.duplicateDays} 天存在重复记录，完成量不一致时不计入合计`
                : ""}
              。
            </p>
          )}
          <div className="period-timeline">
            {item.days.map((day, i) => (
              <div key={`${day.reportId}-${i}`} className="period-day">
                <div>
                  <Button
                    variant="link"
                    size="sm"
                    disabled={opening}
                    onClick={() => void open(day.reportId)}
                  >
                    {day.date} · 打开日报
                  </Button>
                  {day.reportStatus === "draft" && (
                    <span className="period-draft">草稿</span>
                  )}
                </div>
                <div className="period-day-content">
                  <div>
                    <span>做了什么</span>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {day.activity || "未填写"}
                    </ReactMarkdown>
                  </div>
                  <div>
                    <span>产出结果</span>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {day.result || "未填写"}
                    </ReactMarkdown>
                  </div>
                  <p>
                    当日新增完成量：
                    {day.completedQuantity === null
                      ? "未填写"
                      : `${day.completedQuantity} ${day.unit}`}{" "}
                    · 累计进度：
                    {day.progress === null ? "未填写" : `${day.progress}%`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </article>
      ))
    );
  }
  return (
    <div className="period-content">
      <div className="report-toolbar">
        <Button variant="outline" disabled={!anchor} onClick={() => move(-1)}>
          上一{type === "weekly" ? "周" : "月"}
        </Button>
        {type === "weekly" ? (
          <label>
            选择周内任意一天
            <Input
              aria-label="周报日期"
              type="date"
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
            />
          </label>
        ) : (
          <label>
            选择月份
            <Input
              aria-label="月报月份"
              type="month"
              value={anchor.slice(0, 7)}
              onChange={(e) =>
                setAnchor(e.target.value ? e.target.value + "-01" : "")
              }
            />
          </label>
        )}
        <Button variant="outline" disabled={!anchor} onClick={() => move(1)}>
          下一{type === "weekly" ? "周" : "月"}
        </Button>
        <Button variant="ghost" onClick={() => setAnchor(localToday())}>
          本{type === "weekly" ? "周" : "月"}
        </Button>
        <label className="period-filter">
          <input
            type="checkbox"
            checked={finalOnly}
            onChange={(e) => setFinalOnly(e.target.checked)}
          />
          仅包含已定稿日报
        </label>
        <Button variant="outline" onClick={() => setRevision((v) => v + 1)}>
          <RefreshCw />
          刷新汇总
        </Button>
      </div>
      {error && (
        <div role="alert" className="message error">
          {error}
        </div>
      )}
      {loading ? (
        <p role="status">正在整理{label}…</p>
      ) : !report ? (
        <p>请选择有效日期。</p>
      ) : (
        <>
          <div className="report-editor period-editor">
            <div className="report-editor-heading">
              <h2>
                {label} · {report.start} 至 {report.end}
              </h2>
              <span>
                {report.reportCount} 份日报 · {report.draftCount} 份草稿
              </span>
            </div>
            <div className="report-actions">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPreview(!preview)}
              >
                {preview ? "返回汇总" : "预览全文"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void copy()}>
                <Copy />
                复制数据汇总
              </Button>
              <Button size="sm" variant="outline" onClick={download}>
                <Download />
                导出数据汇总
              </Button>
            </div>
            <ReportAIPanel
              key={`${report.type}:${report.start}:${report.finalOnly}`}
              report={report}
            />
            <div className="report-metrics">
              <div>
                <strong>{report.metrics.total}</strong>
                <span>涉及事项（去重）</span>
              </div>
              <div>
                <strong>{report.metrics.firstRecorded}</strong>
                <span>本期首次记录</span>
              </div>
              <div>
                <strong>{report.metrics.firstCompleted}</strong>
                <span>本期首次完成</span>
              </div>
              <div>
                <strong>{quantityText(report.metrics.quantities)}</strong>
                <span>期间新增完成量（按单位统计）</span>
              </div>
            </div>
            <p className="report-help">
              期末已完成 {report.metrics.endDone}{" "}
              件。首次记录和首次完成依据已有日报判断；期末状态和进度取本期最后一次记录。完成量只累加每日增量，进度不相加。缺失信息不按零计算。
            </p>
            {(report.metrics.missingQuantityDays > 0 ||
              report.metrics.missingResultDays > 0) && (
              <p className="period-data-warning">
                有 {report.metrics.missingQuantityDays} 个事项日缺少有效完成量，
                {report.metrics.missingResultDays}{" "}
                个事项日缺少产出结果，可打开来源日报补充。
              </p>
            )}
            {!report.reportCount && (
              <p className="report-add-hint">
                当前时段没有{finalOnly ? "已定稿" : ""}
                日报。先记录日报，再刷新汇总。
              </p>
            )}
            {preview ? (
              <article className="report-preview">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {periodMarkdown(report)}
                </ReactMarkdown>
              </article>
            ) : (
              <>
                {type === "weekly" ? (
                  <>
                    <h2 className="period-heading">按事项整理每日工作</h2>
                    {matters(report.matters)}
                  </>
                ) : (
                  <>
                    {report.weeks.map((week, index) => (
                      <section className="period-week" key={week.start}>
                        <div className="report-section-heading">
                          <h2>
                            第 {index + 1} 周 · {week.start} 至 {week.end}
                          </h2>
                          <span>
                            {week.reportCount} 份日报 · {week.matters.length}{" "}
                            件事项
                          </span>
                        </div>
                        {matters(week.matters)}
                      </section>
                    ))}
                    <section>
                      <h2 className="period-heading">
                        全月事项汇总（跨周去重）
                      </h2>
                      <div className="period-overview">
                        {report.matters.map((item) => (
                          <div key={item.key}>
                            <strong>{item.title}</strong>
                            <span>
                              {matterStatusLabels[item.status]} ·{" "}
                              {item.progress === null
                                ? "进度未填写"
                                : `${item.progress}%`}
                            </span>
                            <span>{quantityText(item.quantities)}</span>
                            <span>
                              {item.days
                                .filter((day) => day.result.trim())
                                .map((day) => `${day.date}：${day.result}`)
                                .join("；") || "产出结果未填写"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </section>
                  </>
                )}
                <section>
                  <h2 className="period-heading">来源日报与补充记录</h2>
                  {report.sources.map((source) => (
                    <details key={source.id} className="period-source">
                      <summary>
                        {source.date} ·{" "}
                        {source.status === "draft" ? "草稿" : "已定稿"} ·{" "}
                        {source.sections.length} 段补充记录
                      </summary>
                      <Button
                        variant="link"
                        disabled={opening}
                        onClick={() => void open(source.id)}
                      >
                        打开日报
                      </Button>
                      {source.sections.map((section) => (
                        <div key={section.label}>
                          <h4>{section.label}</h4>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {section.content}
                          </ReactMarkdown>
                        </div>
                      ))}
                    </details>
                  ))}
                </section>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
