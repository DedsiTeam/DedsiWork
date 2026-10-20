import { version } from "../../package.json";
import { MAX_REQUEST_BODY_SIZE } from "../../shared/description";
import {
  createMcpHandler,
  McpServer,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  createSchema,
  patchSchema,
  listSchema,
  pageSchema,
  idSchema,
  requestKeySchema,
} from "../../shared/work-item";
import {
  domainModelInputSchema,
  domainModelUpdateSchema,
} from "../../shared/domain-model";
import {
  developmentCreateSchema,
  developmentMessageSchema,
} from "../../shared/development-task";
import { chatAnswerSchema } from "../../shared/chat";
import type { DomainModelService } from "../services/domain-models";
import type { DevelopmentTasks } from "../services/development-tasks";
import { errorBody } from "../../shared/errors";
import type { WorkItemService, Actor } from "../services/work-items";

import type { SprintService } from "../services/sprints";
import {
  sprintSchema,
  sprintDeleteSchema,
  sprintUpdateSchema,
  sprintItemsSchema,
  sprintMoveSchema,
  sprintFinishSchema,
  sprintCreateItemSchema,
} from "../../shared/sprint";
export function createMcp(
  service: WorkItemService,
  sprints: SprintService,
  models: DomainModelService,
  development: DevelopmentTasks,
) {
  return createMcpHandler(
    (ctx) => {
      const actor: Actor = {
        source: "mcp",
        identity: ctx.authInfo?.clientId || "unknown",
        writable: ctx.authInfo?.scopes.includes("write") || false,
        requestId: crypto.randomUUID(),
      };
      const server = new McpServer({ name: "dedsiwork", version });
      function tool<S extends z.ZodObject>(
        name: string,
        description: string,
        schema: S,
        readOnly: boolean,
        callback: (input: z.infer<S>) => unknown,
      ) {
        const inputSchema: StandardSchemaWithJSON = schema;
        server.registerTool(
          name,
          {
            description,
            inputSchema,
            annotations: {
              readOnlyHint: readOnly,
              destructiveHint: [
                "work_item_delete",
                "sprint_delete",
                "domain_model_delete",
                "development_task_merge",
                "development_task_cleanup",
              ].includes(name),
              openWorldHint: name.startsWith("development_task_") && !readOnly,
            },
          },
          async (input) => {
            try {
              const result = await callback(schema.parse(input));
              return {
                content: [
                  { type: "text" as const, text: JSON.stringify(result) },
                ],
                structuredContent: JSON.parse(JSON.stringify({ result })),
              };
            } catch (error) {
              const body = errorBody(error);
              if (body.status === 500)
                console.error("MCP tool failed", actor.requestId, error);
              return {
                isError: true,
                content: [
                  { type: "text" as const, text: JSON.stringify(body.error) },
                ],
              };
            }
          },
        );
      }
      tool(
        "work_item_list",
        "查询工作项，支持搜索、筛选、分页和回收站；列表不含完整描述。",
        listSchema,
        true,
        (input) => {
          const result = service.list(input);
          return {
            ...result,
            data: result.data.map(({ description, ...item }) => item),
          };
        },
      );
      tool(
        "work_item_get",
        "读取工作项详情与最新版本。",
        z.object({ id: idSchema, includeDeleted: z.boolean().default(false) }),
        true,
        ({ id, includeDeleted }) => service.get(id, includeDeleted),
      );
      tool(
        "work_item_create",
        "创建待处理工作项；重试时重复使用 requestKey。",
        createSchema.extend({ requestKey: requestKeySchema.optional() }),
        false,
        ({ requestKey, ...input }) => service.create(input, actor, requestKey),
      );
      tool(
        "work_item_update",
        "修改工作项，必须提交最新 expectedVersion；状态可选 todo/in_progress/in_review/in_verification/awaiting_acceptance/paused/done/cancelled。blockedReason 非空标记阻塞、空串解除；从评审/验证/验收退回 in_progress 时必须提供 transitionReason。已结束的项目先改为 todo 重新打开。",
        patchSchema.extend({ id: idSchema }),
        false,
        ({ id, ...input }) => service.update(id, input, actor),
      );
      const versioned = z.object({
        id: idSchema,
        expectedVersion: z.number().int().positive(),
      });
      tool(
        "work_item_delete",
        "将工作项移入回收站，可恢复。",
        versioned,
        false,
        ({ id, expectedVersion }) => service.remove(id, expectedVersion, actor),
      );
      tool(
        "work_item_restore",
        "从回收站恢复工作项。",
        versioned,
        false,
        ({ id, expectedVersion }) =>
          service.restore(id, expectedVersion, actor),
      );
      tool(
        "work_item_events",
        "分页读取工作项活动记录，包括修改来源。",
        pageSchema.extend({ id: idSchema }),
        true,
        ({ id, ...input }) => service.events(id, input),
      );
      tool(
        "sprint_list",
        "列出冲刺，优先返回进行中的冲刺。",
        z.object({}).strict(),
        true,
        () => sprints.list(),
      );
      tool(
        "sprint_get",
        "读取冲刺看板、版本号、工作项和最近活动。已结束冲刺返回结束时快照。",
        z.object({ id: idSchema }).strict(),
        true,
        ({ id }) => sprints.board(id),
      );
      tool(
        "sprint_create",
        "创建计划中的冲刺，日期格式 YYYY-MM-DD。",
        z.object({ sprint: sprintSchema }).strict(),
        false,
        ({ sprint }) => sprints.create(sprint, actor),
      );
      tool(
        "sprint_update",
        "修改未结束冲刺的信息，需要最新冲刺版本。",
        sprintUpdateSchema.extend({ id: idSchema }),
        false,
        ({ id, ...input }) => sprints.update(id, input, actor),
      );
      tool(
        "sprint_start",
        "开始计划中的冲刺，同时最多一个进行中的冲刺。",
        versioned,
        false,
        ({ id, ...input }) => sprints.start(id, input, actor),
      );
      tool(
        "sprint_add_items",
        "批量加入未安排的工作项，需要冲刺及工作项最新版本。work_item_list 的 unplanned=true 可查询候选项。",
        sprintItemsSchema.extend({ id: idSchema }),
        false,
        ({ id, ...input }) => sprints.add(id, input, actor),
      );
      tool(
        "sprint_remove_items",
        "将工作项移回待规划区，保留工作项状态。",
        sprintItemsSchema.extend({ id: idSchema }),
        false,
        ({ id, ...input }) => sprints.remove(id, input, actor),
      );
      tool(
        "sprint_move_item",
        "修改卡片状态并排序。beforeId=null 表示放在列末尾。评审/验证/验收退回 in_progress 必须提供 reason。已暂停 paused 仍计入未完成。已结束工作项需先移至 todo。",
        sprintMoveSchema.extend({ id: idSchema }),
        false,
        ({ id, ...input }) => sprints.move(id, input, actor),
      );
      tool(
        "sprint_create_item",
        "在冲刺指定列创建工作项。item.status 应为 todo，status 指定目标列，requestKey 用于工作项幂等创建。",
        sprintCreateItemSchema.extend({ id: idSchema }),
        false,
        ({ id, ...input }) => sprints.createItem(id, input, actor),
      );
      tool(
        "sprint_delete",
        "删除空冲刺（任何阶段均可）。用户二次确认后提交 confirmed=true 和最新 expectedVersion。有工作项或非空历史快照时拒绝，不删除工作项。",
        sprintDeleteSchema.extend({ id: idSchema }),
        false,
        ({ id, ...input }) => sprints.deleteSprint(id, input, actor),
      );
      tool(
        "sprint_finish",
        "结束进行中的冲刺并保存快照。targetSprintId=null 将未完成项退回待规划；否则提供计划中目标冲刺 ID 和 targetVersion 结转。",
        sprintFinishSchema.extend({ id: idSchema }),
        false,
        ({ id, ...input }) => sprints.finish(id, input, actor),
      );

      tool(
        "domain_model_list",
        "搜索当前工作空间领域模型，分页返回摘要，每页 20 条。",
        z
          .object({
            q: z.string().trim().max(200).default(""),
            page: z.number().int().positive().max(1000000).default(1),
          })
          .strict(),
        true,
        (input) => models.list(input),
      );
      tool(
        "domain_model_get",
        "读取完整领域模型及最新版本，包含设计项和字段。",
        z.object({ id: idSchema }).strict(),
        true,
        ({ id }) => models.get(id),
      );
      tool(
        "domain_model_create",
        "创建领域模型，复用页面校验：恰好一个聚合根，领域事件与处理器一一对应。元素和字段需要 UUID。",
        z.object({ model: domainModelInputSchema }).strict(),
        false,
        ({ model }) => models.create(model, actor),
      );
      tool(
        "domain_model_update",
        "更新完整领域模型，必须传最新 expectedVersion。",
        domainModelUpdateSchema.extend({ id: idSchema }),
        false,
        ({ id, ...input }) => models.update(id, input, actor),
      );
      tool(
        "domain_model_delete",
        "删除领域模型，需要最新版本；与页面一致，删除后不再出现在列表中。",
        versioned,
        false,
        ({ id, expectedVersion }) => models.remove(id, expectedVersion, actor),
      );

      const taskId = z.object({ id: idSchema }).strict();
      tool(
        "development_task_list",
        "列出当前工作空间、当前调用身份的研发任务摘要；详情及执行记录用 development_task_get。",
        z.object({}).strict(),
        true,
        () => development.list(actor),
      );
      tool(
        "development_task_get",
        "读取研发任务、关联资料引用（历史任务为快照）、执行记录及待处理请求。执行中可轮询此工具获取进度。",
        taskId,
        true,
        ({ id }) => development.get(id, actor),
      );
      tool(
        "development_task_repository",
        "自动读取工作空间本地 Git 仓库、可选本地分支及当前分支，返回创建任务所需 token；不会弹出目录选择器。",
        z.object({}).strict(),
        false,
        () => development.selectDirectory(actor),
      );
      tool(
        "development_task_create",
        "创建并立即开始研发，在所选起始分支的已提交代码上创建独立 Git 工作树和研发分支。先调用 development_task_repository，将 token 填入 directoryToken，从 branches 中选择起始分支填入 baseBranch（默认 currentBranch）。关联工作项和模型必须属于当前空间。需用户已授权开始研发。",
        z.object({ task: developmentCreateSchema }).strict(),
        false,
        ({ task }) => development.create(task, actor),
      );
      tool(
        "development_task_start",
        "开始或继续研发任务；新任务首次开始时创建独立工作树，再次开始复用原工作树。同一空间一次只能执行一个任务，历史工作树任务不可继续。",
        taskId,
        false,
        ({ id }) => development.start(id, actor),
      );
      tool(
        "development_task_stop",
        "请求停止研发执行；返回后可通过 get 查询是否停止完成。",
        taskId,
        false,
        ({ id }) => development.stop(id, actor),
      );
      tool(
        "development_task_message",
        "补充要求并继续研发。当前执行必须已停止；重试同一消息使用相同 clientId。",
        developmentMessageSchema.extend({ id: idSchema }),
        false,
        ({ id, ...input }) => development.message(id, input, actor),
      );
      tool(
        "development_task_answer",
        "回复任务待处理请求。requestId 来自 get 返回的 snapshot.requests；权限审批必须传达用户的明确决定，不可自动批准，信息问题按实际用户答复填写。",
        chatAnswerSchema.extend({ id: idSchema, requestId: z.uuid() }),
        false,
        ({ id, requestId, ...input }) =>
          development.answer(id, requestId, input, actor),
      );
      tool(
        "development_task_complete",
        "用户验收确认后标记研发任务完成，不提交代码，也不自动改变关联工作项状态。",
        z.object({ id: idSchema, confirmed: z.literal(true) }).strict(),
        false,
        ({ id }) => development.complete(id, actor),
      );
      tool(
        "development_task_changes",
        "读取工作目录状态、相对基准提交的差异及提交记录；包含目录原有修改，不等同于任务独占改动。",
        taskId,
        true,
        ({ id }) => development.changes(id, actor),
      );
      tool(
        "development_task_notifications",
        "读取当前身份未确认的研发提醒。",
        z.object({}).strict(),
        true,
        () => development.notifications(actor),
      );
      tool(
        "development_task_acknowledge",
        "确认已看到一条研发提醒，不验收或完成任务；notificationId 来自任务 attention.id。",
        z.object({ id: idSchema, notificationId: z.uuid() }).strict(),
        false,
        ({ id, notificationId }) =>
          development.acknowledge(id, notificationId, actor),
      );
      tool(
        "development_task_merge_preview",
        "预览历史独立工作树任务合并。仅限已验收任务；直接使用工作空间目录的新任务无需合并。",
        taskId,
        false,
        ({ id }) => development.merging.preview(id, actor),
      );
      tool(
        "development_task_merge",
        "用户确认预览后合并历史任务，可能提交代码、合并分支并清理旧工作树。token 来自 merge_preview。",
        z
          .object({ id: idSchema, token: z.uuid(), confirmed: z.literal(true) })
          .strict(),
        false,
        ({ id, ...input }) => development.merging.merge(id, input, actor),
      );
      tool(
        "development_task_cleanup",
        "重试清理已合并历史任务的工作树与研发分支，保留未提交修改；不允许清理工作空间本地目录。",
        z.object({ id: idSchema, confirmed: z.literal(true) }).strict(),
        false,
        ({ id }) => development.merging.cleanup(id, actor),
      );
      tool(
        "development_task_open_directory",
        "在本机文件管理器打开任务目录。",
        taskId,
        false,
        ({ id }) => development.openDirectory(id, actor),
      );
      tool(
        "development_task_handoff",
        "停止执行并在本机打开 ChatGPT 供用户接管，不自动接续同一会话。",
        taskId,
        false,
        ({ id }) => development.handoff(id, actor),
      );
      tool(
        "development_task_status",
        "检查本机 Codex 登录状态及可用模型。",
        z.object({}).strict(),
        false,
        () => development.chat.status(actor),
      );
      tool(
        "development_task_login",
        "开始本机 Codex 登录，返回登录 URL 供用户完成授权。",
        z.object({}).strict(),
        false,
        () => development.chat.signIn(actor),
      );
      return server;
    },
    { maxRequestBodySize: MAX_REQUEST_BODY_SIZE },
  );
}
