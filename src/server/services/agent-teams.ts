import type { Database } from "bun:sqlite";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../shared/errors";
import {
  teamCreateSchema,
  teamMessageSchema,
  teamPlanSchema,
  type AgentTeam,
  type ProjectAgent,
  type TeamPlan,
} from "../../shared/agent-team";
import { normalizeGeneratedWorkItem } from "../../shared/work-item-ai";
import { normalizeGeneratedModel } from "../../shared/domain-model-ai";
import type { Actor, WorkItemService } from "./work-items";
import type { DomainModelService } from "./domain-models";
import type { DevelopmentTasks } from "./development-tasks";
import { CodexChat } from "../codex/chat";
import { PAGE_SIZE } from "../../shared/pagination";

const active = new Set(["preparing", "running", "waiting", "stopping"]);
const stopped = new Set(["failed", "stopped", "interrupted", "taken_over"]);
const fingerprint = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (!isAbsolute(rel) &&
      rel !== ".." &&
      !rel.startsWith("..\\") &&
      !rel.startsWith("../"))
  );
};

export async function discoverAgents(directory: string) {
  if (!directory)
    throw new AppError("INVALID_DIRECTORY", "请先在工作空间设置中配置项目目录");
  const root = await realpath(directory);
  const folder = join(root, ".codex", "agents");
  const agents: ProjectAgent[] = [],
    errors: string[] = [];
  let files;
  try {
    files = await readdir(folder, { withFileTypes: true });
  } catch (error: any) {
    if (error.code === "ENOENT") return { agents, errors, directory: root };
    throw error;
  }
  for (const file of files
    .filter((f) => f.name.endsWith(".toml"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 100)) {
    try {
      const path = await realpath(join(folder, file.name));
      if (
        !inside(root, path) ||
        !(await stat(path)).isFile() ||
        (await stat(path)).size > 64000
      )
        throw new Error("配置必须是项目内不超过 64KB 的文件");
      const text = await readFile(path, "utf8");
      const parsed = z
        .object({
          name: z.string().trim().min(1).max(100),
          description: z.string().trim().min(1).max(4000),
          developer_instructions: z.string().trim().min(1).max(30000),
          model: z.string().min(1).max(200).optional(),
          model_reasoning_effort: z
            .enum([
              "none",
              "minimal",
              "low",
              "medium",
              "high",
              "xhigh",
              "max",
              "ultra",
            ])
            .optional(),
        })
        .parse(Bun.TOML.parse(text));
      if (agents.some((a) => a.name === parsed.name))
        throw new Error(`角色名称重复：${parsed.name}`);
      agents.push({
        name: parsed.name,
        description: parsed.description,
        instructions: parsed.developer_instructions,
        model: parsed.model,
        effort: parsed.model_reasoning_effort,
        file: file.name,
        fingerprint: fingerprint(text),
      });
    } catch (error) {
      errors.push(
        `${file.name}：${error instanceof Error ? error.message : "配置无法读取"}`,
      );
    }
  }
  if (files.length > 100)
    errors.push("最多读取 100 个配置文件，请精简目录后刷新");
  return { agents, errors, directory: root };
}

export function validateTeamPlan(
  value: unknown,
  agents: ProjectAgent[],
): TeamPlan {
  const plan = teamPlanSchema.parse(value);
  const keys = new Set(plan.tasks.map((t) => t.key));
  if (keys.size !== plan.tasks.length)
    throw new AppError("INVALID_PLAN", "任务标识不能重复");
  const visited = new Set<string>(),
    visiting = new Set<string>();
  const visit = (key: string) => {
    if (visiting.has(key))
      throw new AppError("INVALID_PLAN", "任务依赖存在循环");
    if (visited.has(key)) return;
    const task = plan.tasks.find((t) => t.key === key);
    if (!task) throw new AppError("INVALID_PLAN", "任务依赖不存在");
    visiting.add(key);
    task.dependsOn.forEach(visit);
    visiting.delete(key);
    visited.add(key);
  };
  for (const task of plan.tasks) {
    visit(task.key);
    if (!agents.some((a) => a.name === task.agent))
      throw new AppError("INVALID_PLAN", `未选择智能体：${task.agent}`);
    if (task.itemIndexes.some((index) => !plan.items[index]))
      throw new AppError("INVALID_PLAN", "任务关联的工作项不存在");
    if (
      `${plan.summary}\n\n${task.requirement}\n文件范围：${task.files.join("、")}\n仅执行本任务，不继续委派。`
        .length > 16000
    )
      throw new AppError(
        "INVALID_PLAN",
        "方案与任务要求合计过长，请精简后再确认",
      );
    if (
      task.files.some(
        (file) =>
          isAbsolute(file) ||
          file.replaceAll("\\", "/").split("/").includes(".."),
      )
    )
      throw new AppError("INVALID_PLAN", "任务文件范围必须使用项目相对路径");
  }
  // Shared file/directory ownership requires an explicit dependency.
  const depends = (a: string, b: string): boolean =>
    plan.tasks
      .find((t) => t.key === a)!
      .dependsOn.some((key) => key === b || depends(key, b));
  const scope = (path: string) =>
    path
      .replaceAll("\\", "/")
      .replace(/^\.\//, "")
      .split(/[*?\[]/)[0]!
      .replace(/\/+$/, "")
      .toLowerCase() || ".";
  const overlaps = (a: string, b: string) => {
    a = scope(a);
    b = scope(b);
    return (
      a === b ||
      a.startsWith(b + "/") ||
      b.startsWith(a + "/") ||
      a === "." ||
      b === "."
    );
  };
  plan.tasks.forEach((a, i) =>
    plan.tasks.slice(i + 1).forEach((b) => {
      if (
        a.files.some((f) => b.files.some((g) => overlaps(f, g))) &&
        !depends(a.key, b.key) &&
        !depends(b.key, a.key)
      )
        throw new AppError(
          "INVALID_PLAN",
          `任务 ${a.key} 与 ${b.key} 的文件范围重叠，请添加依赖或调整范围`,
        );
    }),
  );
  plan.items.forEach(normalizeGeneratedWorkItem);
  plan.models.forEach(normalizeGeneratedModel);
  return plan;
}

export class AgentTeams {
  readonly chat: CodexChat;
  private jobs = new Map<string, Promise<void>>();
  private mutations = new Map<string, Promise<unknown>>();
  private actors = new Map<string, Actor>();
  private timer: ReturnType<typeof setInterval>;
  private ticking = false;
  private tickJob: Promise<void> | null = null;
  private closed = false;
  constructor(
    private db: Database,
    dataDir: string,
    private directory: () => string,
    private items: WorkItemService,
    private models: DomainModelService,
    private development: DevelopmentTasks,
  ) {
    db.run(
      "CREATE TABLE IF NOT EXISTS agent_teams(id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL)",
    );
    this.chat = new CodexChat(
      db,
      dataDir,
      undefined,
      "你是项目讨论助手。",
      undefined,
      undefined,
      true,
    );
    for (const row of db.query("SELECT state FROM agent_teams").all() as {
      state: string;
    }[]) {
      const team = JSON.parse(row.state) as AgentTeam;
      if (["discussing", "running"].includes(team.status)) {
        team.status = "interrupted";
        team.error = "客户端或服务退出，已保留讨论和任务，请检查后继续。";
        this.save(team);
      }
    }
    this.timer = setInterval(() => {
      if (!this.tickJob)
        this.tickJob = this.tick()
          .catch(() => {})
          .finally(() => {
            this.tickJob = null;
          });
    }, 1000);
  }
  private access(actor: Actor) {
    if (!actor.writable) throw new AppError("FORBIDDEN", "需要写入权限", 403);
    if (this.closed)
      throw new AppError("SERVICE_CLOSED", "群聊服务已关闭", 409);
  }
  discover(actor: Actor) {
    this.access(actor);
    return discoverAgents(this.directory());
  }
  list(actor: Actor, input: unknown = 1) {
    this.access(actor);
    const page = z.coerce.number().int().min(1).max(1000000).parse(input);
    const total = (
      this.db
        .query("SELECT COUNT(*) AS total FROM agent_teams WHERE owner=?")
        .get(actor.identity) as { total: number }
    ).total;
    const data = (
      this.db
        .query(
          "SELECT state FROM agent_teams WHERE owner=? ORDER BY json_extract(state,'$.updatedAt') DESC,id DESC LIMIT ? OFFSET ?",
        )
        .all(actor.identity, PAGE_SIZE, (page - 1) * PAGE_SIZE) as {
        state: string;
      }[]
    ).map((row) => {
      const t = JSON.parse(row.state) as AgentTeam;
      return {
        id: t.id,
        title: t.title,
        status: t.status,
        updatedAt: t.updatedAt,
      };
    });
    return { data, meta: { total, page, pageSize: PAGE_SIZE } };
  }
  get(id: string, actor: Actor) {
    this.access(actor);
    z.uuid().parse(id);
    const row = this.db
      .query("SELECT state FROM agent_teams WHERE id=? AND owner=?")
      .get(id, actor.identity) as { state: string } | null;
    if (!row) throw new AppError("NOT_FOUND", "群聊不存在", 404);
    const team = JSON.parse(row.state) as AgentTeam;
    let usage = 0,
      known = true;
    const count = (id: string, fallback = 0, fallbackKnown = false) => {
      const measured = this.db
        .query(
          "SELECT SUM(total) AS total,COUNT(*) AS count FROM chat_token_usage WHERE root_id=?",
        )
        .get(id) as { total: number | null; count: number };
      usage += Math.max(fallback, measured.total || 0);
      known &&= measured.count > 0 || fallbackKnown;
    };
    team.chats.forEach((chat) => count(chat.id, chat.usage, chat.known));
    for (const entry of team.tasks) {
      const stored = this.db
        .query("SELECT state FROM development_tasks WHERE id=? AND owner=?")
        .get(entry.id, actor.identity) as { state: string } | null;
      if (!stored) continue;
      const task = JSON.parse(stored.state);
      if (task.chatId)
        count(
          task.chatId,
          task.snapshot?.tokenUsage?.total,
          task.snapshot?.tokenUsage?.known,
        );
    }
    team.usage = Math.max(team.usage, usage);
    team.usageKnown = known;
    return team;
  }
  private save(team: AgentTeam, owner?: string) {
    team.revision++;
    team.updatedAt = new Date().toISOString();
    if (owner)
      this.db
        .query("INSERT INTO agent_teams VALUES (?,?,?)")
        .run(team.id, owner, JSON.stringify(team));
    else
      this.db
        .query("UPDATE agent_teams SET state=? WHERE id=?")
        .run(JSON.stringify(team), team.id);
    return team;
  }
  private guard(team: AgentTeam, revision: number) {
    if (team.restored)
      throw new AppError(
        "RESTORED_TEAM",
        "备份恢复的群聊仅供查阅，请新建群聊",
        409,
      );
    if (team.revision !== revision)
      throw new AppError("VERSION_CONFLICT", "群聊已更新，请刷新后重试", 409);
    if (this.jobs.has(team.id) || team.status === "running")
      throw new AppError("TEAM_BUSY", "请先暂停当前工作", 409);
  }
  async create(input: unknown, actor: Actor) {
    this.access(actor);
    const request = teamCreateSchema.parse(input),
      found = await this.discover(actor);
    const agents = [...new Set(request.agents)].map((name) => {
      const agent = found.agents.find((a) => a.name === name);
      if (!agent)
        throw new AppError("AGENT_NOT_FOUND", `角色不存在或配置无效：${name}`);
      return agent;
    });
    const now = new Date().toISOString();
    const team: AgentTeam = {
      id: crypto.randomUUID(),
      title: request.title,
      directory: found.directory,
      revision: 0,
      status: "discussing",
      agents,
      maxParallel: request.maxParallel,
      tokenBudget: request.tokenBudget,
      usage: 0,
      usageKnown: true,
      error: null,
      messages: [{ id: crypto.randomUUID(), role: "你", text: request.text }],
      plan: null,
      confirmedPlan: null,
      itemIds: [],
      modelIds: [],
      tasks: [],
      chats: [],
      createdAt: now,
      updatedAt: now,
    };
    this.cancelled.delete(team.id);
    this.save(team, actor.identity);
    this.discuss(team, actor);
    return team;
  }
  async message(id: string, input: unknown, actor: Actor) {
    const request = teamMessageSchema.parse(input),
      team = this.get(id, actor);
    this.guard(team, request.expectedRevision);
    if (team.confirmedPlan)
      throw new AppError(
        "PLAN_FROZEN",
        "已启动的方案不可修改，请新建群聊",
        409,
      );
    if (team.usage >= team.tokenBudget)
      throw new AppError("TOKEN_BUDGET", "预算已用尽，请提高预算后继续", 409);
    team.messages.push({
      id: crypto.randomUUID(),
      role: "你",
      text: request.text,
    });
    team.plan = null;
    team.status = "discussing";
    team.error = null;
    this.cancelled.delete(id);
    this.save(team);
    this.discuss(team, actor);
    return team;
  }
  private async context(team: AgentTeam) {
    // Bounded business evidence; full requirements are retained separately without truncation.
    const items = this.items.list({ page: 1 }).data.map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      version: item.version,
    }));
    const models = this.models.list({ page: 1 }).data;
    let rules = "";
    try {
      const path = await realpath(join(team.directory, "AGENTS.md"));
      if (inside(team.directory, path))
        rules = (await readFile(path, "utf8")).slice(0, 16000);
    } catch {}
    return JSON.stringify({
      project: team.directory,
      rules: rules.slice(0, 3500),
      existingItems: items,
      existingModels: models.map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version,
      })),
      note: "以上为部分已有资料索引；未提供的代码与业务事实必须标为待核实，不臆测已检查代码。",
    }).slice(0, 6000);
  }
  private discuss(team: AgentTeam, actor: Actor) {
    this.actors.set(team.id, actor);
    const job = (async () => {
      try {
        const context = await this.context(team);
        const user = team.messages
          .filter((m) => m.role === "你")
          .map((m) => m.text)
          .join("\n\n");
        if (user.length > 12000)
          throw new AppError(
            "CONTEXT_LIMIT",
            "补充信息较长，请在新群聊中整理完整需求后继续，避免截断约束",
          );
        let cursor = 0;
        const reviews: string[] = [];
        const workers = await Promise.allSettled(
          Array.from(
            { length: Math.min(team.maxParallel, team.agents.length) },
            async () => {
              while (cursor < team.agents.length) {
                this.assertBudget(team);
                const agent = team.agents[cursor++]!;
                const text = await this.turn(
                  team,
                  actor,
                  agent.name,
                  agent.instructions,
                  `需求：\n${user}\n\n项目资料：${context}\n请从你的职责独立评审，严格控制在 800 字以内。输出事实、建议、风险、需用户决定的问题和可并行任务；不要反复复述需求。`,
                  agent,
                );
                if (text.length > 1000)
                  throw new AppError(
                    "REVIEW_TOO_LONG",
                    `${agent.name} 意见超过上下文预算，已保留原文，请补充要求其精简后继续`,
                  );
                reviews.push(`${agent.name}：\n${text}`);
              }
            },
          ),
        );
        const failed = workers.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
        this.assertBudget(team);
        const output = await this.turn(
          team,
          actor,
          "主持人",
          "你负责收敛项目方案。只根据用户要求和已提供资料形成计划，保留角色分歧和业务待决事项，不虚构已验证的代码证据。",
          `用户全部要求：\n${user}\n\n资料：${context}\n\n角色评审：\n${reviews.join("\n\n")}\n可分配的角色：${JSON.stringify(team.agents.map((a) => ({ name: a.name, description: a.description })))}\n输出一个 JSON 对象，符合 schema：${JSON.stringify(z.toJSONSchema(teamPlanSchema))}\nquestions 记录阻止实施的业务歧义；不可自行决定。任务包含文件或目录所有权、接口契约、测试和验收要求；重叠文件任务必须有依赖。已存在的工作项不要重复创建。models 仅在确有需要时生成，可为空；领域模型必须一个聚合根，事件与处理器一对一。仅输出 JSON，不带 Markdown。`,
          team.agents[0],
          z.toJSONSchema(teamPlanSchema),
        );
        this.assertBudget(team);
        const raw = output
          .trim()
          .replace(/^```(?:json)?\s*/, "")
          .replace(/\s*```$/, "");
        team.plan = validateTeamPlan(JSON.parse(raw), team.agents);
        team.status = "ready";
        team.error = null;
      } catch (error) {
        team.status = team.status === "paused" ? "paused" : "failed";
        team.error = error instanceof Error ? error.message : "讨论失败";
        await this.stopChats(team, actor);
      } finally {
        this.save(team);
      }
    })().finally(() => this.jobs.delete(team.id));
    this.jobs.set(team.id, job);
  }
  private assertBudget(team: AgentTeam) {
    if (
      this.closed ||
      this.cancelled.has(team.id) ||
      team.status === "paused"
    ) {
      team.status = "paused";
      throw new AppError("TEAM_PAUSED", "群聊已暂停");
    }
    if (team.usage >= team.tokenBudget) {
      team.status = "paused";
      throw new AppError("TOKEN_BUDGET", "已达到 token 预算，停止派发新工作");
    }
  }
  private async turn(
    team: AgentTeam,
    actor: Actor,
    role: string,
    instructions: string,
    text: string,
    agent?: ProjectAgent,
    outputSchema?: unknown,
  ) {
    this.assertBudget(team);
    if (text.length > 30000)
      throw new AppError(
        "CONTEXT_LIMIT",
        "讨论上下文超过预算，请精简需求或减少参与角色；完整原文已保留",
      );
    const snapshot = await this.chat.create(
      { cwd: team.directory, ...(agent?.model ? { model: agent.model } : {}) },
      actor,
      {
        instructions: `${instructions}\n本阶段仅讨论；允许在当前项目只读检查相关代码，禁止任何文件或外部业务写入，不调用其他智能体，不读取秘密。按需检查你职责内的最小代码范围，不扫描整个仓库。事实需引用文件和符号位置，无法核实的事项明确标记。意见和上下文不足以授权实施。`,
        effort: agent?.effort,
        readOnly: true,
      },
    );
    const record = {
      id: snapshot.chat.id,
      role,
      usage: 0,
      known: false,
      text: "",
    };
    team.chats.push(record);
    this.save(team);
    this.assertBudget(team);
    await this.chat.message(
      record.id,
      { text, clientId: crypto.randomUUID() },
      actor,
      outputSchema ? { outputSchema } : undefined,
    );
    const start = Date.now();
    while (true) {
      const state = this.chat.checkpoint(record.id);
      if (state) {
        record.usage = Math.max(record.usage, state.tokenUsage?.total || 0);
        record.known ||= Boolean(state.tokenUsage?.known);
        team.usage = team.chats.reduce((sum, c) => sum + c.usage, 0);
        team.usageKnown = team.chats.every((c) => c.known);
        const replies = state.items.filter((i) => i.role === "assistant");
        record.text =
          (
            replies.findLast((i) => i.phase === "final_answer") ||
            replies.at(-1)
          )?.text || "";
        this.save(team);
        this.assertBudget(team);
        if (state.requests.length)
          throw new AppError(
            "AGENT_INPUT",
            `${role} 需要额外输入，请补充需求后重试`,
          );
        if (!state.running) {
          if (state.error) throw new Error(state.error);
          break;
        }
      }
      if (Date.now() - start > 5 * 60 * 1000)
        throw new AppError("AGENT_TIMEOUT", `${role} 讨论超时，已保存进度`);
      await Bun.sleep(250);
    }
    if (!record.text) throw new Error(`${role} 未返回有效意见`);
    team.messages.push({ id: crypto.randomUUID(), role, text: record.text });
    this.save(team);
    return record.text;
  }
  private async exclusive<T>(id: string, action: () => Promise<T>) {
    if (this.mutations.has(id))
      throw new AppError("TEAM_BUSY", "群聊正在保存或调度，请稍后重试", 409);
    const job = action();
    this.mutations.set(id, job);
    try {
      return await job;
    } finally {
      this.mutations.delete(id);
    }
  }
  async confirm(id: string, input: unknown, actor: Actor) {
    return this.exclusive(id, () => this.confirmImpl(id, input, actor));
  }
  private async confirmImpl(id: string, input: unknown, actor: Actor) {
    const request = z
      .object({
        expectedRevision: z.number().int().positive(),
        confirmed: z.literal(true),
        baseBranch: z.string().min(1).max(250),
        plan: teamPlanSchema,
      })
      .strict()
      .parse(input);
    const team = this.get(id, actor);
    if (team.confirmedPlan) {
      if (
        JSON.stringify(team.confirmedPlan) !== JSON.stringify(request.plan) ||
        team.baseBranch !== request.baseBranch
      )
        throw new AppError("PLAN_FROZEN", "方案已执行，请查看现有任务", 409);
      return team;
    }
    this.guard(team, request.expectedRevision);
    const plan = validateTeamPlan(request.plan, team.agents);
    if (plan.questions.length)
      throw new AppError("PLAN_QUESTIONS", "请先解决方案中的待决问题", 409);
    if ((await realpath(this.directory())) !== team.directory)
      throw new AppError(
        "DIRECTORY_CHANGED",
        "项目目录已变更，请在原项目继续或新建群聊",
        409,
      );
    this.assertBudget(team);
    // Validate repository and branch before creating any business records.
    const selection = await this.development.selectDirectory(actor);
    if (!selection.branches.includes(request.baseBranch))
      throw new AppError("INVALID_BRANCH", "请选择有效的本地基准分支");
    this.db
      .transaction(() => {
        // Recheck after async directory selection to protect against concurrent confirmation.
        const current = this.get(id, actor);
        this.guard(current, request.expectedRevision);
        if (current.confirmedPlan)
          throw new AppError("PLAN_FROZEN", "方案已确认", 409);
        team.itemIds = plan.items.map(
          (item, index) =>
            this.items.create(
              normalizeGeneratedWorkItem(item),
              actor,
              `team:${team.id}:${index}`,
            ).id,
        );
        team.modelIds = plan.models.map(
          (model) =>
            this.models.create(normalizeGeneratedModel(model), actor).id,
        );
        team.plan = plan;
        team.confirmedPlan = plan;
        team.baseBranch = request.baseBranch;
        team.status = "paused";
        team.error = null;
        // Draft tasks are created below; crash recovery can fill missing tasks without duplicating records.
        this.save(team);
      })
      .immediate();
    await this.prepareTasks(team, request.baseBranch, actor);
    team.status = "running";
    this.actors.set(id, actor);
    this.save(team);
    return team;
  }
  private async prepareTasks(team: AgentTeam, branch: string, actor: Actor) {
    for (const spec of team.confirmedPlan!.tasks) {
      if (team.tasks.some((t) => t.key === spec.key)) continue;
      const existing = this.development
        .list(actor)
        .find((t) => t.team?.id === team.id && t.team.key === spec.key);
      const agent = team.agents.find((a) => a.name === spec.agent)!;
      const selection = await this.development.selectDirectory(actor);
      const task =
        existing ||
        (await this.development.create(
          {
            title: spec.title,
            requirement: `${team.confirmedPlan!.summary}\n\n${spec.requirement}\n文件范围：${spec.files.join("、")}\n仅执行本任务，不继续委派。`,
            directoryToken: selection.token,
            baseBranch: branch,
            itemIds: spec.itemIndexes.map((i) => team.itemIds[i]),
            modelIds: team.modelIds,
            ...(agent.model ? { model: agent.model } : {}),
          },
          actor,
          {
            id: team.id,
            key: spec.key,
            maxParallel: team.maxParallel,
            instructions: agent.instructions,
            effort: agent.effort,
          },
        ));
      team.tasks.push({ key: spec.key, id: task.id, status: "queued" });
      this.save(team);
    }
  }
  async control(id: string, input: unknown, actor: Actor) {
    return this.exclusive(id, () => this.controlImpl(id, input, actor));
  }
  private async controlImpl(id: string, input: unknown, actor: Actor) {
    const request = z
      .object({
        action: z.enum(["pause", "resume"]),
        tokenBudget: z.number().int().min(1000).max(2000000).optional(),
        expectedRevision: z.number().int().positive(),
      })
      .strict()
      .parse(input);
    if (this.tickJob) await this.tickJob;
    let team = this.get(id, actor);
    if (
      request.action !== "pause" &&
      request.expectedRevision !== team.revision
    )
      throw new AppError("VERSION_CONFLICT", "群聊已更新，请刷新", 409);
    if (request.action === "pause") {
      team.status = "paused";
      this.save(team);
      // The running discussion shares its live object; mark it through the cancellation set too.
      this.cancelled.add(id);
      await this.stopChats(team, actor);
      for (const task of team.tasks)
        if (active.has(this.development.get(task.id, actor).status))
          await this.development.stop(task.id, actor);
      await this.jobs.get(id);
      team = this.get(id, actor);
      team.status = "paused";
      return this.save(team);
    }
    this.guard(team, request.expectedRevision);
    if (request.tokenBudget) team.tokenBudget = request.tokenBudget;
    this.cancelled.delete(id);
    team.error = null;
    if (team.usage >= team.tokenBudget)
      throw new AppError("TOKEN_BUDGET", "请提高预算后继续");
    this.actors.set(id, actor);
    if (team.confirmedPlan) {
      const branch = team.baseBranch || (await this.currentBranch(actor));
      await this.prepareTasks(team, branch, actor);
      team.tasks.forEach((t) => {
        if (stopped.has(this.development.get(t.id, actor).status)) {
          t.status = "queued";
          t.error = null;
        }
      });
      team.status = "running";
      this.save(team);
    } else {
      team.status = "discussing";
      this.save(team);
      this.discuss(team, actor);
    }
    return team;
  }
  private cancelled = new Set<string>();
  private async currentBranch(actor: Actor) {
    return (await this.development.selectDirectory(actor)).currentBranch;
  }
  private async stopChats(team: AgentTeam, actor: Actor) {
    await Promise.allSettled(
      team.chats.map((c) => this.chat.stop(c.id, actor)),
    );
  }
  private async tick() {
    if (this.ticking || this.closed) return;
    this.ticking = true;
    try {
      for (const [id, actor] of this.actors) {
        if (this.mutations.has(id)) continue;
        const team = this.get(id, actor);
        if (team.status !== "running") continue;
        try {
          this.assertBudget(team);
          if ((await realpath(this.directory())) !== team.directory)
            throw new Error("项目目录已变更，请恢复原目录后继续");
          const tasks = team.tasks.map((t) => ({
            entry: t,
            task: this.development.get(t.id, actor),
          }));
          let usage = team.chats.reduce((sum, c) => sum + c.usage, 0),
            known = team.chats.every((c) => c.known);
          for (const { entry, task } of tasks) {
            const snapshot = task.chatId
              ? this.development.chat.checkpoint(task.chatId)
              : null;
            if (snapshot?.tokenUsage) {
              task.snapshot = snapshot;
            }
            usage += task.snapshot?.tokenUsage?.total || 0;
            if (task.chatId && !task.snapshot?.tokenUsage?.known) known = false;
            if (entry.status !== "queued") {
              entry.status = task.status;
              entry.error = task.error;
            }
          }
          team.usage = Math.max(team.usage, usage);
          team.usageKnown = known;
          this.assertBudget(team);
          for (const { entry, task } of tasks) {
            if (entry.status !== "queued") continue;
            const spec = team.confirmedPlan!.tasks.find(
              (t) => t.key === entry.key,
            )!;
            const dependencies = spec.dependsOn.map(
              (key) => tasks.find((t) => t.entry.key === key)!.task,
            );
            if (dependencies.some((t) => !t.merge)) continue;
            // All prerequisite changes must already be integrated into the selected base branch.
            const selection = await this.development.selectDirectory(actor);
            const result = Bun.spawnSync([
              "git",
              "-C",
              selection.directory,
              "rev-parse",
              `refs/heads/${task.baseBranch}^{commit}`,
            ]);
            if (result.exitCode) throw new Error("基准分支不存在");
            for (const dependency of dependencies) {
              const check = Bun.spawnSync([
                "git",
                "-C",
                selection.directory,
                "merge-base",
                "--is-ancestor",
                dependency.merge!.targetCommit,
                result.stdout.toString().trim(),
              ]);
              if (check.exitCode)
                throw new Error("依赖合并提交尚未进入基准分支");
            }
            this.assertBudget(team);
            try {
              const started = await this.development.startTeamTask(
                task.id,
                actor,
                result.stdout.toString().trim(),
              );
              entry.status = started.status;
            } catch (error) {
              if (error instanceof AppError && error.code === "WORKSPACE_BUSY")
                break;
              throw error;
            }
          }
          if (
            tasks.length &&
            tasks.every(({ task }) =>
              ["review", "completed"].includes(task.status),
            )
          )
            team.status = "review";
          if (
            tasks.some(({ task }) => stopped.has(task.status)) &&
            !tasks.some(({ task }) => active.has(task.status))
          ) {
            team.status = "paused";
            team.error = "部分任务已停止或失败，请查看研发任务，修复后继续。";
          }
          if (this.cancelled.has(id)) team.status = "paused";
          this.save(team);
        } catch (error) {
          team.status = "paused";
          team.error = error instanceof Error ? error.message : "调度失败";
          this.save(team);
          for (const t of team.tasks)
            if (active.has(this.development.get(t.id, actor).status))
              await this.development.stop(t.id, actor);
        }
      }
    } finally {
      this.ticking = false;
    }
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await Promise.allSettled(this.mutations.values());
    await this.tickJob;
    for (const [id, actor] of this.actors) {
      const team = this.getForClose(id, actor);
      if (team) await this.stopChats(team, actor);
    }
    await Promise.allSettled(this.jobs.values());
    await this.chat.close();
  }
  private getForClose(id: string, actor: Actor) {
    const row = this.db
      .query("SELECT state FROM agent_teams WHERE id=? AND owner=?")
      .get(id, actor.identity) as { state: string } | null;
    return row ? (JSON.parse(row.state) as AgentTeam) : null;
  }
}
