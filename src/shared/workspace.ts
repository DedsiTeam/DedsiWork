import { z } from "zod";
export const workspaceInputSchema = z
  .object({
    name: z.string().trim().min(1, "请输入工作空间名称").max(80),
    description: z.string().trim().max(2000).default(""),
    directory: z.string().trim().max(2000).default(""),
  })
  .strict();
export type Workspace = z.infer<typeof workspaceInputSchema> & {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
};
export type WorkspaceSummary = Workspace & {
  counts: {
    chats: number;
    items: number;
    models: number;
    sprints: number;
    notes: number;
  };
};
