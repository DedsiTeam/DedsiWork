import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { Choice } from "./choice";
import { Button } from "./ui/button";
import {
  sprintLabels,
  type Sprint,
  type SprintBoard,
} from "../../shared/sprint";
import type { WorkItem } from "../../shared/work-item";

export function SprintChoice({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<{ data: Sprint[] }>("/api/v1/sprints", { signal: controller.signal })
      .then((r) => {
        setSprints(r.data.filter((s) => s.state !== "closed"));
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [attempt]);
  return (
    <div>
      <Choice
        label="选择所属冲刺"
        value={value}
        disabled={disabled}
        onChange={onChange}
        options={{
          none: "暂不安排冲刺",
          ...Object.fromEntries(
            sprints.map((s) => [s.id, `${s.name} · ${sprintLabels[s.state]}`]),
          ),
        }}
      />
      {error && (
        <p role="alert">
          {error}{" "}
          <Button
            type="button"
            variant="link"
            onClick={() => setAttempt((v) => v + 1)}
          >
            重试
          </Button>
        </p>
      )}
    </div>
  );
}

export function SprintAssignment({
  items,
  onAssigned,
}: {
  items: WorkItem[];
  onAssigned: () => void;
}) {
  const [target, setTarget] = useState("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function assign() {
    setBusy(true);
    setError("");
    try {
      const { data } = await api<{ data: SprintBoard }>(
        `/api/v1/sprints/${target}`,
      );
      await api(`/api/v1/sprints/${target}/add`, {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: data.sprint.version,
          items: items.map((i) => ({ id: i.id, expectedVersion: i.version })),
        }),
      });
      onAssigned();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sprint-assignment">
      <SprintChoice value={target} onChange={setTarget} disabled={busy} />
      <Button
        type="button"
        variant="outline"
        disabled={busy || !items.length || target === "none"}
        onClick={() => void assign()}
      >
        {busy
          ? "正在加入…"
          : `加入冲刺${items.length > 1 ? `（${items.length} 项）` : ""}`}
      </Button>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ItemSprint({ item }: { item: WorkItem }) {
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      api<{ data: Sprint | null }>(`/api/v1/work-items/${item.id}/sprint`, {
        signal: controller.signal,
      })
        .then((r) => {
          setSprint(r.data);
          setLoaded(true);
          setError("");
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [item.id, revision]);
  return (
    <div className="item-sprint">
      {error && <p role="alert">{error}</p>}
      {loaded &&
        (sprint ? (
          <Link to={`/work-items/sprints/sprint/${sprint.id}`}>
            所属冲刺：{sprint.name} · {sprintLabels[sprint.state]}
          </Link>
        ) : (
          <>
            <span>尚未安排冲刺</span>
            <SprintAssignment
              items={[item]}
              onAssigned={() => setRevision((v) => v + 1)}
            />
          </>
        ))}
    </div>
  );
}
