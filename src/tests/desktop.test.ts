import { expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const binarySuffix =
  process.platform === "darwin"
    ? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`
    : "x86_64-pc-windows-msvc.exe";
const binary = resolve(
  import.meta.dir,
  `../src-tauri/binaries/dedsiwork-service-${binarySuffix}`,
);
const root = resolve(import.meta.dir, "../.qa");
mkdirSync(root, { recursive: true });
const desktopTest = existsSync(binary) ? test : test.skip;
function freePort() {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("reserved"),
  });
  const port = server.port!;
  server.stop(true);
  return port;
}
async function launch(port: number, directory: string) {
  const token = crypto.randomUUID();
  const child = Bun.spawn([binary], {
    env: {
      ...process.env,
      DEDSIWORK_PORT: String(port),
      DEDSIWORK_DATA_DIR: directory,
      DEDSIWORK_DESKTOP_TOKEN: token,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  let output = "";
  const ready = (async () => {
    while (true) {
      const result = await reader.read();
      if (result.done) throw new Error("Sidecar exited before readiness");
      output += new TextDecoder().decode(result.value);
      if (output.includes('"event":"ready"')) return;
    }
  })();
  try {
    await Promise.race([
      ready,
      Bun.sleep(15000).then(() => {
        throw new Error("Sidecar startup timeout");
      }),
    ]);
  } catch (error) {
    child.kill();
    await child.exited;
    throw error;
  }
  return { child, token, origin: `http://127.0.0.1:${port}` };
}

desktopTest(
  "compiled desktop service embeds web, pairs once, serves API/MCP and stops gracefully",
  async () => {
    const folder = mkdtempSync(resolve(root, "desktop-"));
    const { child, token, origin } = await launch(freePort(), folder);
    try {
      expect((await fetch(`${origin}/healthz`)).status).toBe(200);
      const page = await (await fetch(`${origin}/work-items/new`)).text();
      expect(page).toContain('id="root"');
      const script = page.match(/src="([^"]+\.js)"/);
      expect(script).not.toBeNull();
      expect((await fetch(new URL(script![1]!, origin))).status).toBe(200);
      expect((await fetch(`${origin}/api/v1/work-items`)).status).toBe(401);
      expect(
        (await fetch(`${origin}/desktop/start?token=invalid`)).status,
      ).toBe(403);
      const paired = await fetch(`${origin}/desktop/start?token=${token}`, {
        redirect: "manual",
      });
      expect(paired.status).toBe(303);
      expect(paired.headers.get("location")).toBe("/workspaces");
      const cookie = paired.headers.get("set-cookie")!.split(";")[0]!;
      expect(
        (await fetch(`${origin}/auth/session`, { headers: { Cookie: cookie } }))
          .status,
      ).toBe(200);
      expect(
        (await fetch(`${origin}/desktop/start?token=${token}`)).status,
      ).toBe(403);
      const credentials = JSON.parse(
        readFileSync(resolve(folder, "access.json"), "utf8"),
      );
      const created = await fetch(`${origin}/api/v1/workspaces`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.writeToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Desktop smoke test" }),
      });
      expect(created.status).toBe(201);
      const workspace = (await created.json()).data;
      const mcp = new Client({ name: "desktop-smoke", version: "1" });
      try {
        await mcp.connect(
          new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
            requestInit: {
              headers: {
                Authorization: `Bearer ${credentials.readToken}`,
                "X-Workspace-Id": workspace.id,
              },
            },
          }),
        );
        expect((await mcp.listTools()).tools.length).toBe(18);
      } finally {
        await mcp.close();
      }
      child.stdin.write("shutdown\n");
      await child.stdin.flush();
      expect(await child.exited).toBe(0);
      expect(
        existsSync(
          resolve(folder, "workspaces", workspace.id, "dedsiwork.sqlite"),
        ),
      ).toBe(true);
      await expect(fetch(`${origin}/healthz`)).rejects.toThrow();
    } finally {
      child.kill();
      await child.exited;
      if (resolve(folder).startsWith(root + sep))
        rmSync(folder, { recursive: true, force: true });
    }
  },
  25000,
);

desktopTest(
  "desktop service exits when its parent pipe closes",
  async () => {
    const folder = mkdtempSync(resolve(root, "desktop-eof-"));
    const { child } = await launch(freePort(), folder);
    try {
      child.stdin.end();
      expect(await child.exited).toBe(0);
    } finally {
      child.kill();
      await child.exited;
      if (resolve(folder).startsWith(root + sep))
        rmSync(folder, { recursive: true, force: true });
    }
  },
  20000,
);

desktopTest(
  "occupied port fails without attaching to or terminating an existing service",
  async () => {
    const existing = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("existing"),
    });
    const folder = mkdtempSync(resolve(root, "desktop-port-"));
    try {
      await expect(launch(existing.port!, folder)).rejects.toThrow(
        "before readiness",
      );
      expect(
        await (await fetch(`http://127.0.0.1:${existing.port}/`)).text(),
      ).toBe("existing");
    } finally {
      existing.stop(true);
      if (resolve(folder).startsWith(root + sep))
        rmSync(folder, { recursive: true, force: true });
    }
  },
  20000,
);
