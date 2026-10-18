import { PAGE_SIZE } from "../../shared/pagination";
import { EmptyState } from "../components/empty-state";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import * as Dialog from "@radix-ui/react-alert-dialog";
import {
  Plus,
  StickyNote,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { useWorkspace } from "../workspace-context";
import type {
  CanvasNoteList,
  CanvasNoteSummary,
} from "../../shared/canvas-note";
import "../notes.css";
export function NotesPage() {
  const { notify } = useWorkspace();
  const [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [result, setResult] = useState<CanvasNoteList>({
    data: [],
    meta: { total: 0, page: 1, pageSize: PAGE_SIZE },
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [removing, setRemoving] = useState<CanvasNoteSummary | null>(null),
    [busy, setBusy] = useState(false),
    [deleteError, setDeleteError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<CanvasNoteList>(
      `/api/v1/notes?${new URLSearchParams({ page: String(page) })}`,
      { signal: controller.signal },
    )
      .then(setResult)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, revision]);
  async function remove() {
    if (!removing || busy) return;
    setBusy(true);
    setDeleteError("");
    try {
      await api(`/api/v1/notes/${removing.id}`, {
        method: "DELETE",
        body: JSON.stringify({
          confirmed: true,
          expectedVersion: removing.version,
        }),
      });
      setRemoving(null);
      notify("无边记已删除");
      if (result.data.length === 1 && page > 1) setPage(page - 1);
      else setRevision((v) => v + 1);
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-content notes-content">
      <div className="page-heading">
        <h1>
          无边记<span className="title-count">{result.meta.total}</span>
        </h1>
        <Button
          asChild
          title={"新建无边记"}
          aria-label={"新建无边记"}
          size="icon-sm"
        >
          <Link to="/notes/new">
            <Plus />
          </Link>
        </Button>
      </div>

      {error && (
        <div className="message" role="alert">
          {error}
          <Button variant="ghost" onClick={() => setRevision((v) => v + 1)}>
            重试
          </Button>
        </div>
      )}
      {loading ? (
        <div className="notes-empty" role="status">
          正在加载…
        </div>
      ) : !error && result.data.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title="创建第一个无边记"
          description="用文字、图片和图形，记录并整理你的想法。"
        />
      ) : (
        <div className="notes-grid">
          {result.data.map((note) => (
            <article className="note-card" key={note.id}>
              <Link to={`/notes/${note.id}`} className="note-card-main">
                <span className="note-card-icon">
                  <StickyNote size={18} />
                </span>
                <h2>{note.name}</h2>
                <p>
                  {note.preview || (note.nodeCount ? "图片与图形" : "空白画布")}
                </p>
                <footer>
                  <span>{note.nodeCount} 个元素</span>
                  <time dateTime={note.updatedAt}>
                    {new Date(note.updatedAt).toLocaleDateString("zh-CN")}
                  </time>
                </footer>
              </Link>
              <Button
                className="note-card-delete"
                variant="ghost"
                size="icon-sm"
                title="删除无边记"
                aria-label={`删除 ${note.name}`}
                onClick={() => {
                  setRemoving(note);
                  setDeleteError("");
                }}
              >
                <Trash2 />
              </Button>
            </article>
          ))}
        </div>
      )}
      {!loading && result.meta.total > 20 && (
        <div className="notes-pagination">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={page === 1}
            aria-label="上一页"
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft />
          </Button>
          <span>
            {page} / {Math.max(1, Math.ceil(result.meta.total / PAGE_SIZE))}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={page * PAGE_SIZE >= result.meta.total}
            aria-label="下一页"
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      )}
      <Dialog.Root
        open={!!removing}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoving(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay confirmation-overlay" />
          <Dialog.Content className="confirmation-content">
            <Dialog.Title>删除无边记？</Dialog.Title>
            <Dialog.Description>
              “{removing?.name}
              ”及其中的文字、图片和图形将永久删除，此操作无法撤销。
            </Dialog.Description>
            {deleteError && (
              <p role="alert" className="message">
                {deleteError}
              </p>
            )}
            <div className="confirmation-actions">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setRemoving(null)}
              >
                取消
              </Button>
              <Button variant="destructive" disabled={busy} onClick={remove}>
                {busy ? "正在删除…" : "确认删除"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
