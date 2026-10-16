import { EmptyState } from "../components/empty-state";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import * as Dialog from "@radix-ui/react-dialog";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import {
  Folder,
  FolderOpen,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  LoaderCircle,
  Download,
  Upload,
  ArrowRight,
} from "lucide-react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { useWorkspace } from "../workspace-context";
import type { Workspace, WorkspaceSummary } from "../../shared/workspace";
import "../workspaces.css";
type RestorePreview = {
  token: string;
  name: string;
  description: string;
  createdAt: string;
  counts: {
    items: number;
    trash: number;
    models: number;
    sprints: number;
    notes: number;
    chats: number;
    developmentTasks?: number;
  };
};
const blank = { name: "", description: "", directory: "" };
export function WorkspacesPage() {
  const { openWorkspace, leaveWorkspace, updateWorkspace, workspace, notify } =
    useWorkspace();
  const [params, setParams] = useSearchParams();
  const [spaces, setSpaces] = useState<WorkspaceSummary[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0),
    [opening, setOpening] = useState("");
  const [editing, setEditing] = useState<WorkspaceSummary | null | undefined>(
      undefined,
    ),
    [form, setForm] = useState(blank),
    [saving, setSaving] = useState(false),
    [formError, setFormError] = useState(""),
    [choosing, setChoosing] = useState(false);
  const [removing, setRemoving] = useState<WorkspaceSummary | null>(null),
    [confirmation, setConfirmation] = useState(""),
    [deleting, setDeleting] = useState(false),
    [deleteError, setDeleteError] = useState("");
  const [transfer, setTransfer] = useState(false);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(
    null,
  );
  const [restoreForm, setRestoreForm] = useState(blank);
  const [restoreError, setRestoreError] = useState("");
  const [restoring, setRestoring] = useState(false);
  async function backupSpace(id: string) {
    if (transfer) return;
    setMenu("");
    setTransfer(true);
    try {
      const { data } = await api<{
        data: { cancelled: boolean; path?: string };
      }>(`/api/v1/workspaces/${id}/backup`, { method: "POST" });
      if (!data.cancelled) notify(`备份已保存：${data.path}`);
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setTransfer(false);
    }
  }
  async function previewRestore() {
    if (transfer) return;
    setTransfer(true);
    setRestoreError("");
    try {
      const { data } = await api<{
        data: RestorePreview & { cancelled: boolean };
      }>("/api/v1/workspaces/restore-preview", { method: "POST" });
      if (!data.cancelled) {
        setRestorePreview(data);
        setRestoreForm({
          name: `${data.name.slice(0, 75)}（恢复）`,
          description: data.description,
          directory: "",
        });
      }
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setTransfer(false);
    }
  }
  function cancelRestore() {
    if (restoring || choosing) return;
    const token = restorePreview?.token;
    setRestorePreview(null);
    if (token)
      void api("/api/v1/workspaces/restore-discard", {
        method: "POST",
        body: JSON.stringify({ token }),
      }).catch(() => {});
  }
  async function restore() {
    if (!restorePreview || restoring) return;
    setRestoring(true);
    setRestoreError("");
    try {
      await api("/api/v1/workspaces/restore", {
        method: "POST",
        body: JSON.stringify({
          ...restoreForm,
          token: restorePreview.token,
          confirmed: true,
        }),
      });
      setRestorePreview(null);
      setRevision((value) => value + 1);
      notify("已恢复为新的工作空间");
    } catch (error) {
      setRestoreError((error as Error).message);
    } finally {
      setRestoring(false);
    }
  }
  async function chooseRestoreDirectory() {
    setChoosing(true);
    try {
      const { data } = await api<{ data: { directory: string } }>(
        "/api/v1/workspaces/select-directory",
        { method: "POST" },
      );
      if (data.directory)
        setRestoreForm((previous) => ({
          ...previous,
          directory: data.directory,
        }));
    } catch (error) {
      setRestoreError((error as Error).message);
    } finally {
      setChoosing(false);
    }
  }
  const [menu, setMenu] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void api<{ data: WorkspaceSummary[] }>("/api/v1/workspaces", {
      signal: controller.signal,
    })
      .then(({ data }) => {
        setSpaces(data);
        setError("");
        const target = data.find((space) => space.id === params.get("edit"));
        if (target) {
          edit(target);
          setParams({}, { replace: true });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, params.get("edit")]);
  function edit(value: WorkspaceSummary | null) {
    setMenu("");
    setEditing(value);
    setForm(
      value
        ? {
            name: value.name,
            description: value.description,
            directory: value.directory,
          }
        : blank,
    );
    setFormError("");
  }
  async function save() {
    if (saving) return;
    setSaving(true);
    setFormError("");
    try {
      const { data } = await api<{ data: Workspace }>(
        editing ? `/api/v1/workspaces/${editing.id}` : "/api/v1/workspaces",
        {
          method: editing ? "PUT" : "POST",
          body: JSON.stringify({
            ...form,
            ...(editing ? { expectedVersion: editing.version } : {}),
          }),
        },
      );
      if (editing) {
        if (workspace?.id === data.id) updateWorkspace(data);
        setEditing(undefined);
        setRevision((value) => value + 1);
        notify("工作空间已更新");
      } else {
        await openWorkspace(data.id);
        setEditing(undefined);
        notify("工作空间已创建");
      }
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function choose() {
    setChoosing(true);
    try {
      const { data } = await api<{ data: { directory: string } }>(
        "/api/v1/workspaces/select-directory",
        { method: "POST" },
      );
      if (data.directory)
        setForm((previous) => ({ ...previous, directory: data.directory }));
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setChoosing(false);
    }
  }
  async function remove() {
    if (!removing || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api(`/api/v1/workspaces/${removing.id}`, {
        method: "DELETE",
        body: JSON.stringify({
          confirmed: true,
          name: confirmation,
          expectedVersion: removing.version,
        }),
      });
      if (workspace?.id === removing.id) leaveWorkspace();
      setRemoving(null);
      setRevision((value) => value + 1);
      notify("工作空间已删除");
    } catch (error) {
      setDeleteError((error as Error).message);
    } finally {
      setDeleting(false);
    }
  }
  return (
    <div className="workspace-content spaces-page">
      <div className="page-heading">
        <h1>工作空间</h1>
        <div className="spaces-heading-actions">
          <Button
            variant="outline"
            disabled={transfer}
            onClick={() => void previewRestore()}
          >
            <Upload />
            {transfer ? "正在处理…" : "恢复工作空间"}
          </Button>
          <Button disabled={transfer} onClick={() => edit(null)}>
            <Plus />
            新建工作空间
          </Button>
        </div>
      </div>
      {error && (
        <div className="message" role="alert">
          {error}
          <Button
            variant="ghost"
            onClick={() => setRevision((value) => value + 1)}
          >
            重试
          </Button>
        </div>
      )}
      {loading ? (
        <div className="spaces-empty" role="status">
          <LoaderCircle size={20} className="ai-spin" />
          正在加载工作空间…
        </div>
      ) : spaces.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="创建第一个工作空间"
          description="在工作空间中整理任务、沉淀设计，推进项目。"
        />
      ) : (
        <div className="spaces-grid">
          {spaces.map((space) => (
            <article className="space-card" key={space.id}>
              <button
                className="space-card-open"
                disabled={Boolean(opening) || deleting}
                onClick={() => {
                  setOpening(space.id);
                  void openWorkspace(space.id).catch((error) => {
                    notify(error.message, "error");
                    setOpening("");
                  });
                }}
              >
                <span className="space-card-title">
                  <span className="space-card-icon">
                    <Folder size={21} strokeWidth={1.5} />
                  </span>
                  <strong>{space.name}</strong>
                  {opening === space.id && (
                    <LoaderCircle size={13} className="ai-spin" />
                  )}
                </span>
                <span className="space-card-description">
                  {space.description || "在这里整理任务、沉淀设计，推进项目。"}
                </span>
                <span className="space-card-counts">
                  <span>
                    <strong>{space.counts.items}</strong>工作项
                  </span>
                  <span>
                    <strong>{space.counts.models}</strong>领域模型
                  </span>
                  <span>
                    <strong>{space.counts.notes || 0}</strong>无边记
                  </span>
                </span>
                <span className="space-card-footer">
                  <span className="space-card-enter">
                    {opening === space.id ? "正在打开…" : "进入空间"}
                    <ArrowRight size={14} />
                  </span>
                </span>
              </button>
              <button
                className="space-card-more"
                aria-label={`管理工作空间：${space.name}`}
                aria-expanded={menu === space.id}
                onClick={() =>
                  setMenu((value) => (value === space.id ? "" : space.id))
                }
              >
                <MoreHorizontal size={16} />
              </button>
              {menu === space.id && (
                <>
                  <button
                    className="space-menu-dismiss"
                    aria-label="关闭菜单"
                    onClick={() => setMenu("")}
                  />
                  <div className="space-card-menu">
                    <button
                      disabled={transfer}
                      onClick={() => void backupSpace(space.id)}
                    >
                      <Download size={13} />
                      备份工作空间
                    </button>
                    <button disabled={transfer} onClick={() => edit(space)}>
                      <Pencil size={13} />
                      编辑工作空间
                    </button>
                    <button
                      disabled={transfer}
                      className="danger"
                      onClick={() => {
                        setMenu("");
                        setRemoving(space);
                        setConfirmation("");
                        setDeleteError("");
                      }}
                    >
                      <Trash2 size={13} />
                      删除工作空间
                    </button>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}
      <Dialog.Root
        open={Boolean(restorePreview)}
        onOpenChange={(open) => {
          if (!open) cancelRestore();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="space-dialog"
            onEscapeKeyDown={(event) => {
              if (restoring || choosing) event.preventDefault();
            }}
          >
            <Dialog.Title>恢复工作空间</Dialog.Title>
            <Dialog.Description className="space-restore-description">
              确认后恢复为一个新工作空间，现有数据保持不变。
            </Dialog.Description>
            {restorePreview && (
              <div className="space-restore-summary">
                <strong>{restorePreview.name}</strong>
                <span>
                  备份于{" "}
                  {new Date(restorePreview.createdAt).toLocaleString("zh-CN")}
                </span>
                <div>
                  {restorePreview.counts.items} 工作项（含{" "}
                  {restorePreview.counts.trash} 项回收站） ·{" "}
                  {restorePreview.counts.models} 领域模型
                </div>
                <div>
                  {restorePreview.counts.sprints} 冲刺 ·{" "}
                  {restorePreview.counts.chats} 对话 ·{" "}
                  {restorePreview.counts.notes || 0} 无边记
                  {" · "}
                  {restorePreview.counts.developmentTasks || 0} 研发任务
                </div>
              </div>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void restore();
              }}
            >
              <label>
                工作空间名称
                <input
                  required
                  maxLength={80}
                  value={restoreForm.name}
                  disabled={restoring}
                  onChange={(event) =>
                    setRestoreForm({ ...restoreForm, name: event.target.value })
                  }
                />
              </label>
              <label>
                本地工作目录 <small>可选</small>
                <span className="space-directory">
                  <input
                    maxLength={2000}
                    value={restoreForm.directory}
                    placeholder="留空使用新的默认目录"
                    disabled={restoring || choosing}
                    onChange={(event) =>
                      setRestoreForm({
                        ...restoreForm,
                        directory: event.target.value,
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label="选择恢复后的工作目录"
                    disabled={restoring || choosing}
                    onClick={() => void chooseRestoreDirectory()}
                  >
                    <FolderOpen />
                  </Button>
                </span>
              </label>
              {restoreError && (
                <p role="alert" className="message">
                  {restoreError}
                </p>
              )}
              <div className="confirmation-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={restoring || choosing}
                  onClick={cancelRestore}
                >
                  取消
                </Button>
                <Button
                  disabled={!restoreForm.name.trim() || restoring || choosing}
                >
                  {restoring ? "正在恢复…" : "恢复为新工作空间"}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open && !saving && !choosing) setEditing(undefined);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="space-dialog"
            onEscapeKeyDown={(event) => {
              if (saving || choosing) event.preventDefault();
            }}
          >
            <Dialog.Title>
              {editing ? "编辑工作空间" : "新建工作空间"}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              设置工作空间名称、说明与本地目录。
            </Dialog.Description>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <label>
                工作空间名称
                <input
                  autoFocus
                  required
                  maxLength={80}
                  value={form.name}
                  disabled={saving}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </label>
              <label>
                说明 <small>可选</small>
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={form.description}
                  disabled={saving}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                />
              </label>
              <label>
                本地工作目录 <small>可选</small>
                <span className="space-directory">
                  <input
                    placeholder="DedsiWork Ai Agent 默认使用的目录"
                    value={form.directory}
                    maxLength={2000}
                    disabled={saving || choosing}
                    onChange={(event) =>
                      setForm({ ...form, directory: event.target.value })
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label="选择本地目录"
                    disabled={saving || choosing}
                    onClick={() => void choose()}
                  >
                    <FolderOpen />
                  </Button>
                </span>
              </label>
              {formError && (
                <p className="message" role="alert">
                  {formError}
                </p>
              )}
              <div className="confirmation-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving || choosing}
                  onClick={() => setEditing(undefined)}
                >
                  取消
                </Button>
                <Button disabled={!form.name.trim() || saving || choosing}>
                  {saving ? "正在保存…" : editing ? "保存" : "创建并打开"}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <AlertDialog.Root
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open && !deleting) setRemoving(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay confirmation-overlay" />
          <AlertDialog.Content
            className="confirmation-content"
            onEscapeKeyDown={(event) => {
              if (deleting) event.preventDefault();
            }}
          >
            <AlertDialog.Title>删除工作空间？</AlertDialog.Title>
            <AlertDialog.Description>
              “{removing?.name}”中的 {removing?.counts.chats} 条对话、
              {removing?.counts.items} 个工作项、{removing?.counts.sprints}{" "}
              个冲刺、{removing?.counts.notes || 0} 个无边记和{" "}
              {removing?.counts.models}{" "}
              个领域模型，以及该空间的数据库、附件和内部文件将被物理删除，无法撤销。
              研发任务记录也将删除。关联的本地代码目录、研发工作树和已导出的备份文件保留。
            </AlertDialog.Description>
            <label className="space-delete-name">
              输入工作空间名称确认
              <input
                aria-label="确认工作空间名称"
                value={confirmation}
                disabled={deleting}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            {deleteError && (
              <p className="message" role="alert">
                {deleteError}
              </p>
            )}
            <div className="confirmation-actions">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={deleting}>
                  取消
                </Button>
              </AlertDialog.Cancel>
              <Button
                disabled={confirmation !== removing?.name || deleting}
                onClick={() => void remove()}
              >
                {deleting ? "正在删除…" : "删除工作空间"}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
