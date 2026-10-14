import { z } from "zod";
import { generatedWorkItemSchema } from "./work-item-ai";
import { generatedModelSchema } from "./domain-model-ai";

export const chatProposalSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("work_items"),
      items: z.array(generatedWorkItemSchema).min(1).max(12),
    })
    .strict(),
  z
    .object({ kind: z.literal("domain_model"), model: generatedModelSchema })
    .strict(),
]);
export type ChatProposal = z.infer<typeof chatProposalSchema>;
export function chatProposals(text: string) {
  return [...text.matchAll(/```dedsiwork\s*\n([\s\S]*?)```/g)].flatMap(
    (match, index) => {
      try {
        const result = chatProposalSchema.safeParse(JSON.parse(match[1]!));
        return result.success
          ? [{ index, proposal: result.data, block: match[0] }]
          : [];
      } catch {
        return [];
      }
    },
  );
}
