import type { Database } from "bun:sqlite";
import {
  workflowLibrarySchema,
  type WorkflowLibrary,
} from "../../shared/ai-workflow";
import { AppError } from "../../shared/errors";
import type { Actor } from "./work-items";

export class AIWorkflows {
  constructor(private db: Database) {}
  get(): WorkflowLibrary {
    const row = this.db
      .query("SELECT version,workflows_json FROM ai_workflows WHERE id=1")
      .get() as { version: number; workflows_json: string } | null;
    return row
      ? { version: row.version, workflows: JSON.parse(row.workflows_json) }
      : { version: 0, workflows: [] };
  }
  save(input: unknown, actor: Actor): WorkflowLibrary {
    if (!actor.writable)
      throw new AppError("FORBIDDEN", "此凭据仅允许查询", 403);
    const request = workflowLibrarySchema.parse(input);
    return this.db
      .transaction(() => {
        const current = this.get();
        if (current.version !== request.expectedVersion)
          throw new AppError(
            "VERSION_CONFLICT",
            "模板已在其他页面更新，请重新打开模板库后重试",
            409,
          );
        const version = current.version + 1;
        this.db
          .query(
            "INSERT INTO ai_workflows(id,version,workflows_json) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,workflows_json=excluded.workflows_json",
          )
          .run(version, JSON.stringify(request.workflows));
        return { version, workflows: request.workflows };
      })
      .immediate();
  }
}
