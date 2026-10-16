import { businessOperationSchema } from "./assistant-business";
import { z } from "zod";
import { generatedWorkItemSchema } from "./work-item-ai";
import { generatedModelSchema } from "./domain-model-ai";

export const chatProposalSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("business_action"),
      operation: businessOperationSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("work_items"),
      items: z.array(generatedWorkItemSchema).min(1).max(12),
    })
    .strict(),
  z
    .object({
      kind: z.literal("development_items"),
      sourceItems: z
        .array(
          z
            .object({ id: z.uuid(), version: z.number().int().positive() })
            .strict(),
        )
        .min(1)
        .max(20),
      sourceModels: z
        .array(
          z
            .object({ id: z.uuid(), version: z.number().int().positive() })
            .strict(),
        )
        .min(1)
        .max(10),
      items: z
        .array(generatedWorkItemSchema.extend({ type: z.literal("task") }))
        .min(1)
        .max(12),
    })
    .strict(),
  z
    .object({ kind: z.literal("domain_model"), model: generatedModelSchema })
    .strict(),
]);
export type ChatProposal = z.infer<typeof chatProposalSchema>;

// Accept existing plain JSON and JSON fences as well as the preferred app fence.
// Keep incomplete or invalid app payloads out of the visible conversation too.
export function chatProposalContent(text: string) {
  const regions: {
    start: number;
    end: number;
    json: string;
    complete: boolean;
  }[] = [];
  const isPayload = (value: string) =>
    /^\s*\{\s*"kind"\s*:\s*"(?:work_items|development_items|domain_model|business_action)"/.test(
      value,
    );
  for (const match of text.matchAll(/```(dedsiwork|json)?[^\S\n]*\n/g)) {
    const start = match.index!;
    if (regions.some((region) => start < region.end)) continue;
    const bodyStart = start + match[0].length;
    const close = text.indexOf("```", bodyStart);
    const json = text.slice(bodyStart, close < 0 ? text.length : close);
    if (match[1] === "dedsiwork" || isPayload(json))
      regions.push({
        start,
        end: close < 0 ? text.length : close + 3,
        json,
        complete: close >= 0,
      });
  }
  for (const match of text.matchAll(
    /\{\s*"kind"\s*:\s*"(?:work_items|development_items|domain_model|business_action)"/g,
  )) {
    const start = match.index!;
    if (regions.some((region) => start >= region.start && start < region.end))
      continue;
    let depth = 0,
      quoted = false,
      escaped = false,
      end = text.length,
      complete = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        end = i + 1;
        complete = true;
        break;
      }
    }
    regions.push({ start, end, json: text.slice(start, end), complete });
  }
  regions.sort((a, b) => a.start - b.start);
  const proposals: { index: number; proposal: ChatProposal; block: string }[] =
    [];
  let visible = "",
    cursor = 0,
    pending = false,
    invalid = false;
  regions.forEach((region, index) => {
    visible += text.slice(cursor, region.start);
    cursor = region.end;
    if (!region.complete) {
      pending = true;
      return;
    }
    try {
      const result = chatProposalSchema.safeParse(JSON.parse(region.json));
      if (result.success)
        proposals.push({
          index,
          proposal: result.data,
          block: text.slice(region.start, region.end),
        });
      else invalid = true;
    } catch {
      invalid = true;
    }
  });
  visible += text.slice(cursor);
  // A stream can stop between the opening marker and the first complete field.
  visible = visible.replace(/```dedsiwork[^\n]*(?:\n[\s\S]*)?$/, () => {
    pending = true;
    return "";
  });
  visible = visible.replace(
    /\{\s*"kind"\s*:\s*"(?:work_items|development_items|domain_model|business_action)?$/,
    () => {
      pending = true;
      return "";
    },
  );
  return { text: visible.trim(), proposals, pending, invalid };
}
export function chatProposals(text: string) {
  return chatProposalContent(text).proposals;
}
