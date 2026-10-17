import { z } from "zod";
import { reportDateSchema, type ReportMatter } from "./daily-report";
export const reportDraftInputSchema = z
  .object({
    type: z.enum(["weekly", "monthly"]),
    date: reportDateSchema,
    text: z.string().trim().min(1).max(200000),
    sourceSnapshot: z.string().max(2000000),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export type ReportDraft = Omit<
  z.infer<typeof reportDraftInputSchema>,
  "expectedVersion"
> & { id: string; version: number; createdAt: string };
export type ReportDraftList = {
  versions: ReportDraft[];
  version: number;
  page: number;
  pageSize: number;
  total: number;
};
export type ReportActivity = {
  id: string;
  href: string;
  source: string;
  matter: ReportMatter;
};
export type ReportActivityList = {
  candidates: ReportActivity[];
  total: number;
  page: number;
  pageSize: number;
};
