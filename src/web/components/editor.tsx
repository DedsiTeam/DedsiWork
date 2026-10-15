import { DatePicker } from "./date-picker";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useBlocker } from "react-router";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  Clock3,
  RotateCcw,
  Save,
  Trash2,
  ArrowLeft,
  LoaderCircle,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { RichText } from "./rich-text";
import { DeleteConfirmation } from "./ui/alert-dialog";
import { MAX_DESCRIPTION_LENGTH } from "../../shared/description";
import { Label } from "./ui/label";
import { Choice } from "./choice";
import { api } from "../api";
import { useWorkspace } from "../workspace-context";
import {
  statusLabels,
  needsReturnReason,
  typeLabels,
  priorityLabels,
  type WorkItem,
  type WorkItemInput,
  type WorkItemEvent,
  type Page,
} from "../../shared/work-item";

export const formatDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const eventLabels: Record<string, string> = {
  created: "创建了工作项",
  updated: "更新了工作项",
  deleted: "移入回收站",
  restored: "恢复了工作项",
};
const fieldLabels: Record<string, string> = {
  title: "标题",
  description: "描述",
  status: "状态",
  priority: "优先级",
  type: "类型",
  dueAt: "截止时间",
  deletedAt: "删除状态",
  blockedReason: "阻塞原因",
  transitionReason: "退回原因",
};
function localDate(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function Editor({
  item,
  onClose,
  onSaved,
  onNotice,
  embedded = false,
  initialDraft,
}: {
  embedded?: boolean;
  initialDraft?: WorkItemInput;
  item: WorkItem | null;
  onClose: () => void;
  onSaved: (item: WorkItem) => void;
  onNotice: (message: string) => void;
}) {
  const { notify } = useWorkspace();
  const initial: WorkItemInput =
    initialDraft && !item
      ? initialDraft
      : {
          title: item?.title || "",
          description: item?.description || "",
          status: item?.status || "todo",
          type: item?.type || "task",
          priority: item?.priority || "normal",
          dueAt: item?.dueAt || null,
          blockedReason: item?.blockedReason || "",
        };
  const [transitionReason, setTransitionReason] = useState("");
  const [form, setForm] = useState(initial),
    [due, setDue] = useState(localDate(initial.dueAt));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [latest, setLatest] = useState(item?.version || 1);
  const [events, setEvents] = useState<WorkItemEvent[]>([]),
    [eventPage, setEventPage] = useState(1),
    [eventTotal, setEventTotal] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const lifecycleButton = useRef<HTMLButtonElement>(null);
  const request = useRef({ payload: "", key: crypto.randomUUID() });
  const dirty =
    Boolean(initialDraft && !item) ||
    JSON.stringify(form) !== JSON.stringify(initial) ||
    due !== localDate(initial.dueAt);
  const deleted = Boolean(item?.deletedAt);
  const skipNavigationGuard = useRef(false);
  const blocker = useBlocker(
    () => !skipNavigationGuard.current && (dirty || busy || uploading),
  );
  useEffect(() => {
    if (blocker.state === "blocked" && (busy || uploading)) blocker.reset();
  }, [blocker, busy, uploading]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  useEffect(() => {
    if (!item) return;
    let alive = true;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const [current, activity] = await Promise.all([
          api<{ data: WorkItem }>(
            `/api/v1/work-items/${item.id}?includeDeleted=true`,
          ),
          api<Page<WorkItemEvent>>(
            `/api/v1/work-items/${item.id}/events?page=${eventPage}&pageSize=10`,
          ),
        ]);
        if (alive) {
          setLatest(current.data.version);
          setEvents(activity.data);
          setEventTotal(activity.meta.total);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [item?.id, item?.version, eventPage]);
  const change = <K extends keyof WorkItemInput>(
    key: K,
    value: WorkItemInput[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));
  function close() {
    if (busy || uploading) return;
    if (
      embedded &&
      dirty &&
      !window.confirm("有未保存的修改，确认放弃并关闭？")
    )
      return;
    onClose();
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || uploading) return;
    if (form.description.length > MAX_DESCRIPTION_LENGTH) {
      setError("描述容量已超出，请减少图片或文字。");
      notify("描述容量已超出，请减少图片或文字。", "error");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...form,
        blockedReason: ["done", "cancelled"].includes(form.status)
          ? ""
          : form.blockedReason,
        dueAt: due ? new Date(due).toISOString() : null,
      };
      const serialized = JSON.stringify(payload);
      if (request.current.payload !== serialized)
        request.current = { payload: serialized, key: crypto.randomUUID() };
      const result = await api<{ data: WorkItem }>(
        item ? `/api/v1/work-items/${item.id}` : "/api/v1/work-items",
        {
          method: item ? "PATCH" : "POST",
          headers: item ? {} : { "Idempotency-Key": request.current.key },
          body: JSON.stringify(
            item
              ? { ...payload, transitionReason, expectedVersion: item.version }
              : payload,
          ),
        },
      );
      skipNavigationGuard.current = true;
      onSaved(result.data);
      notify(
        item?.status === "done" && result.data.status === "todo"
          ? "工作项已修改，状态已变为待处理"
          : item
            ? "工作项修改成功"
            : "工作项创建成功",
      );
    } catch (e) {
      setError((e as Error).message);
      notify(
        `${item ? "修改失败" : "创建失败"}：${(e as Error).message}`,
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  async function lifecycle() {
    if (!item || busy || uploading) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/api/v1/work-items/${item.id}${deleted ? "/restore" : ""}`,
        deleted
          ? {
              method: "POST",
              body: JSON.stringify({ expectedVersion: item.version }),
            }
          : { method: "DELETE", headers: { "If-Match": String(item.version) } },
      );
      onNotice(deleted ? "工作项已恢复" : "已移入回收站，可随时恢复");
      skipNavigationGuard.current = true;
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    if (
      !item ||
      (dirty && !window.confirm("重新加载将丢弃未保存的修改，是否继续？"))
    )
      return;
    try {
      onSaved(
        (
          await api<{ data: WorkItem }>(
            `/api/v1/work-items/${item.id}?includeDeleted=true`,
          )
        ).data,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const statusOptions =
    item && ["done", "cancelled"].includes(item.status)
      ? { [item.status]: statusLabels[item.status], todo: "重新打开为待处理" }
      : statusLabels;
  return (
    <section
      className="editor editor-page"
      aria-label={item ? "修改工作项" : "创建工作项"}
    >
      <div className="editor-heading">
        <div>
          <h1>{item ? "修改工作项" : "创建工作项"}</h1>
        </div>
        <Button
          variant="ghost"
          aria-label={embedded ? "关闭详情" : "返回工作项列表"}
          onClick={close}
          disabled={busy || uploading}
        >
          <ArrowLeft /> {embedded ? "关闭详情" : "返回列表"}
        </Button>
      </div>
      {error && (
        <div role="alert" className="message error">
          {error}
        </div>
      )}
      {item && latest !== item.version && (
        <div className="message">
          此工作项已有新版本，你的输入已保留。
          <Button variant="link" onClick={reload}>
            重新加载
          </Button>
        </div>
      )}
      {deleted && (
        <div className="message">此工作项在回收站中，恢复后可以继续编辑。</div>
      )}
      <form onSubmit={save} className="editor-form">
        <fieldset disabled={busy || deleted}>
          <div className="field">
            <Label htmlFor="item-title">
              标题 <span aria-hidden="true">*</span>
            </Label>
            <Input
              autoFocus
              id="item-title"
              placeholder="下一件要推进的事是什么？"
              required
              maxLength={200}
              value={form.title}
              onChange={(e) => change("title", e.target.value)}
            />
          </div>
          <div className="field-grid">
            <div className="field">
              <Label>类型</Label>
              <Choice
                label="工作项类型"
                value={form.type}
                options={typeLabels}
                onChange={(value) => change("type", value as WorkItem["type"])}
              />
            </div>
            <div className="field">
              <Label>优先级</Label>
              <Choice
                label="工作项优先级"
                value={form.priority}
                options={priorityLabels}
                onChange={(value) =>
                  change("priority", value as WorkItem["priority"])
                }
              />
            </div>
          </div>
          <div className="field-grid">
            <div className="field">
              <Label>状态</Label>
              <Choice
                label="工作项状态"
                disabled={!item}
                value={form.status}
                options={statusOptions}
                onChange={(value) =>
                  change("status", value as WorkItem["status"])
                }
              />
            </div>
            <div className="field">
              <Label htmlFor="due-at">截止时间</Label>
              <DatePicker
                id="due-at"
                label="截止时间"
                value={due}
                onChange={setDue}
                withTime
                clearable
              />
            </div>
          </div>
          {item && needsReturnReason(item.status, form.status) && (
            <div className="field">
              <Label htmlFor="transition-reason">退回原因</Label>
              <Input
                id="transition-reason"
                required
                maxLength={1000}
                value={transitionReason}
                onChange={(e) => setTransitionReason(e.target.value)}
              />
            </div>
          )}
          <div className="field">
            <Label htmlFor="blocked-reason">阻塞原因</Label>
            <Input
              id="blocked-reason"
              maxLength={1000}
              placeholder="填写原因标记阻塞，清空后解除；保留当前阶段"
              value={form.blockedReason}
              disabled={["done", "cancelled"].includes(form.status)}
              onChange={(e) => change("blockedReason", e.target.value)}
            />
          </div>
          <div className="field">
            <Label htmlFor="item-description">描述</Label>
            <RichText
              value={form.description}
              disabled={busy || deleted}
              onChange={(value) => change("description", value)}
              onUploading={setUploading}
            />
          </div>
        </fieldset>
        <div className="editor-actions">
          {!deleted && (
            <Button
              type="submit"
              disabled={busy || uploading || (!dirty && Boolean(item))}
            >
              {busy ? <LoaderCircle className="ai-spin" /> : <Save />}
              {busy
                ? item
                  ? "保存中…"
                  : "创建中…"
                : item
                  ? "保存修改"
                  : "创建工作项"}
            </Button>
          )}
          {item && (
            <Button
              type="button"
              variant="outline"
              ref={lifecycleButton}
              onClick={() => {
                if (deleted) void lifecycle();
                else setConfirmDelete(true);
              }}
              disabled={busy || uploading}
            >
              {deleted ? <RotateCcw /> : <Trash2 />}
              {deleted ? "恢复工作项" : "移入回收站"}
            </Button>
          )}
        </div>
      </form>
      {item && (
        <div className="activity">
          <div className="section-heading">
            <h3>
              <Clock3 size={15} /> 活动记录
            </h3>
            <span>版本 {item.version}</span>
          </div>
          {events.map((event) => (
            <div className="event" key={event.id}>
              <span className="event-dot">
                <Check size={10} />
              </span>
              <div>
                <p>
                  <strong>
                    {event.source === "mcp" ? "MCP 客户端" : "你"}
                  </strong>{" "}
                  {eventLabels[event.action] || event.action}
                </p>
                {event.changes.transitionReason && (
                  <small>
                    退回原因：{String(event.changes.transitionReason.after)}
                  </small>
                )}
                {event.action === "updated" && (
                  <small>
                    {Object.keys(event.changes)
                      .map((k) => fieldLabels[k] || k)
                      .join("、")}
                  </small>
                )}
                {event.changes.status && (
                  <small>
                    状态：
                    {statusLabels[
                      event.changes.status.before as WorkItem["status"]
                    ] || String(event.changes.status.before)}
                    {" → "}
                    {statusLabels[
                      event.changes.status.after as WorkItem["status"]
                    ] || String(event.changes.status.after)}
                  </small>
                )}
                <time>{formatDate(event.createdAt)}</time>
              </div>
            </div>
          ))}
          {!events.length && <p className="muted">暂无活动记录</p>}
          {eventTotal > 10 && (
            <div className="pagination">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={eventPage === 1}
                onClick={() => setEventPage((p) => p - 1)}
              >
                上一页
              </Button>
              <span>
                {eventPage} / {Math.ceil(eventTotal / 10)}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={eventPage * 10 >= eventTotal}
                onClick={() => setEventPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </div>
      )}
      {blocker.state === "blocked" && !busy && !uploading && (
        <AlertDialog.Root
          open
          onOpenChange={(open) => {
            if (!open) blocker.reset();
          }}
        >
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="dialog-overlay confirmation-overlay" />
            <AlertDialog.Content className="confirmation-content">
              <AlertDialog.Title>离开编辑页面？</AlertDialog.Title>
              <AlertDialog.Description>
                有未保存的修改，离开后这些修改将丢失。
              </AlertDialog.Description>
              <div className="confirmation-actions">
                <AlertDialog.Cancel asChild>
                  <Button variant="outline">继续编辑</Button>
                </AlertDialog.Cancel>
                <Button onClick={() => blocker.proceed()}>
                  放弃修改并离开
                </Button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      )}
      <DeleteConfirmation
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={item?.title || ""}
        onConfirm={() => void lifecycle()}
        restoreFocus={() => lifecycleButton.current?.focus()}
      />
    </section>
  );
}
