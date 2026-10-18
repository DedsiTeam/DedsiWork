import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  MessageSquarePlus,
  PanelRightClose,
  ArrowUp,
  CircleStop,
  Plus,
  Check,
  RotateCcw,
  LoaderCircle,
} from "lucide-react";
import { Button } from "./ui/button";
import { api } from "../api";
import type {
  CanvasAssistantMessage,
  CanvasAssistantResult,
} from "../../shared/canvas-assistant";
export function CanvasAssistant({
  noteId,
  open,
  onClose,
  getContext,
  onApply,
  onPending,
}: {
  noteId?: string;
  open: boolean;
  onClose: () => void;
  getContext: (all: boolean) => { text: string; count: number };
  onApply: (result: CanvasAssistantResult) => Promise<void>;
  onPending: (pending: boolean) => void;
}) {
  const [messages, setMessages] = useState<CanvasAssistantMessage[]>([]);
  const [text, setText] = useState("");
  const [all, setAll] = useState(false);
  const [error, setError] = useState("");
  const [clearing, setClearing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState("");
  const [count, setCount] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const pending = messages.some((m) =>
    ["queued", "generating"].includes(m.status),
  );
  const base = `/api/v1/notes/${noteId}/assistant`;
  useEffect(() => {
    onPending(pending || sending);
    return () => onPending(false);
  }, [pending, sending, onPending]);
  useEffect(() => {
    const g = ++generation.current;
    if (clearing) return;
    setMessages([]);
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const { data } = await api<{ data: CanvasAssistantMessage[] }>(base);
        if (g !== generation.current) return;
        setMessages(data);
        setError("");
      } catch (e) {
        if (g === generation.current) setError((e as Error).message);
      } finally {
        if (g === generation.current) timer = setTimeout(poll, 1500);
      }
    }
    if (noteId) void poll();
    return () => {
      generation.current++;
      clearTimeout(timer);
    };
  }, [noteId, clearing, revision]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, messages.at(-1)?.status, open]);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setCount(getContext(all).count), 600);
    setCount(getContext(all).count);
    return () => clearInterval(timer);
  }, [open, all, getContext]);
  async function send(prompt = text) {
    if (!noteId || clearing || pending || sending || !prompt.trim()) return;
    setSending(true);
    setError("");
    const g = generation.current;
    try {
      const { data } = await api<{ data: CanvasAssistantMessage }>(base, {
        method: "POST",
        body: JSON.stringify({ prompt, context: getContext(all).text }),
      });
      if (g !== generation.current) return;
      setMessages((ms) => [...ms.filter((m) => m.id !== data.id), data]);
      setText("");
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    } finally {
      if (g === generation.current) setSending(false);
    }
  }
  async function apply(m: CanvasAssistantMessage) {
    if (!m.result || applying || clearing) return;
    setApplying(m.id);
    setError("");
    try {
      await onApply(m.result);
      setMessages((ms) =>
        ms.map((v) => (v.id === m.id ? { ...v, applied: true } : v)),
      );
      await api(`${base}/${m.id}/applied`, { method: "POST", body: "{}" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying("");
    }
  }
  async function clearConversation() {
    if (!noteId || clearing || sending || applying) return;
    generation.current++;
    setClearing(true);
    setError("");
    try {
      await api(base, { method: "DELETE" });
      setMessages([]);
      setText("");
      setAll(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setClearing(false);
      setRevision((v) => v + 1);
    }
  }
  async function cancel(m: CanvasAssistantMessage) {
    try {
      await api(`${base}/${m.id}/cancel`, { method: "POST", body: "{}" });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <aside
      className="canvas-assistant"
      hidden={!open}
      aria-label="画布助手"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header>
        <span>
          <Sparkles size={17} />
          画布助手
        </span>
        <div className="canvas-assistant-header-actions">
        <Button variant="ghost" size="icon-sm"
          title="清空对话，开始新对话" aria-label="清空对话"
          disabled={!noteId || !messages.length || clearing || sending || !!applying}
          onClick={() => void clearConversation()}>
          {clearing ? <LoaderCircle className="canvas-assistant-spin" /> : <MessageSquarePlus />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="收起助手"
          aria-label="收起助手"
          onClick={onClose}
        >
          <PanelRightClose />
        </Button>
        </div>
      </header>
      <div className="canvas-assistant-context">
        当前无边记{" "}
        <span>
          {all ? "整张画布" : "选中内容"} · {count} 个元素
        </span>
      </div>
      <div className="canvas-assistant-messages" aria-live="polite">
        {!messages.length && (
          <div className="canvas-assistant-welcome">
            <Sparkles size={24} />
            <strong>一起完善这张画布</strong>
            <p>整理想法、绘制原型，或生成 UI 图片。</p>
          </div>
        )}
        {messages.map((m) => (
          <article key={m.id}>
            <div className="canvas-assistant-user">{m.prompt}</div>
            {m.result && (
              <>
                <div className="canvas-assistant-reply">{m.result.reply}</div>
                {m.result.action !== "chat" && (
                  <div className="canvas-assistant-result">
                    <span>
                      {m.applied
                        ? m.result.action === "image"
                          ? "已提交后台生成"
                          : m.result.action === "design" ? "已更新设计规范" : m.result.action === "createDesign" ? "已创建设计规范卡" : "已添加到画布"
                        : m.result.action === "prototype"
                          ? "可编辑原型已准备好"
                          : m.result.action === "image"
                            ? "UI 图片要求已准备好"
                            : m.result.action === "design" ? "设计规范调整已准备好" : m.result.action === "createDesign" ? "设计规范卡已准备好" : "文字已整理"}
                    </span>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={
                        clearing || !!applying || (m.applied && m.result.action !== "image")
                      }
                      title={
                        m.result.action === "image"
                          ? "后台生成 UI 图片"
                          : m.result.action === "design" ? "更新设计规范" : m.result.action === "createDesign" ? "创建设计规范卡" : "添加到画布"
                      }
                      aria-label={
                        m.result.action === "image"
                          ? "后台生成 UI 图片"
                          : m.result.action === "design" ? "更新设计规范" : m.result.action === "createDesign" ? "创建设计规范卡" : "添加到画布"
                      }
                      onClick={() => void apply(m)}
                    >
                      {applying === m.id ? (
                        <LoaderCircle className="canvas-assistant-spin" />
                      ) : m.applied ? (
                        <Check />
                      ) : m.result.action === "design" ? (
                        <RotateCcw />
                      ) : (
                        <Plus />
                      )}
                    </Button>
                  </div>
                )}
              </>
            )}
            {["queued", "generating"].includes(m.status) && (
              <div className="canvas-assistant-progress">
                <LoaderCircle size={14} className="canvas-assistant-spin" />
                <span>{m.stage || "正在思考"}</span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="停止生成"
                  aria-label="停止生成"
                  onClick={() => void cancel(m)}
                >
                  <CircleStop className="[&_rect]:fill-current" />
                </Button>
              </div>
            )}
            {(m.status === "failed" || m.status === "cancelled") && (
              <div className="canvas-assistant-progress">
                <span>{m.error || "已停止"}</span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="重新发送"
                  aria-label="重新发送"
                  disabled={pending || sending}
                  onClick={() => void send(m.prompt)}
                >
                  <RotateCcw />
                </Button>
              </div>
            )}
          </article>
        ))}
        <div ref={bottom} />
      </div>
      {error && (
        <p className="canvas-assistant-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <div className="canvas-assistant-shortcuts">
          {["整理文字", "创建原型", "生成 UI 图片"].map((label) => (
            <button
              key={label}
              onClick={() =>
                setText(`请根据${all ? "画布" : "选中"}内容${label}。`)
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div className="canvas-assistant-composer">
          <textarea
            aria-label="给画布助手发送消息"
            placeholder={noteId ? "说说你的想法…" : "请先保存无边记"}
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div>
            <select
              aria-label="引用范围"
              value={all ? "all" : "selected"}
              onChange={(e) => setAll(e.target.value === "all")}
            >
              <option value="selected">选中内容</option>
              <option value="all">整张画布</option>
            </select>
            <Button
              size="icon-sm"
              disabled={!noteId || !text.trim() || pending || sending || clearing}
              title="发送 · Enter"
              aria-label="发送"
              onClick={() => void send()}
            >
              {sending ? (
                <LoaderCircle className="canvas-assistant-spin" />
              ) : (
                <ArrowUp />
              )}
            </Button>
          </div>
        </div>
        <small>Enter 发送 · Shift + Enter 换行</small>
      </footer>
    </aside>
  );
}
