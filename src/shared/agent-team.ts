import { z } from "zod";
import { generatedWorkItemSchema } from "./work-item-ai";
import { generatedModelSchema } from "./domain-model-ai";

export type ProjectAgent = {
  name: string;
  description: string;
  instructions: string;
  model?: string;
  effort?: string;
  file: string;
  fingerprint: string;
};
export const teamPlanSchema = z
  .object({
    summary: z.string().trim().min(1).max(12000),
    questions: z.array(z.string().min(1).max(2000)).max(12),
    items: z.array(generatedWorkItemSchema).min(1).max(12),
    models: z.array(generatedModelSchema).max(5),
    tasks: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),
            title: z.string().trim().min(1).max(120),
            agent: z.string().min(1).max(100),
            requirement: z.string().trim().min(1).max(10000),
            files: z.array(z.string().min(1).max(300)).min(1).max(30),
            dependsOn: z.array(z.string().max(50)).max(12),
            itemIndexes: z
              .array(z.number().int().min(0).max(11))
              .min(1)
              .max(12),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
export type TeamPlan = z.infer<typeof teamPlanSchema>;
export const teamCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    text: z.string().trim().min(1).max(12000),
    agents: z.array(z.string().min(1).max(100)).min(1).max(8),
    maxParallel: z.number().int().min(1).max(4).default(2),
    tokenBudget: z.number().int().min(1000).max(2000000).default(100000),
  })
  .strict();
export const teamMessageSchema = z
  .object({
    text: z.string().trim().min(1).max(12000),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export type AgentTeam = {
  id: string;
  title: string;
  directory: string;
  revision: number;
  status:
    | "discussing"
    | "ready"
    | "running"
    | "paused"
    | "review"
    | "failed"
    | "interrupted";
  agents: ProjectAgent[];
  maxParallel: number;
  tokenBudget: number;
  usage: number;
  usageKnown: boolean;
  error: string | null;
  messages: { id: string; role: string; text: string }[];
  plan: TeamPlan | null;
  confirmedPlan: TeamPlan | null;
  baseBranch?: string;
  restored?: boolean;
  itemIds: string[];
  modelIds: string[];
  tasks: { key: string; id: string; status?: string; error?: string | null }[];
  chats: {
    id: string;
    role: string;
    usage: number;
    known: boolean;
    text: string;
  }[];
  createdAt: string;
  updatedAt: string;
};
