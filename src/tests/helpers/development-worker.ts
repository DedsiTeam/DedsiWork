import { openDatabase } from "../../server/db/database";
import { WorkItemRepository } from "../../server/repositories/work-items";
import { WorkItemService } from "../../server/services/work-items";
import { DomainModelService } from "../../server/services/domain-models";
import { DevelopmentTasks } from "../../server/services/development-tasks";
import { join } from "node:path";
const dir = process.env.DEVELOPMENT_WORKER_DIR!;
const db = openDatabase(join(dir, "worker.sqlite"));
const service = new DevelopmentTasks(
  db,
  dir,
  new WorkItemService(new WorkItemRepository(db)),
  new DomainModelService(db),
  join(dir, "trees"),
);
await service.start(process.env.DEVELOPMENT_TASK_ID!, {
  source: "web",
  identity: "local-user",
  writable: true,
  requestId: "crash-worker",
});
console.log("started");
