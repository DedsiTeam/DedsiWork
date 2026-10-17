import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { EmptyState } from "./empty-state";
import type { ReportMatter } from "../../shared/daily-report";
import type {
  ReportActivity,
  ReportActivityList,
} from "../../shared/report-records";
export function ReportActivityPicker({
  date,
  matters,
  onAdd,
}: {
  date: string;
  matters: ReportMatter[];
  onAdd: (values: ReportMatter[]) => void;
}) {
  const [data, setData] = useState<ReportActivityList | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load(page = 1) {
    setBusy(true);
    setError("");
    try {
      const { data } = await api<{ data: ReportActivityList }>(
        `/api/v1/daily-reports/activity?${new URLSearchParams({ date, offset: String(new Date(`${date}T00:00:00`).getTimezoneOffset()), page: String(page) })}`,
      );
      setData(data);
      setSelected([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(id: string, field: "title" | "activity", value: string) {
    setData((old) =>
      old
        ? {
            ...old,
            candidates: old.candidates.map((c) =>
              c.id === id
                ? { ...c, matter: { ...c.matter, [field]: value } }
                : c,
            ),
          }
        : null,
    );
  }
  const exists = (c: ReportActivity) =>
    matters.some(
      (m) =>
        m.matterId === c.matter.matterId ||
        (c.matter.workItemId && m.workItemId === c.matter.workItemId),
    );
  return (
    <section className="report-ai-panel" aria-label="从当日活动整理">
      <div className="report-section-heading">
        <h3>从当日活动整理</h3>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? "正在读取…" : "读取当天活动"}
        </Button>
      </div>
      <p className="report-help">
        按日报日期读取工作项变更与研发交付。核对后勾选加入；完成状态、数量和投入需自行确认。
      </p>
      {error && <p role="alert">{error}</p>}
      {data && !data.total && (
        <EmptyState
          compact
          title="当天暂无活动"
          description="可以手动记录当天完成的工作。"
        />
      )}
      {data?.candidates.map((c) => (
        <div className="report-matter" key={c.id}>
          <label>
            <input
              type="checkbox"
              checked={selected.includes(c.id)}
              disabled={exists(c)}
              onChange={(e) =>
                setSelected((ids) =>
                  e.target.checked
                    ? [...ids, c.id]
                    : ids.filter((id) => id !== c.id),
                )
              }
            />
            {c.source}
            {exists(c) ? " · 已加入" : ""}
          </label>
          <Input
            aria-label="候选事项名称"
            value={c.matter.title}
            maxLength={200}
            onChange={(e) => edit(c.id, "title", e.target.value)}
          />
          <Textarea
            aria-label="候选事项活动"
            value={c.matter.activity}
            maxLength={10000}
            onChange={(e) => edit(c.id, "activity", e.target.value)}
          />
          <Link to={c.href}>查看来源</Link>
        </div>
      ))}
      {!!data?.total && (
        <div className="report-actions">
          <Button
            size="sm"
            disabled={
              !selected.length ||
              selected.some(
                (id) =>
                  !data.candidates
                    .find((c) => c.id === id)
                    ?.matter.title.trim(),
              )
            }
            onClick={() => {
              onAdd(
                data.candidates
                  .filter((c) => selected.includes(c.id) && !exists(c))
                  .map((c) => c.matter),
              );
              setSelected([]);
            }}
          >
            加入选中事项
          </Button>
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
      )}
    </section>
  );
}
