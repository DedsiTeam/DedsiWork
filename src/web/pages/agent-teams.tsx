import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Users, RefreshCw, Plus, ArrowLeft } from "lucide-react";
import { api } from "../api";
import { resourceRoute } from "../route-inputs";
import { useWorkspace } from "../workspace-context";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { EmptyState } from "../components/empty-state";
import {
  teamPlanSchema,
  type AgentTeam,
  type ProjectAgent,
  type TeamPlan,
} from "../../shared/agent-team";
import { typeLabels, priorityLabels } from "../../shared/work-item";
import { PAGE_SIZE } from "../../shared/pagination";
import "../agent-teams.css";

const labels: Record<AgentTeam["status"], string> = {
  discussing: "讨论中",
  ready: "待确认方案",
  running: "并行研发中",
  paused: "已暂停",
  review: "待验收",
  failed: "讨论失败",
  interrupted: "已中断",
};
type Discovery = {
  directory: string;
  agents: ProjectAgent[];
  errors: string[];
};
type Summary = Pick<AgentTeam, "id" | "title" | "status" | "updatedAt">;

export function AgentTeamsPage() {
  const { workspace } = useWorkspace();
  return <TeamPage key={`${workspace?.id}:${useParams().team || "new"}`} />;
}
function TeamPage() {
  const { workspace, refreshSummary } = useWorkspace();
  const { team: id } = useParams();
  const navigate = useNavigate();
  const prefix = workspace
    ? `/workspace/${encodeURIComponent(workspace.id)}`
    : "";
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [history, setHistory] = useState<Summary[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [team, setTeam] = useState<AgentTeam | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [parallel, setParallel] = useState(2);
  const [budget, setBudget] = useState(100000);
  const [plan, setPlan] = useState<TeamPlan | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const planVersion = useRef("");
  const budgetInitialized = useRef(false);
  const accept = (value: AgentTeam) => {
    setTeam((previous) =>
      previous && previous.revision > value.revision ? previous : value,
    );
    const version = JSON.stringify(value.plan);
    if (version !== planVersion.current) {
      planVersion.current = version;
      setPlan(value.plan);
    }
  };
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        if (id) {
          const { data } = await api<{ data: AgentTeam }>(
            `/api/v1/agent-teams/${id}`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted) {
            accept(data);
            if (!budgetInitialized.current) {
              setBudget(data.tokenBudget);
              budgetInitialized.current = true;
            }
          }
        } else {
          const [found, list] = await Promise.all([
            api<{ data: Discovery }>("/api/v1/agent-teams/agents", {
              signal: controller.signal,
            }),
            api<{ data: Summary[]; meta: { total: number } }>(
              `/api/v1/agent-teams?page=${page}`,
              { signal: controller.signal },
            ),
          ]);
          if (!controller.signal.aborted) {
            setDiscovery(found.data);
            setHistory(list.data);
            setTotal(list.meta.total);
          }
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          if (id) timer = setTimeout(load, 1500);
        }
      }
    };
    void load();
    return () => {
      alive.current = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, page]);
  async function action(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function refresh() {
    await action(async () => {
      const { data } = await api<{ data: Discovery }>(
        "/api/v1/agent-teams/agents",
      );
      setDiscovery(data);
      setSelected((previous) =>
        previous.filter((name) => data.agents.some((a) => a.name === name)),
      );
    });
  }
  async function create() {
    await action(async () => {
      const { data } = await api<{ data: AgentTeam }>("/api/v1/agent-teams", {
        method: "POST",
        body: JSON.stringify({
          title,
          text,
          agents: selected,
          maxParallel: parallel,
          tokenBudget: budget,
        }),
      });
      navigate(prefix + resourceRoute("/assistant", { team: data.id }));
    });
  }
  async function send() {
    if (!team) return;
    await action(async () => {
      const { data } = await api<{ data: AgentTeam }>(
        `/api/v1/agent-teams/${id}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ text, expectedRevision: team.revision }),
        },
      );
      accept(data);
      setText("");
    });
  }
  async function control(mode: "pause" | "resume") {
    if (!team) return;
    await action(async () => {
      const { data } = await api<{ data: AgentTeam }>(
        `/api/v1/agent-teams/${id}/control`,
        {
          method: "POST",
          body: JSON.stringify({
            action: mode,
            tokenBudget: budget,
            expectedRevision: team.revision,
          }),
        },
      );
      accept(data);
    });
  }
  async function loadBranches() {
    await action(async () => {
      const { data } = await api<{
        data: { branches: string[]; currentBranch: string };
      }>("/api/v1/development-tasks/select-directory", {
        method: "POST",
        body: "{}",
      });
      setBranches(data.branches);
      setBranch(data.currentBranch);
    });
  }
  async function confirm() {
    if (!team || !plan) return;
    await action(async () => {
      const { data } = await api<{ data: AgentTeam }>(
        `/api/v1/agent-teams/${id}/confirm`,
        {
          method: "POST",
          body: JSON.stringify({
            confirmed: true,
            expectedRevision: team.revision,
            baseBranch: branch,
            plan,
          }),
        },
      );
      accept(data);
      refreshSummary();
    });
  }
  const active = team?.status === "discussing" || team?.status === "running";
  return (
    <div className="workspace-content agent-team-page">
      <div className="page-heading">
        <div>
          <h1>{team?.title || "智能体群聊"}</h1>
          <p className="team-muted">
            {team
              ? `${labels[team.status]} · 配置已随本次讨论保存`
              : "读取当前项目配置，讨论方案，确认后并行研发"}
          </p>
        </div>
        <div className="team-actions">
          <Button variant="ghost" asChild>
            <Link to={prefix + "/assistant"}>
              <ArrowLeft />
              AI 助手
            </Link>
          </Button>
          {id && (
            <Button variant="outline" asChild>
              <Link to={prefix + "/assistant/teams"}>
                <Plus />
                新群聊 / 历史
              </Link>
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">正在读取项目资料…</p>}
      {!id && discovery && (
        <>
          <section className="team-section">
            <div className="team-actions">
              <h2>参与角色</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={refresh}
                disabled={busy}
              >
                <RefreshCw />
                刷新配置
              </Button>
            </div>
            <p className="team-muted">
              {discovery.directory} / .codex / agents ·
              只勾选与需求有关的角色，减少重复分析。
            </p>
            {discovery.errors.map((message) => (
              <p key={message} role="alert">
                {message}
              </p>
            ))}
            {!discovery.agents.length && (
              <EmptyState
                compact
                icon={Users}
                title="没有可用智能体"
                description="在项目 .codex/agents 目录中配置角色后刷新。"
              />
            )}
            <div className="team-roles">
              {discovery.agents.map((agent) => (
                <label key={agent.name} className="team-role">
                  <input
                    type="checkbox"
                    checked={selected.includes(agent.name)}
                    onChange={(event) =>
                      setSelected((previous) =>
                        event.target.checked
                          ? [...previous, agent.name]
                          : previous.filter((name) => name !== agent.name),
                      )
                    }
                  />
                  <span>
                    <strong>{agent.name}</strong>
                    <span className="team-muted">{agent.description}</span>
                    <small>
                      {agent.model || "项目默认模型"} ·{" "}
                      {agent.effort || "默认推理强度"}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </section>
          <section className="team-section team-form">
            <label>
              讨论名称
              <Input
                value={title}
                maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：设备告警处理"
              />
            </label>
            <label>
              基本信息
              <Textarea
                value={text}
                maxLength={12000}
                rows={6}
                onChange={(e) => setText(e.target.value)}
                placeholder="描述目标、业务场景、现状、限制和验收期望。关键业务问题会集中向你确认。"
              />
            </label>
            <div className="team-settings">
              <label>
                最大并行数
                <Input
                  type="number"
                  min={1}
                  max={4}
                  value={parallel}
                  onChange={(e) => setParallel(Number(e.target.value))}
                />
              </label>
              <label>
                总 token 预算
                <Input
                  type="number"
                  min={1000}
                  max={2000000}
                  step={1000}
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value))}
                />
              </label>
            </div>
            <p className="team-muted">
              一轮独立评审与一次主持收敛。预算包含讨论及研发；使用角色配置的模型。并行缩短等待时间，调用更多角色会增加消耗。
            </p>
            <Button
              onClick={create}
              disabled={
                busy ||
                !text.trim() ||
                !title.trim() ||
                !selected.length ||
                selected.length > 8
              }
            >
              开始讨论（{selected.length} 个角色）
            </Button>
          </section>
          <section className="team-section">
            <h2>历史群聊</h2>
            {history.length ? (
              <div className="team-history">
                {history.map((item) => (
                  <Link
                    key={item.id}
                    to={prefix + resourceRoute("/assistant", { team: item.id })}
                  >
                    {item.title}
                    <span className="team-muted">{labels[item.status]}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                title="还没有群聊"
                description="讨论和执行记录会保留在当前工作空间。"
              />
            )}
            {total > PAGE_SIZE && (
              <div className="team-actions">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  上一页
                </Button>
                <span>第 {page} 页</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page * PAGE_SIZE >= total}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </Button>
              </div>
            )}
          </section>
        </>
      )}
      {team && (
        <>
          <section className="team-section">
            <div className="team-actions">
              <strong>
                已统计 {team.usage.toLocaleString()} /{" "}
                {team.tokenBudget.toLocaleString()} tokens
              </strong>
              <span className="team-muted">并行上限 {team.maxParallel}</span>
              {active && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => control("pause")}
                >
                  暂停
                </Button>
              )}
            </div>
            <p className="team-muted">
              {team.usageKnown
                ? "按线程统计；达到预算后停止派发并请求中断，可能存在上报延迟。"
                : "部分线程尚未提供用量，当前统计不完整，无法保证预算上限；未将未知用量当作零费用。"}{" "}
              金额取决于实际计费方式，此处不估算账单。
            </p>
            {team.usage >= team.tokenBudget * 0.8 && (
              <p role="status">预算已使用至少 80%，建议检查剩余任务。</p>
            )}
            {team.error && <p role="alert">{team.error}</p>}
            {!active &&
              !team.restored &&
              team.status !== "ready" &&
              team.status !== "review" && (
                <div className="team-actions">
                  <label>
                    继续时的总预算
                    <Input
                      type="number"
                      min={1000}
                      max={2000000}
                      value={budget}
                      onChange={(e) => setBudget(Number(e.target.value))}
                    />
                  </label>
                  <Button disabled={busy} onClick={() => control("resume")}>
                    继续 / 重试未完成工作
                  </Button>
                </div>
              )}
            <details>
              <summary>参与角色与配置版本</summary>
              {team.agents.map((agent) => (
                <p key={agent.name}>
                  {agent.name} · {agent.model || "默认模型"} · {agent.file} ·{" "}
                  {agent.fingerprint.slice(0, 12)}
                </p>
              ))}
            </details>
          </section>
          <section
            className="team-section team-conversation"
            aria-label="群聊消息"
          >
            {team.messages
              .filter((m) => m.role !== "主持人")
              .map((message) => (
                <article key={message.id}>
                  <strong>{message.role}</strong>
                  <div className="team-text">{message.text}</div>
                </article>
              ))}
            {team.status === "discussing" &&
              team.chats
                .filter(
                  (chat) =>
                    !team.messages.some(
                      (m) => m.role === chat.role && m.text === chat.text,
                    ),
                )
                .slice(-team.maxParallel)
                .map((chat) => (
                  <article key={chat.id}>
                    <strong>{chat.role}</strong>
                    <div className="team-text">
                      {chat.role === "主持人"
                        ? "正在收敛方案…"
                        : chat.text || "正在分析…"}
                    </div>
                  </article>
                ))}
          </section>
          {plan && (
            <section className="team-section team-plan">
              <h2>方案与执行预览</h2>
              <div className="team-text">{plan.summary}</div>
              {!!plan.questions.length && (
                <div>
                  <h3>待决问题</h3>
                  <ul>
                    {plan.questions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                  <p className="team-muted">
                    在下方补充信息后重新讨论，解决问题后才能启动研发。
                  </p>
                </div>
              )}
              <h3>工作项（{plan.items.length}）</h3>
              {plan.items.map((item, i) => (
                <article key={i}>
                  <strong>
                    {i + 1}. {item.title}
                  </strong>
                  <p className="team-muted">
                    {typeLabels[item.type]} · {priorityLabels[item.priority]}
                  </p>
                  <div className="team-text">{item.description}</div>
                  {team.itemIds[i] && (
                    <Link to={prefix + `/work-items/${team.itemIds[i]}`}>
                      打开工作项
                    </Link>
                  )}
                </article>
              ))}
              <h3>领域模型（{plan.models.length}）</h3>
              {!plan.models.length && (
                <p className="team-muted">本次不新增领域模型。</p>
              )}
              {plan.models.map((model, i) => (
                <details key={i}>
                  <summary>{model.name}</summary>
                  <pre>{JSON.stringify(model, null, 2)}</pre>
                  {team.modelIds[i] && (
                    <Link to={prefix + `/domain-models/${team.modelIds[i]}`}>
                      打开领域模型
                    </Link>
                  )}
                </details>
              ))}
              <h3>研发任务（{plan.tasks.length}）</h3>
              {plan.tasks.map((task) => {
                const result = team.tasks.find((t) => t.key === task.key);
                return (
                  <article key={task.key}>
                    <strong>
                      {task.title} · {task.agent}
                    </strong>
                    <p className="team-muted">
                      依赖：{task.dependsOn.join("、") || "无，可立即排队"} ·
                      文件范围：{task.files.join("、")}
                    </p>
                    <div className="team-text">{task.requirement}</div>
                    {result && (
                      <p>
                        <Link to={prefix + `/development-tasks/${result.id}`}>
                          查看研发、验收与合并
                        </Link>{" "}
                        ·{" "}
                        {result.status === "queued"
                          ? "排队中（依赖任务需先完成合并）"
                          : result.status}
                        {result.error && ` · ${result.error}`}
                      </p>
                    )}
                  </article>
                );
              })}
              {!team.confirmedPlan && !team.restored && !active && (
                <>
                  <details>
                    <summary>编辑方案 JSON</summary>
                    <p className="team-muted">
                      可调整工作项、模型、角色和依赖；确认时统一校验。所有创建均以此预览为准。
                    </p>
                    <PlanInput plan={plan} onChange={setPlan} />
                  </details>
                  <div className="team-actions">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={loadBranches}
                    >
                      选择研发基准分支
                    </Button>
                    {branches.length > 0 && (
                      <label>
                        基准分支
                        <select
                          value={branch}
                          onChange={(e) => setBranch(e.target.value)}
                        >
                          {branches.map((name) => (
                            <option key={name}>{name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <p className="team-muted">
                    确认后在当前 DedsiWork
                    工作空间创建上述工作项和领域模型，并创建研发任务。各任务使用独立工作树；有依赖的任务等待前置变更合并。不自动发布
                    Azure DevOps 工作项。
                  </p>
                  <Button
                    disabled={
                      busy ||
                      !branch ||
                      !!plan.questions.length ||
                      team.usage >= team.tokenBudget
                    }
                    onClick={confirm}
                  >
                    确认创建并开始并行研发
                  </Button>
                </>
              )}
            </section>
          )}
          {!team.confirmedPlan && !team.restored && !active && (
            <section className="team-section team-form">
              <label>
                补充信息
                <Textarea
                  rows={4}
                  value={text}
                  maxLength={12000}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="回答待决问题，或调整范围和约束。补充后重新进行一轮评审。"
                />
              </label>
              <Button disabled={busy || !text.trim()} onClick={send}>
                补充并重新讨论
              </Button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
function PlanInput({
  plan,
  onChange,
}: {
  plan: TeamPlan;
  onChange: (plan: TeamPlan) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(plan, null, 2));
  const [error, setError] = useState("");
  return (
    <>
      <Textarea
        rows={18}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="方案 JSON"
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          try {
            onChange(teamPlanSchema.parse(JSON.parse(text)));
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        应用编辑并更新预览
      </Button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
