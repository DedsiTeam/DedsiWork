import { EmptyState } from "../components/empty-state";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  GitBranch,
  ListTree,
  Maximize,
  Minus,
  Plus,
  RefreshCw,
  FileText,
} from "lucide-react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import {
  elementKinds,
  elementLabels,
  type DomainElement,
  type DomainModel,
  type ElementKind,
} from "../../shared/domain-model";

export function DomainModelDiagramPage() {
  const { id } = useParams();
  const [model, setModel] = useState<DomainModel | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setModel(null);
    api<{ data: DomainModel }>(
      `/api/v1/domain-models/${encodeURIComponent(id || "")}`,
      { signal: controller.signal },
    )
      .then(({ data }) => {
        if (!controller.signal.aborted) setModel(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, revision]);
  return (
    <div className="workspace-content dm-diagram-page">
      <div className="page-heading">
        <div>
          <h1>{model?.name || "领域模型"}</h1>
        </div>
        <div className="dm-diagram-actions">
          {model && (
            <div className="model-view-switch" aria-label="模型视图">
              <Link to={`/domain-models/${model.id}`}>
                <FileText size={14} />
                设计
              </Link>
              <span aria-current="page">
                <GitBranch size={14} />
                一张图
              </span>
            </div>
          )}
          <Button variant="outline" asChild>
            <Link to="/domain-models">
              <ArrowLeft />
              返回列表
            </Link>
          </Button>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw />
            刷新
          </Button>
        </div>
      </div>
      {loading ? (
        <p role="status">正在加载模型结构…</p>
      ) : error ? (
        <div className="message" role="alert">
          {error}
          <Button
            variant="ghost"
            onClick={() => setRevision((value) => value + 1)}
          >
            重试
          </Button>
        </div>
      ) : (
        model && (
          <ModelTree key={`${model.id}:${model.version}`} model={model} />
        )
      )}
    </div>
  );
}

function Branch({ node, children }: { node: ReactNode; children?: ReactNode }) {
  return (
    <div className="dm-tree-branch">
      {node}
      {children && <ul className="dm-tree-children">{children}</ul>}
    </div>
  );
}

function ElementCard({
  element,
  model,
  showFields,
}: {
  element: DomainElement;
  model: DomainModel;
  showFields: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = showFields || expanded;
  const paired =
    element.kind === "event_handler"
      ? model.elements.find(
          (value) =>
            value.kind === "domain_event" && value.id === element.eventId,
        )
      : element.kind === "domain_event"
        ? model.elements.find(
            (value) =>
              value.kind === "event_handler" && value.eventId === element.id,
          )
        : undefined;
  return (
    <article className={`dm-tree-node dm-tree-element dm-tree-${element.kind}`}>
      <h3>{element.name}</h3>
      {element.description && (
        <p className="dm-tree-description">{element.description}</p>
      )}
      {(element.kind === "domain_event" ||
        element.kind === "event_handler") && (
        <p className="dm-tree-pair">
          <GitBranch size={13} />
          <span>
            {element.kind === "domain_event" ? "对应处理器" : "对应事件"}：
            {paired?.name || "尚未关联"}
          </span>
        </p>
      )}
      <button
        type="button"
        className="dm-tree-fields-toggle"
        aria-expanded={visible}
        aria-controls={`tree-fields-${element.id}`}
        disabled={showFields}
        onClick={() => setExpanded((value) => !value)}
      >
        {visible ? <ChevronDown size={14} /> : <ChevronRight size={14} />}字段{" "}
        <span>{element.fields.length}</span>
      </button>
      {visible && (
        <div id={`tree-fields-${element.id}`} className="dm-tree-fields">
          {element.fields.length ? (
            element.fields.map((field) => (
              <div className="dm-tree-field" key={field.id}>
                <div>
                  <strong>{field.name}</strong>
                  <code>{field.dataType}</code>
                </div>
                <p>{field.description}</p>
              </div>
            ))
          ) : (
            <EmptyState
              compact
              title="暂无字段"
              description="在设计页添加字段后即可查看。"
            />
          )}
        </div>
      )}
    </article>
  );
}

function treePreferences(id: string) {
  const fallback = {
    collapsed: {} as Partial<Record<ElementKind, boolean>>,
    showFields: false,
    scale: 1,
  };
  try {
    const saved = JSON.parse(
      localStorage.getItem(`dedsiwork:model-tree:${id}`) || "null",
    );
    if (!saved || typeof saved !== "object") return fallback;
    return {
      collapsed: Object.fromEntries(
        elementKinds.map((kind) => [kind, saved.collapsed?.[kind] === true]),
      ),
      showFields: saved.showFields === true,
      scale:
        typeof saved.scale === "number" && Number.isFinite(saved.scale)
          ? Math.min(1.5, Math.max(0.3, saved.scale))
          : 1,
    };
  } catch {
    return fallback;
  }
}
function ModelTree({ model }: { model: DomainModel }) {
  const preferences = useRef(treePreferences(model.id));
  const [collapsed, setCollapsed] = useState<
    Partial<Record<ElementKind, boolean>>
  >(preferences.current.collapsed);
  const [showFields, setShowFields] = useState(preferences.current.showFields);
  const [scale, setScale] = useState(preferences.current.scale);
  useEffect(() => {
    try {
      localStorage.setItem(
        `dedsiwork:model-tree:${model.id}`,
        JSON.stringify({ collapsed, showFields, scale }),
      );
    } catch {}
  }, [model.id, collapsed, showFields, scale]);
  const [dimensions, setDimensions] = useState({ width: 1000, height: 800 });
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pan = useRef<{
    pointer: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  useEffect(() => {
    const node = content.current;
    if (!node) return;
    const observer = new ResizeObserver(() =>
      setDimensions({ width: node.offsetWidth, height: node.offsetHeight }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const zoom = (value: number) =>
    setScale(Math.min(1.5, Math.max(0.3, Math.round(value * 100) / 100)));
  function fit() {
    if (!viewport.current) return;
    zoom((viewport.current.clientWidth - 64) / dimensions.width);
    viewport.current.scrollTo({ left: 0, top: 0 });
  }
  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (
      event.button !== 0 ||
      (event.target as Element).closest(".dm-tree-node")
    )
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pan.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: event.currentTarget.scrollLeft,
      top: event.currentTarget.scrollTop,
    };
  }
  function movePan(event: PointerEvent<HTMLDivElement>) {
    const value = pan.current;
    if (!value || value.pointer !== event.pointerId) return;
    event.currentTarget.scrollLeft = value.left - (event.clientX - value.x);
    event.currentTarget.scrollTop = value.top - (event.clientY - value.y);
  }
  const events = model.elements.filter(
    (element) => element.kind === "domain_event",
  );
  function elementsFor(kind: ElementKind) {
    const elements = model.elements.filter((element) => element.kind === kind);
    if (kind !== "event_handler") return elements;
    const order = (element: DomainElement) => {
      const index = events.findIndex((event) => event.id === element.eventId);
      return index < 0 ? events.length : index;
    };
    return elements.sort((left, right) => order(left) - order(right));
  }
  return (
    <section className="dm-diagram" aria-label={`${model.name}的领域模型树图`}>
      <div className="dm-diagram-toolbar">
        <div>
          <Button
            variant={showFields ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={showFields ? "收起全部字段" : "展开全部字段"}
            title={showFields ? "收起全部字段" : "展开全部字段"}
            aria-pressed={showFields}
            onClick={() => setShowFields((value) => !value)}
          >
            <ListTree />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="适应宽度"
            title="适应宽度"
            onClick={fit}
          >
            <Maximize />
          </Button>
        </div>
      </div>
      <div className="dm-diagram-zoom" role="group" aria-label="模型图缩放">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="缩小模型图"
          disabled={scale <= 0.3}
          onClick={() => zoom(scale - 0.1)}
        >
          <Minus />
        </Button>
        <button
          className="dm-diagram-scale"
          type="button"
          title="恢复 100%"
          onClick={() => zoom(1)}
        >
          {Math.round(scale * 100)}%
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="放大模型图"
          disabled={scale >= 1.5}
          onClick={() => zoom(scale + 0.1)}
        >
          <Plus />
        </Button>
      </div>
      <div
        ref={viewport}
        className="dm-diagram-viewport"
        tabIndex={0}
        aria-label="模型图画布，可滚动或拖动画布空白处"
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={() => {
          pan.current = null;
        }}
        onPointerCancel={() => {
          pan.current = null;
        }}
        onLostPointerCapture={() => {
          pan.current = null;
        }}
      >
        <div
          className="dm-diagram-stage"
          style={{
            width: dimensions.width * scale + 64,
            height: dimensions.height * scale + 64,
          }}
        >
          <div
            ref={content}
            className="dm-tree"
            style={{ transform: `scale(${scale})` }}
          >
            <Branch
              node={
                <article className="dm-tree-node dm-tree-root">
                  <span>领域模型</span>
                  <h2>{model.name}</h2>
                  {model.description && (
                    <p className="dm-tree-description">{model.description}</p>
                  )}
                  <small>
                    {model.elements.length} 个设计项 ·{" "}
                    {model.elements.reduce(
                      (count, element) => count + element.fields.length,
                      0,
                    )}{" "}
                    个字段
                  </small>
                </article>
              }
            >
              {elementKinds.map((kind, index) => {
                const elements = elementsFor(kind);
                return (
                  <li key={kind}>
                    <Branch
                      node={
                        <button
                          type="button"
                          className={`dm-tree-node dm-tree-category dm-tree-${kind}`}
                          aria-expanded={!collapsed[kind]}
                          aria-controls={`tree-group-${kind}`}
                          onClick={() =>
                            setCollapsed((previous) => ({
                              ...previous,
                              [kind]: !previous[kind],
                            }))
                          }
                        >
                          <span className="dm-tree-order">0{index + 1}</span>
                          <strong>{elementLabels[kind]}</strong>
                          <span className="dm-tree-count">
                            {elements.length}
                          </span>
                          {collapsed[kind] ? (
                            <ChevronRight size={14} />
                          ) : (
                            <ChevronDown size={14} />
                          )}
                        </button>
                      }
                    >
                      {!collapsed[kind] && (
                        <li
                          className="dm-tree-group-wrapper"
                          id={`tree-group-${kind}`}
                        >
                          <ul className="dm-tree-group">
                            {elements.length ? (
                              elements.map((element) => (
                                <li key={element.id}>
                                  <ElementCard
                                    element={element}
                                    model={model}
                                    showFields={showFields}
                                  />
                                </li>
                              ))
                            ) : (
                              <li>
                                <EmptyState
                                  compact
                                  title={`暂无${elementLabels[kind]}`}
                                  description="在设计页添加对应设计项。"
                                />
                              </li>
                            )}
                          </ul>
                        </li>
                      )}
                    </Branch>
                  </li>
                );
              })}
            </Branch>
          </div>
        </div>
      </div>
    </section>
  );
}
