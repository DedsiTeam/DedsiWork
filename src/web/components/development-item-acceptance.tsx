import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { Button } from "./ui/button";
import { Choice } from "./choice";
import { statusLabels, type WorkItem } from "../../shared/work-item";
import type { DevelopmentTask } from "../../shared/development-task";
export function DevelopmentItemAcceptance({ task }: { task: DevelopmentTask }) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState("awaiting_acceptance");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const ids = task.sources.items.map((i) => i.id).join(",");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSelected([]);
    Promise.allSettled(
      ids
        .split(",")
        .map((id) =>
          api<{ data: WorkItem }>(
            `/api/v1/work-items/${id}?includeDeleted=true`,
            { signal: controller.signal },
          ),
        ),
    ).then((results) => {
      if (controller.signal.aborted) return;
      setItems(
        results.flatMap((r) =>
          r.status === "fulfilled" ? [r.value.data] : [],
        ),
      );
      setError(
        results.some((r) => r.status === "rejected")
          ? "部分工作项无法读取，可能已永久删除；可刷新后重试。"
          : "",
      );
      setLoading(false);
    });
    return () => controller.abort();
  }, [ids, revision]);
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { data } = await api<{ data: WorkItem[] }>(
        `/api/v1/development-tasks/${task.id}/update-items`,
        {
          method: "POST",
          body: JSON.stringify({
            status,
            items: items
              .filter((i) => selected.includes(i.id))
              .map((i) => ({ id: i.id, expectedVersion: i.version })),
          }),
        },
      );
      setItems((previous) =>
        previous.map((i) => data.find((v) => v.id === i.id) || i),
      );
      setSelected([]);
      setNotice(`已更新 ${data.length} 个工作项，看板将同步显示。`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="dev-panel development-acceptance">
      <h2>关联工作项验收</h2>
      <p>核对工作项后再更新状态；研发任务的完成状态单独保留。</p>
      {loading ? (
        <p role="status">正在读取最新工作项…</p>
      ) : (
        items.map((i) => (
          <div className="acceptance-item" key={i.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(i.id)}
                disabled={
                  busy ||
                  !!i.deletedAt ||
                  ["done", "cancelled"].includes(i.status)
                }
                onChange={(e) =>
                  setSelected((previous) =>
                    e.target.checked
                      ? [...previous, i.id]
                      : previous.filter((id) => id !== i.id),
                  )
                }
              />{" "}
              {i.title} · {i.deletedAt ? "已删除" : statusLabels[i.status]}
            </label>{" "}
            <Link to={`/work-items/${i.id}`}>查看工作项</Link>
          </div>
        ))
      )}
      <div className="dev-actions">
        <Choice
          label="验收后工作项状态"
          value={status}
          onChange={setStatus}
          disabled={busy}
          options={{
            awaiting_acceptance: "提交待验收",
            done: "验收通过，标记完成",
          }}
        />
        <Button
          disabled={busy || loading || !selected.length}
          onClick={() => void save()}
        >
          更新所选工作项（{selected.length}）
        </Button>
        <Button
          variant="outline"
          disabled={busy || loading}
          onClick={() => setRevision((v) => v + 1)}
        >
          刷新工作项
        </Button>
      </div>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
