import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "./description";

export const statuses = [
  "todo",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
] as const;
export const types = ["task", "bug", "feature"] as const;
export const priorities = ["low", "normal", "high", "urgent"] as const;
export const statusLabels = {
  todo: "待处理",
  in_progress: "进行中",
  blocked: "已阻塞",
  done: "已完成",
  cancelled: "已取消",
};
export const typeLabels = { task: "任务", bug: "缺陷", feature: "需求" };
export const priorityLabels = {
  low: "低",
  normal: "普通",
  high: "高",
  urgent: "紧急",
};

const fields = {
  title: z.string().trim().min(1, "请填写标题").max(200),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).default(""),
  type: z.enum(types).default("task"),
  status: z.enum(statuses).default("todo"),
  priority: z.enum(priorities).default("normal"),
  dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
};
export const createSchema = z.object(fields).strict();
export const patchSchema = z
  .object({
    title: fields.title.optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    type: z.enum(types).optional(),
    status: z.enum(statuses).optional(),
    priority: z.enum(priorities).optional(),
    dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const versionSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
export const listSchema = z
  .object({
    q: z.string().max(200).default(""),
    status: z.enum(statuses).optional(),
    type: z.enum(types).optional(),
    priority: z.enum(priorities).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    deleted: z.enum(["true", "false"]).default("false"),
  })
  .strict();
export const pageSchema = listSchema.pick({ page: true, pageSize: true });
export const idSchema = z.string().uuid();
export const purgeSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: idSchema,
            expectedVersion: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
        "不能重复选择工作项",
      ),
  })
  .strict();
export const requestKeySchema = z.string().min(1).max(128);
export type WorkItemInput = z.infer<typeof createSchema>;
export type WorkItem = WorkItemInput & {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
export type WorkItemEvent = {
  id: string;
  workItemId: string;
  action: string;
  changes: Record<string, { before: unknown; after: unknown }>;
  source: string;
  createdAt: string;
  requestId: string;
};
export type Page<T> = {
  data: T[];
  meta: { total: number; page: number; pageSize: number };
};
