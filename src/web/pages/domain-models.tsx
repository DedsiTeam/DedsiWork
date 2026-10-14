import { useEffect, useState } from "react";
import { Link } from "react-router";
import * as Dialog from "@radix-ui/react-alert-dialog";
import {
  Boxes,
  GitBranch,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import type {
  DomainModelList,
  DomainModelSummary,
} from "../../shared/domain-model";

export function DomainModelsPage() {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<DomainModelList>({
    data: [],
    meta: { total: 0, page: 1, pageSize: 20 },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [target, setTarget] = useState<DomainModelSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<DomainModelList>(
      `/api/v1/domain-models?${new URLSearchParams({ q, page: String(page) })}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [q, page, revision]);
  async function remove() {
    if (!target || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api(`/api/v1/domain-models/${target.id}`, {
        method: "DELETE",
        headers: { "If-Match": String(target.version) },
      });
      setTarget(null);
      if (result.data.length === 1 && page > 1) setPage(page - 1);
      else setRevision((value) => value + 1);
    } catch (error) {
      setDeleteError((error as Error).message);
    } finally {
      setDeleting(false);
    }
  }
  return (
    <div className="workspace-content domain-models-content">
      <div className="page-heading">
        <div>
          <h1>
            领域模型<span className="title-count">{result.meta.total}</span>
          </h1>
        </div>
        <div className="dm-heading-actions">
          <Button asChild>
            <Link to="/domain-models/new">
              <Plus />
              新建领域模型
            </Link>
          </Button>
        </div>
      </div>
      <section
        className="dm-list"
        aria-label="领域模型列表"
        aria-busy={loading}
      >
        <div className="dm-list-toolbar">
          <label className="dm-search">
            <Search size={16} />
            <Input
              aria-label="搜索领域模型"
              placeholder="搜索模型名称或说明…"
              value={search}
              maxLength={200}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="刷新领域模型"
            disabled={loading || deleting}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw />
          </Button>
        </div>
        {error && (
          <div className="message" role="alert">
            {error}
            <Button
              variant="ghost"
              onClick={() => setRevision((value) => value + 1)}
            >
              重试
            </Button>
          </div>
        )}
        {loading ? (
          <p className="dm-empty" role="status">
            正在加载领域模型…
          </p>
        ) : !error && result.data.length === 0 ? (
          <div className="dm-empty">
            <Boxes size={32} />
            <h2>{q ? "没有找到匹配的模型" : "创建第一个领域模型"}</h2>
            <p>
              {q
                ? "试试其他名称或关键词。"
                : "在一个模型中组织五类设计项，并定义每个字段的类型和说明。"}
            </p>
            {!q && (
              <Button asChild>
                <Link to="/domain-models/new">
                  <Plus />
                  新建领域模型
                </Link>
              </Button>
            )}
          </div>
        ) : (
          !error && (
            <div className="model-collection" role="list">
              {result.data.map((model) => (
                <article className="model-entry" role="listitem" key={model.id}>
                  <Link
                    className="model-entry-main"
                    to={`/domain-models/${model.id}`}
                  >
                    <span className="model-entry-icon">
                      <Boxes size={18} strokeWidth={1.5} />
                    </span>
                    <div className="model-entry-copy">
                      <h2>{model.name}</h2>
                      {model.description && (
                        <p title={model.description}>{model.description}</p>
                      )}
                      <div className="model-entry-meta">
                        <span>{model.elementCount} 个设计项</span>
                        <span>{model.fieldCount} 个字段</span>
                        <time dateTime={model.updatedAt}>
                          {new Date(model.updatedAt).toLocaleDateString(
                            "zh-CN",
                          )}{" "}
                          更新
                        </time>
                      </div>
                    </div>
                  </Link>
                  <div className="dm-row-actions row-reveal">
                    <Button variant="ghost" size="icon-sm" asChild>
                      <Link
                        to={`/domain-models/${model.id}/diagram`}
                        aria-label={`查看 ${model.name} 的领域模型一张图`}
                        title="一张图"
                      >
                        <GitBranch />
                      </Link>
                    </Button>
                    <Button variant="ghost" size="icon-sm" asChild>
                      <Link
                        to={`/domain-models/${model.id}`}
                        aria-label={`编辑 ${model.name}`}
                        title="编辑模型"
                      >
                        <Pencil />
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`删除 ${model.name}`}
                      title="删除模型"
                      disabled={deleting}
                      onClick={() => {
                        setDeleteError("");
                        setTarget(model);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )
        )}
        <footer className="list-footer">
          <span>共 {result.meta.total} 个模型</span>
          <div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="上一页"
              disabled={page === 1 || loading || deleting}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft />
            </Button>
            <span>
              {page} / {Math.max(1, Math.ceil(result.meta.total / 20))}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="下一页"
              disabled={page * 20 >= result.meta.total || loading || deleting}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </footer>
      </section>
      <Dialog.Root
        open={Boolean(target)}
        onOpenChange={(open) => {
          if (!open && !deleting) setTarget(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay confirmation-overlay" />
          <Dialog.Content className="confirmation-content">
            <Dialog.Title>删除领域模型？</Dialog.Title>
            <Dialog.Description>
              “{target?.name}”及其全部设计项和字段将从列表中移除。
            </Dialog.Description>
            {deleteError && (
              <p className="message" role="alert">
                {deleteError}
              </p>
            )}
            <div className="confirmation-actions">
              <Dialog.Cancel asChild>
                <Button variant="outline" disabled={deleting}>
                  取消
                </Button>
              </Dialog.Cancel>
              <Button disabled={deleting} onClick={() => void remove()}>
                {deleting ? "正在删除…" : "确认删除"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
