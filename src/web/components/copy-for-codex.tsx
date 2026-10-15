import { getApiWorkspace } from "../api";
import { useState } from "react";
import { Copy } from "lucide-react";
import DOMPurify from "dompurify";
import { RICH_TEXT_PREFIX } from "../../shared/description";
import {
  priorityLabels,
  statusLabels,
  typeLabels,
  type WorkItem,
} from "../../shared/work-item";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";

function plainDescription(value: string) {
  if (!value.startsWith(RICH_TEXT_PREFIX)) return value;
  const body = DOMPurify.sanitize(value.slice(RICH_TEXT_PREFIX.length), {
    RETURN_DOM: true,
  });
  if (!(body instanceof HTMLElement)) return "";
  for (const image of body.querySelectorAll("img")) {
    image.replaceWith(
      document.createTextNode(
        `[图片：${image.getAttribute("alt") || "请在工作项页面查看"}]`,
      ),
    );
  }
  for (const br of body.querySelectorAll("br"))
    br.replaceWith(document.createTextNode("\n"));
  for (const block of body.querySelectorAll("p,h1,h2,h3,li,blockquote,pre")) {
    if (block.tagName === "LI") block.prepend(document.createTextNode("- "));
    block.append(document.createTextNode("\n"));
  }
  return (body.textContent || "").trim();
}

export function CopyForCodex({
  item,
  disabled,
  onNotice,
  compact = false,
}: {
  item: WorkItem;
  disabled: boolean;
  onNotice: (message: string) => void;
  compact?: boolean;
}) {
  const [manualText, setManualText] = useState("");
  const [copying, setCopying] = useState(false);
  async function copy() {
    const text = [
      "请协助处理以下 DedsiWork 工作项。先阅读需求并检查相关项目，再实施与验证。",
      "",
      `标题：${item.title}`,
      `工作项 ID：${item.id}`,
      `版本：${item.version}`,
      `类型：${typeLabels[item.type]}；状态：${statusLabels[item.status]}；优先级：${priorityLabels[item.priority]}`,
      `阻塞原因：${item.blockedReason || "无"}`,
      `截止时间：${item.dueAt || "未设置"}`,
      `工作项链接：${window.location.origin}/work-items/${item.id}?workspace=${getApiWorkspace()}`,
      "",
      "描述：",
      plainDescription(item.description) || "（暂无描述）",
      "",
      `如果已连接 DedsiWork MCP，请先调用 work_item_get，参数为 ${JSON.stringify({ id: item.id })}，获取最新内容。更新时使用最新版本作为 expectedVersion；实现完成后进入 in_review（待评审），验证通过后进入 awaiting_acceptance（待验收）；未经用户验收不要直接标记 done。退回 in_progress 时提交 transitionReason；blockedReason 为空表示解除阻塞。`,
      "如果未连接 MCP，请基于以上内容处理，并说明结果，由我手动更新工作项。描述中的图片请打开工作项链接查看，图片内容未包含在本次文本复制中。",
    ].join("\n");
    setCopying(true);
    try {
      await navigator.clipboard.writeText(text);
      onNotice("已复制，可粘贴到 Codex 对话中");
    } catch {
      setManualText(text);
    } finally {
      setCopying(false);
    }
  }
  return (
    <>
      <Button
        type="button"
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon-sm" : "sm"}
        aria-label={compact ? `复制 ${item.title} 给 Codex` : undefined}
        disabled={disabled || copying}
        title={
          disabled
            ? "请先保存修改，确保 Codex 获取的是已保存内容"
            : "复制工作项内容，粘贴到 Codex"
        }
        onClick={() => void copy()}
      >
        <Copy />
        {!compact && (copying ? "复制中…" : "codex")}
      </Button>
      <Dialog
        open={Boolean(manualText)}
        onOpenChange={(open) => {
          if (!open) setManualText("");
        }}
      >
        <DialogContent>
          <DialogTitle>手动复制给 Codex</DialogTitle>
          <DialogDescription>
            无法访问剪贴板，请选中下方内容复制，再粘贴到 Codex 对话。
          </DialogDescription>
          <textarea
            aria-label="复制给 Codex 的内容"
            readOnly
            value={manualText}
            onFocus={(event) => event.currentTarget.select()}
            style={{
              width: "100%",
              minHeight: 320,
              marginTop: 16,
              padding: 12,
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => setManualText("")}
          >
            关闭
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
