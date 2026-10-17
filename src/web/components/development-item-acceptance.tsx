import { descriptionContent } from "./rich-text";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { Button } from "./ui/button";
import { Choice } from "./choice";
import { statusLabels, type WorkItem } from "../../shared/work-item";
import type { DevelopmentTask } from "../../shared/development-task";
export function DevelopmentItemAcceptance({
  task,
  onTask,
  onRevise,
}: {
  task: DevelopmentTask;
  onTask?: (task: DevelopmentTask) => void;
  onRevise?: (text: string) => void;
}) {
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  async function saveEvidence(itemId: string) {
    setBusy(true);
    setError("");
    try {
      const { data } = await api<{ data: DevelopmentTask }>(
        `/api/v1/development-tasks/${task.id}/acceptance-evidence`,
        {
          method: "POST",
          body: JSON.stringify({
            itemId,
            text:
              evidence[itemId] ?? task.acceptanceEvidence?.[itemId]?.text ?? "",
            expectedVersion: task.version,
          }),
        },
      );
      onTask?.(data);
      setNotice("验收依据已保存，可在下次打开时继续核对。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
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
        .filter(Boolean)
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
            <Link to={`/work-items/${i.id}`}>查看工作项及验收要求</Link>
            <details>
              <summary>需求与验收要求</summary>
              {typeof descriptionContent(i.description) === "string" ? (
                <div
                  dangerouslySetInnerHTML={{
                    __html: descriptionContent(i.description) as string,
                  }}
                />
              ) : (
                <p>
                  {i.description ||
                    "此工作项尚未填写详细要求，请打开工作项补充。"}
                </p>
              )}
            </details>
            <label>
              验收依据
              <textarea
                rows={3}
                maxLength={12000}
                value={
                  evidence[i.id] ?? task.acceptanceEvidence?.[i.id]?.text ?? ""
                }
                placeholder="记录实际检查步骤、结果、截图或文件位置；未验证的内容请注明。"
                onChange={(event) =>
                  setEvidence((previous) => ({
                    ...previous,
                    [i.id]: event.target.value,
                  }))
                }
                disabled={busy || task.restored}
              />
            </label>
            {task.acceptanceEvidence?.[i.id] &&
              task.acceptanceEvidence[i.id]!.deliveryId !==
                (task.deliveryHistory?.at(-1)?.id || null) && (
                <p className="dev-help">
                  此依据对应较早交付，请针对本次修改重新核对。
                </p>
              )}
            <div className="dev-actions">
              <Button
                variant="outline"
                disabled={busy || task.restored}
                onClick={() => void saveEvidence(i.id)}
              >
                保存验收依据
              </Button>
              {onRevise && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    onRevise(
                      `请继续修改工作项「${i.title}」（${i.id}）。\n验收反馈：${evidence[i.id] ?? task.acceptanceEvidence?.[i.id]?.text ?? ""}\n需要调整：`,
                    )
                  }
                >
                  提出修改
                </Button>
              )}
            </div>
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
