import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { z } from "zod";
const credentialsSchema = z.object({
  pairingCode: z.string().min(16),
  readToken: z.string().min(32),
  writeToken: z.string().min(32),
});
export type Credentials = z.infer<typeof credentialsSchema>;
export function loadConfig(options: { production?: boolean } = {}) {
  const projectRoot = resolve(import.meta.dir, "..");
  const production =
    options.production ?? process.argv.includes("--production");
  const defaultData =
    production && process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "DedsiWork")
      : join(projectRoot, "data");
  const dataDir = resolve(process.env.DEDSIWORK_DATA_DIR || defaultData);
  const host = process.env.DEDSIWORK_HOST || "127.0.0.1";
  if (host !== "127.0.0.1")
    throw new Error("第一版仅支持 DEDSIWORK_HOST=127.0.0.1");
  const port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .parse(process.env.DEDSIWORK_PORT || "3210");
  mkdirSync(dataDir, { recursive: true });
  const credentialsPath = join(dataDir, "access.json");
  if (!existsSync(credentialsPath))
    writeFileSync(
      credentialsPath,
      JSON.stringify(
        {
          pairingCode: crypto.randomUUID(),
          readToken: crypto.randomUUID() + crypto.randomUUID(),
          writeToken: crypto.randomUUID() + crypto.randomUUID(),
        },
        null,
        2,
      ),
      { flag: "wx", mode: 0o600 },
    );
  const credentials = credentialsSchema.parse(
    JSON.parse(readFileSync(credentialsPath, "utf8")),
  );
  return {
    projectRoot,
    production,
    dataDir,
    dbPath: join(dataDir, "dedsiwork.sqlite"),
    credentialsPath,
    credentials,
    host,
    port,
  };
}
