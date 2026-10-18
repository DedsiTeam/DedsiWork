import { EmptyState } from "../components/empty-state";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  Plus,
  Save,
  Trash2,
  Boxes,
  FileText,
  GitBranch,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-alert-dialog";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { AssistantSource } from "../components/assistant-source";
import {
  domainModelInputSchema,
  elementKinds,
  elementLabels,
  type DomainElement,
  type DomainModel,
  type DomainModelInput,
  type ElementKind,
} from "../../shared/domain-model";

const blank: DomainModelInput = { name: "", description: "", elements: [] };
export function DomainModelPage() {
  const { id } = useParams();
  const [model, setModel] = useState<DomainModel | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setModel(null);
    setError("");
    setLoading(Boolean(id));
    if (id)
      api<{ data: DomainModel }>(
        `/api/v1/domain-models/${encodeURIComponent(id)}`,
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
  }, [id, retry]);
  return (
    <div className="workspace-content domain-models-content dm-editor-page">
      {model && <AssistantSource kind="domain-models" id={model.id} />}
      {loading ? (
        <p role="status">正在加载领域模型…</p>
      ) : error ? (
        <div className="message" role="alert">
          <p>{error}</p>
          <Button
            variant="outline"
            onClick={() => setRetry((value) => value + 1)}
          >
            重试
          </Button>{" "}
          <Link to="/domain-models">返回模型列表</Link>
        </div>
      ) : (
        <ModelEditor
          key={model?.id || "new"}
          model={model}
          onSaved={setModel}
        />
      )}
    </div>
  );
}

export function ModelEditor({
  model,
  onSaved,
  initialDraft,
  onDiscard,
  onSaveDraft,
  backTo,
}: {
  model: DomainModel | null;
  onSaved: (model: DomainModel) => void;
  initialDraft?: DomainModelInput;
  onDiscard?: () => void;
  onSaveDraft?: (draft: DomainModelInput) => Promise<DomainModel>;
  backTo?: string;
}) {
  const navigate = useNavigate();
  const initial: DomainModelInput = model
    ? {
        name: model.name,
        description: model.description,
        elements: model.elements,
      }
    : initialDraft || blank;
  const [form, setForm] = useState<DomainModelInput>(initial);
  const [selection, setSelection] = useState<{
    kind: ElementKind | null;
    id: string | null;
  }>(() => {
    try {
      const stored = model
        ? JSON.parse(
            localStorage.getItem(`dedsiwork:model-selection:${model.id}`) ||
              "null",
          )
        : null;
      if (
        stored &&
        elementKinds.includes(stored.kind) &&
        (stored.id === null ||
          model?.elements.some(
            (element) =>
              element.id === stored.id && element.kind === stored.kind,
          ))
      )
        return stored;
    } catch {}
    return { kind: null, id: null };
  });
  useEffect(() => {
    if (model) {
      try {
        localStorage.setItem(
          `dedsiwork:model-selection:${model.id}`,
          JSON.stringify(selection),
        );
      } catch {}
    }
  }, [model?.id, selection]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const skipGuard = useRef(false);
  const dirty =
    Boolean(initialDraft && !model) ||
    JSON.stringify(form) !== JSON.stringify(initial);
  const blocker = useBlocker(() => !skipGuard.current && (dirty || saving));
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function updateElement(
    id: string,
    update: (element: DomainElement) => DomainElement,
  ) {
    setForm((previous) => ({
      ...previous,
      elements: previous.elements.map((element) =>
        element.id === id ? update(element) : element,
      ),
    }));
  }
  function canAddElement(kind: ElementKind) {
    return (
      form.elements.length < 100 &&
      (kind !== "aggregate_root" ||
        !form.elements.some((element) => element.kind === "aggregate_root"))
    );
  }
  function addElement(kind: ElementKind) {
    if (!canAddElement(kind)) return;
    const elementId = crypto.randomUUID();
    setSelection({ kind, id: elementId });
    setForm((previous) => ({
      ...previous,
      elements: [
        ...previous.elements,
        {
          id: elementId,
          kind,
          name: "",
          description: "",
          fields: [],
        },
      ],
    }));
  }
  function removeElement(element: DomainElement) {
    if (
      (element.name || element.description || element.fields.length) &&
      !window.confirm(
        `移除“${element.name || elementLabels[element.kind]}”及其字段？${element.kind === "domain_event" ? "关联处理器将保留，但需要重新选择事件或一并移除。" : ""}保存模型后生效。`,
      )
    )
      return;
    const remaining = form.elements
      .filter((value) => value.id !== element.id)
      .map((value) =>
        value.kind === "event_handler" && value.eventId === element.id
          ? { ...value, eventId: null }
          : value,
      );
    setForm((previous) => ({ ...previous, elements: remaining }));
    setSelection({
      kind: element.kind,
      id: remaining.find((value) => value.kind === element.kind)?.id || null,
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const parsed = domainModelInputSchema.safeParse(form);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const index =
        issue?.path[0] === "elements" && typeof issue.path[1] === "number"
          ? issue.path[1]
          : null;
      const element = index === null ? null : form.elements[index];
      setSelection(
        element
          ? { kind: element.kind, id: element.id }
          : { kind: null, id: null },
      );
      setError(issue?.message || "请检查模型内容");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { data } =
        onSaveDraft && !model
          ? { data: await onSaveDraft(parsed.data) }
          : await api<{ data: DomainModel }>(
              model
                ? `/api/v1/domain-models/${model.id}`
                : "/api/v1/domain-models",
              {
                method: model ? "PUT" : "POST",
                body: JSON.stringify(
                  model
                    ? { expectedVersion: model.version, model: parsed.data }
                    : parsed.data,
                ),
              },
            );
      skipGuard.current = !model;
      setForm(parsed.data);
      if (blocker.state === "blocked") blocker.reset();
      if (!model) navigate(`/domain-models/${data.id}`, { replace: true });
      onSaved(data);
      setNotice("领域模型已保存");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <form
        noValidate
        onSubmit={(event) => void save(event)}
        className="dm-editor"
      >
        <div className="page-heading">
          <div>
            <h1>
              {model
                ? model.name
                : initialDraft
                  ? "预览 AI 模型"
                  : "新建领域模型"}
            </h1>
          </div>
          <div className="dm-heading-actions">
            <span
              className={`model-save-state${dirty ? " is-dirty" : ""}`}
              role="status"
            >
              {saving
                ? "保存中…"
                : dirty
                  ? initialDraft && !model
                    ? "AI 草稿 · 未保存"
                    : "未保存"
                  : model
                    ? "已保存"
                    : "未创建"}
            </span>
            {model && (
              <div className="model-view-switch" aria-label="模型视图">
                <span aria-current="page">
                  <FileText size={14} />
                  设计
                </span>
                <Link to={`/domain-models/${model.id}/diagram`}>
                  <GitBranch size={14} />
                  一张图
                </Link>
              </div>
            )}
            <Button
              variant="outline"
              asChild
              title={backTo ? "返回助手" : "返回列表"}
              aria-label={backTo ? "返回助手" : "返回列表"}
              size="icon-sm"
            >
              <Link to={backTo || "/domain-models"}>
                <ArrowLeft />
              </Link>
            </Button>
            <Button
              type="submit"
              disabled={saving}
              title={saving ? "正在保存…" : "保存模型"}
              aria-label={saving ? "正在保存…" : "保存模型"}
              size="icon-sm"
            >
              <Save />
            </Button>
          </div>
        </div>
        {error && (
          <div className="message" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="message" role="status">
            {notice}
          </div>
        )}
        <fieldset disabled={saving} className="dm-fieldset dm-workbench">
          <aside className="model-directory" aria-label="模型设计项目录">
            <button
              type="button"
              className={`model-directory-info${selection.kind === null ? " active" : ""}`}
              aria-current={selection.kind === null ? "true" : undefined}
              onClick={() => setSelection({ kind: null, id: null })}
            >
              <Boxes size={15} />
              模型信息
            </button>
            {elementKinds.map((kind) => (
              <section className="model-directory-group" key={kind}>
                <div className="model-directory-heading">
                  <button
                    type="button"
                    onClick={() =>
                      setSelection({
                        kind,
                        id:
                          form.elements.find((element) => element.kind === kind)
                            ?.id || null,
                      })
                    }
                  >
                    {elementLabels[kind]}
                    <span>
                      {
                        form.elements.filter((element) => element.kind === kind)
                          .length
                      }
                    </span>
                  </button>
                  <button
                    type="button"
                    className="model-directory-add"
                    title={
                      kind === "aggregate_root" && !canAddElement(kind)
                        ? "一个模型只能有一个聚合根"
                        : `添加${elementLabels[kind]}`
                    }
                    aria-label={`添加${elementLabels[kind]}`}
                    disabled={!canAddElement(kind)}
                    onClick={() => addElement(kind)}
                  >
                    <Plus size={13} />
                  </button>
                </div>
                {form.elements
                  .filter((element) => element.kind === kind)
                  .map((element) => (
                    <button
                      type="button"
                      className={`model-directory-item${selection.id === element.id ? " active" : ""}`}
                      key={element.id}
                      aria-current={
                        selection.id === element.id ? "true" : undefined
                      }
                      onClick={() => setSelection({ kind, id: element.id })}
                    >
                      <FileText size={13} />
                      <span>
                        {element.name || `未命名${elementLabels[kind]}`}
                      </span>
                      <small>{element.fields.length}</small>
                    </button>
                  ))}
              </section>
            ))}
          </aside>
          <div
            className="dm-inspector"
            key={selection.id || selection.kind || "info"}
          >
            {selection.kind === null && (
              <section className="dm-section">
                <div className="dm-section-heading">
                  <h2>模型信息</h2>
                  {dirty && <span className="dm-unsaved">未保存</span>}
                </div>
                <div className="dm-model-info">
                  <label>
                    模型名称 <span className="dm-required">*</span>
                    <Input
                      required
                      maxLength={100}
                      value={form.name}
                      placeholder="例如：订单模型"
                      onChange={(event) =>
                        setForm({ ...form, name: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    模型说明
                    <textarea
                      maxLength={5000}
                      rows={3}
                      value={form.description}
                      placeholder="简要说明这个模型的用途"
                      onChange={(event) =>
                        setForm({ ...form, description: event.target.value })
                      }
                    />
                  </label>
                </div>
              </section>
            )}
            {elementKinds
              .filter((kind) => kind === selection.kind)
              .map((kind) => (
                <section
                  className="dm-section"
                  id={`design-${kind}`}
                  key={kind}
                >
                  <div className="dm-section-heading">
                    <h2>
                      {elementLabels[kind]}{" "}
                      <span>
                        {
                          form.elements.filter(
                            (element) => element.kind === kind,
                          ).length
                        }
                      </span>
                    </h2>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      disabled={!canAddElement(kind)}
                      onClick={() => addElement(kind)}
                      title={"添加" + " " + elementLabels[kind]}
                      aria-label={"添加" + " " + elementLabels[kind]}
                    >
                      <Plus />
                    </Button>
                  </div>
                  {!form.elements.some((element) => element.kind === kind) && (
                    <EmptyState
                      compact
                      title={`暂无${elementLabels[kind]}`}
                      description="按需添加设计项，逐步完善模型。"
                    />
                  )}
                  {form.elements
                    .filter(
                      (element) =>
                        element.kind === kind && element.id === selection.id,
                    )
                    .map((element) => (
                      <article className="dm-element" key={element.id}>
                        <div className="dm-element-heading">
                          <label>
                            {elementLabels[kind]}名称{" "}
                            <span className="dm-required">*</span>
                            <Input
                              required
                              maxLength={100}
                              value={element.name}
                              placeholder={`输入${elementLabels[kind]}名称`}
                              onChange={(event) =>
                                updateElement(element.id, (value) => ({
                                  ...value,
                                  name: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`移除${element.name || elementLabels[kind]}`}
                            title="移除设计项（保存后生效）"
                            onClick={() => removeElement(element)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                        {kind === "event_handler" && (
                          <label className="dm-event-association">
                            对应领域事件（一个事件对应一个处理器）
                            <select
                              required
                              value={element.eventId || ""}
                              onChange={(event) =>
                                updateElement(element.id, (value) => ({
                                  ...value,
                                  eventId: event.target.value || null,
                                }))
                              }
                            >
                              <option value="">请选择领域事件</option>
                              {form.elements
                                .filter(
                                  (value) => value.kind === "domain_event",
                                )
                                .map((domainEvent) => {
                                  const occupied = form.elements.some(
                                    (value) =>
                                      value.kind === "event_handler" &&
                                      value.id !== element.id &&
                                      value.eventId === domainEvent.id,
                                  );
                                  return (
                                    <option
                                      key={domainEvent.id}
                                      value={domainEvent.id}
                                      disabled={occupied}
                                    >
                                      {domainEvent.name || "未命名事件"}
                                      {occupied ? "（已关联处理器）" : ""}
                                    </option>
                                  );
                                })}
                            </select>
                            {!form.elements.some(
                              (value) => value.kind === "domain_event",
                            ) && (
                              <span className="dm-association-hint">
                                请先在领域事件区域添加事件。
                              </span>
                            )}
                          </label>
                        )}
                        {kind === "domain_event" && (
                          <p className="dm-association-hint">
                            对应处理器：
                            {form.elements.find(
                              (value) =>
                                value.kind === "event_handler" &&
                                value.eventId === element.id,
                            )?.name || "尚未关联，请添加一个对应处理器"}
                          </p>
                        )}
                        <label className="dm-element-description">
                          说明
                          <textarea
                            maxLength={5000}
                            rows={2}
                            value={element.description}
                            placeholder="简要说明职责或用途"
                            onChange={(event) =>
                              updateElement(element.id, (value) => ({
                                ...value,
                                description: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <div className="dm-fields-heading">
                          <h3>
                            字段 <span>{element.fields.length}</span>
                          </h3>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={element.fields.length >= 100}
                            onClick={() =>
                              updateElement(element.id, (value) => ({
                                ...value,
                                fields: [
                                  ...value.fields,
                                  {
                                    id: crypto.randomUUID(),
                                    name: "",
                                    dataType: "",
                                    description: "",
                                  },
                                ],
                              }))
                            }
                            title={"添加字段"}
                            aria-label={"添加字段"}
                          >
                            <Plus />
                          </Button>
                        </div>
                        {!element.fields.length ? (
                          <EmptyState
                            compact
                            title="暂无字段"
                            description="添加字段，定义名称、类型和说明。"
                          />
                        ) : (
                          <div className="dm-fields">
                            {" "}
                            <div className="dm-field-labels" aria-hidden="true">
                              <span>字段名称 *</span>
                              <span>数据类型 *</span>
                              <span>字段说明 *</span>
                              <span />
                            </div>
                            {element.fields.map((field) => (
                              <div className="dm-field-row" key={field.id}>
                                <Input
                                  required
                                  maxLength={100}
                                  aria-label={`${element.name || elementLabels[kind]}的字段名称`}
                                  value={field.name}
                                  placeholder="例如：OrderId"
                                  onChange={(event) =>
                                    updateElement(element.id, (value) => ({
                                      ...value,
                                      fields: value.fields.map((item) =>
                                        item.id === field.id
                                          ? {
                                              ...item,
                                              name: event.target.value,
                                            }
                                          : item,
                                      ),
                                    }))
                                  }
                                />
                                <Input
                                  required
                                  maxLength={100}
                                  list="domain-data-types"
                                  aria-label={`${field.name || "字段"}的数据类型`}
                                  value={field.dataType}
                                  placeholder="输入或选择类型"
                                  onChange={(event) =>
                                    updateElement(element.id, (value) => ({
                                      ...value,
                                      fields: value.fields.map((item) =>
                                        item.id === field.id
                                          ? {
                                              ...item,
                                              dataType: event.target.value,
                                            }
                                          : item,
                                      ),
                                    }))
                                  }
                                />
                                <textarea
                                  required
                                  maxLength={2000}
                                  rows={1}
                                  aria-label={`${field.name || "字段"}的说明`}
                                  value={field.description}
                                  placeholder="说明字段含义"
                                  onChange={(event) =>
                                    updateElement(element.id, (value) => ({
                                      ...value,
                                      fields: value.fields.map((item) =>
                                        item.id === field.id
                                          ? {
                                              ...item,
                                              description: event.target.value,
                                            }
                                          : item,
                                      ),
                                    }))
                                  }
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`移除字段 ${field.name || "未命名"}`}
                                  title="移除字段（保存后生效）"
                                  onClick={() =>
                                    updateElement(element.id, (value) => ({
                                      ...value,
                                      fields: value.fields.filter(
                                        (item) => item.id !== field.id,
                                      ),
                                    }))
                                  }
                                >
                                  <Trash2 />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </article>
                    ))}
                </section>
              ))}
          </div>
        </fieldset>
        <datalist id="domain-data-types">
          {[
            "string",
            "int",
            "long",
            "decimal",
            "double",
            "bool",
            "Guid",
            "DateTime",
            "DateOnly",
            "TimeOnly",
            "byte[]",
          ].map((type) => (
            <option value={type} key={type} />
          ))}
        </datalist>
      </form>
      <Dialog.Root
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.state === "blocked") blocker.reset();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay confirmation-overlay" />
          <Dialog.Content className="confirmation-content">
            <Dialog.Title>
              {saving ? "模型正在保存" : "离开此页面？"}
            </Dialog.Title>
            <Dialog.Description>
              {saving
                ? "请等待保存完成后再离开。"
                : "当前修改尚未保存，离开后将丢失。"}
            </Dialog.Description>
            <div className="confirmation-actions">
              <Button
                variant="outline"
                onClick={() => {
                  if (blocker.state === "blocked") blocker.reset();
                }}
              >
                留在此页
              </Button>
              {!saving && (
                <Button
                  onClick={() => {
                    if (blocker.state === "blocked") {
                      onDiscard?.();
                      blocker.proceed();
                    }
                  }}
                >
                  放弃修改并离开
                </Button>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
