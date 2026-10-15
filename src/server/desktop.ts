import index from "../web/index.html";
import { loadConfig } from "./config";
import { createApp } from "./app";
import { MAX_REQUEST_BODY_SIZE } from "../shared/description";
import { timingSafeEqual } from "node:crypto";

// Compiled as a standalone Bun executable. The React assets are embedded.
const config = loadConfig({ production: true });
const origin = `http://${config.host}:${config.port}`;
const bootstrapToken = process.env.DEDSIWORK_DESKTOP_TOKEN;
if (!bootstrapToken || bootstrapToken.length < 32)
  throw new Error("Missing desktop launch token");
delete process.env.DEDSIWORK_DESKTOP_TOKEN;
const app = createApp({ ...config, origin });
// Warm up the private App Server automatically. The AI page surfaces failures
// and retries startup without preventing the rest of the workspace from opening.
void app.startAI().catch(() => {});
let bootstrapUsed = false;
const bootstrapExpires = Date.now() + 60_000;
let closing = false;

async function handle(req: Request) {
  const url = new URL(req.url);
  if (url.pathname === "/desktop/start") {
    const token = url.searchParams.get("token") || "";
    const expected = Buffer.from(bootstrapToken!);
    const actual = Buffer.from(token);
    if (
      req.method !== "GET" ||
      url.origin !== origin ||
      (req.headers.get("host") || url.host) !== new URL(origin).host ||
      (req.headers.get("origin") && req.headers.get("origin") !== origin) ||
      bootstrapUsed ||
      Date.now() > bootstrapExpires ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      return new Response("Desktop session expired or invalid", {
        status: 403,
      });
    bootstrapUsed = true;
    const paired = await app.handle(
      new Request(`${origin}/auth/pair`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ code: config.credentials.pairingCode }),
      }),
    );
    if (!paired.ok) return paired;
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/workspaces",
        "Set-Cookie": paired.headers.get("set-cookie")!,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  return app.handle(req);
}

let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({
    hostname: config.host,
    port: config.port,
    development: false,
    maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
    routes: {
      "/*": index,
      "/api": handle,
      "/api/*": handle,
      "/auth": handle,
      "/auth/*": handle,
      "/mcp": handle,
      "/mcp/*": handle,
      "/healthz": handle,
      "/healthz/*": handle,
      "/desktop/start": handle,
    },
    fetch: handle,
  });
} catch (error) {
  await app.close();
  console.error(
    `无法启动本地服务，端口 ${config.port} 可能已被占用。请先停止原有 bun run dev 服务。`,
    error,
  );
  process.exit(1);
}

async function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 2500);
  deadline.unref();
  await server.stop(true);
  await app.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// The private stdin pipe is owned by Tauri. EOF also handles a crashed parent.
void (async () => {
  let pending = "";
  for await (const chunk of Bun.stdin.stream()) {
    pending += new TextDecoder().decode(chunk);
    if (pending.includes("\n")) {
      for (const line of pending.split("\n").slice(0, -1))
        if (line.trim() === "shutdown") await shutdown();
      pending = pending.slice(pending.lastIndexOf("\n") + 1);
    }
    if (pending.length > 4096) await shutdown();
  }
  await shutdown();
})();
// No credentials or bootstrap token are written to logs.
console.log(JSON.stringify({ event: "ready", origin, pid: process.pid }));
