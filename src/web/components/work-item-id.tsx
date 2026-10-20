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
    <div className="work-item-id flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
      {!compact && (
        <span
          className="min-w-0 truncate select-text font-mono"
          title={`工作项 ID：${id}`}
        >
          ID：{id}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size={compact ? "icon-sm" : "sm"}
        title={`复制工作项 ID：${id}`}
        aria-label="复制工作项 ID"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(id);
            notify("工作项 ID 已复制");
          } catch {
            notify(
              compact
                ? "复制失败，请打开工作项详情手动复制 ID"
                : "复制失败，请选中工作项 ID 手动复制",
              "error",
            );
          }
        }}
      >
        <span className="font-mono text-xs font-semibold" aria-hidden="true">
          ID
        </span>
        {!compact && "复制 ID"}
      </Button>
    </div>
  );
}
