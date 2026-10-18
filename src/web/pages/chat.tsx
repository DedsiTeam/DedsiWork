import { useRouteInputs } from "../route-inputs";
import { RICH_TEXT_PREFIX } from "../../shared/description";
import type { SourceKind } from "../../shared/personal-work";
import { EmptyState } from "../components/empty-state";
import { AIWorkflowLibrary } from "../components/ai-workflows";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useNavigate } from "react-router";
import { businessActionLabels } from "../../shared/assistant-business";
import { chatProposals, chatProposalContent } from "../../shared/chat-proposal";
import type { AssistantFlow } from "../../shared/assistant";
import type { WorkItem } from "../../shared/work-item";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  ImagePlus,
  LoaderCircle,
  MessageSquare,
  History,
  Folder,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  Boxes,
  ListTodo,
  X,
  Workflow,
} from "lucide-react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { useWorkspace } from "../workspace-context";
import type { CodexStatus } from "../../shared/domain-model-ai";
import type {
  ChatItem,
  ChatRequest,
  ChatSnapshot,
  ChatSummary,
} from "../../shared/chat";

function stored(key: string) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
function store(key: string, value: string) {
  try {
    value ? localStorage.setItem(key, value) : localStorage.removeItem(key);
  } catch {}
}
const toolLabels: Record<string, string> = {
  commandExecution: "运行命令",
  fileChange: "修改文件",
  mcpToolCall: "调用工具",
  webSearch: "搜索网页",
  plan: "执行计划",
  collabAgentToolCall: "子任务",
  imageGeneration: "生成图片",
  imageView: "查看图片",
  dynamicToolCall: "调用工具",
};
async function openLink(url: string) {
  await api("/api/v1/chat/open-link", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export function ChatPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { notify, workspace } = useWorkspace();
  const selectionKey = `dedsiwork:${workspace?.id}:chat-selected`;
  const navigate = useNavigate();
  const [params, setParams] = useRouteInputs("/assistant");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  useEffect(() => {
    if (!historyOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHistoryOpen(false);
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [historyOpen]);
  const [openingProposal, setOpeningProposal] = useState("");
  const [selected, setSelected] = useState(() => stored(selectionKey));
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [snapshot, setSnapshot] = useState<ChatSnapshot | null>(null);
  const [status, setStatus] = useState<
    (CodexStatus & { defaultWorkspace: string }) | null
  >(null);
  const [connectionError, setConnectionError] = useState("");
  const [connecting, setConnecting] = useState(true);
  const [loginPending, setLoginPending] = useState(false);
  const [loginOpening, setLoginOpening] = useState(false);
  const [revision, setRevision] = useState(0);
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [loading, setLoading] = useState(Boolean(selected));
  const [opening, setOpening] = useState(false);
  const [older, setOlder] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChatSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const removed = useRef(new Set<string>());
  const [error, setError] = useState("");
  useEffect(() => {
    const ids = (params.get("items") || "")
      .split(",")
      .filter(Boolean)
      .slice(0, 20);
    if (!ids.length) return;
    const controller = new AbortController();
    void Promise.all(
      ids.map((id) =>
        api<{ data: WorkItem }>(`/api/v1/work-items/${id}`, {
          signal: controller.signal,
        }),
      ),
    )
      .then((values) => {
        if (controller.signal.aborted) return;
        select("");
        handoffSources.current = values.map(({ data }) => ({
          kind: "item",
          id: data.id,
        }));
        setText(
          "请根据以下工作项设计领域模型，先讨论必要的细节，确认后提供模型草稿：\n" +
            values
              .map(
                ({ data }) =>
                  `工作项：${data.title}（${data.id}，版本 ${data.version}）\n${data.description.startsWith(RICH_TEXT_PREFIX) ? new DOMParser().parseFromString(data.description.replace(/<br\s*\/?>|<\/(?:p|li|h[1-6]|blockquote|div)>/gi, "$&\n"), "text/html").body.textContent || "" : data.description}`,
              )
              .join("\n"),
        );
        setParams({}, { replace: true });
      })
      .catch((error) => {
        if (!controller.signal.aborted) notify(error.message, "error");
      });
    return () => controller.abort();
  }, [params.get("items")]);
  const handoffSources = useRef<
    { kind: SourceKind; id: string; nodeIds?: string[] }[]
  >([]);
  const sourceDrafts = useRef(new Map<string, typeof handoffSources.current>());
  const consumedHandoff = useRef("");
  useEffect(() => {
    const token = params.get("handoff");
    if (!token || consumedHandoff.current === token) return;
    try {
      const raw = sessionStorage.getItem(`personal-handoff:${token}`);
      if (!raw) throw new Error("资料交接已失效，请从来源页面重新发起");
      const value = JSON.parse(raw);
      if (value.workspaceId !== workspace?.id)
        throw new Error("资料属于其他工作空间，请回到来源空间继续");
      consumedHandoff.current = token;
      select("");
      handoffSources.current = value.sources;
      setText(value.text);
      const next = new URLSearchParams(params);
      next.delete("handoff");
      setParams(next, { replace: true });
    } catch (e) {
      notify((e as Error).message, "error");
    }
  }, [params.get("handoff"), workspace?.id]);
  useEffect(() => {
    const thread = params.get("thread");
    if (!thread) return;
    select(thread);
    const next = new URLSearchParams(params);
    next.delete("thread");
    setParams(next, { replace: true });
  }, [params.get("thread")]);
  async function previewProposal(messageId: string, index: number) {
    if (!selected || busy || openingProposal) return;
    const key = `${messageId}:${index}`;
    setOpeningProposal(key);
    try {
      const { data } = await api<{
        data: AssistantFlow | { remoteSnapshotId: string };
      }>(`/api/v1/chat/threads/${selected}/proposals`, {
        method: "POST",
        body: JSON.stringify({ messageId, index }),
      });
      if (alive.current)
        navigate(
          "remoteSnapshotId" in data
            ? `/development-tasks/new/remote/${data.remoteSnapshotId}`
            : `/assistant/flow/${data.id}`,
        );
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      if (alive.current) setOpeningProposal("");
    }
  }
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const draft = useRef(new Map<string, { text: string; images: string[] }>());
  const nonce = useRef({ payload: "", id: crypto.randomUUID() });
  const seen = useRef({ id: "", revision: 0, running: false });
  function accept(data: ChatSnapshot) {
    if (selectedRef.current !== data.chat.id) return;
    if (
      seen.current.id === data.chat.id &&
      data.revision < seen.current.revision
    )
      return;
    seen.current = {
      id: data.chat.id,
      revision: data.revision,
      running: data.running,
    };
    setSnapshot(data);
  }
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const busy = sending || Boolean(snapshot?.running);
  function select(id: string) {
    sourceDrafts.current.set(selected, handoffSources.current);
    handoffSources.current = sourceDrafts.current.get(id) || [];
    setHistoryOpen(false);
    draft.current.set(selected, { text, images });
    selectedRef.current = id;
    setSelected(id);
    store(selectionKey, id);
    setSnapshot(null);
    seen.current = { id: "", revision: 0, running: false };
    setModel("");
    setLoading(Boolean(id));
    setError("");
    follow.current = true;
    const next = draft.current.get(id);
    setText(next?.text || "");
    setImages(next?.images || []);
  }
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function connect() {
      try {
        const { data } = await api<{
          data: CodexStatus & { defaultWorkspace: string };
        }>("/api/v1/chat/status", { signal: controller.signal });
        if (controller.signal.aborted) return;
        setStatus(data);
        setConnectionError("");
        if (data.ready) setLoginPending(false);
        else if (loginPending) timer = setTimeout(connect, 2500);
      } catch (error) {
        if (!controller.signal.aborted)
          setConnectionError((error as Error).message);
      } finally {
        if (!controller.signal.aborted) setConnecting(false);
      }
    }
    setConnecting(true);
    void connect();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [revision, loginPending]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function list() {
      try {
        const { data } = await api<{ data: ChatSummary[] }>(
          "/api/v1/chat/threads",
          { signal: controller.signal },
        );
        if (!controller.signal.aborted)
          setChats(data.filter((chat) => !removed.current.has(chat.id)));
      } catch (error) {
        if (!controller.signal.aborted) setError((error as Error).message);
      }
      if (!controller.signal.aborted) timer = setTimeout(list, 5000);
    }
    void list();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [revision]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const since = seen.current.id === selected ? seen.current.revision : 0;
        const { data } = await api<{ data: ChatSnapshot | null }>(
          `/api/v1/chat/threads/${selected}?since=${since}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (data) {
          accept(data);
        }
        setLoading(false);
        timer = setTimeout(poll, seen.current.running ? 700 : 2500);
      } catch (error) {
        if (controller.signal.aborted) return;
        setError((error as Error).message);
        setLoading(false);
        timer = setTimeout(poll, 4000);
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [selected, revision]);
  useEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [snapshot]);
  async function login() {
    setLoginOpening(true);
    setConnectionError("");
    try {
      await api("/api/v1/chat/login", { method: "POST" });
      if (alive.current) {
        setLoginPending(true);
        setRevision((value) => value + 1);
      }
    } catch (error) {
      if (alive.current) setConnectionError((error as Error).message);
    } finally {
      if (alive.current) setLoginOpening(false);
    }
  }
  async function openApp() {
    setOpening(true);
    try {
      await api("/api/v1/chat/open-app", { method: "POST" });
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      if (alive.current) setOpening(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || (!text.trim() && !images.length) || !status?.ready || loading)
      return;
    setSending(true);
    setError("");
    follow.current = true;
    let id = selected;
    try {
      if (!id) {
        const { data } = await api<{ data: ChatSnapshot }>(
          "/api/v1/chat/threads",
          {
            method: "POST",
            body: JSON.stringify({
              ...(model ? { model } : {}),
            }),
          },
        );
        id = data.chat.id;
        selectedRef.current = id;
        if (alive.current) {
          setSelected(id);
          accept(data);
          setChats((previous) => [data.chat, ...previous]);
          store(selectionKey, id);
        }
      }
      if (handoffSources.current.length) {
        await api("/api/v1/personal/sources", {
          method: "POST",
          body: JSON.stringify({ chatId: id, sources: handoffSources.current }),
        });
        handoffSources.current = [];
        sourceDrafts.current.delete(selected);
        sourceDrafts.current.delete(id);
      }
      const payload = JSON.stringify({ id, text: text.trim(), images, model });
      if (nonce.current.payload !== payload)
        nonce.current = { payload, id: crypto.randomUUID() };
      const { data } = await api<{ data: ChatSnapshot }>(
        `/api/v1/chat/threads/${id}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            text: text.trim(),
            images,
            clientId: nonce.current.id,
            ...(model ? { model } : {}),
          }),
        },
      );
      if (alive.current && selectedRef.current === id) {
        accept(data);
        setText("");
        setImages([]);
        draft.current.delete(id);
        nonce.current.payload = "";
      }
    } catch (error) {
      if (alive.current && selectedRef.current === id)
        setError((error as Error).message);
    } finally {
      if (alive.current) setSending(false);
    }
  }
  async function runWorkflow(prompt: string, existingChatId?: string) {
    if (existingChatId) {
      const { data } = await api<{ data: ChatSnapshot }>(
        `/api/v1/chat/threads/${existingChatId}`,
      );
      draft.current.set(selected, { text, images });
      selectedRef.current = existingChatId;
      setSelected(existingChatId);
      store(selectionKey, existingChatId);
      accept(data);
      setChats((previous) => [
        data.chat,
        ...previous.filter((chat) => chat.id !== existingChatId),
      ]);
      setText("");
      setImages([]);
      setHistoryOpen(false);
      follow.current = true;
      return;
    }
    if (busy || loading || !status?.ready)
      throw new Error("请等待当前回复结束，并确认 Codex 已连接。");
    setSending(true);
    setError("");
    let id = "";
    try {
      const { data: created } = await api<{ data: ChatSnapshot }>(
        "/api/v1/chat/threads",
        {
          method: "POST",
          body: JSON.stringify(model ? { model } : {}),
        },
      );
      id = created.chat.id;
      draft.current.set(selected, { text, images });
      selectedRef.current = id;
      setSelected(id);
      store(selectionKey, id);
      accept(created);
      setChats((previous) => [created.chat, ...previous]);
      setText(prompt);
      setImages([]);
      setHistoryOpen(false);
      follow.current = true;
      const { data } = await api<{ data: ChatSnapshot }>(
        `/api/v1/chat/threads/${id}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            text: prompt,
            images: [],
            clientId: crypto.randomUUID(),
            ...(model ? { model } : {}),
          }),
        },
      );
      if (alive.current && selectedRef.current === id) {
        accept(data);
        setText("");
        draft.current.delete(id);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
      throw e;
    } finally {
      if (alive.current) setSending(false);
    }
  }
  async function deleteChat() {
    if (!deleteTarget || deleting) return;
    const id = deleteTarget.id;
    setDeleting(true);
    setDeleteError("");
    try {
      await api(`/api/v1/chat/threads/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmed: true }),
      });
      removed.current.add(id);
      setChats((previous) => previous.filter((chat) => chat.id !== id));
      if (selectedRef.current === id) select("");
      draft.current.delete(id);
      setDeleteTarget(null);
      notify("对话已删除");
    } catch (error) {
      setDeleteError((error as Error).message);
    } finally {
      setDeleting(false);
    }
  }
  async function stop() {
    if (!selected || stopping) return;
    const id = selected;
    setStopping(true);
    try {
      const { data } = await api<{ data: ChatSnapshot }>(
        `/api/v1/chat/threads/${id}/stop`,
        { method: "POST" },
      );
      if (alive.current && selectedRef.current === id) accept(data);
    } catch (error) {
      if (alive.current) setError((error as Error).message);
    } finally {
      if (alive.current) setStopping(false);
    }
  }
  async function loadOlder() {
    const id = selected;
    setOlder(true);
    const previousHeight = scroll.current?.scrollHeight || 0;
    const previousTop = scroll.current?.scrollTop || 0;
    follow.current = false;
    try {
      const { data } = await api<{ data: ChatSnapshot }>(
        `/api/v1/chat/threads/${id}?older=true`,
      );
      if (alive.current && selectedRef.current === id) {
        accept(data);
        requestAnimationFrame(() => {
          if (scroll.current)
            scroll.current.scrollTop =
              previousTop + scroll.current.scrollHeight - previousHeight;
        });
      }
    } catch (error) {
      if (alive.current) setError((error as Error).message);
    } finally {
      if (alive.current) setOlder(false);
    }
  }
  async function attach(files: FileList | null) {
    if (!files) return;
    const list = [...files];
    if (images.length + list.length > 2) {
      notify("每条消息最多添加 2 张图片", "error");
      return;
    }
    if (
      list.some(
        (file) =>
          !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
            file.type,
          ) || file.size > 2 * 1024 * 1024,
      )
    ) {
      notify("支持 PNG、JPEG、WebP、GIF，每张不超过 2 MB", "error");
      return;
    }
    try {
      const values = await Promise.all(
        list.map(
          (file) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error("读取图片失败"));
              reader.readAsDataURL(file);
            }),
        ),
      );
      if (alive.current)
        setImages((previous) => [...previous, ...values].slice(0, 2));
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }
  return (
    <div className="workspace-content chat-page">
      {workflowOpen && (
        <AIWorkflowLibrary
          key={workspace?.id}
          onClose={() => setWorkflowOpen(false)}
          onRun={runWorkflow}
          canRun={Boolean(status?.ready) && !busy && !loading && !deleting}
          initialPrompt={text}
        />
      )}
      <AlertDialog.Root
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
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
            <AlertDialog.Title>删除对话？</AlertDialog.Title>
            <AlertDialog.Description>
              “{deleteTarget?.title}”将从 DedsiWork Ai Agent 中移除，并归档
              Codex 对话。已创建的工作项和领域模型会保留。
            </AlertDialog.Description>
            {deleteError && (
              <p role="alert" className="message error">
                {deleteError}
              </p>
            )}
            <div className="confirmation-actions">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={deleting}>
                  取消
                </Button>
              </AlertDialog.Cancel>
              <Button disabled={deleting} onClick={() => void deleteChat()}>
                {deleting ? "正在删除…" : "删除对话"}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <div className="page-heading">
        <div className="chat-heading">
          {!embedded && <h1>DedsiWork Ai Agent</h1>}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="历史对话"
            title="历史对话"
            aria-expanded={historyOpen}
            aria-controls="chat-history-panel"
            onClick={() => setHistoryOpen((value) => !value)}
          >
            <History />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={sending || deleting}
            onClick={() => select("")}
            title={"新对话"}
            aria-label={"新对话"}
          >
            <Plus />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={sending || deleting}
            onClick={() => setWorkflowOpen(true)}
            title={"AI 模板"}
            aria-label={"AI 模板"}
          >
            <Workflow />
          </Button>
          <span className={`chat-connection${status?.ready ? " ready" : ""}`}>
            {connecting ? (
              <LoaderCircle className="ai-spin" size={12} />
            ) : status?.ready ? (
              <Check size={12} />
            ) : null}
            {connecting
              ? "连接 Codex…"
              : status?.ready
                ? "Codex 已连接"
                : "Codex 未连接"}
          </span>
        </div>
        <div className="dm-heading-actions">
          {!status?.ready && (
            <Button
              variant="outline"
              disabled={connecting || loginOpening}
              onClick={() => void login()}
            >
              {loginOpening ? "正在打开…" : "登录 Codex"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="刷新 Codex 连接"
            disabled={connecting}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw />
          </Button>
          <Button
            variant="outline"
            disabled={opening}
            onClick={() => void openApp()}
            title={opening ? "正在打开…" : "打开 ChatGPT"}
            aria-label={opening ? "正在打开…" : "打开 ChatGPT"}
            size="icon-sm"
          >
            <ArrowUpRight />
          </Button>
        </div>
      </div>
      {connectionError && (
        <div className="message" role="alert">
          {connectionError}
        </div>
      )}
      {loginPending && !status?.ready && (
        <div className="message" role="status">
          请在浏览器完成登录，连接状态会自动更新。
        </div>
      )}
      <section className="chat-workbench" aria-label="Codex 对话">
        {historyOpen && (
          <>
            <button
              type="button"
              className="chat-history-dismiss"
              aria-label="关闭历史对话"
              onClick={() => setHistoryOpen(false)}
            />
            <aside
              id="chat-history-panel"
              className="chat-history"
              aria-label="对话历史"
            >
              <div className="chat-history-heading">
                <strong>历史对话</strong>
                <button
                  type="button"
                  aria-label="关闭历史对话"
                  onClick={() => setHistoryOpen(false)}
                >
                  <X size={13} />
                </button>
              </div>
              {chats.length === 0 && (
                <EmptyState
                  icon={MessageSquare}
                  compact
                  title="暂无历史对话"
                  description="开始对话后，可以在这里继续查看。"
                />
              )}
              <div className="chat-history-list">
                {chats.map((chat) => (
                  <div
                    key={chat.id}
                    className={`chat-history-row${selected === chat.id ? " active" : ""}`}
                  >
                    <button
                      className="chat-history-select"
                      disabled={sending || deleting}
                      onClick={() => select(chat.id)}
                      title={chat.title}
                    >
                      <MessageSquare size={13} />
                      <span>{chat.title}</span>
                    </button>
                    <button
                      className="chat-history-delete"
                      aria-label={`删除对话：${chat.title}`}
                      title="删除对话"
                      disabled={sending || deleting}
                      onClick={() => {
                        setDeleteError("");
                        setDeleteTarget(chat);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </aside>
          </>
        )}
        <div className="chat-conversation">
          <div
            className="chat-scroll"
            ref={scroll}
            onScroll={(event) => {
              const element = event.currentTarget;
              follow.current =
                element.scrollHeight -
                  element.scrollTop -
                  element.clientHeight <
                100;
            }}
          >
            {snapshot?.nextCursor && (
              <Button
                className="chat-older"
                variant="ghost"
                size="sm"
                disabled={older}
                onClick={() => void loadOlder()}
              >
                {older ? "加载中…" : "加载更早消息"}
              </Button>
            )}
            {loading ? (
              <p className="chat-empty" role="status">
                正在加载对话…
              </p>
            ) : !snapshot?.items.length ? (
              <EmptyState
                className="chat-empty"
                icon={MessageSquare}
                title="有什么需要一起完成？"
                description="聊聊你的想法，或描述需要完成的工作。"
              />
            ) : (
              snapshot.items.map((item) => (
                <div key={item.id}>
                  <ChatMessage
                    item={item}
                    onLinkError={(message) => notify(message, "error")}
                  />
                  {item.role === "assistant" &&
                    (chatProposalContent(item.text).pending ||
                      chatProposalContent(item.text).invalid) && (
                      <div className="chat-draft-status" role="status">
                        {snapshot.running &&
                        chatProposalContent(item.text).pending ? (
                          <>
                            <LoaderCircle size={13} className="ai-spin" />
                            正在整理草稿…
                          </>
                        ) : (
                          "草稿尚未完整，请让助手重新整理后再预览。"
                        )}
                      </div>
                    )}
                  {item.role === "assistant" &&
                    chatProposals(item.text).map(({ index, proposal }) => (
                      <section className="chat-proposal" key={index}>
                        <div>
                          <strong>
                            {proposal.kind !== "domain_model" ? (
                              <ListTodo size={14} />
                            ) : (
                              <Boxes size={14} />
                            )}
                            {proposal.kind === "remote_development"
                              ? "同事需求 · 本机研发"
                              : proposal.kind === "business_action"
                                ? businessActionLabels[
                                    proposal.operation.action
                                  ]
                                : proposal.kind !== "domain_model"
                                  ? `${proposal.kind === "development_items" ? "研发任务草稿" : "工作项草稿"} · ${proposal.items.length} 项`
                                  : proposal.model.name}
                          </strong>
                          <span>
                            {proposal.kind === "remote_development"
                              ? "需求已读取，预览完整内容并确认本机执行目录"
                              : proposal.kind === "business_action"
                                ? "查看操作范围，确认后执行"
                                : proposal.kind !== "domain_model"
                                  ? proposal.items
                                      .map((item) => item.title)
                                      .join(" · ")
                                  : `领域模型草稿 · ${proposal.model.elements.length} 个设计项 · ${proposal.model.elements.reduce((count, element) => count + element.fields.length, 0)} 个字段`}
                          </span>
                          <small>
                            {proposal.kind === "remote_development"
                              ? "预览确认后在本机创建并开始研发"
                              : proposal.kind === "business_action"
                                ? "预览确认后执行"
                                : "预览修改后确认保存"}
                          </small>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || Boolean(openingProposal)}
                          onClick={() => void previewProposal(item.id, index)}
                        >
                          {openingProposal === `${item.id}:${index}`
                            ? "正在打开…"
                            : proposal.kind === "remote_development"
                              ? "预览需求并研发"
                              : proposal.kind === "business_action"
                                ? "预览操作"
                                : proposal.kind !== "domain_model"
                                  ? proposal.kind === "development_items"
                                    ? "预览研发任务"
                                    : "预览工作项"
                                  : "预览领域模型"}
                        </Button>
                      </section>
                    ))}
                </div>
              ))
            )}
            {snapshot?.requests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                chatId={selected}
                onResult={(value) => {
                  if (selectedRef.current === value.chat.id) accept(value);
                }}
              />
            ))}
            {snapshot?.running && (
              <div className="chat-working" role="status">
                <LoaderCircle size={13} className="ai-spin" />
                {snapshot.requests.length
                  ? "等待你的回复或授权"
                  : snapshot.stopping
                    ? "正在停止…"
                    : "Codex 正在处理…"}
              </div>
            )}
            {(error || snapshot?.error) && (
              <div className="message" role="alert">
                {error || snapshot?.error}
              </div>
            )}
          </div>
          <form
            className="chat-composer"
            onSubmit={(event) => void submit(event)}
          >
            {images.length > 0 && (
              <div className="chat-attachments">
                {images.map((url, index) => (
                  <div key={index}>
                    <img src={url} alt={`附件 ${index + 1}`} />
                    <button
                      type="button"
                      aria-label={`移除附件 ${index + 1}`}
                      disabled={busy}
                      onClick={() =>
                        setImages((previous) =>
                          previous.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              aria-label="对话消息"
              value={text}
              disabled={sending || loading}
              maxLength={30000}
              placeholder="聊聊你的想法，或描述需要完成的工作…"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="chat-composer-actions">
              <div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  hidden
                  onChange={(event) => {
                    void attach(event.target.files);
                    event.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="添加图片"
                  title="添加图片"
                  disabled={busy || images.length >= 2}
                  onClick={() => fileInput.current?.click()}
                >
                  <ImagePlus />
                </Button>
                <div
                  className="chat-directory-button"
                  title={
                    workspace?.directory ||
                    status?.defaultWorkspace ||
                    "工作空间本地工作目录"
                  }
                  aria-label="工作空间本地工作目录"
                >
                  <Folder size={13} />
                  <span>
                    {(workspace?.directory || status?.defaultWorkspace || "")
                      .replace(/[\\/]+$/, "")
                      .split(/[\\/]/)
                      .pop() || "工作空间目录"}
                  </span>
                </div>
                {status?.models.length ? (
                  <select
                    className="chat-model-select"
                    aria-label="选择模型"
                    value={model || snapshot?.chat.model || ""}
                    disabled={busy || loading}
                    onChange={(event) => setModel(event.target.value)}
                  >
                    {!snapshot?.chat.model && (
                      <option value="">Codex 默认模型</option>
                    )}
                    {status.models.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              {busy ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="停止回复"
                  title="停止回复"
                  disabled={!selected || stopping || snapshot?.stopping}
                  onClick={() => void stop()}
                >
                  <Square />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  aria-label="发送消息"
                  title="发送消息"
                  disabled={
                    !status?.ready ||
                    connecting ||
                    loading ||
                    (!text.trim() && !images.length)
                  }
                >
                  <ArrowUp />
                </Button>
              )}
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

export function ChatMessage({
  item,
  onLinkError,
}: {
  item: ChatItem;
  onLinkError: (message: string) => void;
}) {
  if (item.role === "tool")
    return (
      <details className="chat-tool">
        <summary>
          <ChevronDown size={12} />
          <span>{toolLabels[item.type] || item.type}</span>
          <small>
            {item.status === "completed"
              ? "已完成"
              : item.status === "declined"
                ? "已拒绝"
                : item.status === "interrupted"
                  ? "已中断"
                  : item.status === "failed"
                    ? "失败"
                    : item.status === "inProgress"
                      ? "进行中"
                      : item.status || ""}
          </small>
        </summary>
        <pre>{item.text}</pre>
      </details>
    );
  return (
    <article
      className={`chat-message chat-message-${item.role}`}
      aria-label={item.role === "user" ? "你的消息" : "Codex 回复"}
    >
      <div className="chat-markdown">
        {item.role === "user" ? (
          <p>{item.text}</p>
        ) : (
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  onClick={(event) => {
                    event.preventDefault();
                    if (href)
                      void openLink(href).catch((error) =>
                        onLinkError(error.message),
                      );
                  }}
                >
                  {children}
                </a>
              ),
            }}
          >
            {chatProposalContent(item.text).text}
          </Markdown>
        )}
        {item.images?.map((image, index) => (
          <img
            className="chat-message-image"
            key={index}
            src={image}
            alt={`图片附件 ${index + 1}`}
          />
        ))}
      </div>
    </article>
  );
}

export function RequestCard({
  request,
  chatId,
  onResult,
  endpoint,
}: {
  request: ChatRequest;
  chatId: string;
  onResult: (snapshot: ChatSnapshot) => void;
  endpoint?: string;
}) {
  const { notify } = useWorkspace();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [content, setContent] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const params = request.params;
  const questions = params.questions as
    | {
        id: string;
        question: string;
        isSecret?: boolean;
        options?: { label: string; description?: string }[];
      }[]
    | undefined;
  const command =
    request.method.includes("commandExecution") ||
    request.method === "execCommandApproval";
  const file =
    request.method.includes("fileChange") ||
    request.method === "applyPatchApproval";
  const permissions = request.method.includes("permissions/requestApproval");
  const elicitation = request.method === "mcpServer/elicitation/request";
  const custom = !questions && !command && !file && !permissions;
  const available = params.availableDecisions as unknown[] | undefined;
  const mayAccept = !available?.length || available.includes("accept");
  async function respond(action: "accept" | "decline" | "cancel") {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ data: ChatSnapshot }>(
        endpoint || `/api/v1/chat/threads/${chatId}/requests/${request.id}`,
        {
          method: "POST",
          body: JSON.stringify({
            action,
            ...(questions ? { answers } : {}),
            ...(custom && action === "accept"
              ? { content: JSON.parse(content) }
              : {}),
          }),
        },
      );
      onResult(result.data);
    } catch (error) {
      setError(
        error instanceof SyntaxError
          ? "请输入有效的 JSON"
          : (error as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="chat-request">
      <h3>
        {questions
          ? "Codex 需要你补充信息"
          : command
            ? "允许运行此命令？"
            : file
              ? "允许修改这些文件？"
              : permissions
                ? "允许本次任务访问？"
                : elicitation
                  ? "工具需要你确认"
                  : "Codex 请求你的响应"}
      </h3>
      {(params.reason || params.message) && (
        <p>{String(params.reason || params.message)}</p>
      )}
      {command && (
        <pre>
          {Array.isArray(params.command)
            ? params.command.join(" ")
            : params.command || "请查看下方命令详情"}
          {params.cwd ? `\n目录：${params.cwd}` : ""}
        </pre>
      )}
      {questions?.map((question) => (
        <div className="chat-question" key={question.id}>
          <label htmlFor={`answer-${request.id}-${question.id}`}>
            {question.question}
          </label>
          {question.options?.length ? (
            <div className="chat-answer-options">
              {question.options.map((option) => (
                <button
                  type="button"
                  key={option.label}
                  disabled={busy}
                  className={
                    answers[question.id] === option.label ? "selected" : ""
                  }
                  title={option.description}
                  onClick={() =>
                    setAnswers((previous) => ({
                      ...previous,
                      [question.id]: option.label,
                    }))
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          <input
            id={`answer-${request.id}-${question.id}`}
            type={question.isSecret ? "password" : "text"}
            autoComplete="off"
            value={answers[question.id] || ""}
            placeholder="填写回复"
            maxLength={12000}
            disabled={busy}
            onChange={(event) =>
              setAnswers((previous) => ({
                ...previous,
                [question.id]: event.target.value,
              }))
            }
          />
        </div>
      ))}
      {!questions && (
        <details>
          <summary>查看请求详情</summary>
          <pre>{JSON.stringify(params, null, 2)}</pre>
        </details>
      )}
      {elicitation && params.mode === "url" && params.url && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void openLink(params.url).catch((error) =>
              notify(error.message, "error"),
            )
          }
          title={"打开授权页面"}
          aria-label={"打开授权页面"}
          size="icon-sm"
        >
          <ArrowUpRight />
        </Button>
      )}
      {custom && !(elicitation && params.mode === "url") && (
        <label className="chat-json-response">
          {elicitation ? "按请求中的字段填写 JSON" : "JSON 响应"}
          <textarea
            value={content}
            disabled={busy}
            onChange={(event) => setContent(event.target.value)}
            spellCheck={false}
          />
        </label>
      )}
      {error && (
        <p className="message" role="alert">
          {error}
        </p>
      )}
      <div className="chat-request-actions">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void respond("cancel")}
        >
          取消
        </Button>
        {!questions && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void respond("decline")}
          >
            拒绝
          </Button>
        )}
        <Button
          size="sm"
          disabled={busy || (!questions && !custom && !mayAccept)}
          onClick={() => void respond("accept")}
        >
          {busy ? "正在提交…" : questions ? "提交回复" : "允许一次"}
        </Button>
      </div>
    </section>
  );
}
