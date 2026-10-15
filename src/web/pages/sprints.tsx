import { DatePicker } from "../components/date-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useSearchParams } from "react-router";
import {
  Plus,
  RefreshCw,
  Columns3,
  X,
  Search,
  CalendarDays,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  Trash2,
} from "lucide-react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { Choice } from "../components/choice";
import { useSprintDrag } from "../components/use-sprint-drag";
import { Editor, formatDate } from "../components/editor";
import { RichText } from "../components/rich-text";
import { CopyForCodex } from "../components/copy-for-codex";
import { useWorkspace } from "../workspace-context";
import {
  statusLabels,
  flowStatuses,
  needsReturnReason,
  typeLabels,
  priorityLabels,
  type WorkItem,
  type Page,
} from "../../shared/work-item";
import {
  sprintLabels,
  type Sprint,
  type SprintBoard,
} from "../../shared/sprint";
import "../sprints.css";
const columns = flowStatuses;
const today = () => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) =>
    parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
};
const blank = () => {
  // Work on the China calendar date using UTC arithmetic, independent of OS timezone.
  const monday = new Date(`${today()}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return {
    name: "",
    goal: "",
    startDate: monday.toISOString().slice(0, 10),
    endDate: sunday.toISOString().slice(0, 10),
  };
};
const eventLabels: Record<string, string> = {
  created: "创建冲刺",
  updated: "修改冲刺信息",
  started: "开始冲刺",
  items_added: "加入工作项",
  items_removed: "移出工作项",
  item_created: "新建工作项",
  item_moved: "更新卡片状态或顺序",
  items_carried: "接收结转工作项",
  closed: "结束冲刺",
};
export function SprintsPage() {
  const [overviewCollapsed, setOverviewCollapsed] = useState(() => {
    try {
      return (
        localStorage.getItem("dedsiwork:sprint-overview-collapsed") === "true"
      );
    } catch {
      return false;
    }
  });
  const [deleteTarget, setDeleteTarget] = useState<Sprint | null>(null);
  const overviewToggle = useRef<HTMLButtonElement>(null);
  function toggleOverview() {
    setOverviewCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem(
          "dedsiwork:sprint-overview-collapsed",
          String(next),
        );
      } catch {}
      return next;
    });
  }
  const [params, setParams] = useSearchParams();
  const id = params.get("sprint") || "";
  const [sprints, setSprints] = useState<Sprint[]>([]),
    [board, setBoard] = useState<SprintBoard | null>(null);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [modal, setModal] = useState<
    "" | "create" | "edit" | "add" | "finish" | "new" | "block"
  >("");
  const [form, setForm] = useState(blank),
    [title, setTitle] = useState(""),
    [newStatus, setNewStatus] = useState<WorkItem["status"]>("todo");
  const [target, setTarget] = useState("backlog"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [type, setType] = useState("all"),
    [priority, setPriority] = useState("all"),
    [cancelled, setCancelled] = useState(false);
  const [candidates, setCandidates] = useState<Page<WorkItem>>({
      data: [],
      meta: { total: 0, page: 1, pageSize: 20 },
    }),
    [candidatePage, setCandidatePage] = useState(1),
    [candidateLoading, setCandidateLoading] = useState(false),
    [candidateQ, setCandidateQ] = useState(""),
    [selected, setSelected] = useState<WorkItem[]>([]);
  const [blockItem, setBlockItem] = useState<WorkItem | null>(null);
  const [blockReason, setBlockReason] = useState("");
  const [detailReadOnly, setDetailReadOnly] = useState(false);
  const [detail, setDetail] = useState<WorkItem | null>(null);
  const formVersion = useRef(1);
  const serial = useRef(0),
    requestKey = useRef(crypto.randomUUID());
  const { refreshSummary } = useWorkspace();
  const refresh = useCallback(async () => {
    const seq = ++serial.current;
    try {
      const list = await api<{ data: Sprint[] }>("/api/v1/sprints");
      if (seq !== serial.current) return;
      setSprints(list.data);
      if (!id && list.data[0]) {
        setParams({ sprint: list.data[0].id }, { replace: true });
        return;
      }
      if (id) {
        const result = await api<{ data: SprintBoard }>(
          `/api/v1/sprints/${id}`,
        );
        if (seq !== serial.current) return;
        setBoard(result.data);
      } else setBoard(null);
      setLoaded(true);
    } catch (e) {
      if (seq === serial.current) {
        setError((e as Error).message);
        setLoaded(true);
      }
    }
  }, [id, setParams]);
  useEffect(() => {
    setBoard(null);
    setDetail(null);
    setError("");
    setFilter("all");
    void refresh();
    const poll = () => {
      if (!document.hidden) void refresh();
    };
    const timer = setInterval(poll, 5000);
    window.addEventListener("focus", poll);
    return () => {
      serial.current++;
      clearInterval(timer);
      window.removeEventListener("focus", poll);
    };
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (modal !== "add") return;
    let alive = true;
    setCandidateLoading(true);
    const timer = setTimeout(() => {
      void api<Page<WorkItem>>(
        `/api/v1/work-items?unplanned=true&pageSize=20&page=${candidatePage}&q=${encodeURIComponent(candidateQ)}`,
      )
        .then((r) => {
          if (alive) setCandidates(r);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        })
        .finally(() => {
          if (alive) setCandidateLoading(false);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [modal, candidateQ, candidatePage, board?.sprint.version]);
  async function mutate(action: string, payload: unknown, method = "POST") {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await api(action, { method, body: JSON.stringify(payload) });
      await refresh();
      refreshSummary();
      return true;
    } catch (e) {
      setError((e as Error).message);
      await refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }
  const sprint = board?.sprint,
    closed = sprint?.state === "closed";
  async function action(name: string, payload: Record<string, unknown> = {}) {
    if (!sprint) return false;
    return mutate(
      `/api/v1/sprints/${sprint.id}${name ? `/${name}` : ""}`,
      { expectedVersion: sprint.version, ...payload },
      name ? "POST" : "PUT",
    );
  }
  async function move(
    item: WorkItem,
    status: WorkItem["status"],
    beforeId: string | null = null,
  ) {
    if (closed || busy) return;
    const reason = needsReturnReason(item.status, status)
      ? window.prompt("请填写退回进行中的原因（评审意见、验证问题或验收反馈）")
      : undefined;
    if (reason === null) return;
    if (reason !== undefined && !reason.trim()) {
      setError("退回进行中时请填写原因");
      return;
    }
    await action("move", {
      reason,
      itemId: item.id,
      itemVersion: item.version,
      status,
      beforeId,
    });
  }
  async function deleteSprint() {
    if (!deleteTarget || busy) return;
    setBusy(true);
    setError("");
    serial.current++;
    try {
      await api(`/api/v1/sprints/${deleteTarget.id}`, {
        method: "DELETE",
        body: JSON.stringify({
          expectedVersion: deleteTarget.version,
          confirmed: true,
        }),
      });
      serial.current++;
      const list = await api<{ data: Sprint[] }>("/api/v1/sprints");
      setBoard(null);
      setSprints(list.data);
      setDeleteTarget(null);
      setParams(list.data[0] ? { sprint: list.data[0].id } : {}, {
        replace: true,
      });
      setLoaded(true);
      setNotice("冲刺已删除");
    } catch (e) {
      setDeleteTarget(null);
      setError((e as Error).message);
      void refresh();
    } finally {
      setBusy(false);
    }
  }
  function openModal(value: typeof modal) {
    setError("");
    setModal(value);
    formVersion.current = sprint?.version || 1;
    if (value === "create") setForm(blank());
    if (value === "edit" && sprint)
      setForm({
        name: sprint.name,
        goal: sprint.goal,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
      });
    if (value === "add") {
      setSelected([]);
      setCandidateQ("");
      setCandidatePage(1);
    }
    if (value === "finish") setTarget("backlog");
  }
  const all = board?.items || [],
    done = all.filter((i) => i.status === "done").length,
    blocking = all.filter((i) => Boolean(i.blockedReason)).length,
    unfinished = all.filter((i) => !["done", "cancelled"].includes(i.status));
  const visible = all.filter(
    (i) =>
      (filter === "all" ||
        (filter === "blocked"
          ? Boolean(i.blockedReason)
          : i.status === filter)) &&
      (type === "all" || i.type === type) &&
      (priority === "all" || i.priority === priority) &&
      i.title.toLowerCase().includes(search.toLowerCase()),
  );
  const { cardProps, dragging, dropTarget, preview } = useSprintDrag(
    Boolean(closed || busy || !board),
    (item, status, beforeId) => {
      void move(item, status, beforeId);
    },
  );
  function card(item: WorkItem) {
    return (
      <article
        key={item.id}
        className={`sprint-card ${dragging === item.id ? "dragging" : ""} ${dropTarget?.beforeId === item.id ? "insert-before" : ""}`}
        {...cardProps(item)}
      >
        <div className="sprint-card-top">
          <span>{typeLabels[item.type]}</span>
          <span className={`priority priority-${item.priority}`}>
            {priorityLabels[item.priority]}
          </span>
        </div>
        <button
          className="sprint-card-title"
          onClick={() => {
            setDetailReadOnly(Boolean(closed));
            setDetail(item);
          }}
        >
          {item.title}
        </button>
        {item.blockedReason && (
          <p className="sprint-blocked" title={item.blockedReason}>
            阻塞：{item.blockedReason}
          </p>
        )}
        {item.dueAt && (
          <time
            className={
              new Date(item.dueAt) < new Date() &&
              !["done", "cancelled"].includes(item.status)
                ? "sprint-overdue"
                : ""
            }
          >
            截止 {formatDate(item.dueAt)}
          </time>
        )}
        <div className={`sprint-card-actions ${closed ? "read-only" : ""}`}>
          <CopyForCodex
            compact
            item={item}
            disabled={busy}
            onNotice={setNotice}
          />
          {!closed && (
            <>
              {!["done", "cancelled"].includes(item.status) && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="sprint-block-action"
                  disabled={busy}
                  title={item.blockedReason ? "编辑或解除阻塞" : "标记阻塞"}
                  aria-label={`设置 ${item.title} 的阻塞标记`}
                  onClick={() => {
                    setBlockItem(item);
                    setBlockReason(item.blockedReason);
                    openModal("block");
                  }}
                >
                  <AlertTriangle />
                </Button>
              )}

              <Choice
                label={`修改 ${item.title} 的状态`}
                value={item.status}
                options={
                  ["done", "cancelled"].includes(item.status)
                    ? {
                        [item.status]: statusLabels[item.status],
                        todo: "重新打开为待处理",
                      }
                    : statusLabels
                }
                disabled={busy}
                onChange={(v) => void move(item, v as WorkItem["status"])}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                className="sprint-remove-action"
                title="移出冲刺"
                aria-label={`移出 ${item.title}`}
                disabled={busy}
                onClick={() =>
                  void action("remove", {
                    items: [{ id: item.id, expectedVersion: item.version }],
                  })
                }
              >
                <X />
              </Button>
            </>
          )}
        </div>
      </article>
    );
  }
  return (
    <div className="workspace-content sprint-page">
      <div className="page-heading">
        <h1>冲刺看板</h1>
        <div className="sprint-header-actions">
          {sprints.length > 0 && (
            <Button
              ref={overviewToggle}
              variant="ghost"
              size="icon-sm"
              aria-label={overviewCollapsed ? "展开冲刺概览" : "折叠冲刺概览"}
              title={overviewCollapsed ? "展开冲刺概览" : "折叠冲刺概览"}
              aria-expanded={!overviewCollapsed}
              aria-controls="sprint-overview-region"
              onClick={toggleOverview}
            >
              {overviewCollapsed ? <ChevronDown /> : <ChevronUp />}
            </Button>
          )}
          <Button onClick={() => openModal("create")} disabled={busy}>
            <Plus />
            新建冲刺
          </Button>
        </div>
      </div>
      {notice && (
        <div className="message" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="message error" role="alert">
          {error}
          <Button
            variant="link"
            onClick={() => {
              setError("");
              void refresh();
            }}
          >
            刷新重试
          </Button>
        </div>
      )}
      <div id="sprint-overview-region" hidden={overviewCollapsed}>
        {sprints.length > 0 && (
          <div className="sprint-selector">
            <Choice
              label="选择冲刺"
              value={id}
              options={Object.fromEntries(
                sprints.map((s) => [
                  s.id,
                  `${s.name} · ${sprintLabels[s.state]}`,
                ]),
              )}
              disabled={busy}
              onChange={(v) => setParams({ sprint: v })}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="刷新冲刺"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw />
            </Button>
          </div>
        )}
        {board && (
          <section className="sprint-overview">
            <div className="sprint-overview-heading">
              <div>
                <h2>
                  {sprint!.name}
                  <span className={`sprint-state ${sprint!.state}`}>
                    {sprintLabels[sprint!.state]}
                  </span>
                </h2>
                <p>
                  <CalendarDays size={14} />
                  {sprint!.startDate} — {sprint!.endDate}
                  <span>
                    {closed
                      ? "已保存结束时结果"
                      : sprint!.endDate < today()
                        ? "已超出计划日期"
                        : `剩余 ${Math.max(0, Math.round((Date.parse(sprint!.endDate) - Date.parse(today())) / 86400000))} 天`}
                  </span>
                </p>
              </div>
              <div className="sprint-header-actions">
                {all.length === 0 && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setDeleteTarget(sprint!);
                    }}
                  >
                    <Trash2 />
                    删除冲刺
                  </Button>
                )}
                {!closed && (
                  <>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => openModal("edit")}
                    >
                      编辑冲刺
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => openModal("add")}
                    >
                      <Plus />
                      加入工作项
                    </Button>
                    {sprint!.state === "planned" ? (
                      <Button
                        disabled={busy}
                        onClick={() => void action("start")}
                      >
                        开始冲刺
                      </Button>
                    ) : (
                      <Button
                        disabled={busy}
                        onClick={() => openModal("finish")}
                      >
                        结束冲刺
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
            <p className="sprint-goal">{sprint!.goal || "尚未填写冲刺目标"}</p>
            <div className="sprint-metrics">
              <button
                onClick={() => setFilter("all")}
                aria-pressed={filter === "all"}
              >
                全部 <strong>{all.length}</strong>
              </button>
              <button
                onClick={() => setFilter(filter === "done" ? "all" : "done")}
                aria-pressed={filter === "done"}
              >
                已完成{" "}
                <strong>
                  {done} / {all.length}
                </strong>
              </button>
              <button
                onClick={() =>
                  setFilter(filter === "in_progress" ? "all" : "in_progress")
                }
                aria-pressed={filter === "in_progress"}
              >
                进行中{" "}
                <strong>
                  {all.filter((x) => x.status === "in_progress").length}
                </strong>
              </button>
              <button
                onClick={() =>
                  setFilter(filter === "blocked" ? "all" : "blocked")
                }
                aria-pressed={filter === "blocked"}
              >
                阻塞 <strong>{blocking}</strong>
              </button>
              <button
                onClick={() =>
                  setFilter(filter === "paused" ? "all" : "paused")
                }
                aria-pressed={filter === "paused"}
              >
                已暂停{" "}
                <strong>
                  {all.filter((x) => x.status === "paused").length}
                </strong>
              </button>
              <progress
                value={done}
                max={all.length || 1}
                aria-label="冲刺完成进度"
              />
            </div>
          </section>
        )}
      </div>
      {!board ? (
        <div className="empty-state">
          <Columns3 size={28} />
          <h2>{!loaded || id ? "正在读取冲刺…" : "规划下一轮工作"}</h2>
          <p>创建冲刺，设置目标，再加入这一轮要完成的工作项。</p>
        </div>
      ) : (
        <>
          <div className="sprint-toolbar">
            <div className="search-field">
              <Search size={16} />
              <Input
                aria-label="搜索看板"
                placeholder="搜索工作项…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Choice
              label="筛选类型"
              value={type}
              options={{ all: "全部类型", ...typeLabels }}
              onChange={setType}
            />
            <Choice
              label="筛选优先级"
              value={priority}
              options={{ all: "全部优先级", ...priorityLabels }}
              onChange={setPriority}
            />
            <label className="sprint-check">
              <input
                type="checkbox"
                checked={cancelled}
                onChange={(e) => setCancelled(e.target.checked)}
              />
              显示已取消 ({all.filter((x) => x.status === "cancelled").length})
            </label>
            {filter !== "all" && (
              <Button variant="ghost" onClick={() => setFilter("all")}>
                {filter === "blocked"
                  ? "已阻塞"
                  : statusLabels[filter as WorkItem["status"]]}{" "}
                <X />
              </Button>
            )}
          </div>
          <div className="sprint-board">
            {[...columns, ...(cancelled ? ["cancelled" as const] : [])].map(
              (status) => (
                <section
                  key={status}
                  className={`sprint-column column-${status} ${dropTarget?.status === status ? "drop-active" : ""}`}
                  data-sprint-column={status}
                  aria-label={statusLabels[status]}
                >
                  <div className="sprint-column-heading">
                    <h3>
                      <span />
                      {statusLabels[status]}{" "}
                      <small>
                        {visible.filter((i) => i.status === status).length}
                      </small>
                    </h3>
                    {!closed && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy}
                        aria-label={`在${statusLabels[status]}中新建工作项`}
                        onClick={() => {
                          setTitle("");
                          setNewStatus(status);
                          requestKey.current = crypto.randomUUID();
                          openModal("new");
                        }}
                      >
                        <Plus />
                      </Button>
                    )}
                  </div>
                  <div className="sprint-column-cards">
                    {visible.filter((i) => i.status === status).map(card)}
                    {!visible.some((i) => i.status === status) && (
                      <p className="sprint-column-empty">
                        {search ||
                        filter !== "all" ||
                        type !== "all" ||
                        priority !== "all"
                          ? "没有匹配的工作项"
                          : "暂无工作项"}
                      </p>
                    )}
                  </div>
                </section>
              ),
            )}
          </div>
          <details className="sprint-history">
            <summary>冲刺活动 · 最近 {board.events.length} 条</summary>
            {board.events.map((e) => (
              <div key={e.id}>
                <span>{eventLabels[e.action] || e.action}</span>
                <span>
                  {e.source === "mcp" ? "MCP 客户端" : "你"} ·{" "}
                  {formatDate(e.createdAt)}
                </span>
              </div>
            ))}
          </details>
        </>
      )}
      <AlertDialog.Root
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteTarget(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay confirmation-overlay" />
          <AlertDialog.Content
            className="confirmation-content"
            onEscapeKeyDown={(e) => {
              if (busy) e.preventDefault();
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              overviewToggle.current?.focus();
            }}
          >
            <AlertDialog.Title>确认删除冲刺？</AlertDialog.Title>
            <AlertDialog.Description>
              将删除空冲刺“{deleteTarget?.name}
              ”。删除后无法恢复，工作项不会被删除。
            </AlertDialog.Description>
            <div className="confirmation-actions">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={busy}>
                  取消
                </Button>
              </AlertDialog.Cancel>
              <Button disabled={busy} onClick={() => void deleteSprint()}>
                {busy ? "正在删除…" : "确认删除"}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      {preview && (
        <div
          className="sprint-drag-preview"
          style={{ left: preview.x, top: preview.y }}
        >
          {preview.title}
        </div>
      )}
      <Dialog
        open={Boolean(modal)}
        onOpenChange={(open) => {
          if (!open && !busy) setModal("");
        }}
      >
        <DialogContent className="dialog-content editor sprint-modal">
          <DialogTitle>
            {(
              {
                create: "新建冲刺",
                edit: "编辑冲刺",
                add: "加入已有工作项",
                finish: "结束冲刺",
                new: "新建工作项",
                block: "设置阻塞标记",
              } as Record<string, string>
            )[modal] || "冲刺"}
          </DialogTitle>
          <DialogDescription>
            {modal === "finish"
              ? `本轮还有 ${unfinished.length} 项未完成，结束后将保存当前结果。`
              : modal === "block"
                ? "标记阻塞会保留当前阶段；解除后可继续推进。"
                : modal === "add"
                  ? "选择未加入任何未结束冲刺的工作项。"
                  : "围绕这一轮的目标安排工作。"}
          </DialogDescription>
          {error && (
            <div role="alert" className="message error">
              {error}
            </div>
          )}
          {(modal === "create" || modal === "edit") && (
            <form
              className="editor-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                if (modal === "create") {
                  setBusy(true);
                  setError("");
                  try {
                    const r = await api<{ data: Sprint }>("/api/v1/sprints", {
                      method: "POST",
                      body: JSON.stringify(form),
                    });
                    setModal("");
                    setParams({ sprint: r.data.id });
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                } else if (
                  await action("", {
                    sprint: form,
                    expectedVersion: formVersion.current,
                  })
                )
                  setModal("");
              }}
            >
              <fieldset disabled={busy}>
                <label className="field">
                  名称
                  <Input
                    required
                    maxLength={100}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </label>
                <label className="field">
                  目标
                  <textarea
                    maxLength={1000}
                    value={form.goal}
                    onChange={(e) => setForm({ ...form, goal: e.target.value })}
                  />
                </label>
                <div className="field-grid">
                  <div className="field">
                    开始日期
                    <DatePicker
                      label="开始日期"
                      disabled={busy}
                      value={form.startDate}
                      onChange={(value) =>
                        setForm((previous) => ({
                          ...previous,
                          startDate: value,
                          endDate:
                            previous.endDate < value ? value : previous.endDate,
                        }))
                      }
                    />
                  </div>
                  <div className="field">
                    结束日期
                    <DatePicker
                      label="结束日期"
                      disabled={busy}
                      min={form.startDate}
                      value={form.endDate}
                      onChange={(value) =>
                        setForm((previous) => ({ ...previous, endDate: value }))
                      }
                    />
                  </div>
                </div>
              </fieldset>
              <div className="sprint-modal-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setModal("")}
                >
                  取消
                </Button>
                <Button disabled={busy}>保存冲刺</Button>
              </div>
            </form>
          )}
          {modal === "add" && (
            <>
              <Input
                aria-label="搜索未安排工作项"
                placeholder="搜索未安排的工作项…"
                value={candidateQ}
                onChange={(e) => {
                  setCandidateQ(e.target.value);
                  setCandidatePage(1);
                }}
              />
              <div className="sprint-candidates" aria-busy={candidateLoading}>
                {candidateLoading ? (
                  <p>正在加载…</p>
                ) : (
                  candidates.data.map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={selected.some((x) => x.id === item.id)}
                        onChange={(e) =>
                          setSelected((prev) =>
                            e.target.checked
                              ? [...prev.filter((x) => x.id !== item.id), item]
                              : prev.filter((x) => x.id !== item.id),
                          )
                        }
                      />
                      <span>
                        {item.title}
                        <small>
                          {typeLabels[item.type]} · {statusLabels[item.status]}
                        </small>
                      </span>
                    </label>
                  ))
                )}
                {!candidateLoading && !candidates.data.length && (
                  <p>没有可加入的工作项</p>
                )}
              </div>
              <div className="pagination">
                <Button
                  variant="ghost"
                  disabled={candidatePage === 1 || candidateLoading}
                  onClick={() => setCandidatePage((p) => p - 1)}
                >
                  上一页
                </Button>
                <span>
                  {candidatePage} /{" "}
                  {Math.max(1, Math.ceil(candidates.meta.total / 20))}
                </span>
                <Button
                  variant="ghost"
                  disabled={
                    candidatePage * 20 >= candidates.meta.total ||
                    candidateLoading
                  }
                  onClick={() => setCandidatePage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
              <div className="sprint-modal-actions">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setModal("")}
                >
                  取消
                </Button>
                <Button
                  disabled={busy || !selected.length || selected.length > 100}
                  onClick={async () => {
                    if (
                      await action("add", {
                        items: selected.map((x) => ({
                          id: x.id,
                          expectedVersion: x.version,
                        })),
                      })
                    )
                      setModal("");
                  }}
                >
                  加入 {selected.length} 项
                </Button>
              </div>
            </>
          )}
          {modal === "finish" && (
            <>
              <div className="sprint-finish-list">
                {unfinished.map((i) => (
                  <p key={i.id}>
                    {i.title}
                    <small>{statusLabels[i.status]}</small>
                  </p>
                ))}
                {!unfinished.length && <p>所有工作项均已完成或取消。</p>}
              </div>
              <Choice
                label="未完成项处理方式"
                value={target}
                options={{
                  backlog: "退回待规划区",
                  ...Object.fromEntries(
                    sprints
                      .filter((s) => s.state === "planned")
                      .map((s) => [s.id, `结转到 ${s.name}`]),
                  ),
                }}
                disabled={busy}
                onChange={setTarget}
              />
              <div className="sprint-modal-actions">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setModal("")}
                >
                  继续冲刺
                </Button>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await action("finish", {
                        targetSprintId: target === "backlog" ? null : target,
                        targetVersion:
                          target === "backlog"
                            ? undefined
                            : sprints.find((s) => s.id === target)?.version,
                      })
                    )
                      setModal("");
                  }}
                >
                  确认结束冲刺
                </Button>
              </div>
            </>
          )}
          {modal === "block" && blockItem && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await mutate(
                    `/api/v1/work-items/${blockItem.id}`,
                    {
                      blockedReason: blockReason,
                      expectedVersion: blockItem.version,
                    },
                    "PATCH",
                  )
                )
                  setModal("");
              }}
            >
              <label className="field">
                阻塞原因
                <textarea
                  aria-label="阻塞原因"
                  required
                  maxLength={1000}
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  disabled={busy}
                />
              </label>
              <div className="sprint-modal-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setModal("")}
                >
                  取消
                </Button>
                {blockItem.blockedReason && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await mutate(
                          `/api/v1/work-items/${blockItem.id}`,
                          {
                            blockedReason: "",
                            expectedVersion: blockItem.version,
                          },
                          "PATCH",
                        )
                      )
                        setModal("");
                    }}
                  >
                    解除阻塞
                  </Button>
                )}
                <Button disabled={busy || !blockReason.trim()}>保存标记</Button>
              </div>
            </form>
          )}
          {modal === "new" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await action("create-item", {
                    item: { title },
                    status: newStatus,
                    requestKey: requestKey.current,
                  })
                )
                  setModal("");
              }}
            >
              <label className="field">
                标题
                <Input
                  required
                  maxLength={200}
                  value={title}
                  disabled={busy}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    requestKey.current = crypto.randomUUID();
                  }}
                />
              </label>
              <p className="muted">
                创建到「{statusLabels[newStatus]}」，其他信息可在详情中补充。
              </p>
              <div className="sprint-modal-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setModal("")}
                >
                  取消
                </Button>
                <Button disabled={busy}>创建工作项</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open && detailReadOnly) setDetail(null);
        }}
      >
        <DialogContent
          className={`dialog-content editor sprint-drawer ${detailReadOnly ? "sprint-snapshot" : ""}`}
          onEscapeKeyDown={(e) => {
            if (!detailReadOnly) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (!detailReadOnly) e.preventDefault();
          }}
        >
          <DialogTitle className="sr-only">
            {detailReadOnly ? "冲刺结束时的工作项" : "工作项详情"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            查看工作项内容
          </DialogDescription>
          {detail &&
            (detailReadOnly ? (
              <>
                <div className="editor-heading">
                  <h2>{detail.title}</h2>
                  <Button variant="ghost" onClick={() => setDetail(null)}>
                    关闭
                  </Button>
                </div>
                <p className="muted">
                  结束时快照 · {statusLabels[detail.status]} ·{" "}
                  {priorityLabels[detail.priority]}
                </p>
                {detail.blockedReason && (
                  <p className="sprint-blocked">阻塞：{detail.blockedReason}</p>
                )}
                <RichText
                  value={detail.description}
                  disabled
                  onChange={() => {}}
                  onUploading={() => {}}
                />
              </>
            ) : (
              <Editor
                embedded
                key={`${detail.id}:${detail.version}`}
                item={detail}
                onClose={() => {
                  setDetail(null);
                  void refresh();
                  refreshSummary();
                }}
                onSaved={(saved) => {
                  setDetail(saved);
                  void refresh();
                  refreshSummary();
                }}
                onNotice={setNotice}
              />
            ))}
        </DialogContent>
      </Dialog>
    </div>
  );
}
