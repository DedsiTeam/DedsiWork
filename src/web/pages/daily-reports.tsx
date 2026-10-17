import { ReportActivityPicker } from "../components/report-activity";
import { PAGE_SIZE } from "../../shared/pagination";
import { EmptyState } from "../components/empty-state";
import { DatePicker } from "../components/date-picker";
import { useReportExport } from "../report-export";
import { ReportWorkItemPicker } from "../components/report-work-item-picker";
import type { WorkItem } from "../../shared/work-item";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Link,
  useBlocker,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Plus, Trash2, Copy, Download, Save } from "lucide-react";
import { api } from "../api";
import { useWorkspace } from "../workspace-context";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import {
  dailyReportInputSchema,
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
function ReportSupplement({
  defaultOpen,
  children,
}: {
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="report-supplement"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      {children}
    </details>
  );
}
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
export function DailyReportPage() {
  const { workspace } = useWorkspace();
  return <DailyReportEditor key={workspace?.id} />;
}
function DailyReportEditor() {
  const { exporting, exportMarkdown } = useReportExport();
  const { notify, workspace } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const isNew = !id;
  const listSearch = (location.state as { reportListSearch?: string } | null)
    ?.reportListSearch;
  const [loading, setLoading] = useState(true);
  const [linkTarget, setLinkTarget] = useState<number | "new" | null>(null);
  const [selected, setSelected] = useState<DailyReport | null>(null),
    [form, setForm] = useState<DailyReportInput | null>(null),
    [saved, setSaved] = useState("");
  const [saveState, setSaveState] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false);
  const [deleteAction, setDeleteAction] = useState<"delete" | "purge" | null>(
    null,
  );
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
  const listUrl = `/daily-reports${listSearch || `?workspace=${workspace?.id || ""}${selectedTrash()}`}`;
  function selectedTrash() {
    return recordRef.current?.deletedAt ? "&trash=true" : "";
  }
  const dirty = !!form && JSON.stringify(form) !== saved;
  const blocker = useBlocker(
    () =>
      pending.current !== null ||
      (!!formRef.current &&
        JSON.stringify(formRef.current) !== savedRef.current),
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    if (!id) {
      const initial = dailyReportInputSchema.parse({ date: today() });
      formRef.current = initial;
      recordRef.current = null;
      savedRef.current = JSON.stringify(initial);
      setSelected(null);
      setForm(initial);
      setSaved(JSON.stringify(initial));
      setSaveState("尚未保存");
      setLoading(false);
    } else if (recordRef.current?.id === id) {
      setLoading(false);
    } else {
      formRef.current = null;
      recordRef.current = null;
      savedRef.current = "";
      setForm(null);
      setSelected(null);
      setSaved("");
      api<{ data: DailyReport }>(`/api/v1/daily-reports/${id}`, {
        signal: controller.signal,
      })
        .then(({ data }) => {
          if (!controller.signal.aborted) install(data);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }
    return () => controller.abort();
  }, [id]);
  useEffect(() => {
    if (isNew && selected && !dirty && !busy)
      navigate(
        `/daily-reports/${selected.id}?workspace=${workspace?.id || ""}`,
        { replace: true, state: location.state },
      );
  }, [isNew, selected, dirty, busy, navigate, workspace?.id, location.state]);
  const flush = useCallback(async function save(): Promise<boolean> {
    if (pending.current) {
      const ok = await pending.current;
      return ok ? save() : false;
    }
    const value = formRef.current,
      record = recordRef.current;
    if (
      !value ||
      record?.deletedAt ||
      (record && JSON.stringify(value) === savedRef.current)
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
          record
            ? `/api/v1/daily-reports/${record.id}`
            : "/api/v1/daily-reports",
          {
            method: record ? "PUT" : "POST",
            body: JSON.stringify({
              ...parsed.data,
              ...(record ? { expectedVersion: record.version } : {}),
            }),
          },
        );
        if (!alive.current) return false;
        recordRef.current = result.data;
        savedRef.current = serialized;
        setSelected(result.data);
        setSaved(serialized);
        setSaveState("已保存");
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
    if (busy || !dirty || !selected || selected.deletedAt) return;
    setSaveState("等待保存…");
    const timer = setTimeout(() => void flush(), 1000);
    return () => clearTimeout(timer);
  }, [form, dirty, selected?.deletedAt, flush, busy]);
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
  async function saveForm() {
    if (busy) return;
    setBusy(true);
    try {
      await flush();
    } finally {
      setBusy(false);
    }
  }
  async function lifecycle() {
    if (!selected || busy) return;
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
      savedRef.current = "";
      setSaved("");
      setError("");
      setDeleteAction(null);
      navigate(listUrl, { replace: true });
      notify(restored ? "日报已恢复" : "日报已移入回收站");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function purge() {
    if (!recordRef.current || busy) return;
    setBusy(true);
    try {
      if (pending.current) await pending.current;
      const record = recordRef.current!;
      await api(`/api/v1/daily-reports/${record.id}/purge`, {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: record.version,
          confirmed: true,
        }),
      });
      setForm(null);
      setSelected(null);
      formRef.current = null;
      recordRef.current = null;
      savedRef.current = "";
      setSaved("");
      setError("");
      setDeleteAction(null);
      navigate(listUrl, { replace: true });
      notify("日报已永久删除");
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
      while ((p - 1) * PAGE_SIZE < total) {
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
      <div className="page-heading report-edit-page-heading">
        <h1>
          {selected?.deletedAt
            ? "查看已删除日报"
            : isNew
              ? "新增日报"
              : "修改日报"}
        </h1>
        <div>
          <Button
            variant="ghost"
            onClick={() => navigate(listUrl)}
            disabled={busy}
          >
            <ArrowLeft />
            返回日报列表
          </Button>
          {!selected?.deletedAt && (
            <Button
              onClick={() => void saveForm()}
              disabled={busy || loading || !form || (!!selected && !dirty)}
            >
              <Save />
              {busy ? "保存中…" : "保存日报"}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      <section
        className="report-editor report-page-editor"
        aria-label="日报填报"
      >
        {!form || loading ? (
          <div className="report-empty">
            <p role="status">
              {loading ? "正在加载日报…" : "无法打开日报，请返回列表重试。"}
            </p>
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
                <Button size="sm" variant="outline" onClick={() => void copy()}>
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
                  disabled={busy || !selected}
                  onClick={() => {
                    if (selected?.deletedAt) void lifecycle();
                    else {
                      setError("");
                      setDeleteAction("delete");
                    }
                  }}
                >
                  <Trash2 />
                  {selected?.deletedAt ? "恢复" : "删除"}
                </Button>
                {selected?.deletedAt && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="report-purge-button"
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setDeleteAction("purge");
                    }}
                  >
                    <Trash2 />
                    永久删除
                  </Button>
                )}
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
                <ReportActivityPicker
                  key={form.date}
                  date={form.date}
                  matters={form.matters}
                  onAdd={(values) => {
                    if (form.matters.length + values.length > 100) {
                      setError("每天最多记录 100 个事项");
                      return;
                    }
                    change("matters", [...form.matters, ...values]);
                  }}
                />
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
                    {!history.length && (
                      <EmptyState
                        compact
                        title="暂无可接续的历史事项"
                        description="此前未完成的事项会显示在这里。"
                      />
                    )}
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
                            items.filter((m) => m.matterId !== item.matterId),
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
                              progress: status === "done" ? 100 : item.progress,
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
                    <ReportSupplement
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
                    </ReportSupplement>
                  ))}
                </section>
                <div className="report-bottom">
                  <span>
                    {selected ? "修改后自动保存" : "填写完成后保存日报"} ·
                    空白数量表示未填写，不计为 0
                  </span>
                  <Button
                    onClick={() => void saveForm()}
                    disabled={busy || (!!selected && !dirty)}
                  >
                    <Save />
                    立即保存
                  </Button>
                </div>
              </fieldset>
            )}
          </>
        )}
      </section>
      <AlertDialog.Root
        open={deleteAction !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteAction(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay confirmation-overlay" />
          <AlertDialog.Content className="confirmation-content">
            <AlertDialog.Title>
              {deleteAction === "purge" ? "永久删除日报" : "删除日报"}
            </AlertDialog.Title>
            <AlertDialog.Description>
              {deleteAction === "purge"
                ? `永久删除 ${selected?.date} 日报？删除后无法恢复。`
                : `将 ${selected?.date} 日报移入回收站后可以恢复；选择永久删除将直接删除，无法恢复。`}
            </AlertDialog.Description>
            {error && (
              <p className="message error" role="alert">
                {error}
              </p>
            )}
            <div className="confirmation-actions">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={busy}>
                  取消
                </Button>
              </AlertDialog.Cancel>
              {deleteAction === "delete" && (
                <Button
                  variant="destructive"
                  className="report-purge-button"
                  disabled={busy}
                  onClick={() => void purge()}
                >
                  {busy ? "正在删除…" : "永久删除"}
                </Button>
              )}
              <Button
                variant="destructive"
                className={
                  deleteAction === "purge" ? "report-purge-button" : undefined
                }
                disabled={busy}
                onClick={() =>
                  void (deleteAction === "purge" ? purge() : lifecycle())
                }
              >
                {busy
                  ? "正在删除…"
                  : deleteAction === "purge"
                    ? "永久删除"
                    : "移入回收站"}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
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
