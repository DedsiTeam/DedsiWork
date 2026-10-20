import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Search,
  X,
  ListTodo,
  Layers,
  FileText,
  Globe,
  ArrowUpRight,
} from "lucide-react";
import { EmptyState } from "../components/empty-state";
import { prepareAssistantSource } from "../components/personal-actions";
import { useWorkspace } from "../workspace-context";
import type { SearchEntry } from "../../shared/personal-work";
import "../library.css";
const labels = {
  item: "工作项",
  model: "领域模型",
  note: "无边记",
  bookmark: "网址",
};
const icons = {
  item: ListTodo,
  model: Layers,
  note: FileText,
  bookmark: Globe,
};
export function LibraryPage() {
  const { workspace } = useWorkspace(),
    navigate = useNavigate();
  const [page, setPage] = useState(1),
    [data, setData] = useState<{
      data: SearchEntry[];
      meta: { total: number; pageSize: number };
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | SearchEntry["kind"]>("all");
  useEffect(() => {
    setData(null);
    setError("");
    const c = new AbortController();
    const timer = setTimeout(() => {
      const query = new URLSearchParams({
        page: String(page),
        q: search.trim(),
        kind,
      });
      api<NonNullable<typeof data>>(`/api/v1/personal/search?${query}`, {
        signal: c.signal,
      })
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
  }, [page, search, kind, workspace?.id]);
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
    <div className="workspace-content library-page">
      <header className="page-heading">
        <div>
          <h1>
            资料库
            {data && <span className="library-total">{data.meta.total}</span>}
          </h1>
        </div>
      </header>
      <div className="library-toolbar">
        <div className="library-search">
          <Search size={17} aria-hidden="true" />
          <Input
            aria-label="搜索资料"
            placeholder="搜索标题或资料内容…"
            value={search}
            maxLength={200}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          {search && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="清空搜索"
              onClick={() => {
                setSearch("");
                setPage(1);
              }}
            >
              <X />
            </Button>
          )}
        </div>
        <div className="library-filters" role="group" aria-label="资料类型">
          {(["all", "item", "model", "note", "bookmark"] as const).map(
            (value) => (
              <Button
                key={value}
                size="sm"
                variant={kind === value ? "secondary" : "ghost"}
                aria-pressed={kind === value}
                onClick={() => {
                  setKind(value);
                  setPage(1);
                }}
              >
                {value === "all" ? "全部资料" : labels[value]}
              </Button>
            ),
          )}
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {!data && !error ? (
        <p role="status">正在查找…</p>
      ) : data && !data.data.length ? (
        <EmptyState
          title={
            search || kind !== "all" ? "没有找到匹配资料" : "资料库还是空的"
          }
          description={
            search || kind !== "all"
              ? "试试其他关键词，或切换资料类型。"
              : "工作项、领域模型、无边记和网址会汇集在这里。"
          }
        />
      ) : data ? (
        <div className="library-grid">
          {data.data.map((row) => {
            const Icon = icons[row.kind];
            return (
              <article className="library-card" key={`${row.kind}:${row.id}`}>
                <div className="library-card-kind">
                  <Icon size={17} aria-hidden="true" />
                  <span>{labels[row.kind]}</span>
                </div>
                <h2>
                  <Link to={row.href}>{row.title}</Link>
                </h2>
                <p className="library-card-summary">
                  {row.text || "暂无文字摘要，打开资料查看完整内容。"}
                </p>
                <div className="library-card-actions">
                  <Button asChild size="sm" variant="ghost">
                    <Link to={row.href}>
                      查看资料
                      <ArrowUpRight />
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() => void useSource(row)}
                  >
                    {busy === row.id ? "准备资料…" : "交给 Codex"}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
      {data && data.meta.total > 0 && (
        <div className="library-pagination">
          <span>共 {data.meta.total} 条资料</span>
          <div>
            <Button
              variant="ghost"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <span>
              {page} / {Math.ceil(data.meta.total / data.meta.pageSize)}
            </span>
            <Button
              variant="ghost"
              disabled={page * data.meta.pageSize >= data.meta.total}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
