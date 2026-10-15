import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../server/app";
import { openDatabase } from "../../server/db/database";

// Each app gets its own workspace registry and databases, never the source tree.
export function createTestApp(
  options: Omit<Parameters<typeof createApp>[0], "dbPath">,
  legacy = false,
) {
  const directory = mkdtempSync(join(tmpdir(), "dedsiwork-app-test-"));
  const dbPath = join(directory, "dedsiwork.sqlite");
  try {
    if (legacy) openDatabase(dbPath).close();
    const app = createApp({ ...options, dbPath });
    return {
      ...app,
      async close() {
        try {
          await app.close();
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
