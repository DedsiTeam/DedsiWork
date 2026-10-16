import { PAGE_SIZE } from "./pagination";
import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "./description";

export const statuses = [
  "todo",
  "in_progress",
  "in_review",
  "in_verification",
  "awaiting_acceptance",
  "paused",
  "done",
  "cancelled",
] as const;
export const types = ["task", "bug", "feature"] as const;
export const priorities = ["low", "normal", "high", "urgent"] as const;
export const statusLabels = {
  todo: "待处理",
  in_progress: "进行中",
  in_review: "待评审",
  in_verification: "待验证",
  awaiting_acceptance: "待验收",
  paused: "已暂停",
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
  blockedReason: z.string().trim().max(1000).default(""),
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
    blockedReason: z.string().trim().max(1000).optional(),
    transitionReason: z.string().trim().max(1000).optional(),
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
    blocked: z.enum(["true", "false"]).optional(),
    type: z.enum(types).optional(),
    priority: z.enum(priorities).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(PAGE_SIZE),
    unplanned: z.enum(["true", "false"]).default("false"),
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

export const flowStatuses = [
  "todo",
  "in_progress",
  "in_review",
  "in_verification",
  "awaiting_acceptance",
  "paused",
  "done",
] as const;
export function needsReturnReason(
  from: WorkItem["status"],
  to: WorkItem["status"],
) {
  return (
    ["in_review", "in_verification", "awaiting_acceptance"].includes(from) &&
    to === "in_progress"
  );
}
export function normalizeHistoricalItem(item: WorkItem): WorkItem {
  const legacy = (item.status as string) === "blocked";
  return {
    ...item,
    status: legacy ? "in_progress" : item.status,
    blockedReason:
      item.blockedReason || (legacy ? "历史阻塞工作项（原阶段未记录）" : ""),
  };
}
