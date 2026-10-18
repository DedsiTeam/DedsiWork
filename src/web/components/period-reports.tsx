import { EmptyState } from "./empty-state";
import { DatePicker } from "./date-picker";
import { useReportExport } from "../report-export";
import { ReportAIPanel } from "./report-ai";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Download, Eye, EyeOff, RefreshCw } from "lucide-react";
import { api } from "../api";
import { useWorkspace } from "../workspace-context";
import { Button } from "./ui/button";
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
  const { exporting, exportMarkdown } = useReportExport();
  const { notify } = useWorkspace();
  const [anchor, setAnchor] = useState(localToday()),
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
      `/api/v1/daily-reports/summary?${new URLSearchParams({ type, date: anchor })}`,
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
  }, [type, anchor, revision]);
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
    void exportMarkdown(
      `${report.start}-${report.end}-${label}.md`,
      periodMarkdown(report),
    );
  }
  function matters(items: MatterSummary[]) {
    return !items.length ? (
      <EmptyState
        compact
        title="暂无事项记录"
        description="这个时段的事项会在填写日报后显示。"
      />
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
          <div>
            <DatePicker
              label="周报日期"
              placement="bottom"
              value={anchor}
              onChange={setAnchor}
            />
          </div>
        ) : (
          <div>
            <DatePicker
              label="月报月份"
              mode="month"
              placement="bottom"
              value={anchor.slice(0, 7)}
              onChange={(value) => setAnchor(value ? value + "-01" : "")}
            />
          </div>
        )}
        <Button variant="outline" disabled={!anchor} onClick={() => move(1)}>
          下一{type === "weekly" ? "周" : "月"}
        </Button>
        <Button variant="ghost" onClick={() => setAnchor(localToday())}>
          本{type === "weekly" ? "周" : "月"}
        </Button>
        <Button
          variant="outline"
          onClick={() => setRevision((v) => v + 1)}
          title={"刷新汇总"}
          aria-label={"刷新汇总"}
          size="icon-sm"
        >
          <RefreshCw />
        </Button>
        {!loading && report && (
          <div className="report-actions period-toolbar-actions">
            <Button
              size="icon-sm"
              variant={preview ? "secondary" : "ghost"}
              title={preview ? "返回汇总" : "预览全文"}
              aria-label={preview ? "返回汇总" : "预览全文"}
              aria-pressed={preview}
              onClick={() => setPreview(!preview)}
            >
              {preview ? <EyeOff /> : <Eye />}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title="复制数据汇总"
              aria-label="复制数据汇总"
              onClick={() => void copy()}
            >
              <Copy />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title={exporting ? "请选择保存位置…" : "导出数据汇总"}
              aria-label="导出数据汇总"
              onClick={download}
              disabled={exporting}
            >
              <Download />
            </Button>
          </div>
        )}
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
            <div className="report-metrics">
              <div>
                <strong>{report.metrics.total}</strong>
                <span>涉及事项</span>
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
                <span>本期完成量</span>
              </div>
            </div>
            <details className="report-inline-help">
              <summary>统计口径 · 期末完成 {report.metrics.endDone} 件</summary>
              <p>
                事项按身份去重，完成量累加每日增量，进度取期末记录。首次记录与首次完成均以已有日报为依据，缺失信息不计为零。
              </p>
            </details>
            {(report.metrics.missingQuantityDays > 0 ||
              report.metrics.missingResultDays > 0) && (
              <p className="period-data-warning">
                有 {report.metrics.missingQuantityDays} 个事项日缺少有效完成量，
                {report.metrics.missingResultDays}{" "}
                个事项日缺少产出结果，可打开来源日报补充。
              </p>
            )}
            <ReportAIPanel
              key={`${report.type}:${report.start}`}
              report={report}
            />
            {!report.reportCount && (
              <EmptyState
                title="当前时段暂无日报"
                description="先记录日报，再刷新查看汇总。"
              />
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
                    {report.weeks.map((week, index) =>
                      week.reportCount === 0 ? (
                        <details className="period-empty-week" key={week.start}>
                          <summary>
                            <span>第 {index + 1} 周</span>
                            <span>
                              {week.start} — {week.end}
                            </span>
                            <span>暂无记录</span>
                          </summary>
                          <EmptyState
                            compact
                            title="这一周暂无日报"
                            description="补写日报后即可纳入汇总。"
                          />
                        </details>
                      ) : (
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
                      ),
                    )}
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
                <details className="period-sources">
                  <summary>
                    来源日报与补充记录 <span>{report.sources.length} 份</span>
                  </summary>
                  {report.sources.map((source) => (
                    <details key={source.id} className="period-source">
                      <summary>
                        {source.date} · {source.sections.length} 段补充记录
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
                </details>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
