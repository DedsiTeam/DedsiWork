import { WorkItemId } from "../components/work-item-id";
import { FocusActions, RelatedWork } from "../components/personal-actions";
import "../personal-work.css";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Editor } from "../components/editor";
import { Button } from "../components/ui/button";
import { api } from "../api";
import { useWorkspace } from "../workspace-context";
import type { WorkItem } from "../../shared/work-item";
import { AssistantSource } from "../components/assistant-source";

export function WorkItemPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshSummary, notify } = useWorkspace();
  const [item, setItem] = useState<WorkItem | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const returnTo = [
    "/work-items",
    "/work-items/in-progress",
    "/work-items/completed",
    "/work-items/trash",
  ].includes(location.state?.returnTo)
    ? location.state.returnTo
    : item?.deletedAt
      ? "/work-items/trash"
      : "/work-items";
  useEffect(() => {
    if (!id) {
      setItem(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    api<{ data: WorkItem }>(
      `/api/v1/work-items/${encodeURIComponent(id)}?includeDeleted=true`,
    )
      .then((result) => {
        if (alive) setItem(result.data);
      })
      .catch((error) => {
        if (alive) setError(error.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, attempt]);
  return (
    <div className="workspace-content editor-page-content">
      {item && !loading && (
        <div className="assistant-context-bar">
          <WorkItemId id={item.id} />
          <AssistantSource kind="work-items" id={item.id} />
          {!item.deletedAt && (
            <>
              <Button asChild size="sm">
                <Link to={`/development-tasks/new/items/${item.id}`}>
                  开始研发
                </Link>
              </Button>
              <FocusActions id={item.id} />
            </>
          )}
          {!item.deletedAt && (
            <Link
              to={`/assistant/items/${item.id}`}
              className="assistant-context-link"
            >
              用此工作项设计领域模型
            </Link>
          )}
        </div>
      )}
      {item && !loading && <RelatedWork id={item.id} />}
      {loading ? (
        <p role="status">正在加载工作项…</p>
      ) : error ? (
        <div className="message" role="alert">
          <p>{error}</p>
          <Button
            variant="outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            重试
          </Button>{" "}
          <Link to="/work-items">返回工作项列表</Link>
        </div>
      ) : (
        <Editor
          key={item ? `${item.id}:${item.version}` : "new"}
          item={item}
          onClose={() => {
            refreshSummary();
            navigate(returnTo);
          }}
          onSaved={(saved) => {
            setItem(saved);
            refreshSummary();
            if (!id)
              navigate(`/work-items/${saved.id}`, {
                replace: true,
                state: { returnTo },
              });
          }}
          onNotice={notify}
        />
      )}
    </div>
  );
}
