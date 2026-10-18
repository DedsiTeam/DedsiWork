import { AppError } from "../../shared/errors";
import { networkInterfaces } from "node:os";
import { timingSafeEqual } from "node:crypto";
import { MAX_REQUEST_BODY_SIZE } from "../../shared/description";

function privateAddress(address: string) {
  const parts = address.split(".").map(Number);
  return (
    parts.length === 4 &&
    parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (parts[0] === 10 ||
      (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
      (parts[0] === 192 && parts[1] === 168))
  );
}
function addresses() {
  return [
    ...new Set(
      Object.values(networkInterfaces()).flatMap((items) =>
        (items || [])
          .filter(
            (item) =>
              !item.internal &&
              item.family === "IPv4" &&
              privateAddress(item.address),
          )
          .map((item) => item.address),
      ),
    ),
  ];
}

// A separate listener exposes only authenticated, read-only MCP. The local
// browser session, credential settings and desktop bootstrap stay on loopback.
export class LanMcp {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private error = "";
  private enabled = false;
  constructor(
    private options: {
      origin: string;
      readToken: string;
      port: number;
      handle: (req: Request) => Promise<Response>;
    },
  ) {}
  status(workspace: string) {
    return {
      enabled: this.enabled,
      running: this.server !== null,
      port: this.options.port,
      error: this.error,
      urls: this.server
        ? addresses().map(
            (ip) =>
              `http://${ip}:${this.options.port}/mcp/workspace/${encodeURIComponent(workspace)}`,
          )
        : [],
    };
  }
  private start() {
    if (this.server) return;
    this.server = Bun.serve({
      hostname: "0.0.0.0",
      port: this.options.port,
      development: false,
      maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
      fetch: (req, server) => {
        const url = new URL(req.url);
        const peer = server.requestIP(req)?.address || "";
        const host = req.headers.get("host") || url.host;
        if (!privateAddress(peer) && peer !== "127.0.0.1")
          return new Response("Forbidden", { status: 403 });
        if (
          !addresses().some((ip) => host === `${ip}:${this.options.port}`) &&
          host !== `127.0.0.1:${this.options.port}`
        )
          return new Response("Invalid host", { status: 403 });
        if (
          req.headers.has("origin") ||
          req.headers.get("sec-fetch-site") === "cross-site"
        )
          return new Response("Browser access is not allowed", { status: 403 });
        if (
          url.pathname !== "/mcp" &&
          !/^\/mcp\/workspace\/[^/]+$/.test(url.pathname)
        )
          return new Response("Not found", { status: 404 });
        const actual = Buffer.from(req.headers.get("authorization") || "");
        const expected = Buffer.from(`Bearer ${this.options.readToken}`);
        if (
          actual.length !== expected.length ||
          !timingSafeEqual(actual, expected)
        )
          return new Response("Read-only MCP token required", { status: 401 });
        // Forward to the existing MCP authentication and workspace routing.
        const headers = new Headers(req.headers);
        headers.set("host", new URL(this.options.origin).host);
        headers.delete("cookie");
        return this.options.handle(
          new Request(`${this.options.origin}${url.pathname}${url.search}`, {
            method: req.method,
            headers,
            ...(!["GET", "HEAD"].includes(req.method)
              ? { body: req.body }
              : {}),
            signal: req.signal,
          }),
        );
      },
    });
  }
  async setEnabled(enabled: boolean) {
    if (enabled) {
      try {
        this.start();
      } catch {
        throw new AppError(
          "LAN_START_FAILED",
          `无法开启局域网 MCP，请检查端口 ${this.options.port} 是否已被占用`,
          409,
        );
      }
    }
    if (!enabled) await this.close();
    this.enabled = enabled;
    this.error = "";
  }
  async close() {
    const server = this.server;
    this.server = null;
    if (server) await server.stop(true);
  }
}
