import type { Database } from "bun:sqlite";
import { AppError } from "../../shared/errors";
import {
  businessActionLabels,
  type BusinessOperation,
  type BusinessPreview,
} from "../../shared/assistant-business";
import { sprintLabels } from "../../shared/sprint";
import { statusLabels } from "../../shared/work-item";
import { Bookmarks } from "./bookmarks";
import { SprintService } from "./sprints";
import type { Actor, WorkItemService } from "./work-items";

export class AssistantBusiness {
  readonly bookmarks: Bookmarks;
  readonly sprints: SprintService;
  constructor(
    db: Database,
    private items: WorkItemService,
  ) {
    this.bookmarks = new Bookmarks(db);
    this.sprints = new SprintService(db, items);
  }
  private bookmarkChange(
    op: Extract<BusinessOperation, { expectedVersion: number }>,
  ) {
    const state = this.bookmarks.get();
    if (state.version !== op.expectedVersion)
      throw new AppError(
        "VERSION_CONFLICT",
        "网址导航已变更，请让助手读取最新资料后重新生成操作",
        409,
      );
    const rows: BusinessPreview["rows"] = [];
    if (op.action === "bookmark_group_create") {
      state.groups.push({
        id: crypto.randomUUID(),
        title: op.title,
        links: [],
      });
      rows.push({ label: "分组名称", after: op.title });
    } else if ("groupId" in op) {
      const group = state.groups.find((group) => group.id === op.groupId);
      if (!group) throw new AppError("NOT_FOUND", "网址分组不存在", 404);
      rows.push({ label: "分组", after: group.title });
      if (op.action === "bookmark_group_update") {
        rows.push({ label: "分组名称", before: group.title, after: op.title });
        group.title = op.title;
      } else if (op.action === "bookmark_group_delete") {
        rows.push({
          label: "永久删除",
          after: `分组及其 ${group.links.length} 个网址：${group.links.map((link) => `${link.title}（${link.url}）`).join("、") || "空分组"}`,
        });
        state.groups = state.groups.filter((value) => value.id !== group.id);
      } else if (op.action === "bookmark_create") {
        group.links.push({ id: crypto.randomUUID(), ...op.bookmark });
        rows.push(
          { label: "名称", after: op.bookmark.title },
          { label: "网址", after: op.bookmark.url },
          { label: "说明", after: op.bookmark.description },
        );
      } else if (
        op.action === "bookmark_update" ||
        op.action === "bookmark_delete"
      ) {
        const link = group.links.find((link) => link.id === op.id);
        if (!link) throw new AppError("NOT_FOUND", "网址不存在", 404);
        if (op.action === "bookmark_delete") {
          rows.push({
            label: "永久删除网址",
            after: `${link.title}（${link.url}）`,
          });
          group.links = group.links.filter((value) => value.id !== link.id);
        } else {
          rows.push(
            { label: "名称", before: link.title, after: op.bookmark.title },
            { label: "网址", before: link.url, after: op.bookmark.url },
            {
              label: "说明",
              before: link.description,
              after: op.bookmark.description,
            },
          );
          Object.assign(link, op.bookmark);
        }
      }
    }
    return { state, rows };
  }
  preview(op: BusinessOperation): BusinessPreview {
    const title = businessActionLabels[op.action];
    if (op.action.startsWith("bookmark_"))
      return {
        title,
        rows: this.bookmarkChange(
          op as Extract<BusinessOperation, { expectedVersion: number }>,
        ).rows,
      };
    const rows: BusinessPreview["rows"] = [];
    if (op.action === "sprint_create") {
      rows.push(
        { label: "名称", after: op.sprint.name },
        { label: "目标", after: op.sprint.goal },
        {
          label: "日期",
          after: `${op.sprint.startDate} 至 ${op.sprint.endDate}`,
        },
      );
    } else if ("id" in op && op.action.startsWith("sprint_")) {
      const sprint = this.sprints.get(op.id);
      if (sprint.version !== op.expectedVersion)
        throw new AppError(
          "VERSION_CONFLICT",
          "冲刺已变更，请让助手读取最新资料后重新生成操作",
          409,
        );
      rows.push(
        { label: "冲刺", after: sprint.name },
        { label: "当前状态", after: sprintLabels[sprint.state] },
      );
      if (op.action === "sprint_update")
        rows.push(
          { label: "名称", before: sprint.name, after: op.sprint.name },
          { label: "目标", before: sprint.goal, after: op.sprint.goal },
          {
            label: "日期",
            before: `${sprint.startDate} 至 ${sprint.endDate}`,
            after: `${op.sprint.startDate} 至 ${op.sprint.endDate}`,
          },
        );
      if (op.action === "sprint_delete") {
        if (this.sprints.board(op.id).items.length)
          throw new AppError(
            "SPRINT_NOT_EMPTY",
            "仅允许删除没有工作项的冲刺",
            409,
          );
        rows.push({
          label: "永久删除",
          after: "删除此空冲刺及其活动记录，不删除工作项",
        });
      }
      if (op.action === "sprint_start")
        rows.push({
          label: "状态",
          before: sprintLabels[sprint.state],
          after: "进行中",
        });
      if (op.action === "sprint_finish") {
        let target = "退回待规划";
        if (op.targetSprintId) {
          const next = this.sprints.get(op.targetSprintId);
          if (next.version !== op.targetVersion)
            throw new AppError(
              "VERSION_CONFLICT",
              "目标冲刺已变更，请重新生成操作",
              409,
            );
          target = next.name;
        }
        const unfinished = this.sprints
          .board(op.id)
          .items.filter((item) => !["done", "cancelled"].includes(item.status));
        rows.push(
          { label: "结束冲刺", after: "保存结束时快照" },
          {
            label: "未完成工作项",
            after: `${unfinished.length} 项：${unfinished.map((item) => item.title).join("、") || "无"}`,
          },
          { label: "未完成项去向", after: target },
        );
      }
      if (
        op.action === "sprint_add_items" ||
        op.action === "sprint_remove_items"
      ) {
        for (const ref of op.items) {
          const item = this.items.get(ref.id);
          if (item.version !== ref.expectedVersion)
            throw new AppError(
              "VERSION_CONFLICT",
              "工作项已变更，请重新生成操作",
              409,
            );
          rows.push({
            label:
              op.action === "sprint_add_items" ? "加入工作项" : "移出工作项",
            after: item.title,
          });
        }
      }
      if (op.action === "sprint_move_item") {
        const item = this.items.get(op.itemId);
        if (item.version !== op.itemVersion)
          throw new AppError(
            "VERSION_CONFLICT",
            "工作项已变更，请重新生成操作",
            409,
          );
        rows.push(
          { label: "工作项", after: item.title },
          {
            label: "状态",
            before: statusLabels[item.status],
            after: statusLabels[op.status],
          },
        );
        if (op.reason) rows.push({ label: "原因", after: op.reason });
        if (op.beforeId)
          rows.push({
            label: "排列在此工作项之前",
            after: this.items.get(op.beforeId).title,
          });
      }
    }
    return { title, rows };
  }
  execute(op: BusinessOperation, actor: Actor) {
    this.preview(op);
    if (op.action.startsWith("bookmark_")) {
      const change = this.bookmarkChange(
        op as Extract<BusinessOperation, { expectedVersion: number }>,
      );
      this.bookmarks.save(
        { expectedVersion: change.state.version, groups: change.state.groups },
        actor,
      );
      return {
        label: businessActionLabels[op.action] + "已完成",
        url: "/bookmarks",
      };
    }
    switch (op.action) {
      case "sprint_create":
        this.sprints.create(op.sprint, actor);
        break;
      case "sprint_update":
        this.sprints.update(
          op.id,
          { expectedVersion: op.expectedVersion, sprint: op.sprint },
          actor,
        );
        break;
      case "sprint_delete":
        this.sprints.deleteSprint(
          op.id,
          { expectedVersion: op.expectedVersion, confirmed: true },
          actor,
        );
        break;
      case "sprint_start":
        this.sprints.start(
          op.id,
          { expectedVersion: op.expectedVersion },
          actor,
        );
        break;
      case "sprint_finish":
        this.sprints.finish(
          op.id,
          {
            expectedVersion: op.expectedVersion,
            targetSprintId: op.targetSprintId,
            targetVersion: op.targetVersion,
          },
          actor,
        );
        break;
      case "sprint_add_items":
        this.sprints.add(
          op.id,
          { expectedVersion: op.expectedVersion, items: op.items },
          actor,
        );
        break;
      case "sprint_remove_items":
        this.sprints.remove(
          op.id,
          { expectedVersion: op.expectedVersion, items: op.items },
          actor,
        );
        break;
      case "sprint_move_item":
        this.sprints.move(
          op.id,
          {
            expectedVersion: op.expectedVersion,
            itemId: op.itemId,
            itemVersion: op.itemVersion,
            status: op.status,
            reason: op.reason,
            beforeId: op.beforeId,
          },
          actor,
        );
        break;
    }
    return {
      label: businessActionLabels[op.action] + "已完成",
      url: "/work-items/sprints",
    };
  }
}
