import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import * as Dialog from "@radix-ui/react-dialog";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import {
  ArrowLeft,
  ArrowRight,
  Code2,
  FolderOpen,
  GitBranch,
  Play,
  Plus,
  Square,
  Check,
  RefreshCw,
  X,
  Copy,
  ExternalLink,
} from "lucide-react";
import { api, subscribeApi } from "../api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useWorkspace } from "../workspace-context";
import { ChatMessage, RequestCard } from "./chat";
import {
  developmentStatusLabels,
  type DevelopmentTask,
  type RepositorySelection,
  type DevelopmentChanges,
  type DevelopmentMergePreview,
} from "../../shared/development-task";
import type { CodexStatus } from "../../shared/domain-model-ai";
import type { WorkItem, Page } from "../../shared/work-item";
import type { DomainModelList } from "../../shared/domain-model";
import "../development-tasks.css";

const root = "/api/v1/development-tasks";
const active = (task: DevelopmentTask) =>
  ["preparing", "running", "waiting", "stopping"].includes(task.status);
const date = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });
function Status({ task }: { task: DevelopmentTask }) {
  return (
    <span className={`dev-status dev-status-${task.status}`}>
      {active(task) && <span className="dev-status-dot" />}
      {task.merge
        ? `已合并到 ${task.merge.targetBranch}`
        : developmentStatusLabels[task.status]}
    </span>
  );
}
export function DevelopmentTasksPage() {
  const [tasks, setTasks] = useState<DevelopmentTask[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const result = await api<{ data: DevelopmentTask[] }>(root, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setTasks(result.data);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(load, 2500);
        }
      }
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  const filtered = tasks.filter(
    (task) =>
      filter === "all" ||
      (filter === "active" ? active(task) : task.status === filter),
  );
  return (
    <div className="workspace-content dev-page">
      <div className="page-heading">
        <div>
          <h1>研发任务</h1>
        </div>
        <Button asChild>
          <Link to="/development-tasks/new">
            <Plus />
            新建研发任务
          </Link>
        </Button>
      </div>
      <div className="dev-filters" role="group" aria-label="筛选研发任务">
        {[
          ["all", "全部任务"],
          ["active", "执行中"],
          ["review", "待验收"],
          ["completed", "已完成"],
        ].map(([value, label]) => (
          <Button
            key={value}
            variant={filter === value ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={filter === value}
            onClick={() => setFilter(value!)}
          >
            {label}
          </Button>
        ))}
        <span>{filtered.length} 个任务</span>
      </div>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">正在加载研发任务…</p>
      ) : !filtered.length ? (
        <div className="dev-empty">
          <Code2 size={32} />
          <h2>
            {tasks.length ? "暂无符合条件的任务" : "开始你的第一个研发任务"}
          </h2>
          <p>选择本地代码目录，关联工作项与领域模型，交给 Codex 实现。</p>
          {!tasks.length && (
            <Button asChild>
              <Link to="/development-tasks/new">
                <Plus />
                新建研发任务
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="dev-task-grid">
          {filtered.map((task) => (
            <Link
              className="dev-task-card"
              key={task.id}
              to={`/development-tasks/${task.id}`}
            >
              <div className="dev-card-heading">
                <Code2 size={20} />
                <Status task={task} />
              </div>
              <h2>{task.title}</h2>
              <p className="dev-card-requirement">
                {task.requirement || "按照关联工作项完成研发"}
              </p>
              <div className="dev-card-branch">
                <GitBranch size={14} />
                {task.branch}
              </div>
              <div className="dev-card-sources">
                {task.sources.items.length} 工作项 ·{" "}
                {task.sources.models.length} 领域模型
              </div>
              <footer>
                <span>{date(task.updatedAt)}</span>
                <ArrowRight size={15} />
              </footer>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

type SourceOption = { id: string; title: string; version: number };
function SourcePicker({
  kind,
  selected,
  onSelect,
  onClose,
}: {
  kind: "items" | "models";
  selected: string[];
  onSelect: (value: SourceOption) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState<SourceOption[]>([]),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(async () => {
      try {
        const query = new URLSearchParams({ q, page: String(page) });
        if (kind === "items") {
          const result = await api<Page<WorkItem>>(
            `/api/v1/work-items?${query}`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) {
            setData(
              result.data.map((i) => ({
                id: i.id,
                title: i.title,
                version: i.version,
              })),
            );
            setTotal(result.meta.total);
          }
        } else {
          const result = await api<DomainModelList>(
            `/api/v1/domain-models?${query}`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) {
            setData(
              result.data.map((m) => ({
                id: m.id,
                title: m.name,
                version: m.version,
              })),
            );
            setTotal(result.meta.total);
          }
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [q, page, kind]);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="confirmation-content dev-source-picker">
          <Dialog.Title>
            选择{kind === "items" ? "工作项" : "领域模型"}
          </Dialog.Title>
          <Dialog.Description>
            仅展示当前工作空间的数据，创建任务时保存内容快照。
          </Dialog.Description>
          <Input
            aria-label="搜索关联内容"
            placeholder="搜索名称或说明…"
            value={q}
            maxLength={200}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <div className="dev-source-options">
            {loading ? (
              <p role="status">正在加载…</p>
            ) : error ? (
              <p role="alert">{error}</p>
            ) : !data.length ? (
              <p>没有找到可关联的内容。</p>
            ) : (
              data.map((value) => (
                <button
                  key={value.id}
                  onClick={() => onSelect(value)}
                  aria-pressed={selected.includes(value.id)}
                >
                  <span>
                    {value.title}
                    <small>版本 {value.version}</small>
                  </span>
                  {selected.includes(value.id) ? (
                    <Check size={16} />
                  ) : (
                    <Plus size={16} />
                  )}
                </button>
              ))
            )}
          </div>
          <div className="dev-actions">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </Button>
            <span>
              {page} / {Math.max(1, Math.ceil(total / 20))}
            </span>
            <Button
              variant="outline"
              disabled={page * 20 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
            <Button onClick={onClose}>完成选择</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function DevelopmentTaskCreatePage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState(""),
    [requirement, setRequirement] = useState(""),
    [selection, setSelection] = useState<RepositorySelection | null>(null),
    [base, setBase] = useState(""),
    [model, setModel] = useState("");
  const [items, setItems] = useState<SourceOption[]>([]),
    [models, setModels] = useState<SourceOption[]>([]),
    [picker, setPicker] = useState<"items" | "models" | null>(null);
  const [choosing, setChoosing] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [status, setStatus] = useState<CodexStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<{ data: CodexStatus }>(`${root}/status`, { signal: controller.signal })
      .then((r) => setStatus(r.data))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  async function choose() {
    setChoosing(true);
    setError("");
    try {
      const result = await api<{ data: RepositorySelection | null }>(
        `${root}/select-directory`,
        { method: "POST" },
      );
      if (result.data) {
        setSelection(result.data);
        setBase(result.data.currentBranch);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChoosing(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selection || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<{ data: DevelopmentTask }>(root, {
        method: "POST",
        body: JSON.stringify({
          title,
          requirement,
          directoryToken: selection.token,
          baseBranch: base,
          model,
          itemIds: items.map((i) => i.id),
          modelIds: models.map((m) => m.id),
        }),
      });
      navigate(`/development-tasks/${result.data.id}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function toggle(value: SourceOption) {
    const list = picker === "items" ? items : models,
      set = picker === "items" ? setItems : setModels,
      limit = picker === "items" ? 20 : 10;
    if (list.some((i) => i.id === value.id))
      set(list.filter((i) => i.id !== value.id));
    else if (list.length < limit) {
      set([...list, value]);
      if (!title) setTitle(value.title);
    }
  }
  return (
    <div className="workspace-content dev-page">
      <div className="page-heading">
        <h1>新建研发任务</h1>
        <Button variant="ghost" asChild>
          <Link to="/development-tasks">
            <ArrowLeft />
            返回任务列表
          </Link>
        </Button>
      </div>
      <form className="dev-create-form" onSubmit={submit}>
        <fieldset disabled={saving}>
          <section className="dev-panel">
            <h2>任务信息</h2>
            <label>
              任务名称
              <Input
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：实现订单审核流程"
              />
            </label>
            <label>
              研发要求
              <textarea
                rows={5}
                maxLength={16000}
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
                placeholder="补充实现范围、技术约束与验收标准；也可以直接关联已有工作项。"
              />
            </label>
          </section>
          <section className="dev-panel">
            <h2>代码与执行环境</h2>
            <label>
              本地代码目录
              <div className="dev-directory">
                <output title={selection?.directory}>
                  {selection?.directory || "请选择本地 Git 仓库"}
                </output>
                <Button
                  type="button"
                  variant="outline"
                  disabled={choosing}
                  onClick={() => void choose()}
                >
                  <FolderOpen />
                  {choosing
                    ? "正在选择…"
                    : selection
                      ? "重新选择"
                      : "选择文件夹"}
                </Button>
              </div>
            </label>
            <p className="dev-help">
              仅支持文件夹选择器。任务从起始分支的已提交代码创建独立工作树，不包含原目录中的未提交修改。
            </p>
            <div className="dev-form-columns">
              <label>
                起始分支
                <select
                  disabled={!selection}
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                >
                  {!selection && <option value="">请先选择代码目录</option>}
                  {selection?.branches.map((branch) => (
                    <option key={branch}>{branch}</option>
                  ))}
                </select>
              </label>
              <label>
                执行模型
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="">Codex 默认模型</option>
                  {status?.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
          <section className="dev-panel">
            <h2>关联需求与设计</h2>
            <div className="dev-source-group">
              <div>
                <h3>
                  工作项 <small>{items.length}/20</small>
                </h3>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPicker("items")}
                >
                  <Plus />
                  选择工作项
                </Button>
              </div>
              <div className="dev-source-chips">
                {items.map((i) => (
                  <span key={i.id}>
                    {i.title}
                    <button
                      type="button"
                      aria-label={`移除 ${i.title}`}
                      onClick={() =>
                        setItems(items.filter((v) => v.id !== i.id))
                      }
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {!items.length && (
                  <p>关联要实现的工作项，或在上方填写研发要求。</p>
                )}
              </div>
            </div>
            <div className="dev-source-group">
              <div>
                <h3>
                  领域模型 <small>{models.length}/10 · 可选</small>
                </h3>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPicker("models")}
                >
                  <Plus />
                  选择领域模型
                </Button>
              </div>
              <div className="dev-source-chips">
                {models.map((m) => (
                  <span key={m.id}>
                    {m.title}
                    <button
                      type="button"
                      aria-label={`移除 ${m.title}`}
                      onClick={() =>
                        setModels(models.filter((v) => v.id !== m.id))
                      }
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {!models.length && <p>关联业务结构和设计约束。</p>}
              </div>
            </div>
            <p className="dev-help">
              创建时保存所选内容及版本快照，后续编辑工作项或模型不会改变执行依据。
            </p>
          </section>
          {error && (
            <p className="message error" role="alert">
              {error}
            </p>
          )}
          <div className="dev-create-footer">
            <span>创建后自动执行 · 人工验收 · 手动合并</span>
            <Button
              type="submit"
              disabled={
                saving ||
                choosing ||
                !selection ||
                !title.trim() ||
                (!items.length && !requirement.trim())
              }
            >
              {saving ? "正在创建并启动…" : "创建并开始研发"}
            </Button>
          </div>
        </fieldset>
      </form>
      {picker && (
        <SourcePicker
          kind={picker}
          selected={(picker === "items" ? items : models).map((v) => v.id)}
          onSelect={toggle}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

export function DevelopmentTaskPage() {
  const { id } = useParams(),
    { notify } = useWorkspace();
  const [task, setTask] = useState<DevelopmentTask | null>(null),
    [error, setError] = useState(""),
    [connection, setConnection] = useState("正在连接实时进度…"),
    [busy, setBusy] = useState("");
  const [tab, setTab] = useState("progress"),
    [text, setText] = useState(""),
    [changes, setChanges] = useState<DevelopmentChanges | null>(null),
    [changesError, setChangesError] = useState(""),
    [changesLoading, setChangesLoading] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState<CodexStatus | null>(null),
    [loginUrl, setLoginUrl] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false),
    [mergePreview, setMergePreview] = useState<DevelopmentMergePreview | null>(
      null,
    ),
    [mergeError, setMergeError] = useState("");
  const viewport = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const currentId = useRef(id);
  currentId.current = id;
  const accept = (value: DevelopmentTask) =>
    setTask((previous) =>
      value.id !== currentId.current
        ? previous
        : !previous ||
            previous.id !== value.id ||
            value.version >= previous.version
          ? value
          : previous,
    );
  useEffect(() => {
    setTask(null);
    setText("");
    setChanges(null);
    setConfirm(false);
    setBusy("");
    setConnection("正在连接实时进度…");
    setMergeOpen(false);
    setMergePreview(null);
    setMergeError("");
    follow.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const connect = async () => {
      try {
        const initial = await api<{ data: DevelopmentTask }>(`${root}/${id}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        accept(initial.data);
        setError("");
        await subscribeApi<DevelopmentTask>(
          `${root}/${id}/events`,
          controller.signal,
          (value) => {
            if (!controller.signal.aborted) {
              accept(value);
              setConnection("实时进度已连接");
            }
          },
        );
        if (!controller.signal.aborted)
          setConnection("进度连接已断开，正在重连…");
      } catch (e) {
        if (!controller.signal.aborted) {
          setConnection("进度连接失败，正在重连…");
          setError((e as Error).message);
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(connect, 2000);
      }
    };
    void connect();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id]);
  useEffect(() => {
    if (follow.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [task?.snapshot?.revision, tab]);
  async function refreshStatus() {
    try {
      const result = await api<{ data: CodexStatus }>(`${root}/status`);
      setStatus(result.data);
      if (result.data.ready) setLoginUrl("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refreshStatus();
  }, []);
  async function action(name: string) {
    if (busy || !task) return;
    setBusy(name);
    setError("");
    try {
      const result = await api<{ data: DevelopmentTask }>(
        `${root}/${task.id}/${name}`,
        { method: "POST" },
      );
      if (result.data?.id) accept(result.data);
      if (name === "complete") {
        setConfirm(false);
        notify("研发任务已完成，分支和工作树已保留");
      }
      if (name === "handoff")
        notify(
          "已打开 ChatGPT。请粘贴接管上下文并打开任务目录，当前不会自动接续原会话。",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function previewMerge() {
    setMergeOpen(true);
    setMergePreview(null);
    setMergeError("");
    setBusy("merge-preview");
    try {
      const result = await api<{ data: DevelopmentMergePreview }>(
        `${root}/${id}/merge-preview`,
      );
      setMergePreview(result.data);
    } catch (e) {
      setMergeError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function confirmMerge() {
    if (!mergePreview?.token || busy) return;
    setBusy("merge");
    setMergeError("");
    try {
      const result = await api<{ data: DevelopmentTask }>(
        `${root}/${id}/merge`,
        {
          method: "POST",
          body: JSON.stringify({ token: mergePreview.token, confirmed: true }),
        },
      );
      accept(result.data);
      setMergeOpen(false);
      setChanges(null);
      notify(
        `已合并到 ${result.data.merge?.targetBranch}，${result.data.merge?.cleanedAt ? "研发分支和工作树已清理" : "清理未完成，请查看提示"}`,
      );
    } catch (e) {
      setMergeError((e as Error).message);
      setMergePreview(null);
    } finally {
      setBusy("");
    }
  }
  async function loadChanges() {
    const requestedId = id;
    setChangesLoading(true);
    setChangesError("");
    try {
      const result = await api<{ data: DevelopmentChanges }>(
        `${root}/${id}/changes`,
      );
      if (currentId.current === requestedId) setChanges(result.data);
    } catch (e) {
      if (currentId.current === requestedId)
        setChangesError((e as Error).message);
    } finally {
      if (currentId.current === requestedId) setChangesLoading(false);
    }
  }
  useEffect(() => {
    if (tab === "changes") void loadChanges();
  }, [tab, id]);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy("messages");
    setError("");
    try {
      const result = await api<{ data: DevelopmentTask }>(
        `${root}/${id}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ text, clientId: crypto.randomUUID() }),
        },
      );
      accept(result.data);
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function copyContext() {
    if (!task) return;
    const context = [
      `请接管以下研发任务：${task.title}`,
      `任务工作目录：${task.worktree}`,
      `原仓库：${task.repository}`,
      `研发分支：${task.branch}`,
      `起始分支：${task.baseBranch}（${task.baseCommit}）`,
      `Codex 会话 ID：${task.chatId || "尚未创建"}`,
      `研发要求：${task.requirement}`,
      "约束：不运行测试，由用户测试，不自动提交、推送或合并。请先检查当前代码和差异。",
      `需求与模型快照：\n${JSON.stringify(task.sources, null, 2)}`,
      `近期执行记录：\n${(task.snapshot?.items || [])
        .slice(-10)
        .map((i) => `${i.type}: ${i.text.slice(-4000)}`)
        .join("\n\n")}`,
    ].join("\n\n");
    try {
      await navigator.clipboard.writeText(context);
      notify("接管上下文已复制");
    } catch {
      setError("复制失败，请检查系统剪贴板权限");
    }
  }
  async function login() {
    setBusy("login");
    setError("");
    try {
      const { data } = await api<{ data: { authUrl: string } }>(
        `${root}/login`,
        { method: "POST" },
      );
      setLoginUrl(data.authUrl);
      await api("/api/v1/chat/open-link", {
        method: "POST",
        body: JSON.stringify({ url: data.authUrl }),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (!task)
    return (
      <div className="workspace-content dev-page">
        <Button variant="ghost" asChild>
          <Link to="/development-tasks">
            <ArrowLeft />
            返回任务列表
          </Link>
        </Button>
        <p role={error ? "alert" : "status"}>{error || "正在加载研发任务…"}</p>
      </div>
    );
  const running = active(task),
    canStart = !running && task.status !== "completed" && !task.restored;
  const latest = [...(task.snapshot?.items || [])]
    .reverse()
    .find(
      (i) =>
        i.role === "tool" &&
        ["inProgress", "in_progress"].includes(i.status || ""),
    );
  return (
    <div className="workspace-content dev-page dev-detail">
      <div className="page-heading">
        <div className="dev-detail-title">
          <h1>{task.title}</h1>
          <Status task={task} />
        </div>
        <Button variant="ghost" asChild>
          <Link to="/development-tasks">
            <ArrowLeft />
            返回任务列表
          </Link>
        </Button>
      </div>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {task.error && task.error !== error && (
        <p role="status" className="message">
          {task.error}
        </p>
      )}
      <section className="dev-panel dev-task-overview">
        <dl>
          <div>
            <dt>代码仓库</dt>
            <dd title={task.repository}>{task.repository}</dd>
          </div>
          <div>
            <dt>任务工作树</dt>
            <dd title={task.worktree}>{task.worktree || "开始研发时创建"}</dd>
          </div>
          <div>
            <dt>研发分支</dt>
            <dd>
              <GitBranch size={14} />
              {task.branch}
            </dd>
          </div>
          <div>
            <dt>起始分支 / 执行模型</dt>
            <dd>
              {task.baseBranch} · {task.model || "Codex 默认模型"}
            </dd>
          </div>
        </dl>
        <div className="dev-actions">
          {task.status === "completed" && !task.restored && !task.merge && (
            <Button disabled={!!busy} onClick={() => void previewMerge()}>
              <GitBranch />
              合并回主分支
            </Button>
          )}
          {task.merge && !task.merge.cleanedAt && !task.restored && (
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => void action("cleanup")}
            >
              清理研发目录
            </Button>
          )}
          {canStart && (
            <Button disabled={!!busy} onClick={() => void action("start")}>
              <Play />
              {task.status === "draft" ? "开始研发" : "继续研发"}
            </Button>
          )}
          {running && (
            <Button
              variant="outline"
              disabled={!!busy || task.status === "preparing"}
              onClick={() => void action("stop")}
            >
              <Square />
              {task.status === "stopping" ? "重试停止" : "停止执行"}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={
              !!busy ||
              !task.worktree ||
              !!task.restored ||
              !!task.merge?.cleanedAt
            }
            onClick={() => void action("open-directory")}
          >
            <FolderOpen />
            打开研发目录
          </Button>
          <Button
            variant="outline"
            disabled={!task.worktree}
            onClick={() => void copyContext()}
          >
            <Copy />
            复制接管上下文
          </Button>
          <Button
            variant="outline"
            disabled={
              !!busy ||
              !task.worktree ||
              running ||
              task.status === "completed" ||
              !!task.restored
            }
            onClick={() => void action("handoff")}
          >
            <ExternalLink />
            打开 ChatGPT 接管
          </Button>
          {task.worktree &&
            !running &&
            task.status !== "completed" &&
            !task.restored && (
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => setConfirm(true)}
              >
                <Check />
                确认完成
              </Button>
            )}
        </div>
        <p className="dev-help">
          不自动运行测试，由你测试和验收。外部接管需先停止执行，再复制上下文到
          ChatGPT；不会自动打开同一会话。
        </p>
        {task.merge && (
          <p className="dev-help">
            合并于 {date(task.merge.mergedAt)} · 提交{" "}
            {task.merge.targetCommit.slice(0, 12)} ·{" "}
            {task.merge.cleanedAt
              ? "研发分支和工作树已清理"
              : "等待清理研发目录"}
            {task.merge.cleanupError && (
              <span role="alert"> · 清理未完成：{task.merge.cleanupError}</span>
            )}
          </p>
        )}
      </section>
      {!status?.ready && status && (
        <div className="dev-login">
          <span>Codex 尚未登录</span>
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() => void login()}
          >
            登录 Codex
          </Button>
          <Button
            variant="ghost"
            disabled={!!busy}
            onClick={() => void refreshStatus()}
          >
            刷新登录状态
          </Button>
          {loginUrl && <span>请在浏览器完成登录，然后刷新状态。</span>}
        </div>
      )}
      <div className="dev-tabs" role="tablist" aria-label="任务详情">
        {[
          ["progress", "执行进度"],
          ["changes", "代码差异"],
          ["sources", "需求与模型"],
        ].map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value!)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "progress" && (
        <section className="dev-panel dev-progress">
          <div className="dev-live-heading">
            <div>
              <span
                className={`dev-live-dot${connection === "实时进度已连接" ? " connected" : ""}`}
              />
              {connection}
            </div>
            <span>
              {task.status === "waiting"
                ? "等待授权或补充信息"
                : latest && task.status === "running"
                  ? `正在${latest.type === "commandExecution" ? "执行命令" : latest.type === "fileChange" ? "修改文件" : "处理工具任务"}`
                  : developmentStatusLabels[task.status]}
            </span>
          </div>
          <div
            className="dev-timeline"
            ref={viewport}
            onScroll={() => {
              const el = viewport.current;
              if (el)
                follow.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
          >
            {!task.snapshot?.items.length && (
              <div className="dev-empty">
                <Code2 size={28} />
                <p>
                  {task.status === "draft"
                    ? "点击“开始研发”，Codex 将创建执行计划并开始实现。"
                    : "正在准备执行环境…"}
                </p>
              </div>
            )}
            {task.snapshot?.items.map((item, index) =>
              index === 0 && item.role === "user" ? (
                <details key={item.id} className="dev-initial-context">
                  <summary>任务初始上下文</summary>
                  <pre>{item.text}</pre>
                </details>
              ) : (
                <ChatMessage key={item.id} item={item} onLinkError={setError} />
              ),
            )}
          </div>
          {task.snapshot?.requests.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              chatId={task.chatId!}
              endpoint={`${root}/${task.id}/requests/${request.id}`}
              onResult={() => {}}
            />
          ))}
          {task.chatId && !task.restored && task.status !== "completed" && (
            <form className="dev-composer" onSubmit={send}>
              <textarea
                aria-label="补充研发要求"
                rows={3}
                maxLength={16000}
                placeholder={
                  running
                    ? "需要调整方向时，先停止执行，再发送补充要求。"
                    : "补充要求、反馈问题，让 Codex 继续研发…"
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={running || !!busy}
              />
              <div>
                <span>停止后可补充要求，继续同一任务会话。</span>
                <Button
                  type="submit"
                  disabled={running || !!busy || !text.trim()}
                >
                  {busy === "messages" ? "正在发送…" : "发送并继续"}
                </Button>
              </div>
            </form>
          )}
        </section>
      )}
      {tab === "changes" && (
        <section className="dev-panel dev-changes">
          <div className="dev-section-title">
            <h2>相对基准提交的代码变化</h2>
            <Button
              variant="outline"
              disabled={changesLoading}
              onClick={() => void loadChanges()}
            >
              <RefreshCw />
              {changesLoading ? "正在读取…" : "刷新差异"}
            </Button>
          </div>
          <p className="dev-help">
            包含分支已提交与未提交的跟踪文件差异。新文件列在工作目录状态中，可在研发目录查看完整内容。
          </p>
          {changesError && (
            <p className="message error" role="alert">
              {changesError}
            </p>
          )}
          {changes && (
            <>
              <h3>工作目录状态</h3>
              <pre>{changes.status}</pre>
              <h3>代码差异</h3>
              <pre>{changes.diff || "暂无跟踪文件差异"}</pre>
              {changes.truncated && (
                <p>差异内容较长，仅展示前 200,000 个字符。</p>
              )}
              <h3>提交记录</h3>
              <pre>{changes.commits}</pre>
            </>
          )}
        </section>
      )}
      {tab === "sources" && (
        <section className="dev-panel dev-sources">
          <h2>研发要求</h2>
          <p>{task.requirement || "按照关联工作项完成实现。"}</p>
          <h2>
            工作项快照 <small>{task.sources.items.length}</small>
          </h2>
          {task.sources.items.map((item) => (
            <details key={item.id}>
              <summary>
                {item.title}
                <small>版本 {item.version}</small>
              </summary>
              <pre>{JSON.stringify(item, null, 2)}</pre>
            </details>
          ))}
          {!task.sources.items.length && <p>未关联工作项</p>}
          <h2>
            领域模型快照 <small>{task.sources.models.length}</small>
          </h2>
          {task.sources.models.map((model) => (
            <details key={model.id}>
              <summary>
                {model.name}
                <small>版本 {model.version}</small>
              </summary>
              <pre>{JSON.stringify(model, null, 2)}</pre>
            </details>
          ))}
          {!task.sources.models.length && <p>未关联领域模型</p>}
          <p className="dev-help">
            创建于 {date(task.createdAt)}。这里展示创建任务时的内容和版本。
          </p>
        </section>
      )}
      <AlertDialog.Root open={confirm} onOpenChange={setConfirm}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay confirmation-overlay" />
          <AlertDialog.Content className="confirmation-content">
            <AlertDialog.Title>确认研发任务完成</AlertDialog.Title>
            <AlertDialog.Description>
              请确认你已完成必要的测试和验收。完成后保留研发分支和工作树，由你决定何时合并；关联工作项的状态不自动改变。
            </AlertDialog.Description>
            <div className="confirmation-actions">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={!!busy}>
                  取消
                </Button>
              </AlertDialog.Cancel>
              <Button disabled={!!busy} onClick={() => void action("complete")}>
                确认完成
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <Dialog.Root
        open={mergeOpen}
        onOpenChange={(open) => {
          if (!busy) setMergeOpen(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="confirmation-content dev-merge-dialog">
            <Dialog.Title>预览合并回主分支</Dialog.Title>
            <Dialog.Description>
              确认后会提交研发工作树中的修改（含未跟踪文件），并合并到原仓库的主分支。合并成功后会删除研发工作树和已合并分支，保留任务历史，不会推送。
            </Dialog.Description>
            {mergeError && (
              <p role="alert" className="message error">
                {mergeError}
              </p>
            )}
            {busy === "merge-preview" && (
              <p role="status">正在检查分支、代码差异和合并冲突…</p>
            )}
            {mergePreview && (
              <div className="dev-merge-body">
                <p>
                  <strong>{mergePreview.sourceBranch}</strong> →{" "}
                  <strong>{mergePreview.targetBranch}</strong>
                </p>
                <p className="dev-help">
                  主分支当前提交：{mergePreview.targetCommit.slice(0, 12)}
                  。预览有效期 5 分钟，确认时会再次检查代码是否变化。
                </p>
                {mergePreview.alreadyMerged && (
                  <p>主分支已包含当前研发提交，确认后仅同步任务合并状态。</p>
                )}
                {mergePreview.conflict && (
                  <>
                    <p role="alert" className="message error">
                      存在合并冲突，主分支未改动。请在研发分支处理冲突后重新预览。
                    </p>
                    <pre>{mergePreview.conflict}</pre>
                  </>
                )}
                <h3>将合入主分支的文件</h3>
                <pre>{mergePreview.files || "没有新增文件差异"}</pre>
                <details open>
                  <summary>代码差异</summary>
                  <pre>{mergePreview.diff || "没有内容差异"}</pre>
                </details>
                {mergePreview.truncated && (
                  <p className="dev-help">
                    差异较长，仅展示前 200,000
                    个字符，请在研发目录查看完整内容。
                  </p>
                )}
              </div>
            )}
            <div className="confirmation-actions">
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => setMergeOpen(false)}
              >
                取消
              </Button>
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => void previewMerge()}
              >
                重新预览
              </Button>
              <Button
                disabled={
                  !!busy || !mergePreview?.canMerge || !mergePreview.token
                }
                onClick={() => void confirmMerge()}
              >
                {busy === "merge" ? "正在合并…" : "确认合并"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
