import { EmptyState } from "../components/empty-state";
import { useEffect, useRef, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { useWorkspace } from "../workspace-context";
import {
  bookmarkSaveSchema,
  type BookmarkGroup,
  type BookmarkState,
} from "../../shared/bookmarks";
import "../bookmarks.css";

type Editor = {
  kind: "group" | "link" | "delete-group" | "delete-link";
  groupId: string;
  linkId?: string;
};
export function BookmarksPage() {
  const { workspace, notify } = useWorkspace();
  const [data, setData] = useState<BookmarkState>({ version: 0, groups: [] });
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [formError, setFormError] = useState("");
  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [title, setTitle] = useState(""),
    [url, setUrl] = useState(""),
    [description, setDescription] = useState("");
  const lock = useRef(false);
  const spaceId = useRef(workspace?.id);
  spaceId.current = workspace?.id;
  async function load(signal?: AbortSignal) {
    setLoading(true);
    setError("");
    const id = spaceId.current;
    try {
      const result = await api<{ data: BookmarkState }>("/api/v1/bookmarks", {
        signal,
      });
      if (id === spaceId.current) setData(result.data);
    } catch (e) {
      if (!signal?.aborted && id === spaceId.current)
        setError((e as Error).message);
    } finally {
      if (!signal?.aborted && id === spaceId.current) setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    setData({ version: 0, groups: [] });
    setEditor(null);
    void load(controller.signal);
    return () => controller.abort();
  }, [workspace?.id]);
  function open(next: Editor) {
    const group = data.groups.find((g) => g.id === next.groupId);
    const link = group?.links.find((l) => l.id === next.linkId);
    setTitle(
      next.kind.includes("group") ? group?.title || "" : link?.title || "",
    );
    setUrl(link?.url || "");
    setDescription(link?.description || "");
    setFormError("");
    setEditor(next);
  }
  async function save(groups: BookmarkGroup[], modal = false) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    modal ? setFormError("") : setError("");
    const id = spaceId.current;
    try {
      const parsed = bookmarkSaveSchema.safeParse({
        expectedVersion: data.version,
        groups,
      });
      if (!parsed.success)
        throw new Error(parsed.error.issues[0]?.message || "请检查输入");
      const result = await api<{ data: BookmarkState }>("/api/v1/bookmarks", {
        method: "PUT",
        body: JSON.stringify(parsed.data),
      });
      if (id === spaceId.current) {
        setData(result.data);
        if (modal) setEditor(null);
      }
      return true;
    } catch (e) {
      if (id === spaceId.current)
        (modal ? setFormError : setError)((e as Error).message);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    let groups = structuredClone(data.groups);
    const group = groups.find((g) => g.id === editor.groupId);
    if (editor.kind === "delete-group")
      groups = groups.filter((g) => g.id !== editor.groupId);
    else if (editor.kind === "group") {
      if (group) group.title = title.trim();
      else
        groups.push({
          id: crypto.randomUUID(),
          title: title.trim(),
          links: [],
        });
    } else if (group) {
      if (editor.kind === "delete-link")
        group.links = group.links.filter((l) => l.id !== editor.linkId);
      else {
        const value = {
          id: editor.linkId || crypto.randomUUID(),
          title: title.trim(),
          url: url.trim(),
          description: description.trim(),
        };
        const index = group.links.findIndex((l) => l.id === editor.linkId);
        if (index >= 0) group.links[index] = value;
        else group.links.push(value);
      }
    }
    await save(groups, true);
  }
  function move(groupId: string, offset: number, linkId?: string) {
    const groups = structuredClone(data.groups);
    const list = linkId ? groups.find((g) => g.id === groupId)!.links : groups;
    const index = list.findIndex((value) => value.id === (linkId || groupId));
    if (index + offset < 0 || index + offset >= list.length) return;
    [list[index], list[index + offset]] = [list[index + offset]!, list[index]!];
    void save(groups);
  }
  async function visit(url: string) {
    try {
      await api("/api/v1/chat/open-link", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
    } catch (e) {
      notify((e as Error).message, "error");
    }
  }
  const groups = data.groups;
  const deleting = editor?.kind.startsWith("delete");
  return (
    <div className="workspace-content bookmarks-page">
      <div className="page-heading">
        <div>
          <h1>网址导航</h1>
        </div>
        <div className="bookmarks-actions">
          <Button
            variant="ghost"
            disabled={loading || busy}
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
            title={editing ? "完成编辑" : "编辑"}
            aria-label={editing ? "完成编辑" : "编辑"}
            size="icon-sm"
          >
            <Pencil />
          </Button>
          <Button
            disabled={loading || busy}
            onClick={() => open({ kind: "group", groupId: "" })}
            title={"新建分组"}
            aria-label={"新建分组"}
            size="icon-sm"
          >
            <Plus />
          </Button>
        </div>
      </div>
      {error && (
        <div role="alert" className="message error">
          {error}{" "}
          <Button variant="ghost" disabled={busy} onClick={() => void load()}>
            重新加载
          </Button>
        </div>
      )}
      {loading ? (
        <p role="status" className="bookmarks-empty">
          正在读取网址…
        </p>
      ) : !groups.length && !error ? (
        <EmptyState
          title="创建第一个网址分组"
          description="按主题收集常用网址，让常用资源触手可及。"
        />
      ) : (
        groups.map((group) => (
          <section className="bookmark-section" key={group.id}>
            <header>
              <h2>{group.title}</h2>
              <div className="bookmarks-actions">
                {editing && (
                  <>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`上移分组 ${group.title}`}
                      disabled={busy || data.groups[0]?.id === group.id}
                      onClick={() => move(group.id, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`下移分组 ${group.title}`}
                      disabled={busy || data.groups.at(-1)?.id === group.id}
                      onClick={() => move(group.id, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`重命名分组 ${group.title}`}
                      disabled={busy}
                      onClick={() => open({ kind: "group", groupId: group.id })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`删除分组 ${group.title}`}
                      disabled={busy}
                      onClick={() =>
                        open({ kind: "delete-group", groupId: group.id })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => open({ kind: "link", groupId: group.id })}
                  title={"添加网址"}
                  aria-label={"添加网址"}
                >
                  <Plus />
                </Button>
              </div>
            </header>
            <div className="bookmark-grid">
              {group.links.map((link, index) => (
                <article className="bookmark-tile" key={link.id}>
                  <a
                    href={link.url}
                    onClick={(e) => {
                      e.preventDefault();
                      void visit(link.url);
                    }}
                  >
                    <strong>{link.title}</strong>
                    <span className="bookmark-description">
                      {link.description || new URL(link.url).hostname}
                    </span>
                    <ExternalLink className="bookmark-external" size={13} />
                  </a>
                  {editing && (
                    <div className="bookmark-controls">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`前移 ${link.title}`}
                        disabled={busy || index === 0}
                        onClick={() => move(group.id, -1, link.id)}
                      >
                        <ArrowLeft />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`后移 ${link.title}`}
                        disabled={busy || index === group.links.length - 1}
                        onClick={() => move(group.id, 1, link.id)}
                      >
                        <ArrowRight />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`编辑 ${link.title}`}
                        disabled={busy}
                        onClick={() =>
                          open({
                            kind: "link",
                            groupId: group.id,
                            linkId: link.id,
                          })
                        }
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`删除 ${link.title}`}
                        disabled={busy}
                        onClick={() =>
                          open({
                            kind: "delete-link",
                            groupId: group.id,
                            linkId: link.id,
                          })
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </article>
              ))}
            </div>
            {!group.links.length && (
              <EmptyState
                compact
                title="分组里还没有网址"
                description="添加常用网址，整理这一组资源。"
              />
            )}
          </section>
        ))
      )}
      <Dialog.Root
        open={!!editor}
        onOpenChange={(value) => {
          if (!value && !busy) setEditor(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="bookmark-dialog">
            <Dialog.Title>
              {deleting
                ? "确认删除"
                : editor?.kind === "group"
                  ? editor.groupId
                    ? "编辑分组"
                    : "新建分组"
                  : editor?.linkId
                    ? "编辑网址"
                    : "添加网址"}
            </Dialog.Title>
            <Dialog.Description>
              {deleting
                ? `删除“${title}”${editor?.kind === "delete-group" ? "及分组内的全部网址" : ""}？此操作不会删除网站上的任何内容。`
                : "保存到当前工作空间，随工作空间备份保留。"}
            </Dialog.Description>
            <form onSubmit={submit}>
              {!deleting && (
                <>
                  <label>
                    名称
                    <input
                      autoFocus
                      required
                      maxLength={editor?.kind === "group" ? 80 : 100}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  {editor?.kind === "link" && (
                    <>
                      <label>
                        网址
                        <input
                          type="url"
                          required
                          placeholder="https://example.com"
                          maxLength={2000}
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          disabled={busy}
                        />
                      </label>
                      <label>
                        说明 <small>可选</small>
                        <input
                          maxLength={300}
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          disabled={busy}
                        />
                      </label>
                    </>
                  )}
                </>
              )}
              {formError && (
                <p className="message error" role="alert">
                  {formError}
                </p>
              )}
              <footer>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setEditor(null)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "正在保存…" : deleting ? "确认删除" : "保存"}
                </Button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
