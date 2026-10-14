import { useCallback, useEffect, useState } from "react";
import { Outlet, useMatches, useLocation } from "react-router";
import { ChevronRight, FolderOpen } from "lucide-react";
import { api, setCsrf } from "./api";
import { Mark, Pairing } from "./components/workspace";
import { Sidebar } from "./components/sidebar";
import { WorkspaceContext, type Summary } from "./workspace-context";
export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<Summary>({
    total: 0,
    inProgress: 0,
    done: 0,
    trash: 0,
  });
  const location = useLocation();
  const matches = useMatches();
  const title =
    (matches.at(-1)?.handle as { title?: string } | undefined)?.title ||
    "页面不存在";
  const refreshSummary = useCallback(() => {
    void api<{ data: Summary }>("/api/v1/summary")
      .then((result) => setSummary(result.data))
      .catch(() => {});
  }, []);
  useEffect(() => {
    api<{ data: { csrf: string } }>("/auth/session")
      .then((result) => {
        setCsrf(result.data.csrf);
        setAuthenticated(true);
      })
      .catch(() => setAuthenticated(false));
    const expired = () => setAuthenticated(false);
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    document.title = `${title} · DedsiWork`;
    window.scrollTo({ top: 0 });
    if (authenticated) refreshSummary();
  }, [authenticated, location.pathname, refreshSummary, title]);
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
    return <Pairing onConnected={() => setAuthenticated(true)} />;
  return (
    <WorkspaceContext.Provider value={{ summary, setSummary, refreshSummary }}>
      <div className="app-shell">
        <Sidebar />
        <main className="main-area">
          <header className="topbar">
            <div>
              <FolderOpen size={15} />
              <span>
                {location.pathname.startsWith("/settings") ? "设置" : "工作项"}
              </span>
              <ChevronRight size={13} />
              <strong>{title}</strong>
            </div>
          </header>
          <Outlet />
        </main>
      </div>
    </WorkspaceContext.Provider>
  );
}
