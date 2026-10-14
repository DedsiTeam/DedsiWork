import { z } from "zod";
export const chatCreateSchema = z
  .object({
    cwd: z.string().trim().max(2000).optional(),
    model: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export const chatMessageSchema = z
  .object({
    model: z.string().trim().min(1).max(200).optional(),
    text: z.string().trim().max(30000),
    clientId: z.uuid(),
    images: z
      .array(
        z
          .string()
          .max(2800000)
          .regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/),
      )
      .max(2)
      .default([]),
  })
  .strict()
  .refine(
    (value) => value.text.length > 0 || value.images.length > 0,
    "请输入消息",
  );
export const chatAnswerSchema = z
  .object({
    action: z.enum(["accept", "decline", "cancel"]),
    answers: z.record(z.string(), z.string().max(12000)).optional(),
    content: z.unknown().optional(),
  })
  .strict();
export type ChatSummary = {
  id: string;
  title: string;
  cwd: string;
  model: string | null;
  updatedAt: string;
};
export type ChatItem = {
  id: string;
  role: "user" | "assistant" | "tool";
  type: string;
  text: string;
  status?: string;
  images?: string[];
};
export type ChatRequest = {
  id: string;
  method: string;
  params: Record<string, any>;
};
export type ChatSnapshot = {
  revision: number;
  chat: ChatSummary;
  items: ChatItem[];
  requests: ChatRequest[];
  running: boolean;
  stopping: boolean;
  error: string | null;
  nextCursor: string | null;
};
