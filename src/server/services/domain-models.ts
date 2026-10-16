import { PAGE_SIZE } from "../../shared/pagination";
import { z } from "zod";
import type { Database } from "bun:sqlite";
import { AppError } from "../../shared/errors";
import {
  domainModelInputSchema,
  domainModelUpdateSchema,
  type DomainModel,
  type DomainElement,
  type DomainModelList,
} from "../../shared/domain-model";
import type { Actor } from "./work-items";

type Row = {
  id: string;
  name: string;
  description: string;
  elements: string;
  version: number;
  created_at: string;
  updated_at: string;
};
const map = (row: Row): DomainModel => ({
  id: row.id,
  name: row.name,
  description: row.description,
  elements: JSON.parse(row.elements) as DomainElement[],
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
export class DomainModelService {
  constructor(private db: Database) {}
  private writeAccess(actor: Actor) {
    if (!actor.writable)
      throw new AppError("FORBIDDEN", "此凭据仅允许查询", 403);
  }
  get(id: string) {
    z.uuid().parse(id);
    const row = this.db
      .query("SELECT * FROM domain_models WHERE id=? AND deleted_at IS NULL")
      .get(id) as Row | null;
    if (!row) throw new AppError("NOT_FOUND", "领域模型不存在或已删除", 404);
    return map(row);
  }
  list(input: unknown): DomainModelList {
    const query = z
      .object({
        q: z.string().trim().max(200).default(""),
        page: z.coerce.number().int().positive().max(1000000).default(1),
      })
      .parse(input);
    const where =
      "deleted_at IS NULL AND (instr(lower(name),lower(?))>0 OR instr(lower(description),lower(?))>0)";
    const total = (
      this.db
        .query(`SELECT COUNT(*) AS total FROM domain_models WHERE ${where}`)
        .get(query.q, query.q) as { total: number }
    ).total;
    const rows = this.db
      .query(
        `SELECT *, json_array_length(elements) AS element_count FROM domain_models WHERE ${where} ORDER BY updated_at DESC, id DESC LIMIT ${PAGE_SIZE} OFFSET ?`,
      )
      .all(query.q, query.q, (query.page - 1) * PAGE_SIZE) as (Row & {
      element_count: number;
    })[];
    return {
      data: rows.map((row) => {
        const model = map(row);
        return {
          id: model.id,
          name: model.name,
          description: model.description,
          version: model.version,
          createdAt: model.createdAt,
          updatedAt: model.updatedAt,
          elementCount: row.element_count,
          fieldCount: model.elements.reduce(
            (sum, element) => sum + element.fields.length,
            0,
          ),
        };
      }),
      meta: { total, page: query.page, pageSize: PAGE_SIZE },
    };
  }
  create(input: unknown, actor: Actor) {
    this.writeAccess(actor);
    const model = domainModelInputSchema.parse(input);
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    this.db
      .query(
        "INSERT INTO domain_models (id,name,description,elements,version,created_at,updated_at) VALUES (?,?,?,?,1,?,?)",
      )
      .run(
        id,
        model.name,
        model.description,
        JSON.stringify(model.elements),
        now,
        now,
      );
    return this.get(id);
  }
  update(id: string, input: unknown, actor: Actor) {
    this.writeAccess(actor);
    z.uuid().parse(id);
    const { model, expectedVersion } = domainModelUpdateSchema.parse(input);
    return this.db
      .transaction(() => {
        const current = this.get(id);
        if (current.version !== expectedVersion)
          throw new AppError(
            "VERSION_CONFLICT",
            "模型已在其他页面更新，请保留当前输入并重新打开最新版本",
            409,
          );
        this.db
          .query(
            "UPDATE domain_models SET name=?,description=?,elements=?,version=version+1,updated_at=? WHERE id=? AND version=? AND deleted_at IS NULL",
          )
          .run(
            model.name,
            model.description,
            JSON.stringify(model.elements),
            new Date().toISOString(),
            id,
            expectedVersion,
          );
        return this.get(id);
      })
      .immediate();
  }
  remove(id: string, expectedVersion: number, actor: Actor) {
    this.writeAccess(actor);
    z.number().int().positive().parse(expectedVersion);
    this.db
      .transaction(() => {
        const current = this.get(id);
        if (current.version !== expectedVersion)
          throw new AppError(
            "VERSION_CONFLICT",
            "模型已更新，请刷新列表后再删除",
            409,
          );
        const now = new Date().toISOString();
        this.db
          .query(
            "UPDATE domain_models SET deleted_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NULL",
          )
          .run(now, now, id, expectedVersion);
      })
      .immediate();
    return { id };
  }
}
