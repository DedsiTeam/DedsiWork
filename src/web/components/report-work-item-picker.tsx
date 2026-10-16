import { PAGE_SIZE } from "../../shared/pagination";
import { EmptyState } from "./empty-state";
import { Choice } from "./choice";
import type { Sprint, SprintBoard } from "../../shared/sprint";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { api } from "../api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { statusLabels, type WorkItem, type Page } from "../../shared/work-item";
export function ReportWorkItemPicker({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (item: WorkItem) => void;
}) {
  const [scope, setScope] = useState("sprint");
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [result, setResult] = useState<Page<WorkItem>>({
    data: [],
    meta: { page: 1, pageSize: PAGE_SIZE, total: 0 },
  });
  useEffect(() => {
    const controller = new AbortController(),
      timer = setTimeout(() => {
        setLoading(true);
        setError("");
        (async () => {
          if (scope === "all")
            return api<Page<WorkItem>>(
              `/api/v1/work-items?${new URLSearchParams({ q: search, page: String(page), pageSize: String(PAGE_SIZE) })}`,
              { signal: controller.signal },
            );
          const { data: sprints } = await api<{ data: Sprint[] }>(
            "/api/v1/sprints",
            { signal: controller.signal },
          );
          const current = sprints.find((s) => s.state === "active");
          if (!current)
            return {
              data: [],
              meta: { page: 1, pageSize: PAGE_SIZE, total: 0 },
            };
          const { data: board } = await api<{ data: SprintBoard }>(
            `/api/v1/sprints/${current.id}`,
            { signal: controller.signal },
          );
          const items = board.items.filter((i) =>
            `${i.title} ${i.description}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          );
          return {
            data: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
            meta: { page, pageSize: PAGE_SIZE, total: items.length },
          };
        })()
          .then((r) => {
            if (!controller.signal.aborted) setResult(r);
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(e.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, page, scope]);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="confirmation-content report-work-picker">
          <Dialog.Title>关联工作项</Dialog.Title>
          <Dialog.Description>
            选择当前工作空间的工作项。日报保留当天的内容快照，工作项后续变化不会覆盖日报。
          </Dialog.Description>
          <Choice
            label="工作项来源"
            value={scope}
            onChange={(v) => {
              setScope(v);
              setPage(1);
            }}
            options={{ sprint: "当前冲刺", all: "全部工作项" }}
          />
          <Input
            aria-label="搜索关联工作项"
            placeholder="搜索工作项标题或描述…"
            value={search}
            maxLength={200}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <div className="report-work-picker-list">
            {loading ? (
              <p role="status">正在加载…</p>
            ) : error ? (
              <p role="alert">{error}</p>
            ) : !result.data.length ? (
              <EmptyState
                compact
                title="没有可关联的工作项"
                description={
                  scope === "sprint"
                    ? "切换到全部工作项，或调整筛选条件。"
                    : "试试其他关键词。"
                }
              />
            ) : (
              result.data.map((item) => (
                <button key={item.id} onClick={() => onSelect(item)}>
                  <strong>{item.title}</strong>
                  <span>
                    {statusLabels[item.status]}
                    {item.blockedReason ? " · 有阻碍" : ""}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="report-pagination">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((v) => v - 1)}
            >
              上一页
            </Button>
            <span>
              {page} / {Math.max(1, Math.ceil(result.meta.total / PAGE_SIZE))}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page * PAGE_SIZE >= result.meta.total}
              onClick={() => setPage((v) => v + 1)}
            >
              下一页
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              取消
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
