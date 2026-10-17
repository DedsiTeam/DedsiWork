import { useEffect, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import {
  Boxes,
  Copy,
  ListTodo,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import {
  renderWorkflow,
  workflowTemplateSchema,
  workflowVariables,
  type WorkflowLibrary,
  type WorkflowSource,
  type WorkflowTemplate,
  type WorkflowRun,
} from "../../shared/ai-workflow";
import { PAGE_SIZE } from "../../shared/pagination";
import { api } from "../api";
import { EmptyState } from "./empty-state";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { useWorkspace } from "../workspace-context";
import "../ai-workflows.css";

export function AIWorkflowLibrary({
  onClose,
  onRun,
  canRun,
  initialPrompt = "",
}: {
  onClose: () => void;
  onRun: (prompt: string, chatId?: string) => Promise<void>;
  canRun: boolean;
  initialPrompt?: string;
}) {
  const { workspace } = useWorkspace();
  const [library, setLibrary] = useState<WorkflowLibrary>({
    version: 0,
    workflows: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState<WorkflowTemplate | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [sources, setSources] = useState<WorkflowSource[]>([]);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [preview, setPreview] = useState(false);
  const templates = library.workflows;
  const current =
    templates.find((item) => item.id === selected) || templates[0] || null;
  const busy = saving || running;

  useEffect(() => {
    const controller = new AbortController();
    api<{ data: WorkflowLibrary }>("/api/v1/ai-workflows", {
      signal: controller.signal,
    })
      .then(({ data }) => {
        if (!controller.signal.aborted) setLibrary(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [workspace?.id]);

  function choose(id: string) {
    setSelected(id);
    setEditing(null);
    setValues({});
    setPreview(false);
    setError("");
  }
  function create(
    prompt = "围绕以下目标开展工作：\n{{目标}}\n\n先明确范围，再给出结构化结果供我确认。",
  ) {
    setEditing({ id: crypto.randomUUID(), name: "", description: "", prompt });
    setError("");
  }
  async function persist(workflows: WorkflowTemplate[]) {
    const { data } = await api<{ data: WorkflowLibrary }>(
      "/api/v1/ai-workflows",
      {
        method: "PUT",
        body: JSON.stringify({ expectedVersion: library.version, workflows }),
      },
    );
    setLibrary(data);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing || busy) return;
    setError("");
    const result = workflowTemplateSchema.safeParse(editing);
    if (!result.success) {
      setError(result.error.issues[0]?.message || "请检查模板内容");
      return;
    }
    setSaving(true);
    try {
      const exists = library.workflows.some(
        (item) => item.id === result.data.id,
      );
      await persist(
        exists
          ? library.workflows.map((item) =>
              item.id === result.data.id ? result.data : item,
            )
          : [...library.workflows, result.data],
      );
      choose(result.data.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (busy || !current) return;
    setSaving(true);
    setError("");
    try {
      await persist(library.workflows.filter((item) => item.id !== current.id));
      setDeleting(false);
      choose("");
    } catch (e) {
      setDeleting(false);
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function run(event: FormEvent) {
    event.preventDefault();
    if (busy || !canRun || !current) return;
    setError("");
    try {
      const prompt = renderWorkflow(current, values, sources, notes);
      setRunning(true);
      const { data: execution } = await api<{ data: WorkflowRun }>(
        "/api/v1/ai-workflows/runs",
        {
          method: "POST",
          body: JSON.stringify({ template: current, values, sources, notes }),
        },
      );
      if (execution.status === "failed" || !execution.chatId)
        throw new Error(execution.error || "运行失败，请到执行记录查看详情");
      await onRun(prompt, execution.chatId);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="workflow-dialog"
          aria-describedby={undefined}
        >
          <header className="workflow-heading">
            <div>
              <Dialog.Title>AI 模板</Dialog.Title>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="关闭模板"
              disabled={busy}
              onClick={onClose}
            >
              <X />
            </Button>
          </header>
          {error && (
            <p className="workflow-error" role="alert">
              {error}
            </p>
          )}
          <div className="workflow-layout">
            <aside className="workflow-library">
              <div className="workflow-library-actions">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || loading}
                  onClick={() => create()}
                >
                  <Plus />
                  新建
                </Button>
                {initialPrompt.trim() && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || loading}
                    onClick={() => create(initialPrompt)}
                    title="将当前对话输入保存为可复用模板"
                  >
                    从当前输入创建
                  </Button>
                )}
              </div>
              {loading && <p role="status">正在加载模板…</p>}
              <nav aria-label="选择模板">
                {templates.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="workflow-list-item"
                    aria-pressed={!editing && current?.id === item.id}
                    disabled={busy}
                    onClick={() => choose(item.id)}
                  >
                    <span>
                      <Workflow size={16} />
                      <strong>{item.name}</strong>
                    </span>
                    <small>我的模板</small>
                  </button>
                ))}
              </nav>
            </aside>
            <section
              className="workflow-detail"
              aria-label={editing ? "编辑模板" : "使用模板"}
            >
              {editing ? (
                <form onSubmit={save} className="workflow-form">
                  <h3>
                    {library.workflows.some((item) => item.id === editing.id)
                      ? "编辑模板"
                      : "新建模板"}
                  </h3>
                  <label>
                    名称
                    <Input
                      autoFocus
                      value={editing.name}
                      maxLength={80}
                      required
                      onChange={(e) =>
                        setEditing({ ...editing, name: e.target.value })
                      }
                      placeholder="例如：接口设计评审"
                    />
                  </label>
                  <label>
                    说明
                    <Input
                      value={editing.description}
                      maxLength={300}
                      onChange={(e) =>
                        setEditing({ ...editing, description: e.target.value })
                      }
                      placeholder="这个模板能帮助完成什么"
                    />
                  </label>
                  <label>
                    模板指令
                    <Textarea
                      className="workflow-prompt-editor"
                      value={editing.prompt}
                      maxLength={12000}
                      required
                      onChange={(e) =>
                        setEditing({ ...editing, prompt: e.target.value })
                      }
                    />
                  </label>
                  <p className="workflow-help">
                    用 {"{{目标}}"}、{"{{背景资料}}"}{" "}
                    等占位符定义参数，使用时会自动生成填写框。模板保存在当前工作空间。
                  </p>
                  <div className="workflow-form-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setEditing(null)}
                    >
                      取消
                    </Button>
                    <Button type="submit" disabled={busy || loading}>
                      {saving ? "正在保存…" : "保存模板"}
                    </Button>
                  </div>
                </form>
              ) : current ? (
                <form onSubmit={run} className="workflow-form">
                  <div className="workflow-detail-heading">
                    <div>
                      <h3>{current.name}</h3>
                      <p>{current.description}</p>
                    </div>
                    <div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="复制模板"
                        title="复制为自定义模板"
                        disabled={busy || loading}
                        onClick={() => {
                          setError("");
                          setEditing({
                            ...current,
                            id: crypto.randomUUID(),
                            name: `${current.name.slice(0, 76)}（副本）`,
                          });
                        }}
                      >
                        <Copy />
                      </Button>
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="编辑模板"
                          disabled={busy}
                          onClick={() => {
                            setError("");
                            setEditing({ ...current });
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="删除模板"
                          disabled={busy}
                          onClick={() => setDeleting(true)}
                        >
                          <Trash2 />
                        </Button>
                      </>
                    </div>
                  </div>
                  {workflowVariables(current.prompt).map((name, index) => (
                    <label key={`${current.id}:${name}`}>
                      {name}
                      <Textarea
                        autoFocus={index === 0}
                        required
                        maxLength={12000}
                        value={Object.hasOwn(values, name) ? values[name] : ""}
                        onChange={(e) =>
                          setValues({ ...values, [name]: e.target.value })
                        }
                        placeholder={`填写${name}…`}
                      />
                    </label>
                  ))}
                  <label>
                    补充要求 <small>可选</small>
                    <Textarea
                      value={notes}
                      maxLength={6000}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="例如：优先复用已有模型；只生成草稿，不直接修改。"
                    />
                  </label>
                  <WorkflowSources
                    selected={sources}
                    onChange={setSources}
                    disabled={busy}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={preview}
                    onClick={() => setPreview(!preview)}
                  >
                    {preview ? "收起模板指令" : "查看模板指令"}
                  </Button>
                  {preview && (
                    <pre className="workflow-prompt-preview">
                      {current.prompt}
                    </pre>
                  )}
                  {!canRun && (
                    <p className="workflow-help">
                      连接 Codex 并等待当前回复结束后，即可运行模板。
                    </p>
                  )}
                  <div className="workflow-form-actions">
                    <Button type="submit" disabled={busy || loading || !canRun}>
                      <Play />
                      {running ? "正在启动…" : "在新对话中运行"}
                    </Button>
                  </div>
                </form>
              ) : loading ? (
                <p role="status" className="workflow-help">
                  正在加载模板…
                </p>
              ) : (
                <EmptyState
                  icon={Workflow}
                  title="创建第一个模板"
                  description="点击“新建”，保存常用指令并在需要时复用。"
                />
              )}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
      <AlertDialog.Root
        open={deleting}
        onOpenChange={(open) => {
          if (!saving) setDeleting(open);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay confirmation-overlay" />
          <AlertDialog.Content className="confirmation-content">
            <AlertDialog.Title>删除这个模板？</AlertDialog.Title>
            <AlertDialog.Description>
              将删除“{current?.name || ""}
              ”模板，已经产生的对话和业务数据会保留。
            </AlertDialog.Description>
            <div className="confirmation-actions">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={saving}>
                  取消
                </Button>
              </AlertDialog.Cancel>
              <Button disabled={saving} onClick={() => void remove()}>
                {saving ? "正在删除…" : "删除模板"}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </Dialog.Root>
  );
}

function WorkflowSources({
  selected,
  onChange,
  disabled,
}: {
  selected: WorkflowSource[];
  onChange: (values: WorkflowSource[]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<WorkflowSource["kind"]>("items");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<WorkflowSource[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      api<{
        data: { id: string; title?: string; name?: string; version: number }[];
        meta: { total: number };
      }>(
        `/api/v1/${kind === "items" ? "work-items" : "domain-models"}?${new URLSearchParams({ q: query, page: String(page), pageSize: String(PAGE_SIZE) })}`,
        { signal: controller.signal },
      )
        .then((result) => {
          if (!controller.signal.aborted) {
            setRows(
              result.data.map((row) => ({
                kind,
                id: row.id,
                title: row.title || row.name || "",
                version: row.version,
              })),
            );
            setTotal(result.meta.total);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, kind, query, page]);
  return (
    <div className="workflow-sources">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <Plus />
        关联资料{selected.length ? `（${selected.length}）` : "（可选）"}
      </Button>
      {selected.length > 0 && (
        <div className="workflow-source-tags">
          {selected.map((item) => (
            <Button
              key={`${item.kind}:${item.id}`}
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled}
              title={`移除${item.title}`}
              onClick={() =>
                onChange(
                  selected.filter(
                    (value) => value.id !== item.id || value.kind !== item.kind,
                  ),
                )
              }
            >
              {item.title}
              <X />
            </Button>
          ))}
        </div>
      )}
      {open && (
        <div className="workflow-source-picker">
          <div className="workflow-source-toolbar">
            <Button
              type="button"
              size="sm"
              variant={kind === "items" ? "secondary" : "ghost"}
              disabled={disabled}
              onClick={() => {
                setKind("items");
                setPage(1);
              }}
            >
              <ListTodo />
              工作项
            </Button>
            <Button
              type="button"
              size="sm"
              variant={kind === "models" ? "secondary" : "ghost"}
              disabled={disabled}
              onClick={() => {
                setKind("models");
                setPage(1);
              }}
            >
              <Boxes />
              领域模型
            </Button>
          </div>
          <Input
            aria-label="搜索关联资料"
            placeholder="搜索名称或说明…"
            value={query}
            disabled={disabled}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          {loading ? (
            <p role="status" className="workflow-help">
              正在加载资料…
            </p>
          ) : error ? (
            <p role="alert" className="workflow-error">
              {error}
            </p>
          ) : !rows.length ? (
            <EmptyState
              icon={Search}
              compact
              title="没有匹配的资料"
              description="试试其他关键词，或直接填写背景信息。"
            />
          ) : (
            <div className="workflow-source-list">
              {rows.map((item) => {
                const checked = selected.some(
                  (value) => value.id === item.id && value.kind === item.kind,
                );
                return (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled || (!checked && selected.length >= 12)}
                      onChange={() =>
                        onChange(
                          checked
                            ? selected.filter(
                                (value) =>
                                  value.id !== item.id ||
                                  value.kind !== item.kind,
                              )
                            : [...selected, item],
                        )
                      }
                    />
                    <span>{item.title}</span>
                  </label>
                );
              })}
            </div>
          )}
          <div className="workflow-source-pagination">
            <span>
              最多关联 12 项 · {page} /{" "}
              {Math.max(1, Math.ceil(total / PAGE_SIZE))}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={loading || disabled || page <= 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={loading || disabled || page * PAGE_SIZE >= total}
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
