import { z } from "zod";
import { generatedWorkItemSchema } from "./work-item-ai";
import type { DomainModelInput } from "./domain-model";
export const requirementReplySchema = z
  .object({
    reply: z.string().trim().min(1).max(12000),
    items: z.array(generatedWorkItemSchema).min(1).max(12),
  })
  .strict();
export const assistantDraftSchema = generatedWorkItemSchema
  .extend({ draftId: z.uuid() })
  .strict();
export type AssistantDraft = z.infer<typeof assistantDraftSchema>;
export const assistantMessageSchema = z
  .object({
    text: z.string().trim().min(1).max(12000),
    clientId: z.uuid(),
    expectedRevision: z.number().int().positive(),
    drafts: z
      .array(assistantDraftSchema.extend({ title: z.string().trim().max(200) }))
      .max(12)
      .optional(),
  })
  .strict();
export const assistantConfirmSchema = z
  .object({
    confirmed: z.literal(true),
    expectedRevision: z.number().int().positive(),
    items: z.array(assistantDraftSchema).min(1).max(12),
  })
  .strict();
export const assistantModelSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    itemIds: z.array(z.uuid()).min(1).max(20),
    note: z.string().trim().max(12000).default(""),
  })
  .strict();
export type AssistantSourceItem = {
  id: string;
  title: string;
  description: string;
  type: string;
  version: number;
};
export type AssistantFlow = {
  chatId?: string;
  id: string;
  revision: number;
  title: string;
  model?: string;
  messages: { id: string; role: "user" | "assistant"; text: string }[];
  drafts: AssistantDraft[];
  createdItems: { id: string; title: string; draftId: string }[];
  sources: AssistantSourceItem[];
  modelDraft: DomainModelInput | null;
  modelId: string | null;
  modelNote?: string;
  jobId: string | null;
  jobKind: "items" | "model" | null;
  error: string | null;
  updatedAt: string;
};
export type AssistantFlowSummary = Pick<
  AssistantFlow,
  "id" | "title" | "updatedAt" | "modelId"
>;
export type AssistantProvenance = {
  flowId: string;
  requirement: string;
  items?: AssistantSourceItem[];
};
