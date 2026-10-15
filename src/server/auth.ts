import { timingSafeEqual } from "node:crypto";
import { AppError } from "../shared/errors";
import type { Credentials } from "./config";
import type { Actor } from "./services/work-items";
const same = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export class Auth {
  private sessions = new Map<string, { csrf: string; expires: number }>();
  private attempts: number[] = [];
  constructor(private credentials: Credentials) {}
  pair(code: string) {
    this.attempts = this.attempts.filter((t) => t > Date.now() - 60000);
    if (this.attempts.length >= 10)
      throw new AppError("RATE_LIMIT", "尝试过于频繁，请一分钟后重试", 429);
    this.attempts.push(Date.now());
    if (!same(code, this.credentials.pairingCode))
      throw new AppError("INVALID_PAIRING", "配对码不正确", 401);
    return this.createSession();
  }
  private createSession() {
    for (const [id, s] of this.sessions)
      if (s.expires < Date.now()) this.sessions.delete(id);
    if (this.sessions.size >= 100)
      this.sessions.delete(this.sessions.keys().next().value!);
    const id = crypto.randomUUID(),
      csrf = crypto.randomUUID();
    this.sessions.set(id, { csrf, expires: Date.now() + 86400000 });
    return {
      csrf,
      cookie: `dedsiwork_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
    };
  }
  private session(req: Request) {
    const id = /(?:^|;\s*)dedsiwork_session=([^;]+)/.exec(
      req.headers.get("cookie") || "",
    )?.[1];
    const session = id ? this.sessions.get(id) : undefined;
    if (!session || session.expires < Date.now())
      throw new AppError("UNAUTHORIZED", "请先连接本地工作空间", 401);
    return session;
  }
  csrf(req: Request) {
    return this.session(req).csrf;
  }
  connect(req: Request) {
    try {
      return { csrf: this.csrf(req) };
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "UNAUTHORIZED")
        throw error;
      return this.createSession();
    }
  }
  actor(req: Request, requestId: string, mcpOnly = false): Actor {
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
    if (token && same(token, this.credentials.writeToken))
      return {
        source: "mcp",
        identity: "mcp-write",
        writable: true,
        requestId,
      };
    if (token && same(token, this.credentials.readToken))
      return {
        source: "mcp",
        identity: "mcp-read",
        writable: false,
        requestId,
      };
    if (token || mcpOnly)
      throw new AppError("UNAUTHORIZED", "MCP 凭据无效或缺失", 401);
    const session = this.session(req);
    if (
      !["GET", "HEAD"].includes(req.method) &&
      !same(req.headers.get("x-csrf-token") || "", session.csrf)
    )
      throw new AppError("CSRF", "页面会话已失效，请刷新后重试", 403);
    return { source: "web", identity: "local-user", writable: true, requestId };
  }
}
