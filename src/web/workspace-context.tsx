import type { Workspace } from "../shared/workspace";
import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from "react";
export type Summary = {
  total: number;
  inProgress: number;
  done: number;
  trash: number;
};
export const WorkspaceContext = createContext<{
  workspace: Workspace | null;
  openWorkspace: (id: string) => Promise<void>;
  leaveWorkspace: () => void;
  updateWorkspace: (workspace: Workspace) => void;
  summary: Summary;
  setSummary: Dispatch<SetStateAction<Summary>>;
  refreshSummary: () => void;
  notify: (message: string, tone?: "success" | "error") => void;
} | null>(null);
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Workspace provider missing");
  return context;
}
