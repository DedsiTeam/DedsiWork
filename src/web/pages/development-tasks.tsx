import { useRouteInputs } from "../route-inputs";
import type { RemoteRequirement } from "../../shared/remote-mcp";
import { RemoteRequirementView } from "../components/remote-requirement";
import { descriptionContent } from "../components/rich-text";
import { PAGE_SIZE } from "../../shared/pagination";
import { EmptyState } from "../components/empty-state";
import { DevelopmentItemAcceptance } from "../components/development-item-acceptance";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import * as Dialog from "@radix-ui/react-dialog";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import {
  Trash2,
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
  ExternalLink,
} from "lucide-react";
import { api, subscribeApi } from "../api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useWorkspace } from "../workspace-context";
import { ChatMessage, RequestCard } from "./chat";
import {
  captureDevelopmentDelivery,
  developmentStatusLabels,
  type DevelopmentTask,
  type RepositorySelection,
  type DevelopmentChanges,
  type DevelopmentMergePreview,
} from "../../shared/development-task";
import type { CodexStatus } from "../../shared/domain-model-ai";
import type { WorkItem, Page } from "../../shared/work-item";
import type { DomainModel, DomainModelList } from "../../shared/domain-model";
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
  const [deleteTarget, setDeleteTarget] = useState<DevelopmentTask | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const { notify } = useWorkspace();
  async function removeTask() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api(`${root}/${deleteTarget.id}`, {
        method: "DELETE",
        body: JSON.stringify({
          confirmed: true,
          expectedVersion: deleteTarget.version,
        }),
      });
      setTasks((previous) =>
        previous.filter((task) => task.id !== deleteTarget.id),
      );
      setDeleteTarget(null);
      notify("研发任务及关联 Codex 对话已永久删除");
    } catch (error) {
      setDeleteError((error as Error).message);
    } finally {
      setDeleting(false);
    }
  }

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
        <Button
          asChild
          title={"新建研发任务"}
          aria-label={"新建研发任务"}
          size="icon-sm"
        >
          <Link to="/development-tasks/new">
            <Plus />
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
        <EmptyState
          icon={Code2}
          title={tasks.length ? "没有符合条件的研发任务" : "创建第一个研发任务"}
          description={
            tasks.length
              ? "切换任务状态，查看其他研发任务。"
              : "关联工作项与领域模型，交给 Codex 推进实现。"
          }
        />
      ) : (
        <div className="dev-task-grid">
          {filtered.map((task) => (
            <article className="dev-task-card" key={task.id}>
              <Link
                className="dev-card-link"
                to={`/development-tasks/${task.id}`}
                aria-label={`打开研发任务：${task.title}`}
              />
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
                <div className="dev-card-actions">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`删除研发任务：${task.title}`}
                    disabled={active(task)}
                    title={active(task) ? "请先停止研发任务" : "删除研发任务"}
                    onClick={() => {
                      setDeleteTarget(task);
                      setDeleteError("");
                    }}
                  >
                    <Trash2 size={15} />
                  </Button>
                  <ArrowRight size={15} aria-hidden="true" />
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}
      <AlertDialog.Root
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay confirmation-overlay" />
          <AlertDialog.Content className="confirmation-content">
            <AlertDialog.Title>永久删除研发任务？</AlertDialog.Title>
            <AlertDialog.Description>
              将永久删除“{deleteTarget?.title}”、执行记录、关联 Codex
              对话及任务资料文件，无法撤销。关联工作项、领域模型和本地仓库代码会保留。
            </AlertDialog.Description>
            {deleteError && (
              <p role="alert" className="message">
                {deleteError}
              </p>
            )}
            <div className="confirmation-actions">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={deleting}>
                  取消
                </Button>
              </AlertDialog.Cancel>
              <Button disabled={deleting} onClick={() => void removeTask()}>
                {deleting ? "正在删除…" : "确认永久删除"}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
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
            仅展示当前工作空间的数据，执行时按关联 ID 读取最新资料。
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
              <EmptyState
                compact
                title="没有可关联的内容"
                description="试试其他名称或关键词。"
              />
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
              {page} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
            </span>
            <Button
              variant="outline"
              disabled={page * PAGE_SIZE >= total}
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
  const [params] = useRouteInputs("/development-tasks/new");
  const remoteId = params.get("remote") || "";
  const [remote, setRemote] = useState<RemoteRequirement | null>(null);
  const [remoteError, setRemoteError] = useState("");
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteUpdate, setRemoteUpdate] = useState<RemoteRequirement | null>(
    null,
  );
  const [remoteNotice, setRemoteNotice] = useState("");
  const sourceIds = params.get("items") || "";
  const sourceModelIds = params.get("models") || "";
  const [sourcesLoading, setSourcesLoading] = useState(
    Boolean(sourceIds || sourceModelIds),
  );
  const [title, setTitle] = useState(""),
    [requirement, setRequirement] = useState(""),
    [selection, setSelection] = useState<RepositorySelection | null>(null),
    [base, setBase] = useState(""),
    [model, setModel] = useState("");
  useEffect(() => {
    if (!remoteId) return;
    const controller = new AbortController();
    setRemote(null);
    setRemoteError("");
    setRemoteUpdate(null);
    api<{ data: RemoteRequirement }>(
      `/api/v1/remote-requirements/${encodeURIComponent(remoteId)}`,
      { signal: controller.signal },
    )
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setRemote(data);
        setTitle((previous) => previous || data.item.title.slice(0, 120));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setRemoteError(e.message);
      });
    return () => controller.abort();
  }, [remoteId]);
  async function checkRemote() {
    if (!remote) return;
    setRemoteBusy(true);
    setRemoteError("");
    setRemoteNotice("");
    try {
      const { data } = await api<{ data: RemoteRequirement }>(
        `/api/v1/remote-requirements/${remote.id}/refresh`,
        { method: "POST" },
      );
      if (
        data.item.version === remote.item.version &&
        JSON.stringify(data.item) === JSON.stringify(remote.item)
      ) {
        setRemoteNotice("需求与保存的快照一致");
        setRemoteUpdate(null);
      } else setRemoteUpdate(data);
    } catch (e) {
      setRemoteError((e as Error).message);
    } finally {
      setRemoteBusy(false);
    }
  }
  const [items, setItems] = useState<SourceOption[]>([]),
    [models, setModels] = useState<SourceOption[]>([]),
    [picker, setPicker] = useState<"items" | "models" | null>(null);
  const linkedModelSources = useRef(new Set<string>());
  const selectedItemIds = items.map((item) => item.id).join(",");
  useEffect(() => {
    const ids = selectedItemIds
      .split(",")
      .filter((id) => id && !linkedModelSources.current.has(id));
    if (!ids.length) return;
    const controller = new AbortController();
    void Promise.all(
      ids.map(async (id) => {
        const { data } = await api<{ data: { models: SourceOption[] } }>(
          `/api/v1/personal/related/${id}`,
          { signal: controller.signal },
        );
        return { id, models: data.models || [] };
      }),
    )
      .then((results) => {
        if (controller.signal.aborted) return;
        results.forEach((result) => linkedModelSources.current.add(result.id));
        setModels((previous) =>
          [
            ...new Map(
              [...previous, ...results.flatMap((result) => result.models)].map(
                (model) => [model.id, model],
              ),
            ).values(),
          ].slice(0, 10),
        );
      })
      .catch(() => {
        /* Optional source discovery must not block direct development. */
      });
    return () => controller.abort();
  }, [selectedItemIds]);
  const [choosing, setChoosing] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [status, setStatus] = useState<CodexStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (!sourceIds && !sourceModelIds) {
      setSourcesLoading(false);
      return;
    }
    setSourcesLoading(true);
    Promise.all([
      Promise.all(
        [...new Set(sourceIds.split(",").filter(Boolean))]
          .slice(0, 20)
          .map((id) =>
            api<{ data: WorkItem }>(
              `/api/v1/work-items/${encodeURIComponent(id)}`,
              { signal: controller.signal },
            ),
          ),
      ),
      Promise.all(
        [...new Set(sourceModelIds.split(",").filter(Boolean))]
          .slice(0, 10)
          .map((id) =>
            api<{ data: DomainModel }>(
              `/api/v1/domain-models/${encodeURIComponent(id)}`,
              { signal: controller.signal },
            ),
          ),
      ),
    ])
      .then(([itemResults, modelResults]) => {
        if (controller.signal.aborted) return;
        setItems(itemResults.map((result) => result.data));
        setModels(
          modelResults.map(({ data }) => ({
            id: data.id,
            title: data.name,
            version: data.version,
          })),
        );
        setTitle((previous) => previous || itemResults[0]?.data.title || "");
        setRequirement(
          (previous) =>
            previous ||
            itemResults
              .map(({ data }) => {
                const content = descriptionContent(data.description);
                const description =
                  typeof content === "string"
                    ? new DOMParser().parseFromString(
                        content.replace(
                          /<br\s*\/?>|<\/(?:p|li|h[1-6]|blockquote|div)>/gi,
                          "$&\n",
                        ),
                        "text/html",
                      ).body.textContent || ""
                    : data.description;
                return `工作项：${data.title}（${data.id}）\n${description}`;
              })
              .join("\n\n")
              .slice(0, 16000),
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(`关联资料加载失败：${error.message}`);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSourcesLoading(false);
      });
    return () => controller.abort();
  }, [sourceIds, sourceModelIds]);
  useEffect(() => {
    const controller = new AbortController();
    api<{ data: CodexStatus }>(`${root}/status`, { signal: controller.signal })
      .then((r) => setStatus(r.data))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    void choose();
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
  async function initializeRepository() {
    setChoosing(true);
    setError("");
    try {
      const { data } = await api<{ data: RepositorySelection }>(
        `${root}/initialize-repository`,
        { method: "POST" },
      );
      setSelection(data);
      setBase(data.currentBranch);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChoosing(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (
      !selection ||
      saving ||
      sourcesLoading ||
      remoteBusy ||
      (remoteId && !remote)
    )
      return;
    setSaving(true);
    setError("");
    try {
      const result = await api<{ data: DevelopmentTask }>(root, {
        method: "POST",
        body: JSON.stringify({
          title,
          requirement,
          ...(remote ? { remoteSnapshotId: remote.id } : {}),
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
        <h1>{remoteId ? "预览需求并创建本机研发任务" : "新建研发任务"}</h1>
        <Button
          variant="ghost"
          asChild
          title={"返回任务列表"}
          aria-label={"返回任务列表"}
          size="icon-sm"
        >
          <Link to="/development-tasks">
            <ArrowLeft />
          </Link>
        </Button>
      </div>
      {remoteId && (
        <section className="dev-panel mb-5">
          <h2>同事需求预览</h2>
          {remoteError && (
            <p role="alert" className="message">
              {remoteError}
            </p>
          )}
          {!remote && !remoteError && <p role="status">正在加载需求快照…</p>}
          {remote && (
            <>
              <RemoteRequirementView source={remote} />
              <Button
                className="mt-4"
                type="button"
                size="sm"
                variant="outline"
                disabled={remoteBusy || saving}
                onClick={checkRemote}
              >
                {remoteBusy ? "正在检查…" : "检查需求更新"}
              </Button>
            </>
          )}
          {remoteNotice && (
            <p role="status" className="muted mt-3">
              {remoteNotice}
            </p>
          )}
          {remoteUpdate && (
            <div className="mt-4 border-t border-border pt-4">
              <p>发现新版本，请核对后决定是否采用：</p>
              <RemoteRequirementView source={remoteUpdate} />
              <div className="flex gap-2 mt-4">
                <Button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setRemote(remoteUpdate);
                    setRemoteUpdate(null);
                    setRemoteNotice("已采用新快照，请确认研发要求后启动");
                  }}
                >
                  采用此版本
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRemoteUpdate(null)}
                >
                  保留原版本
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
      <form className="dev-create-form" onSubmit={submit}>
        <fieldset
          disabled={
            saving ||
            sourcesLoading ||
            remoteBusy ||
            Boolean(remoteId && !remote)
          }
        >
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
              工作空间本地工作目录
              <div className="dev-directory">
                <output title={selection?.directory}>
                  {selection?.directory ||
                    (choosing
                      ? "正在读取工作空间目录…"
                      : "无法读取工作空间仓库")}
                </output>
              </div>
            </label>
            <p className="dev-help">
              自动使用工作空间的本地工作目录；如需修改，请前往工作空间设置。直接在该目录当前分支执行，保留并使用已有未提交修改，不创建工作树或切换分支。
            </p>
            {!selection && !choosing && (
              <div className="dev-actions">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void choose()}
                >
                  重新读取目录
                </Button>
                <Button
                  type="button"
                  onClick={() => void initializeRepository()}
                >
                  初始化空目录
                </Button>
                <p className="dev-help">
                  为选定的空目录建立本地 Git
                  仓库和初始记录，不上传文件。已有文件的目录不会自动初始化。
                </p>
              </div>
            )}
            <div className="dev-form-columns">
              <label>
                当前分支
                <select
                  disabled
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                >
                  {!selection && <option value="">等待工作空间仓库信息</option>}
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
                  size="icon-sm"
                  variant="outline"
                  onClick={() => setPicker("items")}
                  title={"选择工作项"}
                  aria-label={"选择工作项"}
                >
                  <Plus />
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
                  size="icon-sm"
                  variant="outline"
                  onClick={() => setPicker("models")}
                  title={"选择领域模型"}
                  aria-label={"选择领域模型"}
                >
                  <Plus />
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
              本机关联资料在开始或继续研发时读取最新内容；同事需求使用预览确认的完整快照。
            </p>
          </section>
          {error && (
            <p className="message error" role="alert">
              {error}
            </p>
          )}
          <div className="dev-create-footer">
            <span>直接修改本地目录 · 人工验收 · 手动提交</span>
            <Button
              type="submit"
              disabled={
                saving ||
                choosing ||
                !selection ||
                !title.trim() ||
                (!items.length && !requirement.trim() && !remote)
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
  const { id } = useParams();
  const [tasks, setTasks] = useState<DevelopmentTask[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
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
      } catch (error) {
        if (!controller.signal.aborted) setError((error as Error).message);
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
  const visible = tasks.filter((task) =>
    task.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div className="workspace-content dev-task-layout">
      <aside className="dev-task-sidebar" aria-label="研发任务切换">
        <div className="dev-task-sidebar-heading">
          <h2>研发任务</h2>
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to="/development-tasks/new" aria-label="新建研发任务">
              <Plus />
            </Link>
          </Button>
        </div>
        <Input
          aria-label="搜索研发任务"
          placeholder="搜索研发任务…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {error && (
          <p role="alert" className="dev-task-sidebar-message">
            {error}
          </p>
        )}
        <nav className="dev-task-sidebar-list" aria-label="研发任务列表">
          {visible.map((task) => (
            <Link
              key={task.id}
              to={`/development-tasks/${task.id}`}
              className="dev-task-sidebar-item"
              aria-current={task.id === id ? "page" : undefined}
            >
              <strong>{task.title}</strong>
              <Status task={task} />
            </Link>
          ))}
          {!visible.length &&
            (loading ? (
              <p className="dev-task-sidebar-message" role="status">
                正在加载…
              </p>
            ) : (
              <EmptyState
                icon={Code2}
                compact
                title={query ? "没有匹配的任务" : "暂无研发任务"}
                description={
                  query ? "试试其他关键词。" : "新建任务后会显示在这里。"
                }
              />
            ))}
        </nav>
        <Button variant="ghost" asChild>
          <Link to="/development-tasks">查看全部任务</Link>
        </Button>
      </aside>
      <div className="dev-task-main">
        <DevelopmentTaskDetail key={id} />
      </div>
    </div>
  );
}

function DevelopmentTaskDetail() {
  const { id } = useParams(),
    { notify } = useWorkspace();
  const [task, setTask] = useState<DevelopmentTask | null>(null),
    [error, setError] = useState(""),
    [connection, setConnection] = useState("正在连接实时进度…"),
    [busy, setBusy] = useState("");
  const [tab, setTab] = useState("progress"),
    [text, updateText] = useState(
      () => sessionStorage.getItem(`development-draft:${id}`) || "",
    ),
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
  const setText = (value: string) => {
    updateText(value);
    if (value) sessionStorage.setItem(`development-draft:${id}`, value);
    else sessionStorage.removeItem(`development-draft:${id}`);
  };
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
        notify("研发任务已完成，代码修改已保留");
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
        <p role={error ? "alert" : "status"}>{error || "正在加载研发任务…"}</p>
      </div>
    );
  const running = active(task),
    canStart = !running && task.status !== "completed" && !task.restored;
  const delivery =
    task.deliveryHistory?.at(-1) ||
    (!running && task.snapshot
      ? captureDevelopmentDelivery(task.snapshot, task.updatedAt)
      : null);
  const revise = (feedback: string) => {
    setText(feedback);
    setTab("progress");
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLTextAreaElement>('[aria-label="补充研发要求"]')
        ?.focus(),
    );
  };
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
      <section className="dev-detail-content dev-task-overview">
        <dl>
          <div>
            <dt>代码仓库</dt>
            <dd title={task.repository}>{task.repository}</dd>
          </div>
          <div>
            <dt>本地工作目录</dt>
            <dd title={task.worktree}>{task.worktree || "历史目录不可用"}</dd>
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
          {task.executionMode !== "workspace" &&
            task.status === "completed" &&
            !task.restored &&
            !task.merge && (
              <Button
                disabled={!!busy}
                onClick={() => void previewMerge()}
                title={"合并回主分支"}
                aria-label={"合并回主分支"}
                size="icon-sm"
              >
                <GitBranch />
              </Button>
            )}
          {task.executionMode !== "workspace" &&
            task.merge &&
            !task.merge.cleanedAt &&
            !task.restored && (
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => void action("cleanup")}
              >
                清理研发目录
              </Button>
            )}
          {canStart && task.executionMode === "workspace" && (
            <Button
              disabled={!!busy}
              onClick={() => void action("start")}
              title={task.status === "draft" ? "开始研发" : "继续研发"}
              aria-label={task.status === "draft" ? "开始研发" : "继续研发"}
              size="icon-sm"
            >
              <Play />
            </Button>
          )}
          {running && (
            <Button
              variant="outline"
              disabled={!!busy || task.status === "preparing"}
              onClick={() => void action("stop")}
              title={task.status === "stopping" ? "重试停止" : "停止执行"}
              aria-label={task.status === "stopping" ? "重试停止" : "停止执行"}
              size="icon-sm"
            >
              <Square />
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
            title={"打开研发目录"}
            aria-label={"打开研发目录"}
            size="icon-sm"
          >
            <FolderOpen />
          </Button>
          {task.worktree &&
            !running &&
            task.status !== "completed" &&
            !task.restored && (
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => setConfirm(true)}
                title={"确认完成"}
                aria-label={"确认完成"}
                size="icon-sm"
              >
                <Check />
              </Button>
            )}
        </div>
        <p className="dev-help">
          Codex
          在当前任务中持续研发；交付后由你测试和验收，需要调整时提出修改即可继续同一会话。
        </p>
        {!task.executionMode && !task.restored && (
          <p className="dev-help">
            历史工作树任务保留查阅与合并；继续研发请创建新任务，直接使用工作空间目录。
          </p>
        )}
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
      <section className="dev-detail-content" aria-label="交付与收尾">
        <h2>交付与收尾</h2>
        <p>
          研发：{developmentStatusLabels[task.status]} ·
          工作项验收：在下方逐项核对 · 代码：
          {task.executionMode === "workspace"
            ? "保留在当前工作目录，提交由你决定"
            : task.merge
              ? `已合并到 ${task.merge.targetBranch}`
              : "尚未合并"}
        </p>
        {delivery ? (
          <>
            <p className="dev-help">
              最近交付 · {date(delivery.createdAt)} · 以下为 Codex
              报告，仍需人工核验。
              {running ? "当前正在修改，以下为上次交付。" : ""}
            </p>
            <h3>完成内容</h3>
            <pre>{delivery.completed}</pre>
            <h3>验证结果</h3>
            <pre>{delivery.verification}</pre>
            <h3>遗留问题</h3>
            <pre>{delivery.remaining}</pre>
            {canStart && task.chatId && task.executionMode === "workspace" && (
              <Button
                variant="outline"
                onClick={() => revise("请基于本次交付继续修改。\n验收反馈：")}
              >
                提出修改，继续当前任务
              </Button>
            )}
            {(task.deliveryHistory?.length || 0) > 1 && (
              <details>
                <summary>
                  历次交付（{task.deliveryHistory!.length - 1}）
                </summary>
                {task
                  .deliveryHistory!.slice(0, -1)
                  .reverse()
                  .map((item) => (
                    <article key={item.id}>
                      <h3>{date(item.createdAt)}</h3>
                      <pre>{item.raw}</pre>
                    </article>
                  ))}
              </details>
            )}
          </>
        ) : (
          <p className="dev-help">
            Codex 完成研发后，将在这里保留完成内容、验证结果与遗留问题。
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
        <section className="dev-progress" aria-label="研发执行记录">
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
              <EmptyState
                icon={Code2}
                compact
                title={
                  task.status === "draft" ? "研发尚未开始" : "正在准备执行环境"
                }
                description={
                  task.status === "draft"
                    ? "点击“开始研发”，创建执行计划并开始实现。"
                    : "执行记录将在任务开始后显示。"
                }
              />
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
          {task.executionMode === "workspace" &&
            task.chatId &&
            !task.restored &&
            task.status !== "completed" && (
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
        <section className="dev-detail-content dev-changes">
          <div className="dev-section-title">
            <h2>工作目录状态与提交记录</h2>
            <Button
              variant="outline"
              disabled={changesLoading}
              onClick={() => void loadChanges()}
              title={changesLoading ? "正在读取…" : "刷新差异"}
              aria-label={changesLoading ? "正在读取…" : "刷新差异"}
              size="icon-sm"
            >
              <RefreshCw />
            </Button>
          </div>
          <p className="dev-help">
            显示工作目录状态及任务基准提交之后的提交记录。具体代码内容可在本地工作目录中查看。
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
              <h3>提交记录</h3>
              <pre>{changes.commits}</pre>
            </>
          )}
        </section>
      )}
      {tab === "sources" && (
        <section className="dev-detail-content dev-sources">
          <h2>研发要求</h2>
          <p>{task.requirement || "按照关联工作项完成实现。"}</p>
          {task.remoteSource && (
            <div className="mt-4">
              <RemoteRequirementView source={task.remoteSource} />
            </div>
          )}
          <h2>
            {task.sourceMode === "references" ? "关联工作项" : "工作项快照"}{" "}
            <small>{task.sources.items.length}</small>
          </h2>
          {task.sources.items.map((item) => (
            <details key={item.id}>
              <summary>
                {item.title}
                <small>
                  {task.sourceMode === "references" ? "关联时版本" : "版本"}{" "}
                  {item.version}
                </small>
              </summary>
              <pre>{JSON.stringify(item, null, 2)}</pre>
            </details>
          ))}
          {!task.sources.items.length && <p>未关联工作项</p>}
          <h2>
            {task.sourceMode === "references" ? "关联领域模型" : "领域模型快照"}{" "}
            <small>{task.sources.models.length}</small>
          </h2>
          {task.sources.models.map((model) => (
            <details key={model.id}>
              <summary>
                {model.name}
                <small>
                  {task.sourceMode === "references" ? "关联时版本" : "版本"}{" "}
                  {model.version}
                </small>
              </summary>
              <pre>{JSON.stringify(model, null, 2)}</pre>
            </details>
          ))}
          {!task.sources.models.length && <p>未关联领域模型</p>}
          <p className="dev-help">
            创建于 {date(task.createdAt)}。
            {task.sourceMode === "references"
              ? "这里保存关联 ID；每次开始或继续研发时读取最新资料。本次执行期间使用固定资料，后续修改将在下次执行时生效。"
              : "这里展示创建任务时的内容和版本。"}
          </p>
        </section>
      )}
      {["review", "completed"].includes(task.status) &&
        task.sources.items.length > 0 && (
          <DevelopmentItemAcceptance
            key={task.id}
            task={task}
            onTask={accept}
            onRevise={
              canStart && task.executionMode === "workspace" && task.chatId
                ? revise
                : undefined
            }
          />
        )}
      <AlertDialog.Root open={confirm} onOpenChange={setConfirm}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay confirmation-overlay" />
          <AlertDialog.Content className="confirmation-content">
            <AlertDialog.Title>确认研发任务完成</AlertDialog.Title>
            <AlertDialog.Description>
              请确认你已完成必要的测试和验收。完成后保留本地目录中的全部代码修改，由你决定何时提交；完成后可在下方“关联工作项验收”中选择需要更新的工作项。
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
