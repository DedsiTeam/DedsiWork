import { Copy } from "lucide-react";
import { Button } from "./ui/button";
import { useWorkspace } from "../workspace-context";

export function WorkItemId({
  id,
  compact = false,
}: {
  id: string;
  compact?: boolean;
}) {
  const { notify } = useWorkspace();
  return (
    <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
      <span
        className="min-w-0 truncate select-text font-mono"
        title={`工作项 ID：${id}`}
      >
        ID：{id}
      </span>
      <Button
        variant="ghost"
        size={compact ? "icon-sm" : "sm"}
        title="复制工作项 ID"
        aria-label="复制工作项 ID"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(id);
            notify("工作项 ID 已复制");
          } catch {
            notify("复制失败，请选中工作项 ID 手动复制", "error");
          }
        }}
      >
        <Copy aria-hidden="true" />
        {!compact && "复制 ID"}
      </Button>
    </div>
  );
}
