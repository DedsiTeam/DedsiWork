import { z } from "zod";
export const sourceKind = z.enum(["note", "item", "model", "bookmark"]);
export type SourceKind = z.infer<typeof sourceKind>;
export type SearchEntry = {
  id: string;
  kind: SourceKind;
  title: string;
  text: string;
  href: string;
  version: number;
};
export type FocusEntry = {
  id: string;
  title: string;
  status: string;
  priority: string;
  bucket: "today" | "later";
  date: string;
  version: number;
};
export type WorkCard = {
  id: string;
  title: string;
  status: string;
  href: string;
  detail: string;
  updatedAt: string;
};
export type PersonalOverview = {
  focus: FocusEntry[];
  attention: WorkCard[];
  running: WorkCard[];
  delivered: WorkCard[];
};
export const focusInput = z
  .object({
    itemId: z.uuid(),
    bucket: z.enum(["today", "later", "none"]),
    date: z.iso.date(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export const sourceInput = z
  .object({
    kind: sourceKind,
    id: z.uuid(),
    nodeIds: z.array(z.uuid()).max(200).optional(),
  })
  .strict();
