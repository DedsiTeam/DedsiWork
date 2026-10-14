import { z } from "zod";
import { Auth } from "./auth";
import type { Credentials } from "./config";
import { openDatabase } from "./db/database";
import { WorkItemRepository } from "./repositories/work-items";
import { WorkItemService } from "./services/work-items";
import { createMcp } from "./mcp/handler";
import { AppError, errorBody } from "../shared/errors";
import { versionSchema } from "../shared/work-item";

export function createApp(options: {
  dbPath: string;
  credentials: Credentials;
  origin: string;
  credentialsPath?: string;
}) {
  const db = openDatabase(options.dbPath),
    service = new WorkItemService(new WorkItemRepository(db));
  const auth = new Auth(options.credentials),
    mcp = createMcp(service);
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
      if (url.pathname === "/api/v1/summary" && req.method === "GET")
        return reply({ data: service.summary() });
      if (url.pathname === "/api/v1/info" && req.method === "GET")
        return reply({
          data: {
            name: "DedsiWork",
            version: "0.1.0",
            databasePath: options.dbPath,
            mcpUrl: `${base.origin}/mcp`,
            credentialsPath: options.credentialsPath || "",
            runtime: `Bun ${Bun.version}`,
          },
        });
      const query = Object.fromEntries(url.searchParams);
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
    service,
    db,
    close: async () => {
      await mcp.close();
      db.close();
    },
  };
}
