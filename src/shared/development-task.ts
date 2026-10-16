import { z } from "zod";
import type { WorkItem } from "./work-item";
import type { DomainModel } from "./domain-model";
import type { ChatSnapshot } from "./chat";
export const developmentCreateSchema = z
  .object({
    title: z.string().trim().min(1, "请输入任务名称").max(120),
    requirement: z.string().trim().max(16000).default(""),
    directoryToken: z.uuid(),
    baseBranch: z.string().min(1).max(250),
    itemIds: z.array(z.uuid()).max(20).default([]),
    modelIds: z.array(z.uuid()).max(10).default([]),
    model: z.string().trim().max(200).default(""),
  })
  .strict()
  .refine(
    (v) => v.itemIds.length > 0 || v.requirement.length > 0,
    "请选择工作项或填写研发要求",
  );
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
  baseBranch: string;
  baseCommit: string;
  branch: string;
  worktree: string;
  model: string;
  status: DevelopmentStatus;
  chatId: string | null;
  sources: { items: WorkItem[]; models: DomainModel[] };
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
