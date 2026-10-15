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
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [result, setResult] = useState<Page<WorkItem>>({
    data: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  });
  useEffect(() => {
    const controller = new AbortController(),
      timer = setTimeout(() => {
        setLoading(true);
        setError("");
        api<Page<WorkItem>>(
          `/api/v1/work-items?${new URLSearchParams({ q: search, page: String(page), pageSize: "20" })}`,
          { signal: controller.signal },
        )
          .then(setResult)
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
  }, [search, page]);
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
              <p>没有找到工作项。</p>
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
              {page} / {Math.max(1, Math.ceil(result.meta.total / 20))}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page * 20 >= result.meta.total}
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
