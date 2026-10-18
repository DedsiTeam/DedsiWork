import { isTauri } from "@tauri-apps/api/core";
import { DevelopmentNotifications } from "./components/development-notifications";
import { WorkspaceSwitcher } from "./components/workspace-switcher";
import type { Workspace } from "../shared/workspace";
import { useCallback, useEffect, useState } from "react";
import {
  Outlet,
  useMatches,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import { api, setCsrf, setApiWorkspace, getApiWorkspace } from "./api";
import { Mark, LocalConnection } from "./components/workspace";
import { Sidebar } from "./components/sidebar";
import { useWindowDrag } from "./components/window-drag";
import { WorkspaceContext, type Summary } from "./workspace-context";
import { Check, AlertTriangle, X } from "lucide-react";
export function App() {
  const windowDrag = useWindowDrag();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [spaceReady, setSpaceReady] = useState(false);
  const location = useLocation();
  const { workspaceId } = useParams();
  const pagePath = location.pathname.replace(/^\/workspace\/[^/]+/, "");
  const requestedWorkspace =
    workspaceId || new URLSearchParams(location.search).get("workspace");
  const canvasEditor = pagePath.startsWith("/notes/");
  const manager =
    pagePath === "/workspaces" ||
    pagePath.startsWith("/workspaces/edit/") ||
    pagePath === "/";
  const updateWorkspace = useCallback(
    (value: Workspace) => setWorkspace(value),
    [],
  );
  const openWorkspace = useCallback(
    async (id: string) => {
      const { data } = await api<{ data: Workspace }>(
        `/api/v1/workspaces/${id}/open`,
        { method: "POST" },
      );
      sessionStorage.setItem("dedsiwork:active-space", id);
      setApiWorkspace(id);
      setWorkspace(data);
      setSummary({ total: 0, inProgress: 0, done: 0, trash: 0 });
      setSpaceReady(true);
      navigate("/today");
    },
    [navigate],
  );
  const leaveWorkspace = useCallback(() => {
    navigate("/workspaces");
  }, [navigate]);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [notification, setNotification] = useState<{
    id: string;
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const notify = useCallback(
    (message: string, tone: "success" | "error" = "success") => {
      setNotification({ id: crypto.randomUUID(), message, tone });
    },
    [],
  );
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(
      () => setNotification(null),
      notification.tone === "error" ? 6000 : 4000,
    );
    return () => clearTimeout(timer);
  }, [notification]);
  const [summary, setSummary] = useState<Summary>({
    total: 0,
    inProgress: 0,
    done: 0,
    trash: 0,
  });
  const matches = useMatches();
  const title =
    (matches.at(-1)?.handle as { title?: string } | undefined)?.title ||
    "页面不存在";
  const refreshSummary = useCallback(() => {
    const id = getApiWorkspace();
    if (!id) return;
    void api<{ data: Summary }>("/api/v1/summary")
      .then((result) => {
        if (getApiWorkspace() === id) setSummary(result.data);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const connect = () => {
      setAuthenticated(null);
      void api<{ data: { csrf: string } }>("/auth/session")
        .then((result) => {
          setCsrf(result.data.csrf);
          setAuthenticated(true);
        })
        .catch(() => setAuthenticated(false));
    };
    connect();
    const expired = connect;
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  // Clear selection only on entry to the list. Selecting a card can update
  // workspace state before navigation commits; that must not clear the new space.
  useEffect(() => {
    if (!authenticated || !manager) return;
    setApiWorkspace("");
    setWorkspace(null);
    sessionStorage.removeItem("dedsiwork:active-space");
  }, [authenticated, manager]);
  useEffect(() => {
    if (!authenticated) return;
    if (manager) {
      setSpaceReady(true);
      return;
    }
    const requested = requestedWorkspace;
    if (workspace && (!requested || workspace.id === requested)) {
      setSpaceReady(true);
      return;
    }
    setSpaceReady(false);
    const id = requested || sessionStorage.getItem("dedsiwork:active-space");
    if (!id) {
      setSpaceReady(true);
      navigate("/workspaces", { replace: true });
      return;
    }
    const controller = new AbortController();
    api<{ data: Workspace }>(`/api/v1/workspaces/${id}`, {
      signal: controller.signal,
    })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        sessionStorage.setItem("dedsiwork:active-space", id);
        setApiWorkspace(id);
        setWorkspace(data);
        setSpaceReady(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setApiWorkspace("");
          sessionStorage.removeItem("dedsiwork:active-space");
          setSpaceReady(true);
          navigate("/workspaces", { replace: true });
        }
      });
    return () => controller.abort();
  }, [authenticated, manager, workspace, navigate, requestedWorkspace]);
  useEffect(() => {
    document.title = `${title} · DedsiWork`;
    window.scrollTo({ top: 0 });
    if (authenticated) refreshSummary();
  }, [authenticated, location.pathname, refreshSummary, title, workspace?.id]);
  useEffect(() => {
    if (!authenticated) return;
    const refresh = () => {
      if (!document.hidden) refreshSummary();
    };
    const timer = setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [authenticated, refreshSummary]);
  if (authenticated === null)
    return (
      <div className="boot">
        <Mark />
        <p>正在连接本地工作空间…</p>
      </div>
    );
  if (!authenticated)
    return <LocalConnection onConnected={() => setAuthenticated(true)} />;
  return (
    <WorkspaceContext.Provider
      value={{
        workspace,
        openWorkspace,
        leaveWorkspace,
        updateWorkspace,
        summary,
        setSummary,
        refreshSummary,
        notify,
      }}
    >
      <div
        className={`app-shell${manager ? " space-manager-shell" : " workspace-shell"}${canvasEditor ? " note-canvas-shell" : ""}`}
      >
        {!manager && !canvasEditor && workspace && (
          <Sidebar key={workspace.id} />
        )}
        <main className="main-area">
          <header
            className="topbar"
            data-native-controls-inset={
              isTauri() && /Mac/i.test(navigator.platform) ? true : undefined
            }
            {...windowDrag}
          >
            <DevelopmentNotifications />
            {!manager && <WorkspaceSwitcher />}
          </header>
          {spaceReady &&
          (manager ||
            (workspace &&
              (!requestedWorkspace || workspace.id === requestedWorkspace))) ? (
            <Outlet key={manager ? "manager" : workspace!.id} />
          ) : (
            <div className="workspace-content">正在打开工作空间…</div>
          )}
        </main>
        {notification && (
          <div
            key={notification.id}
            className={`workspace-toast workspace-toast-${notification.tone}`}
            role={notification.tone === "error" ? "alert" : "status"}
          >
            {notification.tone === "error" ? (
              <AlertTriangle size={15} aria-hidden="true" />
            ) : (
              <Check size={15} aria-hidden="true" />
            )}
            <span>{notification.message}</span>
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => setNotification(null)}
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>
    </WorkspaceContext.Provider>
  );
}
