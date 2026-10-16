import { Textarea } from "./ui/textarea";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import type { SprintBoard } from "../../shared/sprint";
import { statusLabels, type WorkItem } from "../../shared/work-item";
export function SprintReview({ board }: { board: SprintBoard }) {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setDraft("");
    setNotice("");
  }, [board.sprint.id]);
  function generate() {
    const section = (title: string, items: WorkItem[]) =>
      `${title}（${items.length}）\n${items.map((i) => `- ${i.title} · ${statusLabels[i.status]}${i.blockedReason ? `；阻塞：${i.blockedReason}` : ""}`).join("\n") || "- 无"}`;
    setDraft(
      [
        `${board.sprint.name} · 迭代回顾草稿`,
        `${board.sprint.startDate} — ${board.sprint.endDate}`,
        `目标：${board.sprint.goal || "未填写"}`,
        section(
          "已完成",
          board.items.filter((i) => i.status === "done"),
        ),
        section(
          "未完成",
          board.items.filter((i) => !["done", "cancelled"].includes(i.status)),
        ),
        section(
          "已取消",
          board.items.filter((i) => i.status === "cancelled"),
        ),
        "复盘与下一步：\n- 请补充目标达成情况、遗留原因与下一轮安排。",
      ].join("\n\n"),
    );
    setNotice("");
  }
  return (
    <details className="sprint-history">
      <summary>迭代回顾</summary>
      <p>按完整看板生成草稿，不受筛选影响；可编辑后复制保存。</p>
      <Button variant="outline" onClick={generate}>
        {draft ? "按最新看板重新生成" : "生成回顾草稿"}
      </Button>
      {draft && (
        <>
          <Textarea
            className="sprint-review-draft"
            aria-label="迭代回顾草稿"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(draft);
                setNotice("回顾已复制");
              } catch {
                setNotice("复制失败，请选中文字手动复制");
              }
            }}
          >
            复制回顾
          </Button>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </details>
  );
}
