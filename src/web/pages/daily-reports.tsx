import { DatePicker } from "../components/date-picker";
import { useReportExport } from "../report-export";
import * as Dialog from "@radix-ui/react-dialog";
import { addDays } from "../../shared/period-report";
import { PeriodReports } from "../components/period-reports";
import { ReportWorkItemPicker } from "../components/report-work-item-picker";
import type { WorkItem } from "../../shared/work-item";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useBlocker } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CalendarDays, Plus, Trash2, Copy, Download, Save } from "lucide-react";
import { api } from "../api";
import { useWorkspace } from "../workspace-context";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import {
  dailyReportInputSchema,
  reportDateSchema,
  reportMarkdown,
  reportMetrics,
  reportSections,
  matterStatusLabels,
  type DailyReport,
  type DailyReportInput,
  type DailyReportList,
  type ReportMatter,
} from "../../shared/daily-report";
import "../daily-reports.css";
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function blankMatter(): ReportMatter {
  return {
    matterId: crypto.randomUUID(),
    workItemId: null,
    title: "",
    activity: "",
    result: "",
    status: "in_progress",
    completedQuantity: null,
    unit: "",
    progress: null,
  };
}
function content(report: DailyReport): DailyReportInput {
  const {
    id: _,
    version: __,
    createdAt: ___,
    updatedAt: ____,
    deletedAt: _____,
    ...value
  } = report;
  return value;
}
export function DailyReportsPage() {
  const { workspace } = useWorkspace();
  return <DailyReportsView key={workspace?.id} />;
}
function DailyReportsView() {
  const { exporting, exportMarkdown } = useReportExport();
  const { notify } = useWorkspace();
  const [mode, setMode] = useState<"daily" | "weekly" | "monthly">("daily");
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillDate, setBackfillDate] = useState(() => addDays(today(), -1));
  const [backfillError, setBackfillError] = useState("");
  const [linkTarget, setLinkTarget] = useState<number | "new" | null>(null);
  const [list, setList] = useState<DailyReportList>({
    data: [],
    meta: { total: 0, page: 1, pageSize: 20 },
  });
  const [search, setSearch] = useState(""),
    [month, setMonth] = useState(""),
    [trash, setTrash] = useState(false),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true),
    [listError, setListError] = useState("");
  const [selected, setSelected] = useState<DailyReport | null>(null),
    [form, setForm] = useState<DailyReportInput | null>(null),
    [saved, setSaved] = useState("");
  const [saveState, setSaveState] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false);
  const [history, setHistory] = useState<ReportMatter[]>([]),
    [historyOpen, setHistoryOpen] = useState(false);
  const formRef = useRef(form),
    recordRef = useRef(selected),
    savedRef = useRef(saved),
    pending = useRef<Promise<boolean> | null>(null),
    alive = useRef(true);
  formRef.current = form;
  recordRef.current = selected;
  savedRef.current = saved;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const dirty = !!form && JSON.stringify(form) !== saved;
  const blocker = useBlocker(dirty || busy);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setListError("");
      const query = new URLSearchParams({
        q: search,
        deleted: String(trash),
        page: String(page),
        ...(month ? { month } : {}),
      });
      api<DailyReportList>(`/api/v1/daily-reports?${query}`, {
        signal: controller.signal,
      })
        .then(setList)
        .catch((e) => {
          if (!controller.signal.aborted) setListError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, month, trash, page, revision]);
  const flush = useCallback(async function save(): Promise<boolean> {
    if (pending.current) {
      const ok = await pending.current;
      return ok ? save() : false;
    }
    const value = formRef.current,
      record = recordRef.current;
    if (
      !value ||
      !record ||
      record.deletedAt ||
      JSON.stringify(value) === savedRef.current
    )
      return true;
    const parsed = dailyReportInputSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join("；"));
      setSaveState("保存失败");
      return false;
    }
    const serialized = JSON.stringify(value);
    setSaveState("保存中…");
    setError("");
    const request = (async () => {
      try {
        const result = await api<{ data: DailyReport }>(
          `/api/v1/daily-reports/${record.id}`,
          {
            method: "PUT",
            body: JSON.stringify({
              ...parsed.data,
              expectedVersion: record.version,
            }),
          },
        );
        if (!alive.current) return false;
        recordRef.current = result.data;
        savedRef.current = serialized;
        setSelected(result.data);
        setSaved(serialized);
        setSaveState("已保存");
        setRevision((v) => v + 1);
        return true;
      } catch (e) {
        if (alive.current) {
          setError((e as Error).message);
          setSaveState("保存失败");
        }
        return false;
      } finally {
        pending.current = null;
      }
    })();
    pending.current = request;
    return request;
  }, []);
  useEffect(() => {
    if (!dirty || selected?.deletedAt) return;
    setSaveState("等待保存…");
    const timer = setTimeout(() => void flush(), 1000);
    return () => clearTimeout(timer);
  }, [form, dirty, selected?.deletedAt, flush]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function install(report: DailyReport) {
    const next = content(report),
      serialized = JSON.stringify(next);
    recordRef.current = report;
    formRef.current = next;
    savedRef.current = serialized;
    setSelected(report);
    setForm(next);
    setSaved(serialized);
    setSaveState(report.deletedAt ? "回收站中的日报" : "已保存");
    setError("");
    setPreview(false);
    setHistoryOpen(false);
  }
  async function open(report: DailyReport) {
    if (busy) return;
    setBusy(true);
    try {
      if (await flush())
        install(
          (
            await api<{ data: DailyReport }>(
              `/api/v1/daily-reports/${report.id}`,
            )
          ).data,
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create(date = today()) {
    if (busy) return false;
    setBusy(true);
    try {
      if (!(await flush())) return false;
      const matches = await api<DailyReportList>(
          `/api/v1/daily-reports?date=${date}`,
        ),
        existing = matches.data.find((r) => r.date === date);
      const report =
        existing ||
        (
          await api<{ data: DailyReport }>("/api/v1/daily-reports", {
            method: "POST",
            body: JSON.stringify(dailyReportInputSchema.parse({ date })),
          })
        ).data;
      install(report);
      setTrash(false);
      setMonth("");
      setSearch("");
      setPage(1);
      setRevision((v) => v + 1);
      if (existing) notify(`${date} 已有日报，已为你打开`);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function lifecycle() {
    if (!selected || busy) return;
    if (
      !selected.deletedAt &&
      !window.confirm(`将 ${selected.date} 日报移入回收站？可以随时恢复。`)
    )
      return;
    setBusy(true);
    try {
      if (!(await flush())) return;
      const record = recordRef.current!,
        restored = !!record.deletedAt;
      await api(
        `/api/v1/daily-reports/${record.id}${restored ? "/restore" : ""}`,
        {
          method: restored ? "POST" : "DELETE",
          body: JSON.stringify({ expectedVersion: record.version }),
        },
      );
      setForm(null);
      setSelected(null);
      formRef.current = null;
      recordRef.current = null;
      setError("");
      setPage(1);
      setRevision((v) => v + 1);
      notify(restored ? "日报已恢复" : "日报已移入回收站");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function change<K extends keyof DailyReportInput>(
    key: K,
    value: DailyReportInput[K],
  ) {
    setForm((prev) => prev && { ...prev, [key]: value });
  }
  function changeMatter(index: number, patch: Partial<ReportMatter>) {
    if (form)
      change(
        "matters",
        form.matters.map((item, i) =>
          i === index ? { ...item, ...patch } : item,
        ),
      );
  }
  async function loadHistory() {
    if (!form || busy) return;
    setBusy(true);
    try {
      const unique = new Map<string, ReportMatter>();
      let p = 1,
        total = 1;
      while ((p - 1) * 20 < total) {
        const result = await api<DailyReportList>(
          `/api/v1/daily-reports?page=${p++}`,
        );
        total = result.meta.total;
        for (const report of result.data)
          if (report.date < form.date)
            for (const item of report.matters)
              if (!unique.has(item.matterId)) unique.set(item.matterId, item);
      }
      setHistory(
        [...unique.values()].filter(
          (item) =>
            !form.matters.some((current) => current.matterId === item.matterId),
        ),
      );
      setHistoryOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!form) return;
    try {
      await navigator.clipboard.writeText(reportMarkdown(form));
      notify("日报已复制");
    } catch {
      notify("复制失败，请使用 Markdown 导出", "error");
    }
  }
  function download() {
    if (!form) return;
    void exportMarkdown(`${form.date}-日报.md`, reportMarkdown(form));
  }
  async function switchMode(next: typeof mode) {
    if (busy) return;
    setBusy(true);
    try {
      if (await flush()) setMode(next);
    } finally {
      setBusy(false);
    }
  }
  function linkWorkItem(item: WorkItem) {
    if (!form || linkTarget === null) return;
    if (
      form.matters.some(
        (matter, i) =>
          i !== linkTarget &&
          (matter.workItemId === item.id || matter.matterId === item.id),
      )
    ) {
      notify("这份日报已记录该工作项，请在已有事项中补充", "error");
      return;
    }
    if (linkTarget === "new")
      change("matters", [
        ...form.matters,
        {
          ...blankMatter(),
          matterId: item.id,
          workItemId: item.id,
          title: item.title,
        },
      ]);
    else
      changeMatter(linkTarget, {
        workItemId: item.id,
        ...(form.matters[linkTarget]?.title ? {} : { title: item.title }),
      });
    setLinkTarget(null);
  }
  const metrics = form ? reportMetrics(form) : null;
  return (
    <div className="workspace-content reports-content">
      <nav className="report-tabs" aria-label="报告类型">
        {(["daily", "weekly", "monthly"] as const).map((value) => (
          <Button
            key={value}
            variant={mode === value ? "default" : "ghost"}
            aria-pressed={mode === value}
            disabled={busy}
            onClick={() => void switchMode(value)}
          >
            {{ daily: "日报", weekly: "周报", monthly: "月报" }[value]}
          </Button>
        ))}
      </nav>
      {mode !== "daily" && (
        <PeriodReports
          key={mode}
          type={mode}
          onOpenReport={async (id) => {
            const result = await api<{ data: DailyReport }>(
              `/api/v1/daily-reports/${id}`,
            );
            install(result.data);
            setMode("daily");
            setTrash(false);
            setMonth("");
            setSearch("");
            setPage(1);
          }}
        />
      )}
      <div hidden={mode !== "daily"}>
        <div className="page-heading">
          <div>
            <h1>日报管理</h1>
            <p className="report-subtitle">记录进展，沉淀成果。</p>
          </div>
          <div className="report-heading-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBackfillDate(addDays(today(), -1));
                setBackfillError("");
                setBackfillOpen(true);
              }}
            >
              <CalendarDays />
              补写日报
            </Button>
            <Button onClick={() => void create()} disabled={busy}>
              <Plus />
              写今日日报
            </Button>
          </div>
        </div>
        <div className="report-toolbar">
          <Input
            aria-label="搜索日报"
            placeholder="搜索事项、结果或正文…"
            value={search}
            maxLength={200}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <DatePicker
            label="按月份筛选"
            mode="month"
            placement="bottom"
            clearable
            value={month}
            onChange={(value) => {
              setMonth(value);
              setPage(1);
            }}
          />
          <Button
            variant="outline"
            onClick={() => {
              setMonth("");
              setSearch("");
              setPage(1);
            }}
          >
            清除筛选
          </Button>
          <Button
            variant={trash ? "default" : "outline"}
            onClick={() => {
              setTrash(!trash);
              setPage(1);
            }}
          >
            {trash ? "返回日报" : "回收站"}
          </Button>
        </div>
        {error && (
          <div className="message error" role="alert">
            {error}
            <Button
              variant="ghost"
              onClick={() => void flush()}
              disabled={busy}
            >
              重试保存
            </Button>
          </div>
        )}
        <div className="report-layout">
          <aside className="report-list" aria-label="日报列表">
            <div className="report-list-heading">
              {trash ? "回收站" : "全部日报"}
              <span>{list.meta.total} 份</span>
            </div>
            {listError ? (
              <div role="alert">
                {listError}
                <Button
                  variant="ghost"
                  onClick={() => setRevision((v) => v + 1)}
                >
                  重试
                </Button>
              </div>
            ) : loading ? (
              <p role="status">正在加载…</p>
            ) : !list.data.length ? (
              <p className="report-empty-small">
                {trash ? "回收站为空" : "暂无日报，开始记录今天的工作吧。"}
              </p>
            ) : (
              list.data.map((report) => {
                const m = reportMetrics(report);
                return (
                  <button
                    type="button"
                    key={report.id}
                    disabled={busy}
                    className={`report-list-item ${selected?.id === report.id ? "is-selected" : ""}`}
                    onClick={() => void open(report)}
                  >
                    <div>
                      <strong>{report.date}</strong>
                    </div>
                    <p>
                      {report.matters.map((item) => item.title).join("、") ||
                        report.completed ||
                        "还没有填写工作记录"}
                    </p>
                    <small>
                      {m.total} 件事项 · {m.done} 件完成
                    </small>
                  </button>
                );
              })
            )}
            <div className="report-pagination">
              <Button
                size="sm"
                variant="ghost"
                disabled={page <= 1}
                onClick={() => setPage((v) => v - 1)}
              >
                上一页
              </Button>
              <span>
                {page}/{Math.max(1, Math.ceil(list.meta.total / 20))}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={page * 20 >= list.meta.total}
                onClick={() => setPage((v) => v + 1)}
              >
                下一页
              </Button>
            </div>
          </aside>
          <section className="report-editor" aria-label="日报详情">
            {!form ? (
              <div className="report-empty">
                <CalendarDays size={36} />
                <h2>把今天的进展留下来</h2>
                <p>选择一份日报，或点击“写今日日报”开始记录。</p>
                <p>按事项记录成果和完成量，为后续周报、月报积累素材。</p>
              </div>
            ) : (
              <>
                <div className="report-document-header">
                  <div className="report-editor-heading">
                    <div className="report-document-title">
                      <DatePicker
                        label="日报日期"
                        placement="bottom"
                        value={form.date}
                        disabled={busy || !!selected?.deletedAt}
                        onChange={(value) => change("date", value)}
                      />
                      <h2>日报</h2>
                    </div>
                    <span role="status">{saveState}</span>
                  </div>
                  <div className="report-actions report-document-actions">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPreview(!preview)}
                    >
                      {preview ? "继续编辑" : "预览"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void copy()}
                    >
                      <Copy />
                      复制日报
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={download}
                      disabled={exporting}
                    >
                      <Download />
                      {exporting ? "请选择保存位置…" : "导出 Markdown"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void lifecycle()}
                    >
                      <Trash2 />
                      {selected?.deletedAt ? "恢复" : "删除"}
                    </Button>
                  </div>
                </div>
                {metrics && (
                  <div className="report-metrics">
                    <div>
                      <strong>{metrics.total}</strong>
                      <span>记录事项</span>
                    </div>
                    <div>
                      <strong>{metrics.done}</strong>
                      <span>已完成事项</span>
                    </div>
                    <div>
                      <strong>
                        {Object.entries(metrics.quantities)
                          .map(([unit, n]) => `${Number(n.toFixed(6))} ${unit}`)
                          .join(" / ") || "未填写"}
                      </strong>
                      <span>今日完成量</span>
                    </div>
                  </div>
                )}
                {preview ? (
                  <article className="report-preview">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {reportMarkdown(form)}
                    </ReactMarkdown>
                  </article>
                ) : (
                  <fieldset
                    className="report-fields"
                    disabled={busy || !!selected?.deletedAt}
                  >
                    <div className="report-section-heading">
                      <h3>工作事项</h3>
                      <div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void loadHistory()}
                        >
                          接续历史事项
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={form.matters.length >= 100}
                          onClick={() => setLinkTarget("new")}
                        >
                          从工作项添加
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            change("matters", [...form.matters, blankMatter()])
                          }
                          disabled={form.matters.length >= 100}
                        >
                          <Plus />
                          添加事项
                        </Button>
                      </div>
                    </div>
                    <details className="report-inline-help">
                      <summary>如何记录完成量？</summary>
                      <p>
                        完成量填写当天新增数量，进度填写累计百分比。同一事项跨天推进时，使用“接续历史事项”。
                      </p>
                    </details>
                    {historyOpen && (
                      <div className="report-history">
                        <div className="report-section-heading">
                          <strong>选择要接续的事项</strong>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setHistoryOpen(false)}
                          >
                            关闭
                          </Button>
                        </div>
                        {!history.length && <p>没有可接续的历史事项。</p>}
                        {history.map((item) => (
                          <Button
                            key={item.matterId}
                            size="sm"
                            variant="outline"
                            disabled={form.matters.length >= 100}
                            onClick={() => {
                              change("matters", [
                                ...form.matters,
                                {
                                  ...item,
                                  activity: "",
                                  result: "",
                                  completedQuantity: null,
                                },
                              ]);
                              setHistory((items) =>
                                items.filter(
                                  (m) => m.matterId !== item.matterId,
                                ),
                              );
                            }}
                          >
                            {item.title} · {matterStatusLabels[item.status]}
                          </Button>
                        ))}
                      </div>
                    )}
                    {form.matters.map((item, index) => (
                      <div className="report-matter" key={item.matterId}>
                        <div className="report-matter-title">
                          <span>{index + 1}</span>
                          <Input
                            aria-label={`事项 ${index + 1} 名称`}
                            placeholder="事项名称，例如：日报管理功能开发"
                            value={item.title}
                            maxLength={200}
                            onChange={(e) =>
                              changeMatter(index, { title: e.target.value })
                            }
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`移除事项 ${index + 1}`}
                            onClick={() =>
                              change(
                                "matters",
                                form.matters.filter((_, i) => i !== index),
                              )
                            }
                          >
                            <Trash2 />
                          </Button>
                        </div>
                        <div className="report-matter-link">
                          {item.workItemId && (
                            <>
                              <Link to={`/work-items/${item.workItemId}`}>
                                查看关联工作项 · {item.workItemId.slice(0, 8)}
                              </Link>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  changeMatter(index, { workItemId: null })
                                }
                              >
                                解除关联
                              </Button>
                            </>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setLinkTarget(index)}
                          >
                            {item.workItemId ? "更换工作项" : "关联工作项"}
                          </Button>
                        </div>
                        <div className="report-matter-text">
                          <label>
                            今天做了什么
                            <Textarea
                              value={item.activity}
                              maxLength={10000}
                              placeholder="例如：完成列表页、接入查询接口"
                              onChange={(e) =>
                                changeMatter(index, {
                                  activity: e.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            产出结果
                            <Textarea
                              value={item.result}
                              maxLength={10000}
                              placeholder="例如：列表可按日期查询，已通过接口验证"
                              onChange={(e) =>
                                changeMatter(index, { result: e.target.value })
                              }
                            />
                          </label>
                        </div>
                        <div className="report-matter-numbers">
                          <label>
                            事项状态
                            <select
                              value={item.status}
                              onChange={(e) => {
                                const status = e.target
                                  .value as ReportMatter["status"];
                                changeMatter(index, {
                                  status,
                                  progress:
                                    status === "done" ? 100 : item.progress,
                                });
                              }}
                            >
                              {Object.entries(matterStatusLabels).map(
                                ([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                          <label>
                            当日新增完成量
                            <Input
                              type="number"
                              min={0}
                              max={1e9}
                              step="any"
                              value={item.completedQuantity ?? ""}
                              onChange={(e) =>
                                changeMatter(index, {
                                  completedQuantity:
                                    e.target.value === ""
                                      ? null
                                      : Number(e.target.value),
                                })
                              }
                            />
                          </label>
                          <label>
                            单位
                            <Input
                              placeholder="个接口 / 篇文档"
                              maxLength={30}
                              value={item.unit}
                              onChange={(e) =>
                                changeMatter(index, { unit: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            累计进度（%）
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step="any"
                              value={item.progress ?? ""}
                              disabled={item.status === "done"}
                              onChange={(e) =>
                                changeMatter(index, {
                                  progress:
                                    e.target.value === ""
                                      ? null
                                      : Number(e.target.value),
                                })
                              }
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                    {!form.matters.length && (
                      <div className="report-add-hint">
                        添加事项，记录每件事情的结果和完成情况。
                      </div>
                    )}
                    <section
                      className="report-supplements"
                      aria-label="日报补充内容"
                    >
                      <h3>
                        补充内容 <span>按需填写</span>
                      </h3>
                      {Object.entries(reportSections).map(([key, label]) => (
                        <details
                          className="report-supplement"
                          key={`${selected?.id}:${key}`}
                          defaultOpen={Boolean(
                            form[key as keyof typeof reportSections],
                          )}
                        >
                          <summary>
                            {label}
                            {form[key as keyof typeof reportSections] && (
                              <span>已填写</span>
                            )}
                          </summary>
                          <label className="report-section">
                            <span className="sr-only">{label}</span>
                            <Textarea
                              value={form[key as keyof typeof reportSections]}
                              maxLength={20000}
                              placeholder={`补充${label}…`}
                              onChange={(event) =>
                                change(
                                  key as keyof typeof reportSections,
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                        </details>
                      ))}
                    </section>
                    <div className="report-bottom">
                      <span>修改后自动保存 · 空白数量表示未填写，不计为 0</span>
                      <Button onClick={() => void flush()} disabled={!dirty}>
                        <Save />
                        立即保存
                      </Button>
                    </div>
                  </fieldset>
                )}
              </>
            )}
          </section>
        </div>
      </div>
      <Dialog.Root
        open={backfillOpen}
        onOpenChange={(open) => {
          if (!busy) setBackfillOpen(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="confirmation-content">
            <Dialog.Title>补写日报</Dialog.Title>
            <Dialog.Description>
              选择需要补充的日期，默认昨天。该日期已有日报时会打开已有记录，今天的日报保留。
            </Dialog.Description>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (
                  !reportDateSchema.safeParse(backfillDate).success ||
                  backfillDate > today()
                ) {
                  setBackfillError("请选择今天或更早的有效日期");
                  return;
                }
                setBackfillError("");
                if (await create(backfillDate)) setBackfillOpen(false);
              }}
            >
              <label className="report-backfill-date">
                补写日期
                <DatePicker
                  label="补写日期"
                  placement="bottom"
                  max={today()}
                  value={backfillDate}
                  disabled={busy}
                  onChange={(value) => {
                    setBackfillDate(value);
                    setBackfillError("");
                  }}
                />
              </label>
              {(backfillError || error) && (
                <p role="alert" className="message error">
                  {backfillError || error}
                </p>
              )}
              <div className="confirmation-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setBackfillOpen(false)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={busy || !backfillDate}>
                  {busy ? "正在打开…" : "开始补写"}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {linkTarget !== null && (
        <ReportWorkItemPicker
          onClose={() => setLinkTarget(null)}
          onSelect={linkWorkItem}
        />
      )}
      {blocker.state === "blocked" && (
        <AlertDialog.Root
          open
          onOpenChange={(open) => {
            if (!open) blocker.reset();
          }}
        >
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="dialog-overlay confirmation-overlay" />
            <AlertDialog.Content className="confirmation-content">
              <AlertDialog.Title>日报还有未保存的修改</AlertDialog.Title>
              <AlertDialog.Description>
                保存成功后再离开；保存失败时可以继续编辑或复制内容。
              </AlertDialog.Description>
              <div className="confirmation-actions">
                <AlertDialog.Cancel asChild>
                  <Button variant="outline" onClick={() => blocker.reset()}>
                    继续编辑
                  </Button>
                </AlertDialog.Cancel>
                <Button
                  variant="ghost"
                  disabled={busy || saveState === "保存中…"}
                  onClick={() => blocker.proceed()}
                >
                  放弃修改并离开
                </Button>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    if (await flush()) blocker.proceed();
                  }}
                >
                  保存并离开
                </Button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      )}
    </div>
  );
}
