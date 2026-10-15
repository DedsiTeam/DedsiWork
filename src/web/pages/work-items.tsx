import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  LayoutList,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Choice } from "../components/choice";
import { PurgeConfirmation } from "../components/purge-confirmation";
import { CopyForCodex } from "../components/copy-for-codex";
import { formatDate } from "../components/editor";
import { api } from "../api";
import {
  statusLabels,
  typeLabels,
  priorityLabels,
  type WorkItem,
  type Page,
} from "../../shared/work-item";
import { NavLink, useNavigate } from "react-router";
import { useWorkspace } from "../workspace-context";
import { Status } from "../components/workspace";
export function WorkItemsPage({
  view = "items",
  initialStatus = "all",
}: {
  view?: "items" | "trash";
  initialStatus?: string;
}) {
  const navigate = useNavigate();
  const { summary, setSummary } = useWorkspace();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [status, setStatus] = useState(initialStatus),
    [type, setType] = useState("all"),
    [priority, setPriority] = useState("all");
  const [search, setSearch] = useState(""),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<WorkItem>>({
    data: [],
    meta: { total: 0, page: 1, pageSize: 20 },
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<WorkItem[]>([]);
  const [purgeTargets, setPurgeTargets] = useState<WorkItem[]>([]);
  const [purging, setPurging] = useState(false);
  const [purgeError, setPurgeError] = useState("");
  const selectAll = useRef<HTMLInputElement>(null);
  const purgeTrigger = useRef<HTMLElement | null>(null);
  const serial = useRef(0);
  useEffect(() => {
    setSelected([]);
  }, [view, search, page, status, type, priority]);
  useEffect(() => {
    setSelected((previous) =>
      previous.filter((item) =>
        result.data.some(
          (current) =>
            current.id === item.id && current.version === item.version,
        ),
      ),
    );
  }, [result]);
  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate =
        selected.length > 0 && selected.length < result.data.length;
  }, [selected, result]);
  function confirmPurge(items: WorkItem[]) {
    purgeTrigger.current = document.activeElement as HTMLElement | null;
    setPurgeError("");
    setPurgeTargets(items);
  }
  function cancelPurge() {
    setPurgeTargets([]);
    purgeTrigger.current?.focus();
  }
  async function purge() {
    if (purging || !purgeTargets.length) return;
    setPurging(true);
    setPurgeError("");
    try {
      const response = await api<{ data: { count: number } }>(
        "/api/v1/trash/purge",
        {
          method: "POST",
          body: JSON.stringify({
            items: purgeTargets.map((item) => ({
              id: item.id,
              expectedVersion: item.version,
            })),
          }),
        },
      );
      setSelected([]);
      setPurgeTargets([]);
      setNotice(`已永久删除 ${response.data.count} 个工作项`);
      await refresh(true);
    } catch (error) {
      setPurgeError((error as Error).message);
      void refresh(true);
    } finally {
      setPurging(false);
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const refresh = useCallback(
    async (silent = false) => {
      const id = ++serial.current;
      if (!silent) setLoading(true);
      const params = new URLSearchParams({
        q,
        page: String(page),
        pageSize: "20",
        deleted: String(view === "trash"),
      });
      if (status !== "all") params.set("status", status);
      if (type !== "all") params.set("type", type);
      if (priority !== "all") params.set("priority", priority);
      try {
        const [list, stats] = await Promise.all([
          api<Page<WorkItem>>(`/api/v1/work-items?${params}`),
          api<{ data: typeof summary }>("/api/v1/summary"),
        ]);
        if (id === serial.current) {
          setResult(list);
          setSummary(stats.data);
          setError("");
          if (page > 1 && !list.data.length) setPage((p) => p - 1);
        }
      } catch (e) {
        if (id === serial.current) setError((e as Error).message);
      } finally {
        if (id === serial.current) setLoading(false);
      }
    },
    [view, q, page, status, type, priority, setSummary],
  );
  useEffect(() => {
    void refresh();
    const poll = () => {
      if (!document.hidden) void refresh(true);
    };
    const timer = setInterval(poll, 5000);
    window.addEventListener("focus", poll);
    return () => {
      serial.current++;
      clearInterval(timer);
      window.removeEventListener("focus", poll);
    };
  }, [refresh]);

  function open(item: WorkItem | null) {
    navigate(item ? `/work-items/${item.id}` : "/work-items/new", {
      state: { returnTo: window.location.pathname },
    });
  }
  return (
    <>
      {purgeTargets.length > 0 && (
        <PurgeConfirmation
          titles={purgeTargets.map((item) => item.title)}
          busy={purging}
          error={purgeError}
          onCancel={cancelPurge}
          onConfirm={() => void purge()}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="workspace-content">
        <div className="page-heading">
          <div>
            <h1>
              工作项
              <span className="title-count">{result.meta.total}</span>
            </h1>
          </div>
          {view !== "trash" && (
            <div className="sprint-header-actions">
              <Button onClick={() => open(null)}>
                <Plus />
                新建工作项
              </Button>
            </div>
          )}
        </div>
        <div className="work-layout">
          <section className="list-panel" aria-label="工作项列表">
            <div className="list-toolbar">
              <nav className="work-view-tabs" aria-label="工作项视图">
                {[
                  { to: "/work-items", label: "全部", count: summary.total },
                  {
                    to: "/work-items/in-progress",
                    label: "进行中",
                    count: summary.inProgress,
                  },
                  {
                    to: "/work-items/completed",
                    label: "已完成",
                    count: summary.done,
                  },
                  {
                    to: "/work-items/trash",
                    label: "回收站",
                    count: summary.trash,
                  },
                ].map((tab) => (
                  <NavLink
                    key={tab.to}
                    to={tab.to}
                    end
                    className={({ isActive }) => (isActive ? "active" : "")}
                  >
                    {tab.label}
                    <span>{tab.count}</span>
                  </NavLink>
                ))}
              </nav>
              <div className="search-field">
                <Search size={16} />
                <Input
                  aria-label="搜索工作项"
                  placeholder="搜索工作项…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={filtersOpen}
                aria-controls="work-item-filters"
                onClick={() => setFiltersOpen((value) => !value)}
              >
                <SlidersHorizontal />
                筛选
                {[status, type, priority].filter((value) => value !== "all")
                  .length > 0 && (
                  <span className="filter-count">
                    {
                      [status, type, priority].filter(
                        (value) => value !== "all",
                      ).length
                    }
                  </span>
                )}
              </Button>
              <div
                id="work-item-filters"
                className="filter-toolbar"
                hidden={!filtersOpen}
              >
                <Choice
                  label="筛选状态"
                  value={status}
                  options={{ all: "全部状态", ...statusLabels }}
                  onChange={(value) => {
                    setStatus(value);
                    setPage(1);
                  }}
                />
                <Choice
                  label="筛选类型"
                  value={type}
                  options={{ all: "全部类型", ...typeLabels }}
                  onChange={(value) => {
                    setType(value);
                    setPage(1);
                  }}
                />
                <Choice
                  label="筛选优先级"
                  value={priority}
                  options={{ all: "全部优先级", ...priorityLabels }}
                  onChange={(value) => {
                    setPriority(value);
                    setPage(1);
                  }}
                />
              </div>
              <span className="sort-label">
                <ArrowDown size={12} />
                最近更新
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="刷新工作项"
                onClick={() => refresh()}
                disabled={loading}
              >
                <RefreshCw className={loading ? "animate-spin" : ""} />
              </Button>
            </div>
            {view === "trash" && (
              <div className="trash-actions">
                <label className="task-select-all">
                  <input
                    ref={selectAll}
                    type="checkbox"
                    aria-label="全选当前页"
                    checked={
                      result.data.length > 0 &&
                      selected.length === result.data.length
                    }
                    disabled={!result.data.length || loading || purging}
                    onChange={(event) =>
                      setSelected(event.target.checked ? [...result.data] : [])
                    }
                  />
                  全选当前页 <span>已选 {selected.length} 项</span>
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!selected.length || loading || purging}
                  onClick={() => confirmPurge(selected)}
                >
                  <Trash2 />
                  批量永久删除
                </Button>
              </div>
            )}
            {error && (
              <div className="message error" role="alert">
                {error}
                <Button variant="link" onClick={() => refresh()}>
                  重试
                </Button>
              </div>
            )}
            <div className="task-list" role="list" aria-busy={loading}>
              {result.data.map((item) => (
                <article className="task-row" role="listitem" key={item.id}>
                  {view === "trash" && (
                    <input
                      className="task-checkbox"
                      type="checkbox"
                      aria-label={`选择 ${item.title}`}
                      checked={selected.some((target) => target.id === item.id)}
                      disabled={loading || purging}
                      onChange={(event) =>
                        setSelected((previous) =>
                          event.target.checked
                            ? [...previous, item]
                            : previous.filter(
                                (target) => target.id !== item.id,
                              ),
                        )
                      }
                    />
                  )}
                  <button className="task-main" onClick={() => open(item)}>
                    <span
                      className={`task-state task-state-${item.status}`}
                      title={statusLabels[item.status]}
                    >
                      <Status status={item.status} />
                    </span>
                    <span className="task-copy">
                      <strong
                        className={
                          item.status === "done" ? "task-completed" : ""
                        }
                      >
                        {item.title}
                      </strong>
                      <span className="task-context">
                        {typeLabels[item.type]}
                        {item.blockedReason && (
                          <span
                            className="work-item-blocked"
                            title={item.blockedReason}
                          >
                            {" "}
                            · 已阻塞
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                  <div className="task-meta">
                    <span className={`priority priority-${item.priority}`}>
                      {priorityLabels[item.priority]}
                    </span>
                    <time
                      title={`最近更新：${formatDate(item.updatedAt)}`}
                      dateTime={item.dueAt || item.updatedAt}
                    >
                      {item.dueAt
                        ? `截止 ${formatDate(item.dueAt)}`
                        : formatDate(item.updatedAt)}
                    </time>
                  </div>
                  <div className="row-reveal task-row-actions">
                    {view === "trash" ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="永久删除"
                        disabled={loading || purging}
                        aria-label={`永久删除 ${item.title}`}
                        onClick={() => confirmPurge([item])}
                      >
                        <Trash2 />
                      </Button>
                    ) : (
                      <CopyForCodex
                        compact
                        item={item}
                        disabled={loading}
                        onNotice={setNotice}
                      />
                    )}
                  </div>
                </article>
              ))}
            </div>
            {!result.data.length && !error && (
              <div className="empty-state">
                <span>
                  <LayoutList size={28} />
                </span>
                <h2>
                  {loading
                    ? "正在读取工作项…"
                    : q ||
                        status !== "all" ||
                        type !== "all" ||
                        priority !== "all"
                      ? "没有找到匹配的工作项"
                      : view === "trash"
                        ? "回收站是空的"
                        : "从一件小事开始"}
                </h2>
                <p>
                  {loading
                    ? "正在从本地数据库获取最新数据。"
                    : view === "trash"
                      ? "移入回收站的工作项会显示在这里。"
                      : "记录接下来要做的事，在这里逐步推进。"}
                </p>
              </div>
            )}
            <footer className="list-footer">
              <span>共 {result.meta.total} 项</span>
              <div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="上一页"
                  disabled={page === 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft />
                </Button>
                <span>
                  {page} / {Math.max(1, Math.ceil(result.meta.total / 20))}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="下一页"
                  disabled={page * 20 >= result.meta.total || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight />
                </Button>
              </div>
            </footer>
          </section>
        </div>
      </div>
    </>
  );
}
