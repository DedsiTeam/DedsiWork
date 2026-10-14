import { MAX_REQUEST_BODY_SIZE } from "../shared/description";
import { resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "./config";
import { createApp } from "./app";
import index from "../web/index.html";
const config = loadConfig();
const origin = `http://${config.host}:${config.port}`;
const dist = resolve(config.projectRoot, "dist");
if (config.production && !existsSync(resolve(dist, "index.html")))
  throw new Error("请先运行 bun run build");
const app = createApp({ ...config, origin });
const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
  development: config.production ? false : { hmr: true, console: true },
  routes: config.production
    ? undefined
    : {
        "/*": index,
        "/api": false,
        "/api/*": false,
        "/auth": false,
        "/auth/*": false,
        "/mcp": false,
        "/mcp/*": false,
        "/healthz": false,
        "/healthz/*": false,
      },
  async fetch(req) {
    const url = new URL(req.url);
    if (
      config.production &&
      !/^\/(api|auth|mcp|healthz)(\/|$)/.test(url.pathname)
    ) {
      let pathname: string;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return new Response("Invalid URL", { status: 400 });
      }
      const filePath = resolve(
        dist,
        pathname === "/" ? "index.html" : `.${pathname}`,
      );
      if (!filePath.startsWith(dist + sep))
        return new Response("Forbidden", { status: 403 });
      const file = Bun.file(filePath);
      if (
        (req.method === "GET" || req.method === "HEAD") &&
        (await file.exists())
      )
        return new Response(file, {
          headers: {
            "X-Content-Type-Options": "nosniff",
            "Cache-Control":
              pathname === "/" ? "no-cache" : "public, max-age=3600",
          },
        });
      if (
        (req.method === "GET" || req.method === "HEAD") &&
        req.headers.get("accept")?.includes("text/html") &&
        !pathname.split("/").at(-1)?.includes(".")
      )
        return new Response(Bun.file(resolve(dist, "index.html")), {
          headers: {
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
          },
        });
    }
    return app.handle(req);
  },
});
console.log(
  `DedsiWork ${origin}\n数据库：${config.dbPath}\n本地配对与 MCP 凭据：${config.credentialsPath}`,
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await server.stop();
  await app.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
