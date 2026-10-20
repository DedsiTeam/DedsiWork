import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { z } from "zod";
import { AppError } from "../../shared/errors";
import { createSchema } from "../../shared/work-item";
import {
  remoteReadSchema,
  type PeerConnection,
  type RemoteRequirement,
} from "../../shared/remote-mcp";
import type { Actor } from "./work-items";
const entrySchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  url: z.string().max(2000),
  token: z.string().min(16).max(500),
  updatedAt: z.string(),
});
type Entry = z.infer<typeof entrySchema>;
function endpoint(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("INVALID_MCP_URL", "请填写完整 MCP 地址");
  }
  // Normalize previously saved/shared links to the workspace path.
  if (
    url.pathname === "/mcp" &&
    url.searchParams.getAll("workspace").length === 1 &&
    [...url.searchParams.keys()].every((key) => key === "workspace") &&
    z.uuid().safeParse(url.searchParams.get("workspace")).success
  ) {
    url.pathname = `/mcp/workspace/${url.searchParams.get("workspace")}`;
    url.search = "";
  }
  const workspace = /^\/mcp\/workspace\/([^/]+)$/.exec(url.pathname)?.[1];
  const p = url.hostname.split(".").map(Number);
  const privateIp =
    p.length === 4 &&
    p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (p[0] === 10 ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 172 && p[1]! >= 16 && p[1]! <= 31));
  if (
    !privateIp ||
    !["http:", "https:"].includes(url.protocol) ||
    !z.uuid().safeParse(workspace).success ||
    url.username ||
    url.password ||
    url.hash ||
    Boolean(url.search)
  )
    throw new AppError(
      "INVALID_MCP_URL",
      "请使用同事的局域网 IPv4 MCP 地址，格式为 /mcp/workspace/工作空间ID",
    );
  return url;
}
export class PeerConnections {
  private entries: Entry[];
  private path: string;
  constructor(directory: string) {
    this.path = join(directory, "colleague-mcp.json");
    this.entries = existsSync(this.path)
      ? z.array(entrySchema).parse(JSON.parse(readFileSync(this.path, "utf8")))
      : [];
  }
  list(): PeerConnection[] {
    return this.entries.map(({ token, ...entry }) => ({
      ...entry,
      url: endpoint(entry.url).href,
    }));
  }
  get(id: string) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry)
      throw new AppError(
        "PEER_NOT_FOUND",
        "同事连接不存在，请在服务与 MCP 中添加",
        404,
      );
    return entry;
  }
  private persist(entries: Entry[]) {
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, JSON.stringify(entries), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
    this.entries = entries;
  }
  save(input: unknown) {
    const data = z
      .object({
        id: z.uuid().optional(),
        name: z.string().trim().min(1).max(80),
        config: z.string().max(8000),
      })
      .strict()
      .parse(input);
    let config: any;
    try {
      config = JSON.parse(data.config);
    } catch {
      throw new AppError("INVALID_CONFIG", "请粘贴完整的只读 MCP JSON 配置");
    }
    const parsed = z
      .object({
        url: z.string(),
        transport: z.literal("streamable-http").optional(),
        headers: z.object({
          Authorization: z.string().regex(/^Bearer [^\s]+$/),
        }),
      })
      .parse(config);
    const url = endpoint(parsed.url).href;
    if (data.id) this.get(data.id);
    if (
      this.entries.some(
        (e) => e.id !== data.id && (e.name === data.name || e.url === url),
      )
    )
      throw new AppError(
        "DUPLICATE_PEER",
        "该同事名称或地址已存在，请编辑原连接",
        409,
      );
    const entry = entrySchema.parse({
      id: data.id || crypto.randomUUID(),
      name: data.name,
      url,
      token: parsed.headers.Authorization.slice(7),
      updatedAt: new Date().toISOString(),
    });
    this.persist([...this.entries.filter((e) => e.id !== entry.id), entry]);
    return this.list().find((e) => e.id === entry.id)!;
  }
  remove(id: string) {
    this.get(id);
    this.persist(this.entries.filter((e) => e.id !== id));
  }
  async call(id: string, itemId?: string) {
    const entry = this.get(id),
      url = endpoint(entry.url);
    const client = new Client(
      { name: "dedsiwork-colleague", version: "0.0.6" },
      { versionNegotiation: { mode: "auto" } },
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const safeFetch = async (
        input: Parameters<typeof fetch>[0],
        init?: RequestInit,
      ) => {
        const target = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (
          target.origin !== url.origin ||
          target.pathname !== url.pathname ||
          target.search !== url.search
        )
          throw new Error("Unexpected endpoint");
        const response = await fetch(input, {
          ...init,
          redirect: "error",
          signal: AbortSignal.any([
            controller.signal,
            ...(init?.signal ? [init.signal] : []),
          ]),
        });
        if (response.status === 401 || response.status === 403)
          throw new AppError(
            "MCP_AUTH",
            "连接被拒绝，请更新同事的只读配置",
            401,
          );
        let size = 0;
        const body = response.body?.pipeThrough(
          new TransformStream({
            transform(chunk, c) {
              size += chunk.byteLength;
              if (size > 8 * 1024 * 1024) throw new Error("Response too large");
              c.enqueue(chunk);
            },
          }),
        );
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      };
      await client.connect(
        new StreamableHTTPClientTransport(url, {
          fetch: safeFetch,
          requestInit: { headers: { Authorization: `Bearer ${entry.token}` } },
        }),
      );
      if (client.getServerVersion()?.name !== "dedsiwork")
        throw new AppError("MCP_UNSUPPORTED", "目前仅支持同事的 DedsiWork MCP");
      if (!itemId) {
        const tools = await client.listTools();
        if (!tools.tools.some((t) => t.name === "work_item_get"))
          throw new AppError("MCP_UNSUPPORTED", "对方未提供读取工作项工具");
        return null;
      }
      const result = await client.callTool({
        name: "work_item_get",
        arguments: { id: z.uuid().parse(itemId) },
      });
      if (result.isError)
        throw new AppError(
          "REMOTE_ITEM_UNAVAILABLE",
          "工作项无法读取，请核对 ID、工作空间及是否已删除",
          404,
        );
      const raw =
        result.structuredContent ||
        JSON.parse(
          (result.content.find((c) => c.type === "text") as { text: string })
            ?.text || "null",
        );
      const item = createSchema
        .extend({
          id: z.uuid(),
          version: z.number().int().positive(),
          createdAt: z.string(),
          updatedAt: z.string(),
          deletedAt: z.string().nullable(),
        })
        .parse((raw as any)?.result || raw);
      if (item.id !== itemId || item.deletedAt)
        throw new AppError(
          "REMOTE_ITEM_UNAVAILABLE",
          "远程工作项不匹配或已删除",
          404,
        );
      return item;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "MCP_CONNECTION_FAILED",
        "无法读取同事 MCP：请检查客户端是否运行、网络及端口是否可达，或配置和返回格式是否正确",
        502,
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
      await client.close().catch(() => {});
    }
  }
}
export class RemoteRequirements {
  constructor(
    private db: Database,
    private peers: PeerConnections,
    private directory: string,
  ) {
    db.run(
      "CREATE TABLE IF NOT EXISTS remote_requirements(id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL)",
    );
  }
  get(id: string, owner: string): RemoteRequirement {
    const row = this.db
      .query("SELECT state FROM remote_requirements WHERE id=? AND owner=?")
      .get(z.uuid().parse(id), owner) as { state: string } | null;
    if (!row)
      throw new AppError(
        "REMOTE_SNAPSHOT_NOT_FOUND",
        "需求快照不存在，请让 Agent 重新读取",
        404,
      );
    return JSON.parse(row.state);
  }
  existing(snapshot: RemoteRequirement, owner: string) {
    return (
      this.db
        .query(
          "SELECT state FROM development_tasks WHERE owner=? AND json_extract(state,'$.remoteSource.connectionId')=? AND json_extract(state,'$.remoteSource.workspaceId')=? AND json_extract(state,'$.remoteSource.item.id')=? ORDER BY updated_at DESC LIMIT 12",
        )
        .all(
          owner,
          snapshot.connectionId,
          snapshot.workspaceId,
          snapshot.item.id,
        ) as { state: string }[]
    ).map(({ state }) => {
      const task = JSON.parse(state);
      return { id: task.id, title: task.title, status: task.status };
    });
  }
  async read(input: unknown, owner: string) {
    const { connectionId, itemId } = remoteReadSchema.parse(input);
    const peer = this.peers.get(connectionId);
    const item = (await this.peers.call(connectionId, itemId))!;
    const snapshot: RemoteRequirement = {
      id: crypto.randomUUID(),
      connectionId,
      connectionName: peer.name,
      workspaceId: endpoint(peer.url).pathname.split("/").at(-1)!,
      item,
      readAt: new Date().toISOString(),
    };
    this.db
      .query("INSERT INTO remote_requirements VALUES(?,?,?)")
      .run(snapshot.id, owner, JSON.stringify(snapshot));
    return snapshot;
  }
  async tool(name: string, input: unknown, actor: Actor) {
    if (!actor.writable)
      throw new AppError("FORBIDDEN", "需要本机操作权限", 403);
    if (name === "dedsiwork_colleagues")
      return this.peers.list().map(({ id, name }) => ({ id, name }));
    if (name !== "dedsiwork_read_colleague_item")
      throw new AppError("UNKNOWN_TOOL", "不支持的工具");
    const snapshot = await this.read(input, actor.identity);
    const dir = join(this.directory, "remote-requirements");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, snapshot.id + ".json");
    writeFileSync(path, JSON.stringify(snapshot), { mode: 0o600 });
    return {
      existingTasks: this.existing(snapshot, actor.identity),
      snapshotId: snapshot.id,
      connectionName: snapshot.connectionName,
      title: snapshot.item.title,
      version: snapshot.item.version,
      path,
      instruction:
        "读取完整需求文件后概述，输出 remote_development 卡片供用户预览；不创建或启动任务。",
    };
  }
}
