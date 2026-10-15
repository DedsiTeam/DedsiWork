import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Sparkles, Copy, Download, Square, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { api } from "../api";
import { useWorkspace } from "../workspace-context";
import type { PeriodReport } from "../../shared/period-report";
import type { ReportAIJob } from "../../shared/report-ai";
import type { CodexStatus } from "../../shared/domain-model-ai";
type Cache = {
  text: string;
  candidate: string;
  jobId: string | null;
  handledId: string | null;
  snapshot: string;
  draftSnapshot: string;
};
function readCache(key: string): Cache {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    if (
      value &&
      typeof value.text === "string" &&
      typeof value.candidate === "string" &&
      value.text.length <= 200000 &&
      value.candidate.length <= 200000
    )
      return {
        text: value.text,
        candidate: value.candidate,
        jobId: typeof value.jobId === "string" ? value.jobId : null,
        handledId: typeof value.handledId === "string" ? value.handledId : null,
        snapshot: typeof value.snapshot === "string" ? value.snapshot : "",
        draftSnapshot:
          typeof value.draftSnapshot === "string" ? value.draftSnapshot : "",
      };
  } catch {}
  return {
    text: "",
    candidate: "",
    jobId: null,
    handledId: null,
    snapshot: "",
    draftSnapshot: "",
  };
}
export function ReportAIPanel({ report }: { report: PeriodReport }) {
  const { workspace, notify } = useWorkspace(),
    label = report.type === "weekly" ? "周报" : "月报";
  const cacheKey = `dedsiwork:report-ai:${workspace?.id}:${report.type}:${report.start}:${report.finalOnly}`;
  const [cache, setCache] = useState(() => readCache(cacheKey));
  const [job, setJob] = useState<ReportAIJob | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false),
    [note, setNote] = useState(""),
    [model, setModel] = useState("");
  const [connection, setConnection] = useState<CodexStatus | null>(null),
    [connecting, setConnecting] = useState(false);
  const mounted = useRef(true),
    reportRef = useRef(report);
  reportRef.current = report;
  const running =
    !!cache.jobId &&
    (!job || job.status === "queued" || job.status === "generating");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(cache));
    } catch {
      notify("会话存储不可用，请及时复制文字稿", "error");
    }
  }, [cacheKey, cache, notify]);
  useEffect(() => {
    if (!cache.jobId) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await api<{ data: ReportAIJob }>(
          `/api/v1/daily-reports/ai/jobs/${cache.jobId}`,
        );
        if (cancelled) return;
        setJob(result.data);
        setError("");
        if (
          result.data.status === "queued" ||
          result.data.status === "generating"
        )
          timer = setTimeout(poll, 1500);
        else if (result.data.status === "completed" && result.data.result) {
          const markdown = result.data.result.markdown,
            id = result.data.id;
          setCache((previous) => {
            if (previous.handledId === id) return previous;
            if (previous.text)
              return { ...previous, candidate: markdown, handledId: id };
            return {
              ...previous,
              text: markdown,
              draftSnapshot: previous.snapshot,
              candidate: "",
              handledId: id,
            };
          });
        } else if (result.data.status === "failed")
          setError(result.data.error || "AI 整理失败，请重试");
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setCache((previous) => ({ ...previous, jobId: null }));
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [cache.jobId, report]);
  async function connect() {
    if (connecting) return;
    setConnecting(true);
    setError("");
    try {
      const result = await api<{ data: CodexStatus }>(
        "/api/v1/daily-reports/ai/status",
      );
      if (mounted.current) setConnection(result.data);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setConnecting(false);
    }
  }
  async function login() {
    setConnecting(true);
    setError("");
    try {
      await api("/api/v1/daily-reports/ai/login", { method: "POST" });
      notify("请在浏览器完成登录，再点击检查连接");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }
  async function generate() {
    if (busy || running) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ data: ReportAIJob }>(
        "/api/v1/daily-reports/ai/jobs",
        {
          method: "POST",
          body: JSON.stringify({
            type: report.type,
            date: report.start,
            finalOnly: report.finalOnly,
            note,
            ...(model ? { model } : {}),
          }),
        },
      );
      if (!mounted.current) return;
      setJob(result.data);
      setCache((previous) => ({
        ...previous,
        jobId: result.data.id,
        snapshot: JSON.stringify(reportRef.current),
      }));
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function stop() {
    if (!cache.jobId || busy) return;
    setBusy(true);
    try {
      const result = await api<{ data: ReportAIJob }>(
        `/api/v1/daily-reports/ai/jobs/${cache.jobId}/cancel`,
        { method: "POST" },
      );
      if (mounted.current) setJob(result.data);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(cache.text);
      notify(`AI ${label}文字已复制`);
    } catch {
      notify("复制失败，可选中文字稿手动复制或导出", "error");
    }
  }
  function download() {
    const url = URL.createObjectURL(
        new Blob([cache.text], { type: "text/markdown;charset=utf-8" }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = `${report.start}-${label}-AI文字稿.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stale =
    !!cache.text &&
    ((cache.draftSnapshot && cache.draftSnapshot !== JSON.stringify(report)) ||
      job?.stale);
  return (
    <section className="report-ai-panel" aria-label={`AI ${label}文字稿`}>
      <div className="report-section-heading">
        <h3>
          <Sparkles size={17} />
          AI 整理成文字
        </h3>
        <span className="report-help">使用当前 Codex 登录</span>
      </div>
      <p className="report-help">
        根据本期日报整合成可直接复制的{label}
        ，归纳工作进展和产出结果，并保留核对后的完成量。生成后可修改文字稿，重新生成会保留当前内容。
      </p>
      <div className="report-ai-options">
        <label>
          整理要求（可选）
          <Input
            aria-label="AI 报告整理要求"
            placeholder="例如：适合发给主管，简洁一些，突出成果和问题"
            maxLength={2000}
            value={note}
            disabled={running || busy}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <label>
          模型
          <select
            aria-label="报告 AI 模型"
            value={model}
            disabled={running || busy}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="">Codex 默认模型</option>
            {connection?.models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="report-actions">
        <Button
          onClick={() => void generate()}
          disabled={busy || running || !report.reportCount}
        >
          <Sparkles />
          {cache.text ? `重新整理${label}` : `AI 整理${label}`}
        </Button>
        {running && (
          <Button variant="outline" onClick={() => void stop()} disabled={busy}>
            <Square />
            停止生成
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => void connect()}
          disabled={connecting}
        >
          <RefreshCw />
          {connecting ? "正在连接…" : "检查连接"}
        </Button>
        {connection && !connection.ready && (
          <Button
            variant="outline"
            disabled={connecting}
            onClick={() => void login()}
          >
            登录 Codex
          </Button>
        )}
        {connection?.ready && <span className="report-help">Codex 已连接</span>}
      </div>
      {running && (
        <p role="status" className="report-help">
          {job?.stage || "正在读取生成进度…"}，可稍后返回此周期查看。
        </p>
      )}
      {job?.status === "cancelled" && (
        <p role="status" className="report-help">
          已停止生成，已有文字稿保留。
        </p>
      )}
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {stale && (
        <p className="period-data-warning">
          来源日报或筛选后的汇总已有变化，当前文字稿保留；建议重新整理并核对后复制。
        </p>
      )}
      {cache.candidate && (
        <details className="report-ai-candidate">
          <summary>新文字稿已生成，展开查看</summary>
          <article className="report-preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {cache.candidate}
            </ReactMarkdown>
          </article>
          <Button
            onClick={() => {
              setCache((previous) => ({
                ...previous,
                text: previous.candidate,
                candidate: "",
                draftSnapshot: previous.snapshot,
              }));
              setPreview(false);
            }}
          >
            采用新稿并替换当前文字
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              setCache((previous) => ({ ...previous, candidate: "" }))
            }
          >
            保留当前文字
          </Button>
        </details>
      )}
      {cache.text && (
        <>
          <div className="report-actions">
            <Button size="sm" variant="outline" onClick={() => void copy()}>
              <Copy />
              复制 AI 文字
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPreview(!preview)}
            >
              {preview ? "编辑文字" : "预览文字"}
            </Button>
            <Button size="sm" variant="outline" onClick={download}>
              <Download />
              导出文字稿
            </Button>
          </div>
          {preview ? (
            <article className="report-preview">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {cache.text}
              </ReactMarkdown>
            </article>
          ) : (
            <Textarea
              className="report-ai-text"
              aria-label={`AI ${label}文字稿正文`}
              value={cache.text}
              onChange={(e) =>
                setCache((previous) => ({ ...previous, text: e.target.value }))
              }
              maxLength={200000}
            />
          )}
          <p className="report-help">
            文字稿保留在本次窗口会话中，请及时复制或导出。手动编辑后以当前文字为准。
          </p>
        </>
      )}
    </section>
  );
}
