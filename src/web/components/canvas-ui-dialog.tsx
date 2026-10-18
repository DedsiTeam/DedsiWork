import { canvasScreenSizes } from "../../shared/canvas-screen-sizes";
import { useEffect, useRef, useState } from "react";
import { CanvasUIPlaceholder } from "./canvas-ui-placeholder";
import { Sparkles, RotateCcw, Square, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { api, ApiError } from "../api";
import type { CanvasUIJob, CanvasUIRequest } from "../../shared/canvas-ui";

export function CanvasUIDialog({
  source,
  initialPrompt,
  designPrompt = "",
  autoStart = false,
  onClose,
  onInsert,
  onPrepare,
  getPlaceholder,
  onMovePlaceholder,
}: {
  initialPrompt?: string;
  designPrompt?: string;
  autoStart?: boolean;
  source: Omit<CanvasUIRequest, "prompt">;
  onPrepare: (width: number, height: number) => void;
  getPlaceholder: () => {
    host: HTMLElement;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  onMovePlaceholder: (dx: number, dy: number) => void;
  onClose: () => void;
  onInsert: (image: string, prompt: string) => Promise<void>;
}) {
  const [designInstructions] = useState(designPrompt);
  const [prompt, setPrompt] = useState(
    initialPrompt ??
      (source.sourceText
        ? "根据文字需求设计完整的 UI，简洁清晰，使用中文界面。"
        : source.revision
          ? ""
          : "根据容器原型设计完整的 UI，保留原型布局，简洁清晰，使用中文界面。"),
  );
  const [background, setBackground] = useState(autoStart);
  const [size, setSize] = useState(`${source.width}x${source.height}`);
  const [job, setJob] = useState<CanvasUIJob | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [retry, setRetry] = useState(0);
  const mounted = useRef(true);
  const pending = sending || job?.status === "generating";
  useEffect(() => {
    if (!pending) return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [pending]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!job || job.status !== "generating") return;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const { data } = await api<{ data: CanvasUIJob }>(
          `/api/v1/notes/ui/jobs/${job!.id}`,
        );
        if (!active) return;
        setJob(data);
        if (data.status === "generating") timer = setTimeout(poll, 1500);
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          if (e instanceof ApiError && [403, 404].includes(e.status)) {
            setJob({ ...job!, status: "failed", stage: "生成任务已失效" });
          } else timer = setTimeout(poll, 3000);
        }
      }
    }
    timer = setTimeout(poll, 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [job?.id, job?.status, retry]);
  async function insert(image: string) {
    setInserting(true);
    setError("");
    try {
      await onInsert(image, prompt);
      if (mounted.current) onClose();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setInserting(false);
    }
  }
  useEffect(() => {
    if (job?.status === "completed" && job.image) void insert(job.image);
  }, [job?.status]);
  async function generate() {
    setSending(true);
    setError("");
    try {
      onPrepare(
        source.sourceText ? Number(size.split("x")[0]) : source.width,
        source.sourceText ? Number(size.split("x")[1]) : source.height,
      );
      setBackground(true);
      const { data } = await api<{ data: CanvasUIJob }>(
        "/api/v1/notes/ui/jobs",
        {
          method: "POST",
          body: JSON.stringify({
            ...source,
            ...(source.sourceText
              ? {
                  width: Number(size.split("x")[0]),
                  height: Number(size.split("x")[1]),
                }
              : {}),
            prompt: prompt + designInstructions,
          }),
        },
      );
      setJob(data);
      setBackground(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  const started = useRef(false);
  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      void generate();
    }
  }, [autoStart]);
  async function cancel() {
    if (!job) return;
    try {
      const { data } = await api<{ data: CanvasUIJob }>(
        `/api/v1/notes/ui/jobs/${job.id}/cancel`,
        { method: "POST" },
      );
      setJob(data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
      setRetry((v) => v + 1);
    }
  }
  if (background)
    return (
      <>
        <CanvasUIPlaceholder
          getBounds={getPlaceholder}
          onMove={onMovePlaceholder}
          pending={pending || inserting}
          label={
            error || job?.error
              ? "生成失败，点击处理"
              : inserting
                ? "正在添加图片…"
                : sending
                  ? "正在提交…"
                  : job?.status === "cancelled"
                    ? "已取消"
                    : "生成中…"
          }
          onClick={() => {
            if (!autoStart) setBackground(false);
          }}
        />
        {autoStart ? (
          <div className="note-ui-task-inline" role="status">
            <span title={error || job?.error || job?.stage}>
              {error ||
                job?.error ||
                (inserting
                  ? "正在添加图片…"
                  : job?.status === "cancelled"
                    ? "已取消生成"
                    : "正在生成 UI 图片…")}
            </span>
            {pending && (
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={sending}
                title="取消生成"
                aria-label="取消生成"
                onClick={() => void cancel()}
              >
                <Square />
              </Button>
            )}
            {!pending && !inserting && (
              <>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="重试生成"
                  aria-label="重试生成"
                  onClick={() =>
                    void (job?.status === "completed" && job.image
                      ? insert(job.image)
                      : generate())
                  }
                >
                  <RotateCcw />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="移除生成任务"
                  aria-label="移除生成任务"
                  onClick={onClose}
                >
                  <X />
                </Button>
              </>
            )}
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!autoStart) setBackground(false);
            }}
            title={error || job?.error || job?.stage || "查看生成任务"}
          >
            <Sparkles />
            {error || job?.error
              ? "生成任务需要处理"
              : inserting
                ? "正在添加图片…"
                : job?.stage || "正在生成 UI 图片"}
          </Button>
        )}
      </>
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !sending) {
          if (pending || inserting || job?.status === "completed")
            setBackground(true);
          else onClose();
        }
      }}
    >
      <DialogContent>
        <div className="editor-form note-ui-form">
          <DialogTitle>
            {source.revision ? "修改 UI 图片" : "生成 UI 图片"}
          </DialogTitle>
          <DialogDescription>
            {source.sourceText
              ? "Codex 将根据选中文字和补充要求生成 UI 图片，并放在文字旁边。"
              : "输入设计要求，Codex 将参考图片生成新版本并放在旁边。"}
          </DialogDescription>
          {source.image && (
            <div className="note-ui-prompt">
              <span>{source.revision ? "参考 UI 图片" : "容器原型"}</span>
              <img
                className="note-ui-reference"
                src={source.image}
                alt={source.revision ? "参考 UI 图片" : "容器原型"}
              />
            </div>
          )}
          {source.sourceText && (
            <label className="note-ui-prompt">
              文字需求
              <textarea
                aria-label="文字需求"
                rows={5}
                readOnly
                value={source.sourceText}
              />
            </label>
          )}
          <label className="note-ui-prompt">
            画面尺寸
            <select
              aria-label="画面尺寸"
              title={source.sourceText ? "画面尺寸" : "跟随原图尺寸，不可修改"}
              value={
                source.sourceText ? size : `${source.width}x${source.height}`
              }
              disabled={
                !source.sourceText ||
                pending ||
                inserting ||
                job?.status === "completed"
              }
              onChange={(e) => setSize(e.target.value)}
            >
              {source.sourceText ? (
                <>
                  {!canvasScreenSizes.some((preset) => preset.width === source.width && preset.height === source.height) && (
                    <option value={`${source.width}x${source.height}`}>
                      自定义 · {source.width} × {source.height}
                    </option>
                  )}
                  {["手机", "PC", "其他"].map((group) => (
                    <optgroup key={group} label={group}>
                      {canvasScreenSizes.filter((preset) => preset.group === group).map((preset) => (
                        <option key={preset.name} value={`${preset.width}x${preset.height}`}>
                          {preset.name} · {preset.width} × {preset.height}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </>
              ) : (
                <option value={`${source.width}x${source.height}`}>
                  {source.width} × {source.height}
                </option>
              )}
            </select>
          </label>
          <label className="note-ui-prompt">
            {source.revision ? "修改要求" : "UI 要求"}
            <textarea
              aria-label={source.revision ? "修改要求" : "UI 要求"}
              rows={4}
              maxLength={4000}
              value={prompt}
              disabled={pending || inserting || job?.status === "completed"}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                source.revision
                  ? "例如：保持布局，把主按钮改小，增加留白"
                  : "例如：手机端任务清单，简洁黑白风格，保留原型布局"
              }
            />
          </label>
          {designInstructions && <p>已启用颜色、圆角、字体与布局规范。</p>}
          {pending && <p role="status">{job?.stage || "正在提交…"}</p>}
          {(error || job?.error) && <p role="alert">{error || job?.error}</p>}
          <div className="note-ui-actions">
            {job && (pending || inserting || job.status === "completed") && (
              <Button variant="outline" onClick={() => setBackground(true)}>
                后台运行
              </Button>
            )}
            <Button
              variant="outline"
              disabled={sending || inserting}
              onClick={pending ? cancel : onClose}
            >
              {pending ? "取消生成" : "关闭"}
            </Button>
            {job?.status === "completed" && job.image ? (
              <Button
                disabled={inserting}
                onClick={() => void insert(job.image!)}
              >
                {inserting ? "正在添加…" : "添加到画布"}
              </Button>
            ) : (
              <Button disabled={pending || !prompt.trim()} onClick={generate}>
                <Sparkles />
                {source.revision ? "生成新版本" : "生成图片"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
