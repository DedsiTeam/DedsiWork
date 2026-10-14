import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Check, Plus } from "lucide-react";
import { ChatPage } from "./chat";
import { ModelEditor } from "./domain-model";
import { Button } from "../components/ui/button";
import { api } from "../api";
import { useWorkspace } from "../workspace-context";
import { priorityLabels, typeLabels } from "../../shared/work-item";
import type { AssistantDraft, AssistantFlow } from "../../shared/assistant";
import type { DomainModel } from "../../shared/domain-model";
import "../assistant.css";

export function AssistantPage() {
  const [params] = useSearchParams();
  const flowId = params.get("flow");
  return flowId ? <ProposalEditor key={flowId} id={flowId} /> : <ChatPage />;
}

function ProposalEditor({ id }: { id: string }) {
  const { notify, refreshSummary } = useWorkspace();
  const [flow, setFlow] = useState<AssistantFlow | null>(null);
  const [drafts, setDrafts] = useState<AssistantDraft[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void api<{ data: AssistantFlow }>(`/api/v1/assistant/flows/${id}`, {
      signal: controller.signal,
    })
      .then(({ data }) => {
        setFlow(data);
        setDrafts(data.drafts);
        setChecked(data.drafts.map((item) => item.draftId));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id]);
  async function confirm() {
    if (!flow || saving) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await api<{ data: AssistantFlow }>(
        `/api/v1/assistant/flows/${id}/confirm`,
        {
          method: "POST",
          body: JSON.stringify({
            confirmed: true,
            expectedRevision: flow.revision,
            items: drafts.filter((item) => checked.includes(item.draftId)),
          }),
        },
      );
      setFlow(data);
      refreshSummary();
      notify(`已创建 ${data.createdItems.length} 个工作项`);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function edit(draftId: string, patch: Partial<AssistantDraft>) {
    setDrafts((previous) =>
      previous.map((item) =>
        item.draftId === draftId ? { ...item, ...patch } : item,
      ),
    );
  }
  if (flow?.modelDraft && !flow.modelId)
    return (
      <div className="workspace-content assistant-preview">
        <ModelEditor
          model={null}
          initialDraft={flow.modelDraft}
          backTo="/assistant"
          onSaveDraft={async (draft) => {
            const { data } = await api<{ data: DomainModel }>(
              `/api/v1/assistant/flows/${id}/save-model`,
              {
                method: "POST",
                body: JSON.stringify({
                  confirmed: true,
                  expectedRevision: flow.revision,
                  model: draft,
                }),
              },
            );
            return data;
          }}
          onSaved={() => notify("领域模型已保存")}
        />
      </div>
    );
  return (
    <div className="workspace-content assistant-proposal-editor">
      <div className="page-heading">
        <h1>{flow?.modelId ? "领域模型已保存" : "预览工作项"}</h1>
        <Button asChild variant="outline">
          <Link to="/assistant">返回对话</Link>
        </Button>
      </div>
      {loading && <p role="status">正在加载草稿…</p>}
      {error && (
        <p className="message" role="alert">
          {error}
        </p>
      )}
      {flow?.modelId ? (
        <Button asChild>
          <Link to={`/domain-models/${flow.modelId}`}>打开模型</Link>
        </Button>
      ) : flow?.createdItems.length ? (
        <section className="assistant-result">
          <strong>
            <Check size={14} />
            工作项已创建
          </strong>
          {flow.createdItems.map((item) => (
            <Link key={item.id} to={`/work-items/${item.id}`}>
              {item.title}
            </Link>
          ))}
        </section>
      ) : (
        !loading && (
          <section className="assistant-drafts">
            {drafts.map((draft, index) => (
              <article className="assistant-draft" key={draft.draftId}>
                <label className="assistant-draft-check">
                  <input
                    type="checkbox"
                    checked={checked.includes(draft.draftId)}
                    disabled={saving}
                    onChange={(event) =>
                      setChecked((previous) =>
                        event.target.checked
                          ? [...previous, draft.draftId]
                          : previous.filter((id) => id !== draft.draftId),
                      )
                    }
                  />
                  工作项 {index + 1}
                </label>
                <input
                  aria-label={`工作项 ${index + 1} 标题`}
                  value={draft.title}
                  maxLength={200}
                  disabled={saving}
                  onChange={(event) =>
                    edit(draft.draftId, { title: event.target.value })
                  }
                />
                <div className="assistant-draft-options">
                  <select
                    aria-label="类型"
                    value={draft.type}
                    disabled={saving}
                    onChange={(event) =>
                      edit(draft.draftId, {
                        type: event.target.value as AssistantDraft["type"],
                      })
                    }
                  >
                    {Object.entries(typeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="优先级"
                    value={draft.priority}
                    disabled={saving}
                    onChange={(event) =>
                      edit(draft.draftId, {
                        priority: event.target
                          .value as AssistantDraft["priority"],
                      })
                    }
                  >
                    {Object.entries(priorityLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <span>待处理</span>
                </div>
                <textarea
                  aria-label={`工作项 ${index + 1} 说明`}
                  rows={5}
                  value={draft.description}
                  maxLength={20000}
                  disabled={saving}
                  onChange={(event) =>
                    edit(draft.draftId, { description: event.target.value })
                  }
                />
              </article>
            ))}
            <Button
              disabled={
                saving ||
                !checked.length ||
                drafts.some(
                  (item) =>
                    checked.includes(item.draftId) && !item.title.trim(),
                )
              }
              onClick={() => void confirm()}
            >
              <Plus />
              {saving ? "正在创建…" : `确认创建 ${checked.length} 个工作项`}
            </Button>
          </section>
        )
      )}
    </div>
  );
}
