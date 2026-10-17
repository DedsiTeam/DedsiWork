import { useEffect, useState } from "react";
import { api } from "../api";
import { Button } from "./ui/button";
import type { ReportDraft, ReportDraftList } from "../../shared/report-records";
import type { PeriodReport } from "../../shared/period-report";
export function ReportDraftHistory({
  report,
  text,
  snapshot,
  onLoad,
}: {
  report: PeriodReport;
  text: string;
  snapshot: string;
  onLoad: (draft: ReportDraft, initial: boolean) => void;
}) {
  const [data, setData] = useState<ReportDraftList | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("");
  const query = new URLSearchParams({ type: report.type, date: report.start });
  useEffect(() => {
    let active = true;
    api<{ data: ReportDraftList }>(`/api/v1/daily-reports/drafts?${query}`)
      .then(({ data }) => {
        if (!active) return;
        setData(data);
        const latest = data.versions[0];
        if (latest) {
          setSaved(latest.text);
          onLoad(latest, true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [report.type, report.start]);
  async function load(page = 1) {
    setBusy(true);
    setError("");
    try {
      const { data } = await api<{ data: ReportDraftList }>(
        `/api/v1/daily-reports/drafts?${query}&page=${page}`,
      );
      setData(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/daily-reports/drafts`, {
        method: "POST",
        body: JSON.stringify({
          type: report.type,
          date: report.start,
          text,
          sourceSnapshot: snapshot || JSON.stringify(report),
          expectedVersion: data.version,
        }),
      });
      setSaved(text);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="report-ai-settings">
      <div className="report-actions">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !data || !text.trim() || text === saved}
          onClick={() => void save()}
        >
          保存文字稿
        </Button>
        <span className="report-help">
          {text && text !== saved
            ? "有未保存的文字"
            : "已保存的稿件重启后可找回"}
        </span>
      </div>
      {error && (
        <p role="alert">
          {error}{" "}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void load()}
            disabled={busy}
          >
            读取最新版本
          </Button>
        </p>
      )}
      {!!data?.total && (
        <details>
          <summary>历史文字稿（{data.total} 版）</summary>
          {data.versions.map((draft) => (
            <div className="report-actions" key={draft.id}>
              <span>
                版本 {draft.version} ·{" "}
                {new Date(draft.createdAt).toLocaleString()}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onLoad(draft, false)}
              >
                载入此稿
              </Button>
            </div>
          ))}
          <div className="report-actions">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || data.page === 1}
              onClick={() => void load(data.page - 1)}
            >
              上一页
            </Button>
            <span>
              {data.page} / {Math.ceil(data.total / data.pageSize)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || data.page * data.pageSize >= data.total}
              onClick={() => void load(data.page + 1)}
            >
              下一页
            </Button>
          </div>
          <p className="report-help">
            载入历史版本不会删除其他稿件；当前编辑稿保留为候选稿。
          </p>
        </details>
      )}
    </div>
  );
}
