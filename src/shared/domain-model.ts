import { z } from "zod";

export const elementLabels = {
  aggregate_root: "聚合根",
  entity: "实体",
  value_object: "值对象",
  domain_event: "领域事件",
  event_handler: "领域事件处理器",
} as const;
export type ElementKind = keyof typeof elementLabels;
export const elementKinds = Object.keys(elementLabels) as ElementKind[];
const name = z
  .string()
  .trim()
  .min(1, "名称不能为空")
  .max(100, "名称最多 100 个字符");
export const domainFieldSchema = z
  .object({
    id: z.uuid(),
    name,
    dataType: z.string().trim().min(1, "数据类型不能为空").max(100),
    description: z.string().trim().min(1, "字段说明不能为空").max(2000),
  })
  .strict();
export const domainElementSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(elementKinds),
    name,
    description: z.string().trim().max(5000),
    fields: z.array(domainFieldSchema).max(100),
    eventId: z.uuid().nullable().optional(),
  })
  .strict();
export const domainModelInputSchema = z
  .object({
    name,
    description: z.string().trim().max(5000),
    elements: z.array(domainElementSchema).max(100),
  })
  .strict()
  .superRefine((model, ctx) => {
    const aggregateRoots = model.elements
      .map((element, index) => ({ element, index }))
      .filter(({ element }) => element.kind === "aggregate_root");
    if (aggregateRoots.length !== 1)
      ctx.addIssue({
        code: "custom",
        path:
          aggregateRoots.length > 1
            ? ["elements", aggregateRoots[1]!.index, "kind"]
            : ["elements"],
        message:
          aggregateRoots.length === 0
            ? "每个模型必须有一个聚合根"
            : "一个模型只能有一个聚合根",
      });
    const elements = new Set<string>();
    const ids = new Set<string>();
    model.elements.forEach((element, index) => {
      const key = `${element.kind}:${element.name.toLowerCase()}`;
      if (elements.has(key) || ids.has(element.id))
        ctx.addIssue({
          code: "custom",
          path: ["elements", index, "name"],
          message: "同类设计项名称不能重复",
        });
      elements.add(key);
      ids.add(element.id);
      const fields = new Set<string>();
      const fieldIds = new Set<string>();
      element.fields.forEach((field, fieldIndex) => {
        const key = field.name.toLowerCase();
        if (fields.has(key) || fieldIds.has(field.id))
          ctx.addIssue({
            code: "custom",
            path: ["elements", index, "fields", fieldIndex, "name"],
            message: "同一设计项内的字段名称不能重复",
          });
        fields.add(key);
        fieldIds.add(field.id);
      });
    });
    const events = new Map(
      model.elements
        .filter((element) => element.kind === "domain_event")
        .map((element) => [element.id, element]),
    );
    const assigned = new Set<string>();
    model.elements.forEach((element, index) => {
      if (element.kind !== "event_handler") {
        if (element.eventId)
          ctx.addIssue({
            code: "custom",
            path: ["elements", index, "eventId"],
            message: "只有领域事件处理器可以关联领域事件",
          });
        return;
      }
      if (!element.eventId || !events.has(element.eventId)) {
        ctx.addIssue({
          code: "custom",
          path: ["elements", index, "eventId"],
          message: `请为处理器“${element.name}”选择当前模型中的领域事件`,
        });
        return;
      }
      if (assigned.has(element.eventId))
        ctx.addIssue({
          code: "custom",
          path: ["elements", index, "eventId"],
          message: `领域事件“${events.get(element.eventId)!.name}”只能关联一个处理器`,
        });
      assigned.add(element.eventId);
    });
    model.elements.forEach((element, index) => {
      if (element.kind === "domain_event" && !assigned.has(element.id))
        ctx.addIssue({
          code: "custom",
          path: ["elements", index],
          message: `请为领域事件“${element.name}”添加一个对应的处理器`,
        });
    });
  });
export const domainModelUpdateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    model: domainModelInputSchema,
  })
  .strict();
export type DomainField = z.infer<typeof domainFieldSchema>;
export type DomainElement = z.infer<typeof domainElementSchema>;
export type DomainModelInput = z.infer<typeof domainModelInputSchema>;
export type DomainModel = DomainModelInput & {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type DomainModelSummary = Omit<DomainModel, "elements"> & {
  elementCount: number;
  fieldCount: number;
};
export type DomainModelList = {
  data: DomainModelSummary[];
  meta: { total: number; page: number; pageSize: number };
};
