import { LogOut } from "lucide-react";
import { useWorkspace } from "../workspace-context";

export function WorkspaceSwitcher() {
  const { workspace, leaveWorkspace } = useWorkspace();
  if (!workspace) return null;
  return (
    <div
      className="space-header-info"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className="space-header-name" title={workspace.name}>
        <span>{workspace.name}</span>
      </span>
      <button
        type="button"
        className="space-header-exit"
        aria-label="返回工作空间列表"
        title="返回工作空间列表"
        onClick={leaveWorkspace}
      >
        <LogOut size={14} />
      </button>
    </div>
  );
}
