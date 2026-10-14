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

export function createMcp(service: WorkItemService) {
  return createMcpHandler(
    (ctx) => {
      const actor: Actor = {
        source: "mcp",
        identity: ctx.authInfo?.clientId || "unknown",
        writable: ctx.authInfo?.scopes.includes("write") || false,
        requestId: crypto.randomUUID(),
      };
      const server = new McpServer({ name: "dedsiwork", version: "0.1.0" });
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
              destructiveHint: name === "work_item_delete",
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
        "修改工作项，必须提交最新 expectedVersion；已结束的项目先改为 todo 重新打开。",
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
      return server;
    },
    { maxRequestBodySize: MAX_REQUEST_BODY_SIZE },
  );
}
