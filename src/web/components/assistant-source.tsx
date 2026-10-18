import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Sparkles } from "lucide-react";
import { api } from "../api";
import type { AssistantProvenance } from "../../shared/assistant";
export function AssistantSource({
  kind,
  id,
}: {
  kind: "work-items" | "domain-models";
  id: string;
}) {
  const [source, setSource] = useState<AssistantProvenance | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setSource(null);
    api<{ data: AssistantProvenance | null }>(
      `/api/v1/assistant/sources/${kind}/${id}`,
      { signal: controller.signal },
    )
      .then(({ data }) => {
        if (!controller.signal.aborted) setSource(data);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [kind, id]);
  if (!source) return null;
  return (
    <div className="assistant-provenance">
      <Sparkles size={13} />
      <Link to={`/assistant/flow/${source.flowId}`} title={source.requirement}>
        查看来源需求
      </Link>
      {source.items?.map((item) => (
        <Link
          key={item.id}
          title={`生成时版本 ${item.version}`}
          to={`/work-items/${item.id}`}
        >
          {item.title}
        </Link>
      ))}
    </div>
  );
}
