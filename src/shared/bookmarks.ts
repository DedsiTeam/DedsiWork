import { z } from "zod";

export const bookmarkSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1, "请输入网址名称").max(100),
    url: z
      .string()
      .trim()
      .max(2000)
      .url("请输入完整网址")
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      }, "仅支持不含账号密码的 HTTP 或 HTTPS 网址"),
    description: z.string().trim().max(300).default(""),
  })
  .strict();
export const bookmarkGroupSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1, "请输入分组名称").max(80),
    links: z.array(bookmarkSchema).max(100),
  })
  .strict();
export const bookmarkSaveSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    groups: z.array(bookmarkGroupSchema).max(50),
  })
  .strict()
  .superRefine(({ groups }, ctx) => {
    const ids = groups.flatMap((group) => [
      group.id,
      ...group.links.map((link) => link.id),
    ]);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        message: "分组和网址 ID 不能重复",
        path: ["groups"],
      });
  });
export type Bookmark = z.infer<typeof bookmarkSchema>;
export type BookmarkGroup = z.infer<typeof bookmarkGroupSchema>;
export type BookmarkState = { version: number; groups: BookmarkGroup[] };
