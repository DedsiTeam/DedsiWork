import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { EmptyState } from "../components/empty-state";
import { prepareAssistantSource } from "../components/personal-actions";
import { useWorkspace } from "../workspace-context";
import type { SearchEntry } from "../../shared/personal-work";
import "../personal-work.css";
const labels = {
  item: "工作项",
  model: "领域模型",
  note: "无边记",
  bookmark: "网址",
};
export function LibraryPage() {
  const { workspace } = useWorkspace(),
    navigate = useNavigate();
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState<{
      data: SearchEntry[];
      meta: { total: number; pageSize: number };
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  useEffect(() => {
    setData(null);
    const c = new AbortController();
    const timer = setTimeout(() => {
      api<NonNullable<typeof data>>(
        `/api/v1/personal/search?q=${encodeURIComponent(q)}&page=${page}`,
        { signal: c.signal },
      )
        .then((r) => {
          if (!c.signal.aborted) {
            if (
              r.meta.total > 0 &&
              page > Math.ceil(r.meta.total / r.meta.pageSize)
            ) {
              setPage(Math.ceil(r.meta.total / r.meta.pageSize));
              return;
            }
            setData(r);
            setError("");
          }
        })
        .catch((e) => {
          if (!c.signal.aborted) setError(e.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [q, page, workspace?.id]);
  async function useSource(row: SearchEntry) {
    if (!workspace) return;
    setBusy(row.id);
    try {
      navigate(await prepareAssistantSource(row.kind, row.id, workspace.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="workspace-content">
      <header className="personal-heading">
        <div>
          <h1>资料库</h1>
          <p className="muted">
            查找并引用当前空间的工作项、笔记、模型和网址。
          </p>
        </div>
      </header>
      <Input
        className="personal-search-input"
        aria-label="搜索资料"
        placeholder="搜索标题、正文或网址"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
      />
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p role="status">正在查找…</p>
      ) : !data.data.length ? (
        <EmptyState
          title="没有找到资料"
          description="试试其他关键词，或先记录一些工作内容。"
        />
      ) : (
        data.data.map((row) => (
          <div className="personal-row" key={`${row.kind}:${row.id}`}>
            <div>
              <Link to={row.href}>{row.title}</Link>
              <p>
                {labels[row.kind]} · {row.text.replace(/<[^>]*>/g, " ")}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() => void useSource(row)}
            >
              {busy === row.id ? "准备资料…" : "交给 Codex"}
            </Button>
          </div>
        ))
      )}
      {data && data.meta.total > data.meta.pageSize && (
        <div className="personal-pagination">
          <Button
            variant="ghost"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          {page}/{Math.ceil(data.meta.total / data.meta.pageSize)}
          <Button
            variant="ghost"
            disabled={page * data.meta.pageSize >= data.meta.total}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
