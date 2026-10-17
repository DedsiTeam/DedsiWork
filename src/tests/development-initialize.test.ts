import { test, expect } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db/database";
import { DevelopmentTasks } from "../server/services/development-tasks";
import { WorkItemService, type Actor } from "../server/services/work-items";
import { WorkItemRepository } from "../server/repositories/work-items";
import { DomainModelService } from "../server/services/domain-models";
test("empty selected directory can initialize locally, existing files and read-only actors are protected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dedsiwork-init-")),
    repo = join(dir, "project");
  mkdirSync(repo);
  const db = openDatabase(join(dir, "data.sqlite"));
  const service = new DevelopmentTasks(
    db,
    dir,
    new WorkItemService(new WorkItemRepository(db)),
    new DomainModelService(db),
    join(dir, "trees"),
    () => repo,
  );
  const actor: Actor = {
    source: "web",
    identity: "init-test",
    writable: true,
    requestId: "init-test",
  };
  try {
    await expect(service.selectDirectory(actor)).rejects.toThrow("尚未初始化");
    await expect(
      service.initializeRepository({ ...actor, writable: false }),
    ).rejects.toThrow("写入权限");
    writeFileSync(join(repo, "keep.txt"), "user content");
    await expect(service.initializeRepository(actor)).rejects.toThrow(
      "已有文件",
    );
    expect(existsSync(join(repo, ".git"))).toBe(false);
    rmSync(join(repo, "keep.txt"));
    const result = await service.initializeRepository(actor);
    expect(result.currentBranch).toBe("main");
    expect(result.branches).toEqual(["main"]);
    expect(existsSync(join(repo, ".git"))).toBe(true);
    const again = await service.initializeRepository(actor);
    expect(again.currentBranch).toBe("main");
  } finally {
    await service.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
