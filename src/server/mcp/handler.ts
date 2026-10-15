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
export function createMcp(service: WorkItemService, sprints: SprintService) {
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
              destructiveHint:
                name === "work_item_delete" || name === "sprint_delete",
              openWorldHint: false,
            },
          },
          async (input) => {
            try {
              const result = callback(schema.parse(input));
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
      return server;
    },
    { maxRequestBodySize: MAX_REQUEST_BODY_SIZE },
  );
}
