import { z } from "zod";
import { idSchema, versionSchema, statuses, createSchema } from "./work-item";
import type { WorkItem } from "./work-item";
export const sprintLabels = {
  planned: "计划中",
  active: "进行中",
  closed: "已结束",
};
export const sprintSchema = z
  .object({
    name: z.string().trim().min(1, "请填写冲刺名称").max(100),
    goal: z.string().trim().max(1000).default(""),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
  })
  .strict()
  .refine((v) => v.endDate >= v.startDate, "结束日期不能早于开始日期");
export const sprintUpdateSchema = z
  .object({
    expectedVersion: versionSchema.shape.expectedVersion,
    sprint: sprintSchema,
  })
  .strict();
export const sprintItemsSchema = versionSchema
  .extend({
    items: z
      .array(
        z
          .object({
            id: idSchema,
            expectedVersion: versionSchema.shape.expectedVersion,
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(
        (v) => new Set(v.map((x) => x.id)).size === v.length,
        "不能重复选择工作项",
      ),
  })
  .strict();
export const sprintMoveSchema = versionSchema
  .extend({
    itemId: idSchema,
    itemVersion: versionSchema.shape.expectedVersion,
    status: z.enum(statuses),
    reason: z.string().trim().max(1000).optional(),
    beforeId: idSchema.nullable().default(null),
  })
  .strict();
export const sprintFinishSchema = versionSchema
  .extend({
    targetSprintId: idSchema.nullable().default(null),
    targetVersion: versionSchema.shape.expectedVersion.optional(),
  })
  .strict();
export const sprintCreateItemSchema = versionSchema
  .extend({
    item: createSchema,
    status: z.enum(statuses).default("todo"),
    requestKey: z.string().min(1).max(128),
  })
  .strict();
export type Sprint = z.infer<typeof sprintSchema> & {
  id: string;
  state: keyof typeof sprintLabels;
  version: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};
export type SprintBoard = {
  sprint: Sprint;
  items: WorkItem[];
  events: {
    id: string;
    action: string;
    source: string;
    createdAt: string;
    details: unknown;
  }[];
};

export const sprintDeleteSchema = versionSchema
  .extend({ confirmed: z.literal(true) })
  .strict();
