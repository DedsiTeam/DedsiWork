import { useEffect, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import * as Dialog from "@radix-ui/react-alert-dialog";
import {
  App,
  Box,
  Group,
  Rect,
  Ellipse,
  Polygon,
  Text,
  Image as CanvasImage,
  EditorEvent,
  PropertyEvent,
  type UI,
} from "leafer-editor";
import {
  ArrowLeft,
  Type,
  ImagePlus,
  Square,
  Circle,
  Triangle,
  Trash2,
  Download,
  Save,
  Scan,
  Minus,
  Plus,
  Bold,
  Layers2,
  ArrowUpToLine,
  ArrowDownToLine,
  MousePointer2,
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
} from "lucide-react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useWorkspace } from "../workspace-context";
import {
  canvasContentSchema,
  canvasNoteInputSchema,
  canvasNodeSchema,
  nodeLabels,
  fontOptions,
  fontStacks,
  type CanvasContent,
  type CanvasNode,
  type CanvasNote,
} from "../../shared/canvas-note";
import "../notes.css";
type Scene = {
  app: App;
  group: Group;
  entries: Map<string, { data: CanvasNode; node: UI }>;
  snapshot: () => CanvasContent;
  add: (data: CanvasNode) => void;
};
const empty: CanvasContent = { nodes: [] };
function regular(kind: CanvasNode["kind"]) {
  return kind === "circle" || kind === "equilateral";
}
function isShape(kind: CanvasNode["kind"]) {
  return kind !== "text" && kind !== "image";
}
function labelStyle(data: CanvasNode) {
  const triangle = data.kind === "triangle" || data.kind === "equilateral";
  const round = data.kind === "ellipse" || data.kind === "circle";
  const x = triangle
    ? data.width * 0.25
    : round
      ? data.width * 0.15
      : Math.min(12, data.width / 8);
  const y = triangle
    ? data.height * 0.45
    : round
      ? data.height * 0.15
      : Math.min(8, data.height / 8);
  return {
    x,
    y,
    width: Math.max(1, data.width - 2 * x),
    height: Math.max(1, triangle ? data.height * 0.45 : data.height - 2 * y),
    text: data.text,
    fontSize: data.fontSize,
    fontFamily: fontStacks[data.fontFamily],
    fontWeight: data.bold ? ("bold" as const) : ("normal" as const),
    fill: data.textColor,
    textAlign: "center" as const,
    verticalAlign: "middle" as const,
    textOverflow: "ellipsis" as const,
    hittable: false,
  };
}
function shapeStyle(data: CanvasNode) {
  return {
    width: data.width,
    height: data.height,
    fill: data.fill,
    stroke: data.stroke,
    strokeWidth: data.strokeWidth,
    hittable: false,
    ...(data.kind === "triangle" || data.kind === "equilateral"
      ? {
          points: [data.width / 2, 0, data.width, data.height, 0, data.height],
          closed: true,
        }
      : {}),
  };
}
function makeNode(data: CanvasNode): UI {
  const common = {
    id: data.id,
    x: data.x,
    y: data.y,
    width: data.width,
    height: data.height,
    scaleX: data.scaleX,
    scaleY: data.scaleY,
    rotation: data.rotation,
    editable: true,
    fill: data.fill,
    stroke: data.stroke,
    strokeWidth: data.strokeWidth,
  };
  if (data.kind === "text")
    return new Text({
      ...common,
      text: data.text,
      fontSize: data.fontSize,
      fontFamily: fontStacks[data.fontFamily],
      fontWeight: data.bold ? "bold" : "normal",
      strokeWidth: 0,
      verticalAlign: "top",
    });
  if (data.kind === "image")
    return new CanvasImage({ ...common, url: data.src, strokeWidth: 0 });
  const box = new Box({
    ...common,
    fill: undefined,
    stroke: undefined,
    strokeWidth: 0,
    hitBox: true,
    hitChildren: false,
    textBox: true,
    editConfig: { editSize: "scale", lockRatio: regular(data.kind) },
  });
  const background =
    data.kind === "ellipse" || data.kind === "circle"
      ? new Ellipse(shapeStyle(data))
      : data.kind === "triangle" || data.kind === "equilateral"
        ? new Polygon(shapeStyle(data))
        : new Rect({ ...shapeStyle(data), cornerRadius: 8 });
  box.add(background);
  box.add(new Text(labelStyle(data)));
  return box;
}
function readNode(data: CanvasNode, node: UI): CanvasNode {
  const shape = isShape(data.kind),
    background = shape ? (node as Box).children[0] : node;
  const label =
    data.kind === "text"
      ? (node as Text)
      : shape
        ? ((node as Box).children[1] as Text)
        : null;
  return {
    ...data,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    scaleX: node.scaleX,
    scaleY: node.scaleY,
    rotation: node.rotation,
    fill: typeof background.fill === "string" ? background.fill : data.fill,
    stroke:
      typeof background.stroke === "string" ? background.stroke : data.stroke,
    strokeWidth:
      typeof background.strokeWidth === "number"
        ? background.strokeWidth
        : data.strokeWidth,
    ...(label
      ? {
          text: label.text,
          fontSize: label.fontSize,
          bold: label.fontWeight === "bold",
          ...(shape && typeof label.fill === "string"
            ? { textColor: label.fill }
            : {}),
        }
      : {}),
  };
}
function applyNode(node: UI, data: CanvasNode) {
  node.set({
    x: data.x,
    y: data.y,
    width: data.width,
    height: data.height,
    scaleX: data.scaleX,
    scaleY: data.scaleY,
    rotation: data.rotation,
  });
  if (isShape(data.kind)) {
    const box = node as Box;
    box.children[0].set(shapeStyle(data));
    box.children[1].set(labelStyle(data));
  } else if (data.kind === "text")
    node.set({
      text: data.text,
      fontSize: data.fontSize,
      fontFamily: fontStacks[data.fontFamily],
      fontWeight: data.bold ? "bold" : "normal",
      fill: data.fill,
    });
}
async function imageData(file: File) {
  if (
    !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)
  )
    throw new Error("请选择 PNG、JPG、WebP 或 GIF 图片");
  if (file.size > 15 * 1024 * 1024) throw new Error("单张原图不能超过 15 MB");
  const url = URL.createObjectURL(file);
  try {
    const image = new window.Image();
    image.src = url;
    await image.decode();
    const ratio = Math.min(
      1,
      1600 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理图片");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let src = canvas.toDataURL("image/webp", 0.85);
    if (src.length > 2800000) src = canvas.toDataURL("image/webp", 0.65);
    if (src.length > 2800000) throw new Error("图片过大，请选择尺寸更小的图片");
    return { src, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function NotePage() {
  const { id } = useParams(),
    navigate = useNavigate(),
    { notify } = useWorkspace();
  const [note, setNote] = useState<CanvasNote | null>(null),
    [initial, setInitial] = useState<CanvasContent | null>(id ? null : empty),
    [name, setName] = useState("未命名无边记"),
    [savedName, setSavedName] = useState("未命名无边记");
  const [loading, setLoading] = useState(!!id),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [selected, setSelected] = useState<CanvasNode | null>(null),
    [selection, setSelection] = useState<CanvasNode[]>([]),
    [gap, setGap] = useState(24),
    [removeTarget, setRemoveTarget] = useState<string[] | null>(null),
    [count, setCount] = useState(0),
    [zoom, setZoom] = useState(100);
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<Scene | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    skipGuard = useRef(false),
    change = useRef(() => {});
  const baseline = useRef(JSON.stringify(empty));
  const blocker = useBlocker(
    () => !skipGuard.current && (dirty || name !== savedName || busy),
  );
  useEffect(() => {
    if (!dirty && name === savedName) return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, name, savedName]);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setLoading(true);
    api<{ data: CanvasNote }>(`/api/v1/notes/${id}`, {
      signal: controller.signal,
    })
      .then(({ data }) => {
        setNote(data);
        setName(data.name);
        setSavedName(data.name);
        setInitial(data.content);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id]);
  change.current = () => {
    const s = scene.current;
    if (!s) return;
    setDirty(JSON.stringify(s.snapshot()) !== baseline.current);
    setCount(s.entries.size);
    const values = s.app.editor.list.flatMap((node) => {
      const entry = s.entries.get(node.id);
      return entry ? [readNode(entry.data, entry.node)] : [];
    });
    setSelection(values);
    setSelected(values.length === 1 ? values[0] : null);
  };
  useEffect(() => {
    if (!initial || !host.current || loading || error) return;
    let active = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    const app = new App({
      view: host.current,
      width: host.current.clientWidth,
      height: host.current.clientHeight,
      tree: { type: "design" },
      sky: {},
      editor: {
        keyEvent: false,
        editSize: "scale",
        multipleSelect: true,
        boxSelect: true,
        skipNested: true,
        flipable: false,
        skewable: false,
        pointSize: 8,
        stroke: "#6560b5",
      },
      move: { holdSpaceKey: true },
      wheel: { zoomMode: true },
      zoom: { min: 0.1, max: 4 },
    });
    const group = new Group();
    app.tree.add(group);
    const entries: Scene["entries"] = new Map();
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (active) change.current();
      }, 50);
    };
    const add = (data: CanvasNode) => {
      const node = makeNode(data);
      entries.set(data.id, { data, node });
      group.add(node);
      node.on(PropertyEvent.CHANGE, changed);
      if (isShape(data.kind))
        for (const child of (node as Box).children)
          child.on(PropertyEvent.CHANGE, changed);
    };
    canvasContentSchema.parse(initial).nodes.forEach(add);
    const snapshot = () => ({
      nodes: group.children.map((node) => {
        const entry = entries.get(node.id)!;
        return readNode(entry.data, entry.node);
      }),
    });
    scene.current = { app, group, entries, snapshot, add };
    baseline.current = JSON.stringify(snapshot());
    setCount(entries.size);
    app.editor.on(EditorEvent.SELECT, () => {
      const values = app.editor.list.flatMap((node) => {
        const entry = entries.get(node.id);
        return entry ? [readNode(entry.data, entry.node)] : [];
      });
      app.editor.config.lockRatio = values.some(
        (n) => regular(n.kind) || Math.abs(n.rotation % 90) > 0.0001,
      );
      setSelection(values);
      setSelected(values.length === 1 ? values[0] : null);
    });
    app.tree.zoomLayer.on(PropertyEvent.CHANGE, () => {
      if (active) setZoom(Math.round(app.tree.zoomLayer.scaleX * 100));
    });
    const observer = new ResizeObserver(() => {
      if (host.current && active)
        app.resize({
          width: host.current.clientWidth,
          height: host.current.clientHeight,
        });
    });
    observer.observe(host.current!);
    app.waitViewCompleted(() => {
      if (active && entries.size) app.tree.zoom("fit", 64);
    });
    return () => {
      active = false;
      clearTimeout(timer);
      observer.disconnect();
      scene.current = null;
      app.destroy();
    };
  }, [initial, loading]);
  function add(kind: CanvasNode["kind"], extra: Partial<CanvasNode> = {}) {
    const s = scene.current;
    if (!s || busy) return;
    if (s.entries.size >= 200) {
      notify("每个无边记最多 200 个元素", "error");
      return;
    }
    const point = s.group.getInnerPoint({
      x: host.current!.clientWidth / 2,
      y: host.current!.clientHeight / 2,
    });
    const parsed = canvasNodeSchema.safeParse({
      id: crypto.randomUUID(),
      kind,
      x: point.x - 100,
      y: point.y - 60,
      width: kind === "text" ? 280 : kind === "circle" ? 180 : 200,
      height:
        kind === "text"
          ? 100
          : kind === "circle"
            ? 180
            : kind === "equilateral"
              ? 100 * Math.sqrt(3)
              : 120,
      fill: kind === "text" ? "#33343b" : "#ecebfa",
      text: kind === "text" ? "在这里写下想法" : "",
      ...extra,
    });
    if (!parsed.success) {
      notify("无法在当前位置添加内容，请回到画布中心", "error");
      return;
    }
    const data = parsed.data;
    const candidate = { nodes: [...s.snapshot().nodes, data] },
      result = canvasContentSchema.safeParse(candidate);
    if (!result.success) {
      notify(result.error.issues[0]?.message || "无法添加内容", "error");
      return;
    }
    s.add(data);
    s.app.editor.select(s.entries.get(data.id)!.node);
    change.current();
  }
  async function insertImage(file?: File) {
    if (!file) return;
    try {
      setBusy(true);
      const data = await imageData(file);
      setBusy(false);
      add("image", {
        ...data,
        width: Math.min(400, data.width),
        height: (Math.min(400, data.width) * data.height) / data.width,
      });
    } catch (e) {
      notify((e as Error).message, "error");
      setBusy(false);
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  function patch(update: Partial<CanvasNode>) {
    if (!selected || !scene.current) return;
    const entry = scene.current.entries.get(selected.id);
    if (!entry) return;
    const current = readNode(entry.data, entry.node);
    if (
      regular(current.kind) &&
      (update.width !== undefined || update.height !== undefined)
    ) {
      const ratio = current.kind === "circle" ? 1 : Math.sqrt(3) / 2;
      const width =
        update.width !== undefined ? update.width : update.height! / ratio;
      update = {
        ...update,
        width,
        height: width * ratio,
        scaleX: 1,
        scaleY: 1,
      };
    }
    const next = canvasNodeSchema.safeParse({ ...current, ...update });
    if (!next.success) return;
    entry.data = next.data;
    applyNode(entry.node, next.data);
    change.current();
  }
  function remove() {
    const s = scene.current;
    if (!s || !removeTarget) return;
    s.app.editor.cancel();
    for (const id of removeTarget) {
      s.entries.get(id)?.node.destroy();
      s.entries.delete(id);
    }
    setRemoveTarget(null);
    setSelected(null);
    setSelection([]);
    change.current();
  }
  function arrange(
    action:
      | "left"
      | "centerX"
      | "right"
      | "top"
      | "centerY"
      | "bottom"
      | "horizontal"
      | "vertical",
    custom = false,
  ) {
    const s = scene.current;
    if (!s || busy || selection.length < 2) return;
    s.app.editor.closeInnerEditor();
    s.app.tree.updateLayout();
    const entries = s.app.editor.list.flatMap((node) => {
      const entry = s.entries.get(node.id);
      return entry
        ? [{ entry, bounds: entry.node.getBounds("box", s.group) }]
        : [];
    });
    if (entries.length < 2) return;
    const left = Math.min(...entries.map((n) => n.bounds.x)),
      right = Math.max(...entries.map((n) => n.bounds.x + n.bounds.width));
    const top = Math.min(...entries.map((n) => n.bounds.y)),
      bottom = Math.max(...entries.map((n) => n.bounds.y + n.bounds.height));
    const moves = new Map<string, { x: number; y: number }>();
    if (action === "horizontal" || action === "vertical") {
      if (!custom && entries.length < 3) return;
      const horizontal = action === "horizontal",
        position = horizontal ? "x" : "y",
        size = horizontal ? "width" : "height";
      const sorted = [...entries].sort(
        (a, b) =>
          a.bounds[position] - b.bounds[position] ||
          a.entry.data.id.localeCompare(b.entry.data.id),
      );
      const first = sorted[0].bounds[position],
        last = sorted[sorted.length - 1].bounds;
      const space = custom
        ? gap
        : (last[position] +
            last[size] -
            first -
            sorted.reduce((total, n) => total + n.bounds[size], 0)) /
          (sorted.length - 1);
      if (!Number.isFinite(space) || (custom && (space < 0 || space > 2000)))
        return;
      let cursor = first;
      for (const item of sorted) {
        const delta = cursor - item.bounds[position];
        moves.set(item.entry.data.id, {
          x: item.entry.node.x + (horizontal ? delta : 0),
          y: item.entry.node.y + (horizontal ? 0 : delta),
        });
        cursor += item.bounds[size] + space;
      }
    } else {
      for (const { entry, bounds: b } of entries) {
        const dx =
          action === "left"
            ? left - b.x
            : action === "right"
              ? right - b.x - b.width
              : action === "centerX"
                ? (left + right - b.width) / 2 - b.x
                : 0;
        const dy =
          action === "top"
            ? top - b.y
            : action === "bottom"
              ? bottom - b.y - b.height
              : action === "centerY"
                ? (top + bottom - b.height) / 2 - b.y
                : 0;
        moves.set(entry.data.id, {
          x: entry.node.x + dx,
          y: entry.node.y + dy,
        });
      }
    }
    if (
      [...moves.values()].some(
        (p) =>
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y) ||
          Math.abs(p.x) > 100000 ||
          Math.abs(p.y) > 100000,
      )
    ) {
      notify("排列后超出画布范围，请缩小间距", "error");
      return;
    }
    for (const { entry } of entries) {
      const value = moves.get(entry.data.id);
      if (value) entry.node.set(value);
    }
    s.app.editor.update();
    change.current();
  }
  async function save() {
    const s = scene.current;
    if (!s || busy) return;
    setError("");
    s.app.editor.closeInnerEditor();
    const result = canvasNoteInputSchema.safeParse({
      name,
      content: s.snapshot(),
    });
    if (!result.success) {
      setError(result.error.issues[0]?.message || "内容格式不正确");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api<{ data: CanvasNote }>(
        note ? `/api/v1/notes/${note.id}` : "/api/v1/notes",
        {
          method: note ? "PUT" : "POST",
          body: JSON.stringify({
            ...result.data,
            ...(note ? { expectedVersion: note.version } : {}),
          }),
        },
      );
      setNote(data);
      setName(data.name);
      setSavedName(data.name);
      baseline.current = JSON.stringify(data.content);
      setDirty(false);
      notify("无边记已保存");
      if (!note) {
        skipGuard.current = true;
        navigate(`/notes/${data.id}`, { replace: true });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportImage() {
    const s = scene.current;
    if (!s || busy) return;
    if (!s.entries.size) {
      notify("先添加一些内容再导出", "error");
      return;
    }
    setBusy(true);
    try {
      s.app.editor.closeInnerEditor();
      s.app.tree.updateLayout();
      const bounds = s.group.getBounds("render", s.group);
      const width = bounds.width + 64,
        height = bounds.height + 64;
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width > 8192 ||
        height > 8192 ||
        width * height > 16000000
      )
        throw new Error("整张画布过大，请收拢内容后再导出（最长边 8192 像素）");
      const exported = await s.group.export("png", {
        pixelRatio: 1,
        padding: 32,
        fill: "#ffffff",
        relative: s.group,
      });
      if (exported.error || typeof exported.data !== "string")
        throw new Error("图片导出失败，请重试");
      if (exported.data.length > 7000000)
        throw new Error("图片文件过大，请减少图片或画布尺寸后再导出");
      const result = await api<{ data: { cancelled: boolean } }>(
        "/api/v1/notes/export-image",
        {
          method: "POST",
          body: JSON.stringify({
            name: name.trim() || "无边记",
            data: exported.data,
          }),
        },
      );
      if (!result.data.cancelled) notify("图片已导出");
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  function layer(front: boolean) {
    const s = scene.current;
    if (!s || !selected) return;
    const entry = s.entries.get(selected.id)!;
    s.group.add(entry.node, front ? s.group.children.length : 0);
    change.current();
  }
  return (
    <div className="workspace-content note-editor-content">
      <header className="note-heading">
        <Button variant="ghost" size="icon-sm" asChild title="返回无边记">
          <Link to="/notes">
            <ArrowLeft />
          </Link>
        </Button>
        <Input
          className="note-title-input"
          value={name}
          maxLength={80}
          aria-label="无边记名称"
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <span className="note-save-state">
          {busy
            ? "正在处理…"
            : dirty || name !== savedName
              ? "未保存"
              : "已保存"}
        </span>
        <div className="note-heading-actions">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || loading || !initial}
            onClick={exportImage}
          >
            <Download />
            导出图片
          </Button>
          <Button
            size="sm"
            disabled={busy || loading || !initial}
            onClick={save}
          >
            <Save />
            保存
          </Button>
        </div>
      </header>
      {error && (
        <div className="message" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <div className="notes-empty">正在打开画布…</div>
      ) : initial ? (
        <div className="note-stage" data-busy={busy}>
          <div
            ref={host}
            className="note-canvas"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy) void insertImage(e.dataTransfer.files[0]);
            }}
            role="application"
            aria-label="无边记画布"
          />
          <div className="note-tools" aria-label="添加内容">
            <Button
              variant="ghost"
              size="icon-sm"
              title="选择 / 框选"
              aria-label="选择或框选"
              onClick={() => scene.current?.app.editor.cancel()}
            >
              <MousePointer2 />
            </Button>
            <span className="note-tool-divider" />
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              title="添加文字"
              aria-label="添加文字"
              onClick={() => add("text")}
            >
              <Type />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              title="添加图片"
              aria-label="添加图片"
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus />
            </Button>
            <span className="note-tool-divider" />
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              title="矩形"
              aria-label="添加矩形"
              onClick={() => add("rect")}
            >
              <Square />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              title="椭圆"
              aria-label="添加椭圆"
              onClick={() => add("ellipse")}
            >
              <Circle />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              title="三角形"
              aria-label="添加三角形"
              onClick={() => add("triangle")}
            >
              <Triangle />
            </Button>
            <span className="note-tool-divider" />
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              title="正圆"
              aria-label="添加正圆"
              onClick={() => add("circle")}
            >
              <Circle />
              <span className="regular-tool-mark" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              title="正三角形"
              aria-label="添加正三角形"
              onClick={() => add("equilateral")}
            >
              <Triangle />
              <span className="regular-tool-mark" />
            </Button>
          </div>
          <input
            hidden
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => insertImage(e.target.files?.[0])}
          />
          {!count && (
            <div className="note-canvas-empty">
              <Layers2 size={24} />
              <span>从一段文字、一张图片开始</span>
            </div>
          )}
          {selection.length > 1 && (
            <aside
              className="note-inspector note-selection-inspector"
              aria-label="多选排列"
            >
              <header>
                <span>已选 {selection.length} 个元素</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="删除选中元素"
                  aria-label="删除选中元素"
                  onClick={() => setRemoveTarget(selection.map((n) => n.id))}
                >
                  <Trash2 />
                </Button>
              </header>
              <div className="note-inspector-caption">对齐</div>
              <div className="note-alignment-grid">
                {(
                  [
                    ["left", "左对齐", AlignHorizontalJustifyStart],
                    ["centerX", "水平居中", AlignHorizontalJustifyCenter],
                    ["right", "右对齐", AlignHorizontalJustifyEnd],
                    ["top", "顶部对齐", AlignVerticalJustifyStart],
                    ["centerY", "垂直居中", AlignVerticalJustifyCenter],
                    ["bottom", "底部对齐", AlignVerticalJustifyEnd],
                  ] as const
                ).map(([action, label, Icon]) => (
                  <Button
                    key={action}
                    variant="ghost"
                    size="icon-sm"
                    title={label}
                    aria-label={label}
                    onClick={() => arrange(action)}
                  >
                    <Icon />
                  </Button>
                ))}
              </div>
              <div className="note-inspector-caption">等间距分布</div>
              <div className="note-property-row">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selection.length < 3}
                  title="保持两端位置，水平等间距分布"
                  onClick={() => arrange("horizontal")}
                >
                  <AlignHorizontalDistributeCenter />
                  水平
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selection.length < 3}
                  title="保持两端位置，垂直等间距分布"
                  onClick={() => arrange("vertical")}
                >
                  <AlignVerticalDistributeCenter />
                  垂直
                </Button>
              </div>
              {selection.length < 3 && (
                <p className="note-property-help">
                  等间距分布需要至少 3 个元素
                </p>
              )}
              <div className="note-inspector-caption">自定义间距</div>
              <label className="note-font-field">
                间距
                <input
                  aria-label="元素间距"
                  type="number"
                  min={0}
                  max={2000}
                  value={gap}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isFinite(value)) setGap(value);
                  }}
                />
                <span>px</span>
              </label>
              <div className="note-property-row">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={gap < 0 || gap > 2000}
                  onClick={() => arrange("horizontal", true)}
                >
                  水平应用
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={gap < 0 || gap > 2000}
                  onClick={() => arrange("vertical", true)}
                >
                  垂直应用
                </Button>
              </div>
              <p className="note-property-help">按元素边缘计算间距</p>
            </aside>
          )}
          {selected && (
            <aside className="note-inspector" aria-label="元素属性">
              <header>
                <span>{nodeLabels[selected.kind]}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="删除元素"
                  aria-label="删除选中元素"
                  disabled={busy}
                  onClick={() => setRemoveTarget([selected.id])}
                >
                  <Trash2 />
                </Button>
              </header>
              {selected.kind !== "image" && (
                <>
                  <textarea
                    aria-label="文字内容"
                    maxLength={10000}
                    value={selected.text}
                    onChange={(e) => patch({ text: e.target.value })}
                  />
                  <label className="note-font-field">
                    字体
                    <select
                      aria-label="字体"
                      value={selected.fontFamily}
                      onChange={(e) =>
                        patch({
                          fontFamily: e.target
                            .value as CanvasNode["fontFamily"],
                        })
                      }
                    >
                      {fontOptions.map((font) => (
                        <option value={font.value} key={font.value}>
                          {font.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="note-property-row">
                    <label>
                      字号
                      <input
                        type="number"
                        min={8}
                        max={200}
                        value={selected.fontSize}
                        onChange={(e) =>
                          patch({ fontSize: Number(e.target.value) })
                        }
                      />
                    </label>
                    <Button
                      variant={selected.bold ? "secondary" : "ghost"}
                      size="icon-sm"
                      title="加粗"
                      aria-label="加粗"
                      aria-pressed={selected.bold}
                      onClick={() => patch({ bold: !selected.bold })}
                    >
                      <Bold />
                    </Button>
                  </div>
                </>
              )}
              {selected.kind !== "image" && (
                <div className="note-property-row">
                  <label>
                    {selected.kind === "text" ? "文字颜色" : "填充"}
                    <input
                      type="color"
                      value={selected.fill}
                      onChange={(e) => patch({ fill: e.target.value })}
                    />
                  </label>
                  {selected.kind !== "text" && (
                    <label>
                      边框
                      <input
                        type="color"
                        value={selected.stroke}
                        onChange={(e) => patch({ stroke: e.target.value })}
                      />
                    </label>
                  )}
                </div>
              )}
              {isShape(selected.kind) && (
                <div className="note-property-row">
                  <label>
                    文字颜色
                    <input
                      type="color"
                      value={selected.textColor}
                      onChange={(e) => patch({ textColor: e.target.value })}
                    />
                  </label>
                </div>
              )}
              <div className="note-property-row">
                <label>
                  宽
                  <input
                    type="number"
                    min={1}
                    max={20000}
                    value={Math.round(selected.width * selected.scaleX)}
                    onChange={(e) =>
                      patch({ width: Number(e.target.value), scaleX: 1 })
                    }
                  />
                </label>
                <label>
                  高
                  <input
                    type="number"
                    min={1}
                    max={20000}
                    value={Math.round(selected.height * selected.scaleY)}
                    onChange={(e) =>
                      patch({ height: Number(e.target.value), scaleY: 1 })
                    }
                  />
                </label>
              </div>
              <div className="note-property-row">
                <Button variant="ghost" size="sm" onClick={() => layer(true)}>
                  <ArrowUpToLine />
                  置顶
                </Button>
                <Button variant="ghost" size="sm" onClick={() => layer(false)}>
                  <ArrowDownToLine />
                  置底
                </Button>
              </div>
            </aside>
          )}
          <div className="note-zoom">
            <Button
              variant="ghost"
              size="icon-sm"
              title="缩小"
              aria-label="缩小"
              onClick={() =>
                scene.current?.app.tree.zoom(Math.max(0.1, zoom / 100 / 1.2))
              }
            >
              <Minus />
            </Button>
            <span>{zoom}%</span>
            <Button
              variant="ghost"
              size="icon-sm"
              title="放大"
              aria-label="放大"
              onClick={() =>
                scene.current?.app.tree.zoom(Math.min(4, (zoom / 100) * 1.2))
              }
            >
              <Plus />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="适应全部内容"
              aria-label="适应全部内容"
              onClick={() => {
                if (count) scene.current?.app.tree.zoom("fit", 64);
              }}
            >
              <Scan />
            </Button>
          </div>
        </div>
      ) : null}
      <Dialog.Root
        open={!!removeTarget}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay confirmation-overlay" />
          <Dialog.Content className="confirmation-content">
            <Dialog.Title>
              {removeTarget && removeTarget.length > 1
                ? `删除选中的 ${removeTarget.length} 个元素？`
                : "删除这个元素？"}
            </Dialog.Title>
            <Dialog.Description>
              选中的元素将从画布中移除，保存后生效。
            </Dialog.Description>
            <div className="confirmation-actions">
              <Button variant="outline" onClick={() => setRemoveTarget(null)}>
                取消
              </Button>
              <Button variant="destructive" onClick={remove}>
                确认删除
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
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
              {busy ? "正在处理内容" : "离开前保存修改？"}
            </Dialog.Title>
            <Dialog.Description>
              {busy
                ? "请等待当前操作完成。"
                : "当前修改还未保存，直接离开会丢失这些内容。"}
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
              {!busy && (
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (blocker.state === "blocked") blocker.proceed();
                  }}
                >
                  放弃修改并离开
                </Button>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
