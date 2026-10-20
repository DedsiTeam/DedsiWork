import type { RemoteRequirement } from "./remote-mcp";
import { z } from "zod";
import { resolveAIModel } from "./ai-model";
import type { WorkItem } from "./work-item";
import type { DomainModel } from "./domain-model";
import type { ChatSnapshot } from "./chat";
export const developmentCreateSchema = z
  .object({
    title: z.string().trim().min(1, "请输入任务名称").max(120),
    requirement: z.string().trim().max(16000).default(""),
    remoteSnapshotId: z.uuid().optional(),
    directoryToken: z.uuid(),
    baseBranch: z.string().min(1).max(250),
    itemIds: z.array(z.uuid()).max(20).default([]),
    modelIds: z.array(z.uuid()).max(10).default([]),
    model: z.string().trim().max(200).default("").transform(resolveAIModel),
  })
  .strict()
  .refine(
    (v) =>
      v.itemIds.length > 0 ||
      v.requirement.length > 0 ||
      Boolean(v.remoteSnapshotId),
    "请选择工作项或填写研发要求",
  );
export const developmentMessageSchema = z
  .object({
    text: z.string().trim().min(1).max(16000),
    clientId: z.uuid(),
  })
  .strict();
export const developmentStatusLabels = {
  draft: "待开始",
  preparing: "准备环境",
  running: "研发中",
  waiting: "等待处理",
  stopping: "正在停止",
  stopped: "已停止",
  interrupted: "已中断",
  failed: "执行失败",
  review: "待验收",
  completed: "已完成",
  taken_over: "人工接管",
} as const;
export type DevelopmentStatus = keyof typeof developmentStatusLabels;
export type DevelopmentTask = {
  id: string;
  title: string;
  requirement: string;
  repository: string;
  executionMode?: "workspace" | "worktree";
  baseBranch: string;
  baseCommit: string;
  branch: string;
  worktree: string;
  model: string;
  status: DevelopmentStatus;
  chatId: string | null;
  sourceMode?: "references";
  remoteSource?: RemoteRequirement;
  sources: {
    items: (Pick<WorkItem, "id" | "title" | "version"> & Partial<WorkItem>)[];
    models: (Pick<DomainModel, "id" | "name" | "version"> &
      Partial<DomainModel>)[];
  };
  deliveryHistory?: DevelopmentDelivery[];
  acceptanceEvidence?: Record<
    string,
    { text: string; updatedAt: string; deliveryId: string | null }
  >;
  snapshot: ChatSnapshot | null;
  error: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  restored?: boolean;
  attention?: {
    id: string;
    status: "review" | "waiting" | "failed" | "interrupted";
    fingerprint: string;
    createdAt: string;
    acknowledgedAt?: string;
  } | null;
  merge?: {
    targetBranch: string;
    targetCommit: string;
    sourceCommit: string;
    mergedAt: string;
    cleanedAt?: string;
    cleanupError?: string;
  };
};
export type DevelopmentMergePreview = {
  token: string | null;
  canMerge: boolean;
  targetBranch: string;
  sourceBranch: string;
  targetCommit: string;
  files: string;
  diff: string;
  truncated: boolean;
  conflict: string | null;
  createsCommit: boolean;
  alreadyMerged: boolean;
};
export type RepositorySelection = {
  token: string;
  directory: string;
  branches: string[];
  currentBranch: string;
};
export type DevelopmentChanges = {
  status: string;
  diff: string;
  commits: string;
  truncated: boolean;
};

export type DevelopmentNotification = {
  id: string;
  taskId: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  status: "review" | "waiting" | "failed" | "interrupted";
  createdAt: string;
};

export type DevelopmentDelivery = {
  id: string;
  createdAt: string;
  completed: string;
  verification: string;
  remaining: string;
  raw: string;
};

/** Preserve actual Codex output. Missing sections never imply success. */
export function captureDevelopmentDelivery(
  snapshot: ChatSnapshot,
  createdAt: string,
): DevelopmentDelivery | null {
  const lastUser = snapshot.items.findLastIndex((item) => item.role === "user");
  const reply = snapshot.items
    .slice(lastUser + 1)
    .findLast((item) => item.role === "assistant" && item.text.trim());
  if (!reply) return null;
  const sections: Record<string, string[]> = {};
  let heading = "";
  for (const line of reply.text.split("\n")) {
    const match = line.match(/^#{1,6}\s*(完成内容|验证结果|遗留问题)\s*$/);
    if (match) {
      heading = match[1]!;
      sections[heading] ||= [];
    } else if (heading) sections[heading]!.push(line);
  }
  return {
    id: reply.id,
    createdAt,
    completed: sections["完成内容"]?.join("\n").trim() || reply.text,
    verification:
      sections["验证结果"]?.join("\n").trim() ||
      "未提供结构化验证结果，请查看原始回复并自行核验。",
    remaining:
      sections["遗留问题"]?.join("\n").trim() ||
      "未明确说明遗留问题，请核对交付范围。",
    raw: reply.text,
  };
}
