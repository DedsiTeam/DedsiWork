import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { AppError } from "../../shared/errors";
import type {
  DevelopmentTask,
  DevelopmentMergePreview,
} from "../../shared/development-task";
import type { Actor } from "./work-items";
const execute = promisify(execFile);
// Serialize merges even when two workspaces reference the same repository.
const repositories = new Set<string>();
type Preview = {
  owner: string;
  taskId: string;
  version: number;
  expires: number;
  sourceHead: string;
  sourceTree: string;
  candidate: string;
  targetHead: string;
  targetBranch: string;
  mergedTree: string;
  alreadyMerged: boolean;
};
export class DevelopmentMerge {
  private previews = new Map<string, Preview>();
  private operations = new Set<Promise<unknown>>();
  private closed = false;
  private track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed)
      return Promise.reject(new AppError("SERVICE_CLOSED", "服务已关闭", 503));
    const job = operation();
    this.operations.add(job);
    void job.finally(() => this.operations.delete(job)).catch(() => {});
    return job;
  }
  preview(id: string, actor: Actor) {
    return this.track(() => this.previewImpl(id, actor));
  }
  merge(id: string, input: unknown, actor: Actor) {
    return this.track(() => this.mergeImpl(id, input, actor));
  }
  cleanup(id: string, actor: Actor) {
    return this.track(async () => {
      const task = this.get(id, actor);
      if (!actor.writable) throw new AppError("FORBIDDEN", "需要写入权限", 403);
      if (task.executionMode === "workspace")
        throw new AppError(
          "CLEANUP_UNAVAILABLE",
          "工作空间本地目录不能清理",
          409,
        );
      if (!task.merge || task.restored)
        throw new AppError(
          "CLEANUP_UNAVAILABLE",
          "只能清理本地已合并任务",
          409,
        );
      if (task.merge.cleanedAt) return task;
      const repository = realpathSync(task.repository);
      if (repositories.has(repository))
        throw new AppError("MERGE_BUSY", "仓库正在处理，请稍后重试", 409);
      repositories.add(repository);
      try {
        return await this.cleanupTask(task);
      } finally {
        repositories.delete(repository);
      }
    });
  }
  private async cleanupTask(task: DevelopmentTask) {
    const merge = task.merge!;
    if (merge.cleanedAt) return task;
    try {
      const branchHead = await this.run(task.repository, [
        "for-each-ref",
        "--format=%(objectname)",
        `refs/heads/${task.branch}`,
      ]);
      if (branchHead && branchHead !== merge.sourceCommit)
        throw new Error(
          "研发分支在合并后有新提交，已保留代码，请先处理后再清理",
        );
      const ancestry = await this.run(
        task.repository,
        [
          "merge-base",
          "--is-ancestor",
          merge.sourceCommit,
          `refs/heads/${merge.targetBranch}`,
        ],
        {},
        true,
      );
      if (ancestry.startsWith("CONFLICT\n"))
        throw new Error("主分支不再包含研发提交，暂不清理");
      if (existsSync(task.worktree)) {
        await this.ensure(task);
        if (
          (await this.run(task.worktree, ["rev-parse", "HEAD"])) !==
          merge.sourceCommit
        )
          throw new Error("研发目录在合并后有新提交，暂不清理");
        if (
          await this.run(task.worktree, [
            "status",
            "--porcelain",
            "--untracked-files=all",
          ])
        )
          throw new Error(
            "研发目录有合并后的未提交修改，已保留，请先处理后再清理",
          );
        // Git removes this worktree and its administrative records. Never force-remove user changes.
        await this.run(task.repository, [
          "worktree",
          "remove",
          "--",
          task.worktree,
        ]);
      } else {
        const entries = await this.run(task.repository, [
          "worktree",
          "list",
          "--porcelain",
        ]);
        if (entries.split("\n").includes(`worktree ${task.worktree}`))
          await this.run(task.repository, [
            "worktree",
            "remove",
            "--",
            task.worktree,
          ]);
      }
      if (branchHead)
        await this.run(task.repository, ["branch", "-d", "--", task.branch]);
      merge.cleanedAt = new Date().toISOString();
      delete merge.cleanupError;
    } catch (error) {
      merge.cleanupError = (error as Error).message.slice(0, 2000);
    }
    this.save(task);
    return task;
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.operations]);
    this.previews.clear();
  }
  constructor(
    private get: (id: string, actor: Actor) => DevelopmentTask,
    private save: (task: DevelopmentTask) => void,
    private ensure: (task: DevelopmentTask) => Promise<void>,
  ) {}
  private async run(
    cwd: string,
    args: string[],
    extra: Record<string, string> = {},
    conflicts = false,
  ): Promise<string> {
    try {
      return (
        await execute("git", ["-C", cwd, ...args], {
          encoding: "utf8",
          timeout: 60000,
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...extra },
        })
      ).stdout.trimEnd();
    } catch (e) {
      const error = e as {
        code?: number;
        stdout?: string;
        stderr?: string;
        message: string;
      };
      if (conflicts && error.code === 1)
        return `CONFLICT\n${error.stdout || ""}\n${error.stderr || ""}`;
      throw new AppError(
        "MERGE_GIT_ERROR",
        (error.stderr || error.message).slice(0, 2000),
      );
    }
  }
  private check(task: DevelopmentTask, actor: Actor) {
    if (task.executionMode === "workspace")
      throw new AppError(
        "MERGE_UNAVAILABLE",
        "任务直接修改工作空间目录，无需合并",
        409,
      );
    if (!actor.writable) throw new AppError("FORBIDDEN", "需要写入权限", 403);
    if (task.restored)
      throw new AppError(
        "RESTORED_TASK",
        "恢复的任务仅供查阅，不能合并旧代码目录",
        409,
      );
    if (task.status !== "completed")
      throw new AppError(
        "TASK_NOT_ACCEPTED",
        "请先验收并确认研发任务完成",
        409,
      );
    if (task.merge)
      throw new AppError(
        "TASK_MERGED",
        `任务已合并到 ${task.merge.targetBranch}`,
        409,
      );
  }
  private async target(task: DevelopmentTask) {
    const branches = (
      await this.run(task.repository, [
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads/",
      ])
    ).split("\n");
    const branch = branches.includes("main")
      ? "main"
      : branches.includes("master")
        ? "master"
        : "";
    if (!branch)
      throw new AppError(
        "MAIN_BRANCH_MISSING",
        "未找到 main 或 master 主分支，请先在仓库中创建主分支",
        409,
      );
    if (
      (await this.run(task.repository, ["branch", "--show-current"])) !== branch
    )
      throw new AppError(
        "MAIN_BRANCH_NOT_CHECKED_OUT",
        `请先在原仓库切换到 ${branch} 分支，再预览合并`,
        409,
      );
    if (
      await this.run(task.repository, [
        "status",
        "--porcelain",
        "--untracked-files=all",
      ])
    )
      throw new AppError(
        "MAIN_BRANCH_DIRTY",
        "原仓库有未提交或未跟踪文件，请先保存或提交这些修改，再合并",
        409,
      );
    for (const cwd of [task.repository, task.worktree])
      for (const name of [
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "rebase-merge",
        "rebase-apply",
      ]) {
        const path = await this.run(cwd, ["rev-parse", "--git-path", name]);
        if (existsSync(resolve(cwd, path)))
          throw new AppError(
            "GIT_OPERATION_ACTIVE",
            "仓库有未完成的合并、变基或挑拣操作，请先处理",
            409,
          );
      }
    return {
      branch,
      head: await this.run(task.repository, ["rev-parse", "HEAD"]),
    };
  }
  private async tree(task: DevelopmentTask) {
    const directory = mkdtempSync(join(tmpdir(), "dedsiwork-merge-index-"));
    try {
      const env = { GIT_INDEX_FILE: join(directory, "index") };
      await this.run(task.worktree, ["read-tree", "HEAD"], env);
      await this.run(task.worktree, ["add", "-A", "--", "."], env);
      return await this.run(task.worktree, ["write-tree"], env);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  private async previewImpl(
    id: string,
    actor: Actor,
  ): Promise<DevelopmentMergePreview> {
    const task = this.get(id, actor);
    this.check(task, actor);
    await this.ensure(task);
    const target = await this.target(task),
      sourceHead = await this.run(task.worktree, ["rev-parse", "HEAD"]),
      sourceTree = await this.tree(task);
    const headTree = await this.run(task.worktree, [
      "rev-parse",
      "HEAD^{tree}",
    ]);
    // commit-tree writes only an unreachable object: neither branch nor index is changed by preview.
    const candidate =
      sourceTree === headTree
        ? sourceHead
        : await this.run(task.worktree, [
            "commit-tree",
            sourceTree,
            "-p",
            sourceHead,
            "-m",
            `feat: ${task.title}`,
          ]);
    const result = await this.run(
      task.repository,
      ["merge-tree", "--write-tree", target.head, candidate],
      {},
      true,
    );
    const conflict = result.startsWith("CONFLICT\n"),
      mergedTree = conflict ? "" : result.split("\n")[0]!;
    const diff = await this.run(task.worktree, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      conflict ? task.baseCommit : target.head,
      conflict ? sourceTree : mergedTree,
      "--",
    ]);
    const files = await this.run(task.worktree, [
      "diff",
      "--name-status",
      conflict ? task.baseCommit : target.head,
      conflict ? sourceTree : mergedTree,
      "--",
    ]);
    const ancestry = await this.run(
      task.repository,
      ["merge-base", "--is-ancestor", candidate, target.head],
      {},
      true,
    );
    const alreadyMerged = !ancestry.startsWith("CONFLICT\n");
    if (
      sourceTree ===
        (await this.run(task.worktree, [
          "rev-parse",
          `${task.baseCommit}^{tree}`,
        ])) &&
      sourceHead === task.baseCommit
    )
      throw new AppError(
        "NO_DEVELOPMENT_CHANGES",
        "任务没有可合并的代码修改",
        409,
      );
    for (const [key, value] of this.previews)
      if (value.expires < Date.now()) this.previews.delete(key);
    const token = conflict ? null : crypto.randomUUID();
    if (token)
      this.previews.set(token, {
        owner: actor.identity,
        taskId: id,
        version: task.version,
        expires: Date.now() + 5 * 60000,
        sourceHead,
        sourceTree,
        candidate,
        targetHead: target.head,
        targetBranch: target.branch,
        mergedTree,
        alreadyMerged,
      });
    return {
      token,
      canMerge: !conflict,
      targetBranch: target.branch,
      sourceBranch: task.branch,
      targetCommit: target.head,
      files,
      diff: diff.slice(0, 200000),
      truncated: diff.length > 200000,
      conflict: conflict ? result.slice(9, 200000) : null,
      createsCommit: sourceTree !== headTree,
      alreadyMerged,
    };
  }
  private async mergeImpl(id: string, input: unknown, actor: Actor) {
    const request = z
      .object({ token: z.uuid(), confirmed: z.literal(true) })
      .strict()
      .parse(input);
    const task = this.get(id, actor);
    if (!actor.writable) throw new AppError("FORBIDDEN", "需要写入权限", 403);
    if (task.merge && !task.restored) return this.cleanup(id, actor); // Retried responses never create a second merge.
    this.check(task, actor);
    const preview = this.previews.get(request.token);
    if (
      !preview ||
      preview.owner !== actor.identity ||
      preview.taskId !== id ||
      preview.expires < Date.now()
    )
      throw new AppError(
        "MERGE_PREVIEW_EXPIRED",
        "合并预览已过期，请重新预览",
        409,
      );
    const repository = realpathSync(task.repository);
    if (repositories.has(repository))
      throw new AppError(
        "MERGE_BUSY",
        "此仓库正在合并其他任务，请稍后重试",
        409,
      );
    repositories.add(repository);
    try {
      await this.ensure(task);
      const target = await this.target(task);
      const sourceHead = await this.run(task.worktree, ["rev-parse", "HEAD"]),
        sourceTree = await this.tree(task);
      if (
        task.version !== preview.version ||
        target.branch !== preview.targetBranch ||
        target.head !== preview.targetHead ||
        sourceHead !== preview.sourceHead ||
        sourceTree !== preview.sourceTree
      )
        throw new AppError(
          "MERGE_PREVIEW_STALE",
          "分支或代码在预览后发生变化，请重新预览",
          409,
        );
      let targetCommit = target.head;
      if (!preview.alreadyMerged) {
        if (preview.candidate !== sourceHead) {
          // CAS preserves commits made by another Git client; no reset --hard or forced checkout.
          await this.run(task.worktree, [
            "update-ref",
            `refs/heads/${task.branch}`,
            preview.candidate,
            sourceHead,
          ]);
          await this.run(task.worktree, ["read-tree", preview.candidate]);
        }
        targetCommit = await this.run(task.repository, [
          "commit-tree",
          preview.mergedTree,
          "-p",
          target.head,
          "-p",
          preview.candidate,
          "-m",
          `Merge development task: ${task.title}`,
        ]);
        await this.run(task.repository, [
          "merge",
          "--ff-only",
          "--no-edit",
          targetCommit,
        ]);
      }
      task.merge = {
        targetBranch: target.branch,
        targetCommit,
        sourceCommit: preview.candidate,
        mergedAt: new Date().toISOString(),
      };
      this.save(task);
      this.previews.delete(request.token);
      return await this.cleanupTask(task);
    } finally {
      repositories.delete(repository);
    }
  }
}
