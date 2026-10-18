import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { History, Play, ArrowUpRight, RotateCcw, Workflow } from "lucide-react";
import type { WorkflowRun } from "../../shared/ai-workflow";
import { PAGE_SIZE } from "../../shared/pagination";
import { api } from "../api";
import { useWorkspace } from "../workspace-context";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/empty-state";
import { AIWorkflowLibrary } from "../components/ai-workflows";
import "../workflow-activity.css";

const labels: Record<WorkflowRun["status"], string> = {
  starting: "正在建立会话",
  running: "Codex 正在执行",
  waiting: "等我回答",
  completed: "已生成结果",
  failed: "执行失败",
  cancelled: "已取消",
  interrupted: "执行中断",
};
export function WorkflowsPage() {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const history = await api<{
      data: { items: WorkflowRun[]; total: number };
    }>(`/api/v1/ai-workflows/runs?page=${page}`);
    setRuns(history.data.items);
    setTotal(history.data.total);
    setLoading(false);
  }, [workspace?.id, page]);
  useEffect(() => {
    let active = true;
    const update = () => {
      if (active)
        void refresh().catch((e) => {
          if (active) {
            setError(e.message);
            setLoading(false);
          }
        });
    };
    update();
    const timer = setInterval(update, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);
  async function action(operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="workspace-content workflow-activity">
      <header className="workflow-page-heading">
        <div>
          <h1>工作流</h1>
          <p>把常做的事交给 Codex，留出时间推进今天的重点。</p>
        </div>
      </header>
      {error && (
        <p className="message" role="alert">
          {error}
        </p>
      )}
      <div className="workflow-shortcuts">
        <section className="workflow-shortcut">
          <span className="workflow-feature-icon">
            <Workflow size={20} />
          </span>
          <div>
            <h2>复用你的工作方法</h2>
            <p>将需求拆解、验收检查等常用指令保存为模板，填入目标就能开始。</p>
          </div>
          <Button
            onClick={() => setLibraryOpen(true)}
            title={"使用 AI 模板"}
            aria-label={"使用 AI 模板"}
            size="icon-sm"
          >
            <Play size={14} />{" "}
          </Button>
        </section>
      </div>
      <div className="workflow-columns">
        <section className="workflow-history" aria-label="执行记录">
          <div className="workflow-section-heading">
            <div>
              <h2>
                执行记录 <span>{total}</span>
              </h2>
              <p>回看结果，或沿用上次输入再做一次。</p>
            </div>
          </div>
          {loading ? (
            <p role="status">正在读取执行记录…</p>
          ) : (
            !runs.length && (
              <EmptyState
                icon={History}
                title="还没有执行记录"
                description="运行一个模板后，输入、对话与结果会保存在这里。"
                compact
              />
            )
          )}
          {runs.map((run) => (
            <article key={run.id} className="workflow-activity-entry">
              <div className="workflow-activity-row">
                <span className="workflow-run-icon">
                  <History size={16} />
                </span>
                <strong>{run.template.name}</strong>
                <span className="workflow-status" data-status={run.status}>
                  {labels[run.status]}
                </span>
              </div>
              <p>{new Date(run.createdAt).toLocaleString()}</p>
              {run.error && <p role="alert">{run.error}</p>}
              <div className="workflow-activity-row">
                {run.chatId && (
                  <Button
                    asChild
                    size="icon-sm"
                    variant="secondary"
                    title={"查看结果"}
                    aria-label={"查看结果"}
                  >
                    <Link
                      to={`/assistant/thread/${encodeURIComponent(run.chatId)}`}
                    >
                      <ArrowUpRight size={14} />
                    </Link>
                  </Button>
                )}
                <Button
                  size="icon-sm"
                  variant="outline"
                  disabled={
                    busy ||
                    ["starting", "running", "waiting"].includes(run.status)
                  }
                  onClick={() =>
                    void action(() =>
                      api(`/api/v1/ai-workflows/runs/${run.id}/rerun`, {
                        method: "POST",
                      }),
                    )
                  }
                  title={"再次运行"}
                  aria-label={"再次运行"}
                >
                  <RotateCcw size={14} />{" "}
                </Button>
                {["running", "waiting"].includes(run.status) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void action(() =>
                        api(`/api/v1/ai-workflows/runs/${run.id}/cancel`, {
                          method: "POST",
                        }),
                      )
                    }
                  >
                    停止运行
                  </Button>
                )}
              </div>
              <details>
                <summary>查看输入与引用资料</summary>
                <pre>{run.template.prompt}</pre>
                <dl className="workflow-inputs">
                  {Object.entries(run.values).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {run.notes && <p>{run.notes}</p>}
                {run.sources.map((source) => (
                  <p key={`${source.kind}:${source.id}`}>
                    <Link
                      to={
                        source.kind === "items"
                          ? `/work-items/${source.id}`
                          : `/domain-models/${source.id}`
                      }
                    >
                      {source.title}
                    </Link>{" "}
                    · 版本 {source.version}
                  </p>
                ))}
                <p>再次运行保留原参数，并读取关联资料的最新内容。</p>
              </details>
              {!!run.artifacts?.length && (
                <div className="workflow-activity-row" aria-label="已保存产物">
                  {run.artifacts.map((artifact) => (
                    <Link key={artifact.url} to={artifact.url}>
                      {artifact.label}
                    </Link>
                  ))}
                </div>
              )}
              {run.result && (
                <details>
                  <summary>结果草稿</summary>
                  <pre>{run.result}</pre>
                  <p>请在对话中查看并确认产物后保存。</p>
                </details>
              )}
            </article>
          ))}
          {total > PAGE_SIZE && (
            <div className="workflow-activity-row">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 1 || busy}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </Button>
              <span>
                第 {page} / {Math.ceil(total / PAGE_SIZE)} 页
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page * PAGE_SIZE >= total || busy}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </section>
      </div>
      {libraryOpen && (
        <AIWorkflowLibrary
          canRun={!busy}
          onClose={() => setLibraryOpen(false)}
          onRun={async (_prompt, chatId) => {
            if (chatId)
              navigate(`/assistant/thread/${encodeURIComponent(chatId)}`);
          }}
        />
      )}
    </main>
  );
}
