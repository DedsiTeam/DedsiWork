import { z } from "zod";
import { bookmarkSchema } from "./bookmarks";
import {
  sprintSchema,
  sprintUpdateSchema,
  sprintItemsSchema,
  sprintMoveSchema,
  sprintFinishSchema,
} from "./sprint";
const version = z.number().int().nonnegative();
const sprintRef = {
  id: z.uuid(),
  expectedVersion: z.number().int().positive(),
};
const bookmarkFields = bookmarkSchema.omit({ id: true });
export const businessOperationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("bookmark_group_create"),
      expectedVersion: version,
      title: z.string().trim().min(1).max(80),
    })
    .strict(),
  z
    .object({
      action: z.literal("bookmark_group_update"),
      expectedVersion: version,
      groupId: z.uuid(),
      title: z.string().trim().min(1).max(80),
    })
    .strict(),
  z
    .object({
      action: z.literal("bookmark_group_delete"),
      expectedVersion: version,
      groupId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("bookmark_create"),
      expectedVersion: version,
      groupId: z.uuid(),
      bookmark: bookmarkFields,
    })
    .strict(),
  z
    .object({
      action: z.literal("bookmark_update"),
      expectedVersion: version,
      groupId: z.uuid(),
      id: z.uuid(),
      bookmark: bookmarkFields,
    })
    .strict(),
  z
    .object({
      action: z.literal("bookmark_delete"),
      expectedVersion: version,
      groupId: z.uuid(),
      id: z.uuid(),
    })
    .strict(),
  z
    .object({ action: z.literal("sprint_create"), sprint: sprintSchema })
    .strict(),
  z
    .object({
      action: z.literal("sprint_update"),
      id: z.uuid(),
      ...sprintUpdateSchema.shape,
    })
    .strict(),
  z.object({ action: z.literal("sprint_delete"), ...sprintRef }).strict(),
  z.object({ action: z.literal("sprint_start"), ...sprintRef }).strict(),
  z
    .object({
      action: z.literal("sprint_finish"),
      id: z.uuid(),
      ...sprintFinishSchema.shape,
    })
    .strict(),
  z
    .object({
      action: z.literal("sprint_add_items"),
      id: z.uuid(),
      ...sprintItemsSchema.shape,
    })
    .strict(),
  z
    .object({
      action: z.literal("sprint_remove_items"),
      id: z.uuid(),
      ...sprintItemsSchema.shape,
    })
    .strict(),
  z
    .object({
      action: z.literal("sprint_move_item"),
      id: z.uuid(),
      ...sprintMoveSchema.shape,
    })
    .strict(),
]);
export type BusinessOperation = z.infer<typeof businessOperationSchema>;
export const businessActionLabels: Record<BusinessOperation["action"], string> =
  {
    bookmark_group_create: "新建网址分组",
    bookmark_group_update: "重命名网址分组",
    bookmark_group_delete: "删除网址分组",
    bookmark_create: "添加网址",
    bookmark_update: "修改网址",
    bookmark_delete: "删除网址",
    sprint_create: "创建冲刺",
    sprint_update: "修改冲刺",
    sprint_delete: "删除冲刺",
    sprint_start: "开始冲刺",
    sprint_finish: "结束冲刺",
    sprint_add_items: "加入冲刺",
    sprint_remove_items: "移出冲刺",
    sprint_move_item: "更新看板工作项",
  };
export const isBusinessDelete = (operation: BusinessOperation) =>
  operation.action.endsWith("_delete");
export type BusinessPreview = {
  title: string;
  rows: { label: string; before?: string; after: string }[];
};
export const businessConfirmSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    confirmed: z.literal(true),
    deleteConfirmed: z.literal(true).optional(),
  })
  .strict();
