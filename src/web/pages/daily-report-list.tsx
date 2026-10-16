import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import {
  CalendarDays,
  Plus,
  Trash2,
  RotateCcw,
  ArrowUpRight,
} from "lucide-react";
import { api } from "../api";
import { useWorkspace } from "../workspace-context";
import { DatePicker } from "../components/date-picker";
import { PeriodReports } from "../components/period-reports";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  reportMetrics,
  type DailyReport,
  type DailyReportList,
} from "../../shared/daily-report";
import "../daily-reports.css";

export function DailyReportsPage() {
  const { workspace } = useWorkspace();
  return <DailyReportCards key={workspace?.id} />;
}

function DailyReportCards() {
  const { workspace, notify } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const mode =
    params.get("type") === "weekly"
      ? "weekly"
      : params.get("type") === "monthly"
        ? "monthly"
        : "daily";
  const search = params.get("q") || "";
  const month = params.get("month") || "";
  const trash = params.get("trash") === "true";
  const page = Math.max(1, Math.min(100000, Number(params.get("page")) || 1));
  const [list, setList] = useState<DailyReportList>({
    data: [],
    meta: { total: 0, page: 1, pageSize: 20 },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<DailyReport | null>(null);
  const [deleteError, setDeleteError] = useState("");
  function filter(values: Record<string, string>, resetPage = true) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(values)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (resetPage) next.delete("page");
        return next;
      },
      { replace: true },
    );
  }
  const reportUrl = (id: string) =>
    `/daily-reports/${id}?workspace=${workspace?.id || ""}`;
  const reportState = { reportListSearch: location.search };
  useEffect(() => {
    if (mode !== "daily") return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      const query = new URLSearchParams({
        q: search,
        deleted: String(trash),
        page: String(page),
        ...(month ? { month } : {}),
      });
      api<DailyReportList>(`/api/v1/daily-reports?${query}`, {
        signal: controller.signal,
      })
        .then((result) => {
          if (controller.signal.aborted) return;
          if (page > 1 && !result.data.length) {
            filter(
              { page: String(Math.max(1, Math.ceil(result.meta.total / 20))) },
              false,
            );
          } else setList(result);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [mode, search, month, trash, page, revision]);
  async function remove(permanent = !!deleting?.deletedAt) {
    if (!deleting || busy) return;
    setBusy(true);
    setDeleteError("");
    try {
      await api(
        `/api/v1/daily-reports/${deleting.id}${permanent ? "/purge" : ""}`,
        {
          method: permanent ? "POST" : "DELETE",
          body: JSON.stringify({
            expectedVersion: deleting.version,
            ...(permanent ? { confirmed: true } : {}),
          }),
        },
      );
      notify(permanent ? "日报已永久删除" : "日报已移入回收站");
      setDeleting(null);
      setRevision((value) => value + 1);
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function restore(report: DailyReport) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/daily-reports/${report.id}/restore`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: report.version }),
      });
      notify("日报已恢复");
      setRevision((value) => value + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-content reports-content">
      <nav className="report-tabs" aria-label="报告类型">
        {(["daily", "weekly", "monthly"] as const).map((value) => (
          <Button
            key={value}
            variant={mode === value ? "default" : "ghost"}
            aria-pressed={mode === value}
            disabled={busy}
            onClick={() => filter({ type: value === "daily" ? "" : value })}
          >
            {{ daily: "日报", weekly: "周报", monthly: "月报" }[value]}
          </Button>
        ))}
      </nav>
      {mode !== "daily" ? (
        <PeriodReports
          key={mode}
          type={mode}
          onOpenReport={async (id) => {
            await navigate(reportUrl(id), { state: reportState });
          }}
        />
      ) : (
        <>
          <div className="page-heading">
            <div>
              <h1>{trash ? "日报回收站" : "日报管理"}</h1>
              <p className="report-subtitle">记录进展，沉淀成果。</p>
            </div>
            <Button asChild>
              <Link to={reportUrl("new")} state={reportState}>
                <Plus />
                新增日报
              </Link>
            </Button>
          </div>
          <div className="report-toolbar">
            <Input
              aria-label="搜索日报"
              placeholder="搜索事项、结果或正文…"
              value={search}
              maxLength={200}
              onChange={(e) => filter({ q: e.target.value })}
            />
            <DatePicker
              label="按月份筛选"
              mode="month"
              placement="bottom"
              clearable
              value={month}
              onChange={(value) => filter({ month: value })}
            />
            <Button
              variant="outline"
              onClick={() => filter({ month: "", q: "" })}
            >
              清除筛选
            </Button>
            <Button
              variant={trash ? "default" : "outline"}
              onClick={() => filter({ trash: trash ? "" : "true" })}
            >
              {trash ? "返回日报" : "回收站"}
            </Button>
          </div>
          {error && (
            <div className="message error" role="alert">
              {error}
              <Button variant="ghost" onClick={() => setRevision((v) => v + 1)}>
                重试
              </Button>
            </div>
          )}
          <div className="report-cards-heading">
            <span>{trash ? "已删除日报" : "全部日报"}</span>
            <span>{list.meta.total} 份</span>
          </div>
          {loading ? (
            <p className="report-card-empty" role="status">
              正在加载日报…
            </p>
          ) : !list.data.length ? (
            <div className="report-card-empty">
              <CalendarDays size={36} />
              <h2>
                {trash
                  ? "回收站为空"
                  : search || month
                    ? "没有符合条件的日报"
                    : "记录每一天的进展"}
              </h2>
              <p>
                {trash
                  ? "删除的日报会显示在这里。"
                  : search || month
                    ? "调整搜索或月份筛选后重试。"
                    : "点击“新增日报”，在填报页面记录工作与成果。"}
              </p>
            </div>
          ) : (
            <section className="report-card-grid" aria-label="日报卡片列表">
              {list.data.map((report) => {
                const metrics = reportMetrics(report);
                const summary =
                  report.matters.map((item) => item.title).join("、") ||
                  report.completed ||
                  report.ongoing ||
                  report.notes ||
                  "还没有填写工作记录";
                return (
                  <article className="report-card" key={report.id}>
                    <Link
                      className="report-card-main"
                      to={reportUrl(report.id)}
                      state={reportState}
                      aria-label={`${trash ? "查看" : "修改"} ${report.date} 日报`}
                    >
                      <div className="report-card-title">
                        <span className="report-card-icon">
                          <CalendarDays size={18} />
                        </span>
                        <h2>{report.date}</h2>
                        <ArrowUpRight size={16} />
                      </div>
                      <p className="report-card-summary">{summary}</p>
                      <div className="report-card-metrics">
                        <span>{metrics.total} 件事项</span>
                        <span>{metrics.done} 件完成</span>
                      </div>
                    </Link>
                    <footer className="report-card-footer">
                      <span>
                        更新于{" "}
                        {new Date(report.updatedAt).toLocaleDateString("zh-CN")}
                      </span>
                      <div>
                        {trash ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void restore(report)}
                          >
                            <RotateCcw />
                            恢复
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" asChild>
                            <Link to={reportUrl(report.id)} state={reportState}>
                              修改
                            </Link>
                          </Button>
                        )}
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={busy}
                          aria-label={`${trash ? "永久删除" : "删除"} ${report.date} 日报`}
                          title={trash ? "永久删除" : "删除"}
                          onClick={() => {
                            setDeleteError("");
                            setDeleting(report);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </footer>
                  </article>
                );
              })}
            </section>
          )}
          <div className="report-pagination report-card-pagination">
            <Button
              size="sm"
              variant="outline"
              disabled={loading || page <= 1}
              onClick={() => filter({ page: String(page - 1) }, false)}
            >
              上一页
            </Button>
            <span>
              {page}/{Math.max(1, Math.ceil(list.meta.total / 20))}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || page * 20 >= list.meta.total}
              onClick={() => filter({ page: String(page + 1) }, false)}
            >
              下一页
            </Button>
          </div>
        </>
      )}
      <AlertDialog.Root
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay confirmation-overlay" />
          <AlertDialog.Content className="confirmation-content">
            <AlertDialog.Title>
              {deleting?.deletedAt ? "永久删除日报" : "删除日报"}
            </AlertDialog.Title>
            <AlertDialog.Description>
              {deleting?.deletedAt
                ? `永久删除 ${deleting.date} 日报？删除后无法恢复。`
                : `将 ${deleting?.date} 日报移入回收站后可以恢复；选择永久删除将直接删除，无法恢复。`}
            </AlertDialog.Description>
            {deleteError && (
              <p role="alert" className="message error">
                {deleteError}
              </p>
            )}
            <div className="confirmation-actions">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={busy}>
                  取消
                </Button>
              </AlertDialog.Cancel>
              {!deleting?.deletedAt && (
                <Button
                  variant="destructive"
                  className="report-purge-button"
                  disabled={busy}
                  onClick={() => void remove(true)}
                >
                  {busy ? "正在删除…" : "永久删除"}
                </Button>
              )}
              <Button
                variant="destructive"
                className={
                  deleting?.deletedAt ? "report-purge-button" : undefined
                }
                disabled={busy}
                onClick={() => void remove()}
              >
                {busy
                  ? "正在删除…"
                  : deleting?.deletedAt
                    ? "永久删除"
                    : "移入回收站"}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
