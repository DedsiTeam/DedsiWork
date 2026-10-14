import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { resolve } from "node:path";
const dataDir = resolve(
  process.env.DEDSIWORK_DATA_DIR || resolve(import.meta.dir, "../data"),
);
const credentials = await Bun.file(resolve(dataDir, "access.json")).json();
const port = process.env.DEDSIWORK_PORT || "3210";
const client = new Client(
  { name: "dedsiwork-example", version: "0.1.0" },
  { versionNegotiation: { mode: "auto" } },
);
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: {
        headers: { Authorization: `Bearer ${credentials.readToken}` },
      },
    }),
  );
  console.log(
    "Tools:",
    (await client.listTools()).tools.map((tool) => tool.name),
  );
  const result = await client.callTool({
    name: "work_item_list",
    arguments: { pageSize: 5 },
  });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  console.log(JSON.stringify(result.structuredContent, null, 2));
} finally {
  await client.close();
}
