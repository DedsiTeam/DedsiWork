import { ReportExports } from "./services/report-exports";
import { ReportAI } from "./services/report-ai";
import { DailyReports } from "./services/daily-reports";
import { CanvasNotes } from "./services/canvas-notes";
import { WorkspaceBackups } from "./services/workspace-backups";
import { mkdirSync } from "node:fs";
import { WorkspaceStore } from "./services/workspaces";
import { z } from "zod";
import { Auth } from "./auth";
import type { Credentials } from "./config";
import { openDatabase } from "./db/database";
import { WorkItemRepository } from "./repositories/work-items";
import { WorkItemService } from "./services/work-items";
import { SprintService } from "./services/sprints";
import { createMcp } from "./mcp/handler";
import { AppError, errorBody } from "../shared/errors";
import { versionSchema } from "../shared/work-item";
import { DomainModelService } from "./services/domain-models";
import { CodexChat, openChatGPT, openChatLink } from "./codex/chat";
import { dirname } from "node:path";
import { AssistantService } from "./services/assistant";

export function createApp(options: {
  dbPath: string;
  credentials: Credentials;
  origin: string;
  credentialsPath?: string;
}) {
  const workspaces = new WorkspaceStore(options.dbPath);
  const auth = new Auth(options.credentials);
  const backups = new WorkspaceBackups(workspaces);
  const reportExports = new ReportExports();
  function createBundle(id: string) {
    const path = workspaces.path(id);
    mkdirSync(dirname(path), { recursive: true });
    const db = openDatabase(path),
      service = new WorkItemService(new WorkItemRepository(db));
    const sprints = new SprintService(db, service),
      domainModels = new DomainModelService(db);
    const assistant = new AssistantService(db, service, domainModels);
    const chat = new CodexChat(db, dirname(path), () => workspaces.get(id));
    const mcp = createMcp(service, sprints);
    const dailyReports = new DailyReports(db),
      reportAI = new ReportAI(dailyReports);
    return {
      db,
      service,
      sprints,
      domainModels,
      notes: new CanvasNotes(db),
      dailyReports,
      reportAI,
      assistant,
      chat,
      mcp,
      async close() {
        await Promise.allSettled([
          chat.close(),
          assistant.close(),
          reportAI.close(),
        ]);
        await mcp.close();
        db.close();
      },
    };
  }
  const bundles = new Map<string, ReturnType<typeof createBundle>>();
  const deletingSpaces = new Set<string>();
  function bundle(id: string) {
    workspaces.get(id);
    if (deletingSpaces.has(id))
      throw new AppError("WORKSPACE_BUSY", "工作空间正在处理，请稍后重试", 409);
    if (!bundles.has(id)) bundles.set(id, createBundle(id));
    return bundles.get(id)!;
  }
  // Keep the existing data file intact; its complete contents become the default space.
  const initialId = workspaces.first();
  const initial = initialId ? bundle(initialId) : null;
  function scoped(req: Request) {
    const id =
      req.headers.get("x-workspace-id") ||
      new URL(req.url).searchParams.get("workspace") ||
      workspaces.legacyId();
    if (!id) throw new AppError("WORKSPACE_REQUIRED", "请先选择工作空间", 400);
    return { id, ...bundle(id) };
  }
  const base = new URL(options.origin);
  const allowedHosts = new Set([base.host, `localhost:${base.port}`]);
  const origins = new Set([base.origin, `http://localhost:${base.port}`]);
  async function json(req: Request) {
    if (!req.headers.get("content-type")?.startsWith("application/json"))
      throw new AppError("CONTENT_TYPE", "请使用 application/json", 415);
    try {
      return await req.json();
    } catch {
      throw new AppError("INVALID_JSON", "JSON 格式不正确");
    }
  }
  async function handle(req: Request) {
    const requestId = crypto.randomUUID();
    const reply = (data: unknown, status = 200, headers?: HeadersInit) =>
      Response.json(data, {
        status,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Request-ID": requestId,
          ...headers,
        },
      });
    try {
      const url = new URL(req.url);
      if (!allowedHosts.has(req.headers.get("host") || url.host))
        throw new AppError("INVALID_HOST", "不允许的访问地址", 403);
      const origin = req.headers.get("origin");
      if (origin && !origins.has(origin))
        throw new AppError("INVALID_ORIGIN", "不允许来自其他网站的请求", 403);
      if (url.pathname === "/healthz" && req.method === "GET")
        return reply({ status: "ok" });
      if (url.pathname === "/auth/pair" && req.method === "POST") {
        if (!origin)
          throw new AppError("ORIGIN_REQUIRED", "配对必须来自本地网页", 403);
        const { code } = z
          .object({ code: z.string().max(200) })
          .parse(await json(req));
        const result = auth.pair(code);
        return reply({ data: { csrf: result.csrf } }, 200, {
          "Set-Cookie": result.cookie,
        });
      }
      if (url.pathname === "/auth/session" && req.method === "GET")
        return reply({ data: { csrf: auth.csrf(req) } });
      if (url.pathname === "/mcp") {
        const actor = auth.actor(req, requestId, true);
        const { mcp } = scoped(req);
        return await mcp.fetch(req, {
          authInfo: {
            token: "verified",
            clientId: actor.identity,
            scopes: actor.writable ? ["read", "write"] : ["read"],
          },
        });
      }
      if (!url.pathname.startsWith("/api/"))
        return reply(
          { error: { code: "NOT_FOUND", message: "页面不存在" } },
          404,
        );
      const actor = auth.actor(req, requestId);
      if (url.pathname === "/api/v1/workspaces") {
        if (req.method === "GET") return reply({ data: workspaces.list() });
        if (req.method === "POST")
          return reply(
            { data: workspaces.create(await json(req), actor) },
            201,
          );
        throw new AppError("METHOD_NOT_ALLOWED", "不支持此方法", 405);
      }
      if (
        url.pathname === "/api/v1/workspaces/select-directory" &&
        req.method === "POST"
      )
        return reply({ data: await workspaces.chooseDirectory(actor) });
      if (
        url.pathname === "/api/v1/workspaces/restore-preview" &&
        req.method === "POST"
      )
        return reply({ data: await backups.preview(actor) });
      if (
        url.pathname === "/api/v1/workspaces/restore" &&
        req.method === "POST"
      )
        return reply({ data: backups.restore(await json(req), actor) }, 201);
      if (
        url.pathname === "/api/v1/workspaces/restore-discard" &&
        req.method === "POST"
      )
        return reply({ data: backups.discard(await json(req), actor) });
      const backup = /^\/api\/v1\/workspaces\/([^/]+)\/backup$/.exec(
        url.pathname,
      );
      if (backup && req.method === "POST") {
        const id = z.uuid().parse(backup[1]);
        const value = bundle(id);
        deletingSpaces.add(id);
        try {
          return reply({
            data: await backups.backup(id, value.db, value.chat, actor),
          });
        } finally {
          deletingSpaces.delete(id);
        }
      }
      const space = /^\/api\/v1\/workspaces\/([^/]+)(?:\/(open))?$/.exec(
        url.pathname,
      );
      if (space) {
        const id = z.uuid().parse(space[1]);
        if (space[2] && req.method === "POST")
          return reply({ data: workspaces.open(id, actor) });
        if (!space[2] && req.method === "GET")
          return reply({ data: workspaces.get(id) });
        if (!space[2] && req.method === "PUT")
          return reply({ data: workspaces.update(id, await json(req), actor) });
        if (!space[2] && req.method === "DELETE") {
          const input = await json(req);
          // Validate before shutting down any active services.
          const current = workspaces.get(id);
          z.object({
            confirmed: z.literal(true),
            name: z.literal(current.name),
            expectedVersion: z.literal(current.version),
          })
            .strict()
            .parse(input);
          if (!actor.writable)
            throw new AppError("FORBIDDEN", "需要写入权限", 403);
          if (deletingSpaces.has(id))
            throw new AppError(
              "WORKSPACE_BUSY",
              "工作空间正在处理，请稍后重试",
              409,
            );
          deletingSpaces.add(id);
          try {
            await bundles.get(id)?.close();
            bundles.delete(id);
            return reply({ data: workspaces.remove(id, input, actor) });
          } finally {
            deletingSpaces.delete(id);
          }
        }
        throw new AppError("METHOD_NOT_ALLOWED", "不支持此方法", 405);
      }
      const {
        id: workspaceId,
        db,
        service,
        sprints,
        domainModels,
        notes,
        dailyReports,
        reportAI,
        assistant,
        chat,
      } = scoped(req);
      if (
        url.pathname === "/api/v1/notes/export-image" &&
        req.method === "POST"
      )
        return reply({ data: await notes.exportImage(await json(req), actor) });
      if (url.pathname === "/api/v1/notes") {
        if (req.method === "GET") return reply(notes.list(url.searchParams));
        if (req.method === "POST")
          return reply({ data: notes.save(null, await json(req), actor) }, 201);
        throw new AppError("METHOD_NOT_ALLOWED", "不支持此方法", 405);
      }
      const noteMatch = /^\/api\/v1\/notes\/([^/]+)$/.exec(url.pathname);
      if (noteMatch) {
        if (req.method === "GET")
          return reply({ data: notes.get(noteMatch[1]!) });
        if (req.method === "PUT")
          return reply({
            data: notes.save(noteMatch[1]!, await json(req), actor),
          });
        if (req.method === "DELETE")
          return reply({
            data: notes.remove(noteMatch[1]!, await json(req), actor),
          });
        throw new AppError("METHOD_NOT_ALLOWED", "不支持此方法", 405);
      }
      if (url.pathname === "/api/v1/reports/export") {
        if (req.method === "POST")
          return reply({
            data: await reportExports.save(await json(req), actor),
          });
        throw new AppError("METHOD_NOT_ALLOWED", "不支持此方法", 405);
      }
      if (
        url.pathname === "/api/v1/daily-reports/ai/status" &&
        req.method === "GET"
      )
        return reply({ data: await reportAI.status(actor) });
      if (
        url.pathname === "/api/v1/daily-reports/ai/login" &&
        req.method === "POST"
      )
        return reply({ data: await reportAI.signIn(actor) });
      if (
        url.pathname === "/api/v1/daily-reports/ai/jobs" &&
        req.method === "POST"
      )
        return reply({ data: reportAI.generate(await json(req), actor) }, 202);
      const reportAIJob =
        /^\/api\/v1\/daily-reports\/ai\/jobs\/([^/]+)(?:\/(cancel))?$/.exec(
          url.pathname,
        );
      if (reportAIJob) {
        if (!reportAIJob[2] && req.method === "GET")
          return reply({ data: reportAI.get(reportAIJob[1]!, actor) });
        if (reportAIJob[2] && req.method === "POST")
          return reply({ data: await reportAI.cancel(reportAIJob[1]!, actor) });
        throw new AppError("METHOD_NOT_ALLOWED", "不支持此方法", 405);
      }
      if (url.pathname === "/api/v1/daily-reports/summary") {
        if (req.method === "GET")
          return reply({ data: dailyReports.summary(url.searchParams) });
        throw new AppError("METHOD_NOT_ALLOWED", "不支持此方法", 405);
      }
      if (url.pathname === "/api/v1/daily-reports") {
        if (req.method === "GET")
          return reply(dailyReports.list(url.searchParams));
        if (req.method === "POST")
          return reply(
            { data: dailyReports.save(null, await json(req), actor) },
            201,
          );
        throw new AppError("METHOD_NOT_ALLOWED", "不支持此方法", 405);
      }
      const reportMatch =
        /^\/api\/v1\/daily-reports\/([^/]+)(?:\/(restore))?$/.exec(
          url.pathname,
        );
      if (reportMatch) {
        const id = reportMatch[1]!;
        if (reportMatch[2] && req.method === "POST")
          return reply({
            data: dailyReports.lifecycle(id, await json(req), true, actor),
          });
        if (!reportMatch[2]) {
          if (req.method === "GET")
            return reply({ data: dailyReports.get(id) });
          if (req.method === "PUT")
            return reply({
              data: dailyReports.save(id, await json(req), actor),
            });
          if (req.method === "DELETE")
            return reply({
              data: dailyReports.lifecycle(id, await json(req), false, actor),
            });
        }
        throw new AppError("METHOD_NOT_ALLOWED", "不支持此方法", 405);
      }
      if (url.pathname === "/api/v1/summary" && req.method === "GET")
        return reply({ data: service.summary() });
      if (url.pathname === "/api/v1/info" && req.method === "GET")
        return reply({
          data: {
            name: "DedsiWork",
            version: "0.1.0",
            databasePath: workspaces.path(workspaceId),
            mcpUrl: `${base.origin}/mcp?workspace=${workspaceId}`,
            credentialsPath: options.credentialsPath || "",
            // Only the paired local UI may reveal the write credential.
            // Bearer clients, especially read-only ones, must not obtain it.
            ...(actor.source === "web"
              ? { writeToken: options.credentials.writeToken }
              : {}),
            runtime: `Bun ${Bun.version}`,
          },
        });
      const query = Object.fromEntries(url.searchParams);
      if (url.pathname.startsWith("/api/v1/assistant/")) {
        const path = url.pathname.slice("/api/v1/assistant/".length);
        if (path === "status" && req.method === "GET")
          return reply({ data: await assistant.status(actor) });
        if (path === "login" && req.method === "POST")
          return reply({ data: await assistant.signIn(actor) });
        if (path === "work-items" && req.method === "GET")
          return reply(assistant.availableItems(query, actor));
        if (path === "flows") {
          if (req.method === "GET")
            return reply({ data: assistant.list(actor) });
          if (req.method === "POST")
            return reply(
              { data: assistant.create(await json(req), actor) },
              201,
            );
        }
        const source = /^sources\/(work-items|domain-models)\/([^/]+)$/.exec(
          path,
        );
        if (source && req.method === "GET")
          return reply({
            data: assistant.provenance(source[1]!, source[2]!, actor),
          });
        const flow =
          /^flows\/([^/]+)(?:\/(messages|confirm|generate-model|save-model|stop))?$/.exec(
            path,
          );
        if (flow) {
          const id = z.uuid().parse(flow[1]),
            action = flow[2];
          if (!action && req.method === "GET")
            return reply({ data: assistant.read(id, actor) });
          if (action && req.method === "POST") {
            if (action === "stop")
              return reply({ data: await assistant.stop(id, actor) });
            const input = await json(req);
            return reply({
              data:
                action === "messages"
                  ? assistant.message(id, input, actor)
                  : action === "confirm"
                    ? assistant.confirm(id, input, actor)
                    : action === "generate-model"
                      ? assistant.generateModel(id, input, actor)
                      : assistant.saveModel(id, input, actor),
            });
          }
        }
        throw new AppError("NOT_FOUND", "助手接口不存在", 404);
      }
      if (url.pathname.startsWith("/api/v1/chat/")) {
        const path = url.pathname.slice("/api/v1/chat/".length);
        if (path === "status" && req.method === "GET")
          return reply({
            data: {
              ...(await chat.status(actor)),
              defaultWorkspace: chat.defaultWorkspace,
            },
          });
        if (path === "login" && req.method === "POST")
          return reply({ data: await chat.signIn(actor) });
        if (path === "open-app" && req.method === "POST")
          return reply({ data: await openChatGPT(actor) });
        if (path === "open-link" && req.method === "POST")
          return reply({ data: await openChatLink(await json(req), actor) });
        if (path === "threads") {
          if (req.method === "GET") return reply({ data: chat.list(actor) });
          if (req.method === "POST")
            return reply(
              { data: await chat.create(await json(req), actor) },
              201,
            );
        }
        const proposal = /^threads\/([^/]+)\/proposals$/.exec(path);
        if (proposal && req.method === "POST") {
          const id = z.uuid().parse(proposal[1]);
          const input = z
            .object({
              messageId: z.string().min(1).max(200),
              index: z.number().int().min(0).max(20),
            })
            .strict()
            .parse(await json(req));
          const value = await chat.proposal(
            id,
            input.messageId,
            input.index,
            actor,
          );
          return reply({
            data: assistant.fromChat(
              id,
              input.messageId,
              input.index,
              value.proposal,
              value.messages,
              actor,
            ),
          });
        }
        const match =
          /^threads\/([^/]+)(?:\/(messages|stop|requests)(?:\/([^/]+))?)?$/.exec(
            path,
          );
        if (match) {
          const id = z.uuid().parse(match[1]);
          if (!match[2] && req.method === "DELETE")
            return reply({
              data: await chat.deleteChat(id, await json(req), actor),
            });
          if (!match[2] && req.method === "GET")
            return reply({
              data: await chat.readChat(
                id,
                actor,
                query.older === "true",
                query.since,
              ),
            });
          if (match[2] === "messages" && req.method === "POST")
            return reply({
              data: await chat.message(id, await json(req), actor),
            });
          if (match[2] === "stop" && req.method === "POST")
            return reply({ data: await chat.stop(id, actor) });
          if (match[2] === "requests" && match[3] && req.method === "POST")
            return reply({
              data: await chat.answer(
                id,
                z.uuid().parse(match[3]),
                await json(req),
                actor,
              ),
            });
        }
        throw new AppError("NOT_FOUND", "对话接口不存在", 404);
      }
      if (url.pathname === "/api/v1/sprints") {
        if (req.method === "GET") return reply(sprints.list());
        if (req.method === "POST")
          return reply({ data: sprints.create(await json(req), actor) }, 201);
        throw new AppError("METHOD_NOT_ALLOWED", "不支持此方法", 405);
      }
      const sprintMatch =
        /^\/api\/v1\/sprints\/([^/]+)(?:\/(start|finish|add|remove|move|create-item))?$/.exec(
          url.pathname,
        );
      if (sprintMatch) {
        const id = sprintMatch[1]!,
          action = sprintMatch[2];
        if (!action && req.method === "GET")
          return reply({ data: sprints.board(id) });
        if (!action && req.method === "DELETE")
          return reply({
            data: sprints.deleteSprint(id, await json(req), actor),
          });
        if (!action && req.method === "PUT")
          return reply({ data: sprints.update(id, await json(req), actor) });
        if (action && req.method === "POST") {
          const input = await json(req);
          const data =
            action === "start"
              ? sprints.start(id, input, actor)
              : action === "finish"
                ? sprints.finish(id, input, actor)
                : action === "add"
                  ? sprints.add(id, input, actor)
                  : action === "remove"
                    ? sprints.remove(id, input, actor)
                    : action === "move"
                      ? sprints.move(id, input, actor)
                      : sprints.createItem(id, input, actor);
          return reply({ data });
        }
        throw new AppError("METHOD_NOT_ALLOWED", "不支持此方法", 405);
      }
      if (
        url.pathname.startsWith("/api/v1/work-items/ai/") ||
        url.pathname.startsWith("/api/v1/domain-models/ai/")
      ) {
        throw new AppError(
          "AI_MOVED",
          "AI 创建已整合到 AI 助手，请从助手创建",
          410,
        );
      }
      if (url.pathname === "/api/v1/domain-models") {
        if (req.method === "GET") return reply(domainModels.list(query));
        if (req.method === "POST")
          return reply(
            { data: domainModels.create(await json(req), actor) },
            201,
          );
        throw new AppError("METHOD_NOT_ALLOWED", "不支持此方法", 405);
      }
      const domainMatch = /^\/api\/v1\/domain-models\/([^/]+)$/.exec(
        url.pathname,
      );
      if (domainMatch) {
        const id = domainMatch[1]!;
        if (req.method === "GET") return reply({ data: domainModels.get(id) });
        if (req.method === "PUT")
          return reply({
            data: domainModels.update(id, await json(req), actor),
          });
        if (req.method === "DELETE") {
          const value = req.headers.get("if-match");
          if (!value || !/^"?\d+"?$/.test(value))
            throw new AppError("VERSION_REQUIRED", "请提供 If-Match 版本号");
          return reply({
            data: domainModels.remove(
              id,
              Number(value.replaceAll('"', "")),
              actor,
            ),
          });
        }
        throw new AppError("METHOD_NOT_ALLOWED", "不支持此方法", 405);
      }
      if (url.pathname === "/api/v1/trash/purge") {
        if (req.method !== "POST")
          throw new AppError("METHOD_NOT_ALLOWED", "不支持此方法", 405);
        return reply({ data: service.purge(await json(req), actor) });
      }
      if (url.pathname === "/api/v1/work-items") {
        if (req.method === "GET") return reply(service.list(query));
        if (req.method === "POST")
          return reply(
            {
              data: service.create(
                await json(req),
                actor,
                req.headers.get("idempotency-key") ?? undefined,
              ),
            },
            201,
          );
        throw new AppError("METHOD_NOT_ALLOWED", "不支持此方法", 405);
      }
      const match =
        /^\/api\/v1\/work-items\/([^/]+)(?:\/(restore|events))?$/.exec(
          url.pathname,
        );
      if (!match) throw new AppError("NOT_FOUND", "接口不存在", 404);
      const id = match[1]!,
        action = match[2];
      if (action === "events" && req.method === "GET")
        return reply(service.events(id, query));
      if (action === "restore" && req.method === "POST")
        return reply({
          data: service.restore(
            id,
            versionSchema.parse(await json(req)).expectedVersion,
            actor,
          ),
        });
      if (!action && req.method === "GET")
        return reply({
          data: service.get(id, query.includeDeleted === "true"),
        });
      if (!action && req.method === "PATCH")
        return reply({ data: service.update(id, await json(req), actor) });
      if (!action && req.method === "DELETE") {
        const value = req.headers.get("if-match");
        if (!value || !/^"?\d+"?$/.test(value))
          throw new AppError("VERSION_REQUIRED", "请提供 If-Match 版本号");
        return reply({
          data: service.remove(id, Number(value.replaceAll('"', "")), actor),
        });
      }
      throw new AppError("METHOD_NOT_ALLOWED", "不支持此方法", 405);
    } catch (error) {
      const { status, error: body } = errorBody(error);
      if (status === 500) console.error("Request failed", requestId, error);
      return reply({ error: body, requestId }, status);
    }
  }
  return {
    handle,
    service: initial?.service,
    sprints: initial?.sprints,
    db: initial?.db,
    startAI: () => initial?.chat.start() || Promise.resolve(),
    close: async () => {
      await Promise.allSettled(
        [...bundles.values()].map((value) => value.close()),
      );
      backups.close();
      workspaces.close();
    },
  };
}
