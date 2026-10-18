import { CanvasDesignPanel } from "../components/canvas-design";
import { canvasDesignPrompt, canvasDesignSchema, designColorRoles, designDensities, resolveCanvasDesign, type CanvasDesign } from "../../shared/canvas-design";
import { CanvasAssistant } from "../components/canvas-assistant";
import {
  canvasAssistantNodes,
  applyAssistantDesign,
  type CanvasAssistantResult,
} from "../../shared/canvas-assistant";
import { alignmentGuides } from "../../shared/canvas-guides";
import { CanvasGuides } from "../components/canvas-guides";
import { CanvasHistory } from "../../shared/canvas-history";
import { CanvasUIDialog } from "../components/canvas-ui-dialog";
import { CanvasDimensions } from "../components/canvas-dimensions";
import { EmptyState } from "../components/empty-state";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import * as Dialog from "@radix-ui/react-alert-dialog";
import {
  App,
  Path,
  PointerEvent as CanvasPointerEvent,
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
  Sparkles,
  X, Group as GroupIcon, Ungroup, LockKeyhole, UnlockKeyhole, ListTree, Copy,
  Palette,
  MessageSquare,
  LoaderCircle,
  ArrowLeft,
  ArrowUpRight,
  Type,
  ImagePlus,
  Shapes,
  Frame,
  Trash2,
  Download,
  Save,
  Scan,
  Minus,
  Plus,
  Bold,
  TextAlignStart,
  TextAlignCenter,
  TextAlignEnd,
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
import { api, ApiError } from "../api";
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
  type Connector,
  type CanvasNote,
} from "../../shared/canvas-note";
import {
  connectorBendPoint,
  connectorPath,
  connectorStyle,
  lineSettings,
} from "../canvas-connector";
import { findAttachment, resolveAttachment } from "../canvas-attachments";
import { ConnectorProperties } from "../components/connector-properties";
import { CanvasQuickTools } from "../components/canvas-quick-tools";
import { CanvasInspector } from "../components/canvas-inspector";
import { CanvasLibrary } from "../components/canvas-library";
import { shapePoints, shapeNames } from "../../shared/canvas-shapes";
import { reconcileContainers } from "../../shared/canvas-containers";
import {
  copyCanvasNodes,
  readCanvasClipboard,
  cloneCanvasNodes,
} from "../../shared/canvas-clipboard";
import "../notes.css";
type Scene = {
  app: App;
  group: Group;
  entries: Map<string, { data: CanvasNode; node: UI }>;
  snapshot: () => CanvasContent;
  add: (data: CanvasNode) => void;
  sync: (autoAttach?: boolean) => void;
  gesturing: () => boolean;
  restore: (content: CanvasContent) => void;
};
const empty: CanvasContent = { nodes: [] };
function regular(kind: CanvasNode["kind"]) {
  return kind === "circle" || kind === "equilateral";
}
function isShape(kind: CanvasNode["kind"]) {
  return kind !== "text" && kind !== "image" && kind !== "connector";
}
function shapeDimensions(data: CanvasNode): CanvasNode {
  if (!isShape(data.kind)) return data;
  // Store shape size as geometry, never as a transform that stretches its text.
  return {
    ...data,
    width: Math.min(20000, Math.max(1, data.width * Math.abs(data.scaleX))),
    height: Math.min(20000, Math.max(1, data.height * Math.abs(data.scaleY))),
    scaleX: 1,
    scaleY: 1,
  };
}
function labelStyle(data: CanvasNode) {
  if (data.designSpec) {
    const d = data.designSpec;
    return { x: 16, y: 16, width: data.width - 32, height: data.height - 32,
      text: `${d.name}\n\n\n标题 ${d.typography.title}px · 正文 ${d.typography.body}px · 辅助 ${d.typography.caption}px\n${designDensities[d.density].label}布局 · 行高 ${d.typography.lineHeight}\n圆角 ${d.controlRadius} / ${d.cardRadius} / ${d.buttonRadius}\n\n与原型一起选中，生成 UI 图片`,
      fontSize: 14, fontFamily: fontStacks.system, fontWeight: "normal" as const, fill: d.colors.text,
      textAlign: "left" as const, verticalAlign: "top" as const, textOverflow: "ellipsis" as const, hittable: false };
  }
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
    textAlign: data.textAlign ?? "center",
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
    ...(data.kind === "rect" || data.kind === "container"
      ? {
          cornerRadius: Math.min(
            data.cornerRadius ?? 8,
            data.width / 2,
            data.height / 2,
          ),
        }
      : {}),
    ...(data.kind === "container" ? { dashPattern: [8, 4] } : {}),
    ...(data.kind === "shape" && data.shapeType
      ? {
          points: shapePoints(data.shapeType, data.width, data.height),
          closed: true,
        }
      : {}),
    ...(data.kind === "triangle" || data.kind === "equilateral"
      ? {
          points: [data.width / 2, 0, data.width, data.height, 0, data.height],
          closed: true,
        }
      : {}),
  };
}
function makeNode(data: CanvasNode): UI {
  data = shapeDimensions(data);
  const common = {
    id: data.id,
    x: data.x,
    y: data.y,
    width: data.width,
    height: data.height,
    scaleX: data.scaleX,
    scaleY: data.scaleY,
    rotation: data.rotation,
    editable: !data.locked,
    fill: data.fill,
    stroke: data.stroke,
    strokeWidth: data.strokeWidth,
  };
  if (data.kind === "connector")
    return new Path({
      ...common,
      width: undefined,
      height: undefined,
      ...connectorStyle(data),
      hitRadius: 10,
      editConfig: {
        resizeable: false,
        rotateable: false,
        hideResizeLines: true,
      },
    });
  if (data.kind === "text")
    return new Text({
      ...common,
      width: undefined,
      height: undefined,
      textWrap: "none",
      textAlign: data.textAlign ?? "left",
      editConfig: {
        resizeable: false,
        rotateable: false,
        hideResizeLines: true,
      },
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
    resizeChildren: false,
    editConfig: { editSize: "size", lockRatio: regular(data.kind) },
  });
  const background =
    data.kind === "ellipse" || data.kind === "circle"
      ? new Ellipse(shapeStyle(data))
      : data.kind === "shape" ||
          data.kind === "triangle" ||
          data.kind === "equilateral"
        ? new Polygon(shapeStyle(data))
        : new Rect(shapeStyle(data));
  box.add(background);
  box.add(
    new Text({
      ...labelStyle(data),
      ...(data.kind === "container"
        ? { verticalAlign: "top", textAlign: data.textAlign ?? "left" }
        : {}),
    }),
  );
  if (data.designSpec) {
    designColorRoles.forEach(([key], i) => box.add(new Rect({ x: 16 + i * 38, y: 50, width: 28, height: 24, fill: data.designSpec!.colors[key], stroke: data.designSpec!.colors.border, strokeWidth: 1, hittable: false })));
  }
  return box;
}
function readNode(data: CanvasNode, node: UI): CanvasNode {
  const shape = isShape(data.kind),
    background = shape ? ((node as Box).children[0] ?? node) : node;
  const label = data.designSpec ? null :
    data.kind === "text"
      ? (node as Text)
      : shape
        ? ((node as Box).children[1] as Text)
        : null;
  return shapeDimensions({
    ...data,
    x: node.x ?? data.x,
    y: node.y ?? data.y,
    width:
      data.kind === "text"
        ? Math.min(20000, Math.max(1, node.getBounds("box", "inner").width))
        : data.kind === "connector"
          ? data.width
          : (node.width ?? data.width),
    height:
      data.kind === "text"
        ? Math.min(20000, Math.max(1, node.getBounds("box", "inner").height))
        : data.kind === "connector"
          ? data.height
          : (node.height ?? data.height),
    scaleX: node.scaleX ?? data.scaleX,
    scaleY: node.scaleY ?? data.scaleY,
    rotation: node.rotation ?? data.rotation,
    fill: typeof background.fill === "string" ? background.fill : data.fill,
    stroke:
      typeof background.stroke === "string" ? background.stroke : data.stroke,
    strokeWidth:
      typeof background.strokeWidth === "number"
        ? background.strokeWidth
        : data.strokeWidth,
    ...(label
      ? {
          text: String(label.text ?? data.text),
          textAlign:
            label.textAlign === "center" || label.textAlign === "right"
              ? label.textAlign
              : "left",
          fontSize: label.fontSize ?? data.fontSize,
          bold: label.fontWeight === "bold",
          ...(shape && typeof label.fill === "string"
            ? { textColor: label.fill }
            : {}),
        }
      : {}),
  });
}
function applyNode(node: UI, data: CanvasNode) {
  data = shapeDimensions(data);
  if (data.kind === "connector") {
    node.set({
      x: data.x,
      y: data.y,
      scaleX: data.scaleX,
      scaleY: data.scaleY,
      rotation: data.rotation,
      width: undefined,
      height: undefined,
      ...connectorStyle(data),
    });
    return;
  }
  node.set({
    x: data.x,
    y: data.y,
    width: data.kind === "text" ? undefined : data.width,
    height: data.kind === "text" ? undefined : data.height,
    scaleX: data.scaleX,
    scaleY: data.scaleY,
    rotation: data.rotation,
  });
  if (isShape(data.kind)) {
    const box = node as Box;
    box.children[0]?.set(shapeStyle(data));
    if (data.designSpec) designColorRoles.forEach(([key], i) => box.children[i + 2]?.set({ fill: data.designSpec!.colors[key], stroke: data.designSpec!.colors.border }));
    box.children[1]?.set({
      ...labelStyle(data),
      ...(data.kind === "container"
        ? { verticalAlign: "top", textAlign: data.textAlign ?? "left" }
        : {}),
    });
  } else if (data.kind === "text")
    node.set({
      text: data.text,
      fontSize: data.fontSize,
      fontFamily: fontStacks[data.fontFamily],
      fontWeight: data.bold ? "bold" : "normal",
      fill: data.fill,
      textAlign: data.textAlign ?? "left",
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
  const { id: routeId } = useParams();
  const id = routeId === "new" ? undefined : routeId;
  const navigate = useNavigate(),
    { notify, workspace } = useWorkspace();
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
    [zoom, setZoom] = useState(100),
    [drawing, setDrawing] = useState(false),
    [drawStarted, setDrawStarted] = useState(false);
  const [design, setDesign] = useState<CanvasDesign | undefined>();
  const designRef = useRef<CanvasDesign | undefined>(undefined);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [navigatorNodes, setNavigatorNodes] = useState<CanvasNode[]>([]);
  const [renameSpec, setRenameSpec] = useState<CanvasNode | null>(null);
  const [variantName, setVariantName] = useState("");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantPending, setAssistantPending] = useState(false);
  const [uiSources, setUISources] = useState<
    Array<{
      key: string;
      node: CanvasNode;
      image?: string;
      prompt?: string;
      autoStart?: boolean;
      designPrompt?: string;
      dimensions?: { width: number; height: number };
    }>
  >([]);
  const uiSlots = useRef(
    new Map<string, { x: number; y: number; width: number; height: number }>(),
  );
  const uiSource = uiSources.length > 0 || assistantPending;
  const setUISource = (source: {
    node: CanvasNode;
    image?: string;
    prompt?: string;
    autoStart?: boolean;
    dimensions?: { width: number; height: number };
  }) => {
    const instructions = canvasDesignPrompt(resolveCanvasDesign(selection.flatMap((node) => node.designSpec ? [node.designSpec] : []), designRef.current));
    const task = { ...source, designPrompt: instructions, key: crypto.randomUUID() };
    setUISources((items) => [...items, task]);
  };
  const [library, setLibrary] = useState<"shapes" | "containers" | "design" | null>(null);
  const [, refreshViewport] = useState(0);
  const drawState = useRef<{
    active: boolean;
    start: { x: number; y: number } | null;
    preview: Path | null;
  }>({ active: false, start: null, preview: null });
  const createConnector = useRef(
    (start: { x: number; y: number }, end: { x: number; y: number }) => {},
  );
  const draggingEndpoint = useRef<{
    id: string;
    end: "start" | "end" | "bend";
    pointerId: number;
  } | null>(null);
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<Scene | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    skipGuard = useRef(false),
    change = useRef(() => {});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const saveInFlight = useRef(false);
  const latestName = useRef(name);
  latestName.current = name;
  const savedNote = useRef(note);
  savedNote.current = note;
  const autoSave = useRef(() => {});
  const retry = useRef({ after: 0, failures: 0, blocked: false });
  const candidate = useRef({ key: "", since: 0 });
  const baseline = useRef(JSON.stringify(empty));
  const history = useRef<CanvasHistory | null>(null);
  const restoring = useRef(false);
  const blocker = useBlocker(
    () =>
      !skipGuard.current &&
      (dirty || name !== savedName || busy || saveInFlight.current || uiSource),
  );
  useEffect(() => {
    if (!dirty && name === savedName) return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, name, savedName]);
  useEffect(() => {
    skipGuard.current = false;
    if (!id || savedNote.current?.id === id) return;
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
    const content = s.snapshot();
    if (!restoring.current && !s.gesturing() && !draggingEndpoint.current)
      history.current?.record(content);
    setDirty(JSON.stringify(content) !== baseline.current);
    setCount(s.entries.size);
    const values = s.app.editor.list.flatMap((node) => {
      const entry = s.entries.get(node.id ?? "");
      return entry ? [readNode(entry.data, entry.node)] : [];
    });
    setSelection(values);
    setSelected(values.length === 1 ? values[0]! : null);
  };
  useEffect(() => {
    if (!initial || !host.current || loading || error) return;
    let active = true,
      shiftHeld = false,
      dragging = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const app = new App({
      view: host.current,
      width: host.current.clientWidth,
      height: host.current.clientHeight,
      tree: { type: "design" },
      sky: {},
      editor: {
        keyEvent: false,
        beforeScale: ({ target, scaleX, scaleY }) => {
          if (!shiftHeld || app.editor.list.length !== 1) return;
          const entry = entries.get(target.id ?? "");
          if (
            !entry ||
            !["rect", "ellipse", "triangle", "shape"].includes(entry.data.kind)
          )
            return;
          const ratio = entry.data.kind === "triangle" ? Math.sqrt(3) / 2 : 1;
          const width = Math.min(
            20000,
            Math.max(target.width! * scaleX, (target.height! * scaleY) / ratio),
          );
          return {
            scaleX: width / target.width!,
            scaleY: (width * ratio) / target.height!,
          };
        },
        editSize: "size",
        multipleSelect: true,
        boxSelect: true,
        skipNested: true,
        flipable: false,
        skewable: false,
        pointSize: 8,
        stroke: "#0d0c22",
      },
      move: { holdSpaceKey: true },
      wheel: { zoomMode: true },
      zoom: { min: 0.1, max: 4 },
    });
    const group = new Group();
    app.tree.add(group);
    const entries: Scene["entries"] = new Map();
    let syncing = false,
      followFrame = 0;
    const sync = (autoAttach = false) => {
      if (syncing) return;
      syncing = true;
      try {
        const current = [...entries.values()].map((entry) =>
          readNode(entry.data, entry.node),
        );
        const reconciled = reconcileContainers(
          [...entries.values()].map((entry) => entry.data),
          current,
          new Set(app.editor.list.map((node) => node.id ?? "")),
          dragging,
        );
        for (const data of reconciled) {
          const entry = entries.get(data.id)!;
          if (entry.node.x !== data.x || entry.node.y !== data.y)
            entry.node.set({ x: data.x, y: data.y });
          if (
            data.kind === "container" &&
            (entry.node.width !== data.width ||
              entry.node.height !== data.height)
          )
            entry.node.set({ width: data.width, height: data.height });
          entry.data = { ...entry.data, containerId: data.containerId };
        }
        for (const entry of entries.values()) {
          if (!isShape(entry.data.kind)) continue;
          const data = readNode(entry.data, entry.node);
          const background = (entry.node as Box).children[0] ?? entry.node;
          if (
            entry.node.scaleX !== 1 ||
            entry.node.scaleY !== 1 ||
            background.width !== data.width ||
            background.height !== data.height
          ) {
            applyNode(entry.node, data);
          }
          entry.data = data;
        }
        app.tree.updateLayout();
        for (const entry of entries.values()) {
          if (entry.data.kind !== "connector") continue;
          const data = readNode(entry.data, entry.node),
            line = { ...lineSettings(data) };
          const oldStart = group.getInnerPoint(
              entry.node.getWorldPoint({ x: 0, y: 0 }),
            ),
            oldEnd = group.getInnerPoint(
              entry.node.getWorldPoint({ x: line.endX, y: line.endY }),
            );
          if (line.startBinding && !entries.has(line.startBinding.nodeId))
            line.startBinding = undefined;
          if (line.endBinding && !entries.has(line.endBinding.nodeId))
            line.endBinding = undefined;
          if (autoAttach) {
            if (!line.startBinding)
              line.startBinding = findAttachment(
                entries.values(),
                group,
                oldStart,
                26,
              ).binding;
            if (!line.endBinding)
              line.endBinding = findAttachment(
                entries.values(),
                group,
                oldEnd,
                26,
              ).binding;
          }
          const start =
              resolveAttachment(line.startBinding, entries, group) || oldStart,
            end = resolveAttachment(line.endBinding, entries, group) || oldEnd;
          if (!line.startBinding && !line.endBinding) {
            entry.data = { ...data, line };
            continue;
          }
          const dx = end.x - start.x,
            dy = end.y - start.y;
          if (Math.abs(dx) > 20000 || Math.abs(dy) > 20000) continue;
          // Preserve a manually positioned bend in canvas coordinates.
          if (line.bend) {
            const bend = group.getInnerPoint(
              entry.node.getWorldPoint(line.bend),
            );
            line.bend = {
              x: Math.max(-20000, Math.min(20000, bend.x - start.x)),
              y: Math.max(-20000, Math.min(20000, bend.y - start.y)),
            };
          }
          const next = {
            ...data,
            x: start.x,
            y: start.y,
            width: Math.max(1, Math.abs(dx)),
            height: Math.max(1, Math.abs(dy)),
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            line: { ...line, endX: dx, endY: dy },
          };
          if (JSON.stringify(data) !== JSON.stringify(next)) {
            entry.data = next;
            applyNode(entry.node, next);
          }
        }
      } finally {
        syncing = false;
      }
    };
    const changed = () => {
      if (syncing) return;
      if (!followFrame)
        followFrame = requestAnimationFrame(() => {
          followFrame = 0;
          if (active) sync();
        });
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (active) {
          sync();
          change.current();
        }
      }, 50);
    };
    const add = (data: CanvasNode) => {
      const node = makeNode(data);
      entries.set(data.id, { data, node });
      group.add(node, data.kind === "container" ? 0 : undefined);
      node.on(PropertyEvent.CHANGE, changed);
      if (isShape(data.kind))
        for (const child of (node as Box).children)
          child.on(PropertyEvent.CHANGE, changed);
    };
    const startCanvasDrag = () => {
      dragging = true;
    };
    const finishCanvasDrag = () => {
      if (!dragging) return;
      requestAnimationFrame(() => {
        if (!active) return;
        sync();
        dragging = false;
        changed();
      });
    };
    const canvasHost = host.current!;
    canvasHost.addEventListener("pointerdown", startCanvasDrag, true);
    window.addEventListener("pointerup", finishCanvasDrag);
    window.addEventListener("pointercancel", finishCanvasDrag);
    window.addEventListener("blur", finishCanvasDrag);
    designRef.current = initial.design;
    setDesign(initial.design);
    canvasContentSchema.parse(initial).nodes.forEach(add);
    const snapshot = () => {
      sync();
      return {
        ...(designRef.current ? { design: designRef.current } : {}),
        nodes: group.children.map((node) => {
          const entry = entries.get(node.id ?? "")!;
          return readNode(entry.data, entry.node);
        }),
      };
    };
    const restore = (content: CanvasContent) => {
      designRef.current = content.design;
      setDesign(content.design);
      clearTimeout(timer);
      cancelAnimationFrame(followFrame);
      followFrame = 0;
      const ids = app.editor.list.map((node) => node.id ?? "");
      app.editor.cancel();
      syncing = true;
      try {
        for (const entry of entries.values()) entry.node.destroy();
        entries.clear();
        for (const data of content.nodes) {
          add(data);
          // Restore exact stacking order, including multiple containers.
          group.add(entries.get(data.id)!.node);
        }
      } finally {
        syncing = false;
      }
      app.tree.updateLayout();
      app.editor.select(
        ids.flatMap((id) => (entries.has(id) ? [entries.get(id)!.node] : [])),
      );
    };
    scene.current = {
      app,
      group,
      entries,
      snapshot,
      add,
      sync,
      gesturing: () => dragging,
      restore,
    };
    sync(true);
    baseline.current = JSON.stringify(snapshot());
    history.current = new CanvasHistory(snapshot());
    setCount(entries.size);
    let expandingSelection = false;
    app.editor.on(EditorEvent.SELECT, () => {
      if (!expandingSelection) {
        const selectedIds = new Set(app.editor.list.map(n => n.id));
        const groups = new Set([...entries.values()].filter(e => selectedIds.has(e.data.id) && e.data.groupId).map(e => e.data.groupId));
        const expanded = [...entries.values()].filter(e => !e.data.locked && (selectedIds.has(e.data.id) || (e.data.groupId && groups.has(e.data.groupId)))).map(e => e.node);
        if (expanded.length !== app.editor.list.length) {
          expandingSelection = true;
          app.editor.select(expanded);
          expandingSelection = false;
        }
      }
      const values = app.editor.list.flatMap((node) => {
        const entry = entries.get(node.id ?? "");
        return entry ? [readNode(entry.data, entry.node)] : [];
      });
      app.editor.config.lockRatio = values.some(
        (n) => regular(n.kind) || Math.abs(n.rotation % 90) > 0.0001,
      );
      app.editor.config.resizeable = !values.some(
        (n) => n.kind === "text" || n.kind === "connector",
      );
      app.editor.config.rotateable = !values.some(
        (n) =>
          n.kind === "text" || n.kind === "connector" || n.kind === "container",
      );
      // SELECT runs before Leafer creates the editing tool. Its normal
      // selection lifecycle will build the controls using this configuration.
      setSelection(values);
      setSelected(values.length === 1 ? values[0]! : null);
    });
    app.tree.zoomLayer.on(PropertyEvent.CHANGE, () => {
      if (active) {
        setZoom(Math.round((app.tree.zoomLayer.scaleX ?? 1) * 100));
        refreshViewport((v) => v + 1);
      }
    });
    app.on(CanvasPointerEvent.TAP, (event: CanvasPointerEvent) => {
      const draft = drawState.current;
      if (!draft.active || event.spaceKey || !event.left) return;
      const point = findAttachment(
        entries.values(),
        group,
        event.getInnerPoint(group),
      ).point;
      if (!draft.start) {
        draft.start = point;
        setDrawStarted(true);
        draft.preview = new Path({
          x: point.x,
          y: point.y,
          ...connectorStyle(
            canvasNodeSchema.parse({
              id: crypto.randomUUID(),
              kind: "connector",
              x: 0,
              y: 0,
              width: 1,
              height: 1,
              stroke: "#0d0c22",
              strokeWidth: 2,
              line: { endX: 1, endY: 1 },
            }),
          ),
          hittable: false,
          opacity: 0.7,
        });
        app.tree.add(draft.preview);
      } else if (
        Math.hypot(point.x - draft.start.x, point.y - draft.start.y) >= 4
      )
        createConnector.current(draft.start, point);
    });
    app.on(CanvasPointerEvent.MOVE, (event: CanvasPointerEvent) => {
      const draft = drawState.current;
      if (!draft.active || !draft.start || !draft.preview) return;
      const point = findAttachment(
          entries.values(),
          group,
          event.getInnerPoint(group),
        ).point,
        endX = point.x - draft.start.x,
        endY = point.y - draft.start.y;
      if (Math.abs(endX) > 20000 || Math.abs(endY) > 20000) return;
      draft.preview.set({
        path: connectorPath({
          type: "straight",
          endX,
          endY,
          startArrow: "none",
          endArrow: "triangle",
          style: "solid",
        }),
      });
    });
    const cancelDraw = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drawState.current.active) {
        event.preventDefault();
        stopDrawing();
      }
    };
    const updateShift = (event: KeyboardEvent) => {
      shiftHeld = event.shiftKey;
    };
    const clearShift = () => {
      shiftHeld = false;
    };
    window.addEventListener("keydown", updateShift);
    window.addEventListener("keyup", updateShift);
    window.addEventListener("blur", clearShift);
    window.addEventListener("keydown", cancelDraw);
    const observer = new ResizeObserver(() => {
      if (host.current && active)
        app.resize({
          width: host.current.clientWidth,
          height: host.current.clientHeight,
        });
    });
    observer.observe(host.current!);
    app.waitViewCompleted(() => {
      if (active) {
        app.tree.zoom(1);
        setZoom(100);
      }
    });
    return () => {
      active = false;
      clearTimeout(timer);
      cancelAnimationFrame(followFrame);
      observer.disconnect();
      canvasHost.removeEventListener("pointerdown", startCanvasDrag, true);
      window.removeEventListener("pointerup", finishCanvasDrag);
      window.removeEventListener("pointercancel", finishCanvasDrag);
      window.removeEventListener("blur", finishCanvasDrag);
      window.removeEventListener("keydown", cancelDraw);
      window.removeEventListener("keydown", updateShift);
      window.removeEventListener("keyup", updateShift);
      window.removeEventListener("blur", clearShift);
      drawState.current = { active: false, start: null, preview: null };
      scene.current = null;
      app.destroy();
    };
  }, [initial, loading]);
  function stopDrawing() {
    const draft = drawState.current;
    draft.preview?.destroy();
    drawState.current = { active: false, start: null, preview: null };
    if (scene.current) scene.current.app.editor.config.selector = true;
    setDrawing(false);
    setDrawStarted(false);
  }
  function beginDrawing() {
    const s = scene.current;
    if (!s || busy) return;
    if (drawing) {
      stopDrawing();
      return;
    }
    if (s.entries.size >= 200) {
      notify("每个无边记最多 200 个元素", "error");
      return;
    }
    s.app.editor.cancel();
    s.app.editor.config.selector = false;
    drawState.current.active = true;
    setDrawing(true);
    setDrawStarted(false);
  }
  createConnector.current = (start, end) => {
    const s = scene.current;
    if (!s) return;
    const startSnap = findAttachment(s.entries.values(), s.group, start),
      endSnap = findAttachment(s.entries.values(), s.group, end);
    start = startSnap.point;
    end = endSnap.point;
    const endX = end.x - start.x,
      endY = end.y - start.y;
    if (Math.hypot(endX, endY) < 4) {
      notify("请选择不同的连线起点和终点", "error");
      return;
    }
    if (Math.abs(endX) > 20000 || Math.abs(endY) > 20000) {
      notify("连线跨度过大，请缩短距离", "error");
      return;
    }
    stopDrawing();
    add("connector", {
      x: start.x,
      y: start.y,
      width: Math.max(1, Math.abs(endX)),
      height: Math.max(1, Math.abs(endY)),
      stroke: "#0d0c22",
      strokeWidth: 2,
      line: {
        type: "straight",
        endX,
        endY,
        startArrow: "none",
        endArrow: "triangle",
        style: "solid",
        startBinding: startSnap.binding,
        endBinding: endSnap.binding,
      },
    });
  };
  function moveEndpoint(
    id: string,
    end: "start" | "end",
    point: { x: number; y: number },
  ) {
    const s = scene.current,
      entry = s?.entries.get(id);
    if (!s || !entry || busy) return;
    const data = readNode(entry.data, entry.node),
      line = lineSettings(data);
    const start = s.group.getInnerPoint(
      entry.node.getWorldPoint({ x: 0, y: 0 }),
    );
    const finish = s.group.getInnerPoint(
      entry.node.getWorldPoint({ x: line.endX, y: line.endY }),
    );
    const snap = findAttachment(s.entries.values(), s.group, point);
    const a = end === "start" ? snap.point : start,
      b = end === "end" ? snap.point : finish;
    const bend = line.bend
      ? s.group.getInnerPoint(entry.node.getWorldPoint(line.bend))
      : undefined;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 4) return;
    const next = canvasNodeSchema.safeParse({
      ...data,
      x: a.x,
      y: a.y,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      width: Math.max(1, Math.abs(b.x - a.x)),
      height: Math.max(1, Math.abs(b.y - a.y)),
      line: {
        ...line,
        endX: b.x - a.x,
        endY: b.y - a.y,
        ...(end === "start"
          ? { startBinding: snap.binding }
          : { endBinding: snap.binding }),
        ...(bend ? { bend: { x: bend.x - a.x, y: bend.y - a.y } } : {}),
      },
    });
    if (!next.success) return;
    entry.data = next.data;
    applyNode(entry.node, next.data);
    if (s.app.editor.editTool) s.app.editor.updateEditBox();
    change.current();
  }
  function moveBend(id: string, point: { x: number; y: number }) {
    const s = scene.current,
      entry = s?.entries.get(id);
    if (!s || !entry || busy) return;
    const data = readNode(entry.data, entry.node),
      line = lineSettings(data);
    const local = entry.node.getInnerPoint(s.group.getWorldPoint(point));
    const next = canvasNodeSchema.safeParse({
      ...data,
      line: { ...line, bend: local },
    });
    if (!next.success) return;
    entry.data = next.data;
    applyNode(entry.node, next.data);
    if (s.app.editor.editTool) s.app.editor.updateEditBox();
    change.current();
  }
  function dragEndpoint(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = draggingEndpoint.current,
      s = scene.current;
    if (!drag || !s || !host.current || event.pointerId !== drag.pointerId)
      return;
    event.preventDefault();
    event.stopPropagation();
    const rect = host.current.getBoundingClientRect();
    const point = s.group.getInnerPoint({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    if (drag.end === "bend") moveBend(drag.id, point);
    else moveEndpoint(drag.id, drag.end, point);
  }
  function add(kind: CanvasNode["kind"], extra: Partial<CanvasNode> = {}) {
    const s = scene.current;
    if (!s || busy) return;
    if (kind !== "connector") stopDrawing();
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
      x: point.x - (extra.width ?? 200) / 2,
      y: point.y - (extra.height ?? 120) / 2,
      width: kind === "text" ? 280 : kind === "circle" ? 180 : 200,
      height:
        kind === "text"
          ? 100
          : kind === "circle"
            ? 180
            : kind === "equilateral"
              ? 100 * Math.sqrt(3)
              : 120,
      fill: kind === "text" ? "#0d0c22" : "#ffffff",
      stroke: "#0d0c22",
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
    setLibrary(null);
    s.app.editor.select(s.entries.get(data.id)!.node);
    change.current();
  }
  function addDesignCard(value: CanvasDesign, point?: { x: number; y: number }) {
    add("rect", { designSpec: structuredClone({ ...value, enabled: true }), width: 320, height: 230,
      text: value.name, fill: value.colors.surface, stroke: value.colors.border, textColor: value.colors.text,
      cornerRadius: value.cardRadius, ...(point ? { x: point.x, y: point.y } : {}) });
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
  const pasted = useRef({ text: "", count: 0 });
  function clipboardSelection() {
    const s = scene.current;
    if (!s || busy) return null;
    return copyCanvasNodes(
      s.snapshot().nodes,
      s.app.editor.list.map((node) => node.id ?? ""),
    );
  }
  function pasteContent(text: string) {
    const s = scene.current;
    if (!s || busy || !text) return;
    try {
      const nodes = readCanvasClipboard(text);
      if (!nodes) {
        add("text", { text });
        return;
      }
      const count = pasted.current.text === text ? pasted.current.count + 1 : 1;
      const copies = cloneCanvasNodes(nodes, count * 24);
      const result = canvasContentSchema.safeParse({
        nodes: [...s.snapshot().nodes, ...copies],
      });
      if (!result.success)
        throw new Error(result.error.issues[0]?.message || "无法粘贴内容");
      stopDrawing();
      copies.forEach(s.add);
      s.sync();
      s.app.editor.select(copies.map((node) => s.entries.get(node.id)!.node));
      pasted.current = { text, count };
      setLibrary(null);
      change.current();
    } catch {
      notify(
        "无法粘贴：内容无效或超出画布容量（最多 200 个元素、6 MB）",
        "error",
      );
    }
  }
  useEffect(() => {
    const editing = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        !!target.closest(
          "input, textarea, select, [role=dialog], [role=alertdialog]",
        ));
    const copy = (event: ClipboardEvent) => {
      if (editing(event.target) || busy) return;
      const text = clipboardSelection();
      if (!text || !event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", text);
    };
    const paste = (event: ClipboardEvent) => {
      if (
        editing(event.target) ||
        busy ||
        !scene.current ||
        !event.clipboardData
      )
        return;
      const text = event.clipboardData.getData("text/plain");
      const image = [...event.clipboardData.files].find((file) =>
        file.type.startsWith("image/"),
      );
      if (!text && !image) return;
      event.preventDefault();
      if (image) void insertImage(image);
      else pasteContent(text);
    };
    const undo = (event: KeyboardEvent) => {
      if (
        editing(event.target) ||
        busy ||
        removeTarget ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey)
      )
        return;
      const key = event.key.toLowerCase();
      const redo =
        (key === "z" && event.shiftKey) ||
        (key === "y" && event.ctrlKey && !event.metaKey);
      if (key !== "z" && !redo) return;
      const s = scene.current;
      if (!s || !history.current || s.gesturing() || draggingEndpoint.current)
        return;
      event.preventDefault();
      stopDrawing();
      history.current.record(s.snapshot());
      const content = redo ? history.current.redo() : history.current.undo();
      if (!content) return;
      restoring.current = true;
      try {
        s.restore(content);
        change.current();
      } finally {
        restoring.current = false;
      }
    };
    const groupSelection = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "g" || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (editing(event.target) || event.isComposing || event.repeat || busy || removeTarget ||
          !scene.current || scene.current.gesturing() || draggingEndpoint.current ||
          document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      // Handle before the browser's Find Next shortcut and canvas key handlers.
      event.preventDefault();
      event.stopImmediatePropagation();
      organizeSelection(event.shiftKey);
    };
    const deleteSelection = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      if (editing(event.target) || event.isComposing) return;
      // Capture before the canvas library and suppress WebView back navigation,
      // including when the canvas has no selection.
      event.preventDefault();
      event.stopImmediatePropagation();
      const s = scene.current;
      if (
        !s ||
        busy ||
        removeTarget ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        s.gesturing() ||
        draggingEndpoint.current ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      )
        return;
      const ids = s.app.editor.list.map((node) => node.id ?? "");
      if (ids.length) removeNodes(ids);
    };
    window.addEventListener("keydown", groupSelection, true);
    window.addEventListener("keydown", deleteSelection, true);
    window.addEventListener("keydown", undo);
    // Native clipboard events cover Command on macOS and Control on Windows,
    // as well as the operating system's Edit menu, without hijacking text editing.
    window.addEventListener("copy", copy);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("keydown", groupSelection, true);
      window.removeEventListener("keydown", deleteSelection, true);
      window.removeEventListener("keydown", undo);
      window.removeEventListener("copy", copy);
      window.removeEventListener("paste", paste);
    };
  });
  async function generateUI(prompt?: string, autoStart = false) {
    const s = scene.current;
    if (!s || busy) return;
    setBusy(true);
    try {
      s.app.editor.closeInnerEditor();
      s.app.tree.updateLayout();
      resolveCanvasDesign(selection.flatMap((n) => n.designSpec ? [n.designSpec] : []), designRef.current);
      const candidates = selection.filter((n) => !n.designSpec && ["container", "text", "image"].includes(n.kind) && !selection.some((parent) => parent.id === n.containerId));
      if (candidates.length !== 1) throw new Error("请选择一个原型或文字，并可搭配一张设计规范卡");
      const entry = s.entries.get(candidates[0]!.id)!;
      const node = readNode(entry.data, entry.node);
      if (node.kind === "text") {
        if (!node.text?.trim()) throw new Error("请先填写文字需求");
        if (node.text.length > 20000)
          throw new Error("文字需求最多支持 20000 字，请精简后重试");
        setUISource({ node, prompt, autoStart });
        return;
      }
      let image = node.src;
      if (node.kind === "container") {
        const bounds = entry.node.getBounds("box", "world");
        const exported = await s.group.export("png", {
          screenshot: bounds,
          scale:
            Math.min(1, 1600 / Math.max(node.width, node.height)) /
            (s.app.tree.zoomLayer.scaleX || 1),
          fill: node.fill,
        });
        if (exported.error || typeof exported.data !== "string")
          throw new Error("无法读取容器原型，请重试");
        image = exported.data;
      }
      if (!image || image.length > 7000000)
        throw new Error("原型图片过大，请缩小容器后重试");
      setUISource({ node, image, prompt, autoStart });
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  function fitCanvas(ids?: string[]) {
    const s = scene.current,
      canvas = host.current;
    if (!s || !canvas) return;
    s.app.tree.updateLayout();
    const boxes = [
      ...s.snapshot().nodes.filter(n => !ids || ids.includes(n.id)).map((n) => {
        const angle = (n.rotation * Math.PI) / 180;
        const points = [
          [0, 0],
          [n.width * n.scaleX, 0],
          [0, n.height * n.scaleY],
          [n.width * n.scaleX, n.height * n.scaleY],
        ].map(([x, y]) => ({
          x: n.x + x! * Math.cos(angle) - y! * Math.sin(angle),
          y: n.y + x! * Math.sin(angle) + y! * Math.cos(angle),
        }));
        const x = Math.min(...points.map((p) => p.x)),
          y = Math.min(...points.map((p) => p.y));
        return {
          x,
          y,
          width: Math.max(...points.map((p) => p.x)) - x,
          height: Math.max(...points.map((p) => p.y)) - y,
        };
      }),
      ...(ids ? [] : uiSlots.current.values()),
    ];
    if (!boxes.length) return;
    const viewport = canvas.getBoundingClientRect();
    const panel = canvas
      .closest(".note-editor-content")
      ?.querySelector<HTMLElement>(".canvas-assistant:not([hidden])")
      ?.getBoundingClientRect();
    const right = panel ? Math.max(32, viewport.right - panel.left + 24) : 64;
    // Keep the floating card on top of the full canvas, but fit into its unobscured area.
    const left = Math.min(64, Math.max(16, (viewport.width - right) / 4));
    const x = Math.min(...boxes.map((b) => b.x)),
      y = Math.min(...boxes.map((b) => b.y));
    if (viewport.width - right - left < 48) return;
    s.app.tree.zoom(
      {
        x,
        y,
        width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
        height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
      },
      [88, right, 64, left],
    );
  }
  useEffect(() => {
    const canvas = host.current;
    if (!canvas) return;
    let frame = requestAnimationFrame(() => {
      if (assistantOpen) fitCanvas();
    });
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (assistantOpen) fitCanvas();
      });
    });
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [assistantOpen]);
  function reserveUI(
    key: string,
    source: CanvasNode,
    imageWidth: number,
    imageHeight: number,
  ) {
    const s = scene.current;
    if (!s) throw new Error("画布已关闭");
    const width = source.kind === "text" ? 640 : source.width * source.scaleX;
    const slot = {
      x: source.x + source.width * source.scaleX + 40,
      y: source.y,
      width,
      height: (width * imageHeight) / imageWidth,
    };
    const occupied = [
      ...s.snapshot().nodes.map((n) => ({
        x: n.x,
        y: n.y,
        width: n.width * n.scaleX,
        height: n.height * n.scaleY,
      })),
      ...[...uiSlots.current.entries()]
        .filter(([id]) => id !== key)
        .map(([, value]) => value),
    ];
    while (
      occupied.some(
        (n) =>
          slot.x < n.x + n.width &&
          slot.x + slot.width > n.x &&
          slot.y < n.y + n.height &&
          slot.y + slot.height > n.y,
      )
    )
      slot.x += slot.width + 40;
    uiSlots.current.set(key, slot);
  }
  async function insertGeneratedUI(
    key: string,
    source: CanvasNode,
    image: string,
    prompt: string,
  ) {
    const s = scene.current;
    if (!s) throw new Error("画布已关闭");
    const blob = await (await fetch(image)).blob();
    const processed = await imageData(
      new File([blob], "ui.png", { type: blob.type }),
    );
    const slot = uiSlots.current.get(key);
    if (!slot) throw new Error("生成位置已失效，请重新生成");
    const width = slot.width;
    const data = canvasNodeSchema.parse({
      id: crypto.randomUUID(),
      kind: "image",
      src: processed.src,
      x: slot.x,
      y: slot.y,
      width,
      height: (width * processed.height) / processed.width,
      uiDesign: {
        sourceId: source.uiDesign?.sourceId || source.id,
        prompt,
        revision: (source.uiDesign?.revision || 0) + 1,
      },
    });
    const nodes = s.snapshot().nodes;
    const result = canvasContentSchema.safeParse({ nodes: [...nodes, data] });
    if (!result.success)
      throw new Error("画布容量不足，请释放空间后点击添加到画布");
    s.add(data);
    uiSlots.current.delete(key);
    change.current();
    fitCanvas();
    notify("UI 图片已添加，可选中图片继续修改；将自动保存");
  }
  function updateOrganization(ids: string[], update: Partial<CanvasNode>) {
    const s = scene.current;
    if (!s) return;
    const before = s.snapshot();
    history.current?.record(before);
    s.restore({ ...before, nodes: before.nodes.map(n => ids.includes(n.id) ? { ...n, ...update } : n) });
    change.current();
    setNavigatorNodes(s.snapshot().nodes);
  }
  function organizeSelection(ungroup = false) {
    const s = scene.current;
    if (!s || busy) return;
    const nodes = s.app.editor.list.flatMap(n => {
      const entry = s.entries.get(n.id ?? "");
      return entry && !entry.data.locked ? [entry.data] : [];
    });
    if (ungroup ? !nodes.some(n => n.groupId) : nodes.length < 2) return;
    if (!ungroup && nodes[0]!.groupId && nodes.every(n => n.groupId === nodes[0]!.groupId)) return;
    updateOrganization(nodes.map(n => n.id), { groupId: ungroup ? undefined : crypto.randomUUID() });
  }
  function lockSelection() {
    const s = scene.current;
    if (!s) return;
    const ids = new Set(selection.map(n => n.id));
    for (const n of s.snapshot().nodes) if (n.containerId && ids.has(n.containerId)) ids.add(n.id);
    updateOrganization([...ids], { locked: true });
    s.app.editor.cancel();
  }
  function locateNode(node: CanvasNode) {
    const s = scene.current;
    if (!s) return;
    const ids = s.snapshot().nodes.filter(n => n.id === node.id || (node.groupId && n.groupId === node.groupId)).map(n => n.id);
    fitCanvas(ids);
    setNavigatorOpen(false);
    s.app.editor.select(ids.flatMap(id => { const e = s.entries.get(id); return e && !e.data.locked ? [e.node] : []; }));
  }
  function duplicateSpec() {
    if (!renameSpec?.designSpec || !variantName.trim()) return;
    addDesignCard({ ...structuredClone(renameSpec.designSpec), name: variantName.trim() }, { x: renameSpec.x + renameSpec.width * renameSpec.scaleX + 48, y: renameSpec.y });
    setRenameSpec(null);
    setLibrary("design");
    fitCanvas();
  }
  function patch(update: Partial<CanvasNode>) {
    if (!selected || selected.locked || !scene.current) return;
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
    if (current.kind === "container") {
      const dx = next.data.x - current.x,
        dy = next.data.y - current.y;
      for (const child of scene.current.entries.values()) {
        if (child.data.containerId === current.id) child.node.move(dx, dy);
      }
    }
    entry.data = next.data;
    applyNode(entry.node, next.data);
    scene.current.sync();
    change.current();
  }
  function remove() {
    if (removeTarget) removeNodes(removeTarget);
  }
  function removeNodes(ids: string[]) {
    const s = scene.current;
    if (!s) return;
    history.current?.record(s.snapshot());
    s.app.editor.cancel();
    for (const id of ids) {
      if (s.entries.get(id)?.data.locked) continue;
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
      const entry = s.entries.get(node.id ?? "");
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
      const first = sorted[0]!.bounds[position],
        last = sorted[sorted.length - 1]!.bounds;
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
          x:
            (item.entry.node.x ?? item.entry.data.x) + (horizontal ? delta : 0),
          y:
            (item.entry.node.y ?? item.entry.data.y) + (horizontal ? 0 : delta),
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
          x: (entry.node.x ?? entry.data.x) + dx,
          y: (entry.node.y ?? entry.data.y) + dy,
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
  async function save(automatic = false) {
    const s = scene.current;
    if (!s || busy || saveInFlight.current) return;
    if (
      automatic &&
      (s.gesturing() || draggingEndpoint.current || drawState.current.active)
    )
      return;
    if (!automatic) {
      stopDrawing();
      s.app.editor.closeInnerEditor();
    }
    const submittedName = latestName.current;
    const submittedContent = s.snapshot();
    const submittedSnapshot = JSON.stringify(submittedContent);
    const result = canvasNoteInputSchema.safeParse({
      name: submittedName,
      content: submittedContent,
    });
    if (!result.success) {
      setSaveError(result.error.issues[0]?.message || "内容格式不正确");
      retry.current.blocked = true;
      return;
    }
    const current = savedNote.current;
    saveInFlight.current = true;
    setSaving(true);
    setSaveError("");
    try {
      const { data } = await api<{ data: CanvasNote }>(
        current ? `/api/v1/notes/${current.id}` : "/api/v1/notes",
        {
          method: current ? "PUT" : "POST",
          body: JSON.stringify({
            ...result.data,
            ...(current ? { expectedVersion: current.version } : {}),
          }),
        },
      );
      if (scene.current !== s) return;
      savedNote.current = data;
      setNote(data);
      if (latestName.current === submittedName) setName(data.name);
      setSavedName(data.name);
      // Compare the exact local snapshot: server validation may reorder/default fields.
      baseline.current = submittedSnapshot;
      const stillDirty = JSON.stringify(s.snapshot()) !== baseline.current;
      setDirty(stillDirty);
      retry.current = { after: 0, failures: 0, blocked: false };
      if (!automatic) notify("无边记已保存");
      if (!id) {
        skipGuard.current = true;
        navigate(`/notes/${data.id}`, { replace: true });
      }
    } catch (e) {
      if (scene.current !== s) return;
      const blocked =
        e instanceof ApiError && [400, 403, 404, 409, 413].includes(e.status);
      const failures = retry.current.failures + 1;
      retry.current = {
        blocked,
        failures,
        after: Date.now() + Math.min(30000, 3000 * 2 ** (failures - 1)),
      };
      setSaveError(
        `${(e as Error).message}${blocked ? "；修改尚未保存" : "；将自动重试"}`,
      );
    } finally {
      saveInFlight.current = false;
      if (scene.current === s) {
        setSaving(false);
      }
    }
  }
  autoSave.current = () => {
    const s = scene.current;
    if (!s || loading || busy || saveInFlight.current) return;
    const content = JSON.stringify(s.snapshot());
    const key = JSON.stringify([name, content]);
    const now = Date.now();
    if (key !== candidate.current.key) {
      candidate.current = { key, since: now };
      // Validation errors can recover on edit; version conflicts still retain their version guard.
      retry.current.blocked = false;
      return;
    }
    if (content === baseline.current && name === savedName) return;
    if (
      now - candidate.current.since < 1200 ||
      now < retry.current.after ||
      retry.current.blocked
    )
      return;
    void save(true);
  };
  useEffect(() => {
    const timer = setInterval(() => autoSave.current(), 300);
    return () => clearInterval(timer);
  }, []);
  async function exportImage() {
    const s = scene.current;
    if (!s || busy) return;
    stopDrawing();
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
    const containerCount = [...s.entries.values()].filter(
      (e) => e.data.kind === "container",
    ).length;
    s.group.add(
      entry.node,
      selected.kind === "container"
        ? front
          ? containerCount - 1
          : 0
        : front
          ? s.group.children.length
          : containerCount,
    );
    change.current();
  }
  const inspectorAnchor = () => {
    const current = scene.current,
      canvas = host.current;
    if (!current || !canvas) return null;
    const boxes = selection.flatMap((item) => {
      const entry = current.entries.get(item.id);
      return entry ? [entry.node.getBounds("box", "world")] : [];
    });
    if (!boxes.length) return null;
    const x = Math.min(...boxes.map((b) => b.x)),
      y = Math.min(...boxes.map((b) => b.y));
    return {
      bounds: {
        x,
        y,
        width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
        height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
      },
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    };
  };
  return (
    <div
      className={`workspace-content note-editor-content${assistantOpen ? " note-assistant-open" : ""}`}
    >
      <CanvasAssistant
        noteId={note?.id}
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        onPending={setAssistantPending}
        getContext={(all) => {
          const content = scene.current?.snapshot();
          const ids = new Set(selection.map((n) => n.id));
          const nodes = (content?.nodes || []).filter(
            (n) =>
              all || ids.has(n.id) || (n.containerId && ids.has(n.containerId)),
          );
          return {
            count: nodes.length,
            text: JSON.stringify(
              nodes.map(({ src, ...n }) => ({
                ...n,
                ...(src ? { image: "图片元素" } : {}),
              })),
            ).slice(0, 30000),
          };
        }}
        onApply={async (result: CanvasAssistantResult) => {
          const s = scene.current;
          if (!s) throw new Error("画布未就绪");
          if (result.action === "image") {
            if (selection.some((n) => !n.designSpec && ["container", "image"].includes(n.kind))) {
              await generateUI(result.imagePrompt, true);
              return;
            }
            const anchor =
              selected ||
              s.snapshot().nodes.findLast((n) => n.kind === "container") ||
              s.snapshot().nodes.at(-1);
            const node = canvasNodeSchema.parse({
              id: crypto.randomUUID(),
              kind: "text",
              x: anchor?.x || 80,
              y: anchor?.y || 80,
              width: anchor?.width || 640,
              height: 100,
              text: result.text || result.imagePrompt,
            });
            setUISource({
              node,
              prompt: result.imagePrompt,
              autoStart: true,
              dimensions: { width: result.width, height: result.height },
            });
            return;
          }
          s.app.editor.closeInnerEditor();
          const before = s.snapshot();
          if (result.action === "design") {
            const updated = applyAssistantDesign(result, before);
            history.current?.record(before);
            s.restore(updated);
            change.current();
            notify("已更新设计规范，可用快捷键撤销");
            return;
          }
          const nodes = canvasAssistantNodes(result, before);
          history.current?.record(before);
          s.restore({ ...before, nodes: [...before.nodes, ...nodes] });
          change.current();
          fitCanvas();
          notify("已添加到画布，可用快捷键撤销");
        }}
      />
      <div className="note-ui-background-tasks" aria-label="UI 图片生成任务">
        {uiSources.map((uiSource) => (
          <CanvasUIDialog
            key={uiSource.key}
            initialPrompt={uiSource.prompt}
            designPrompt={uiSource.designPrompt}
            autoStart={uiSource.autoStart}
            source={{
              image: uiSource.image,
              sourceText:
                uiSource.node.kind === "text" ? uiSource.node.text : undefined,
              width:
                uiSource.node.kind === "text"
                  ? uiSource.dimensions?.width || 1440
                  : uiSource.node.width,
              height:
                uiSource.node.kind === "text"
                  ? uiSource.dimensions?.height || 900
                  : uiSource.node.height,
              revision: !!uiSource.node.uiDesign,
            }}
            onPrepare={(width, height) => {
              reserveUI(uiSource.key, uiSource.node, width, height);
              fitCanvas();
            }}
            onMovePlaceholder={(dx, dy) => {
              const s = scene.current, slot = uiSlots.current.get(uiSource.key);
              if (!s || !slot) return;
              const origin = s.group.getWorldPoint({ x: 0, y: 0 });
              const unit = s.group.getWorldPoint({ x: 1, y: 1 });
              const scaleX = unit.x - origin.x, scaleY = unit.y - origin.y;
              if (!scaleX || !scaleY) return;
              slot.x += dx / scaleX;
              slot.y += dy / scaleY;
            }}
            getPlaceholder={() => {
              const s = scene.current,
                slot = uiSlots.current.get(uiSource.key),
                stage = host.current?.parentElement;
              if (!s || !slot || !stage) return null;
              const start = s.group.getWorldPoint({ x: slot.x, y: slot.y });
              const end = s.group.getWorldPoint({
                x: slot.x + slot.width,
                y: slot.y + slot.height,
              });
              return {
                host: stage,
                x: start.x,
                y: start.y,
                width: end.x - start.x,
                height: end.y - start.y,
              };
            }}
            onClose={() => {
              uiSlots.current.delete(uiSource.key);
              setUISources((items) =>
                items.filter((item) => item.key !== uiSource.key),
              );
            }}
            onInsert={(image, prompt) =>
              insertGeneratedUI(uiSource.key, uiSource.node, image, prompt)
            }
          />
        ))}
      </div>
      <header className="note-heading">
        <div className="note-document-controls">
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
            {saving
              ? "正在保存…"
              : saveError
                ? "保存失败"
                : busy
                  ? "正在处理…"
                  : dirty || name !== savedName
                    ? "等待自动保存…"
                    : "已保存"}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={busy || loading || !initial}
            onClick={exportImage}
            title={"导出图片"}
            aria-label={"导出图片"}
          >
            <Download />
          </Button>
        </div>
        <div className="note-heading-actions">
          <Button
            variant={assistantOpen ? "secondary" : "ghost"}
            size="icon-sm"
            title="画布助手"
            aria-label="画布助手"
            aria-expanded={assistantOpen}
            onClick={() => setAssistantOpen((v) => !v)}
          >
            {assistantPending ? (
              <LoaderCircle className="canvas-assistant-spin" />
            ) : (
              <MessageSquare />
            )}
          </Button>
          <Button
            size="icon-sm"
            disabled={busy || saving || loading || !initial}
            onClick={() => void save()}
            title={"保存"}
            aria-label={"保存"}
          >
            <Save />
          </Button>
        </div>
      </header>
      {(error || saveError) && (
        <div className="message" role="alert">
          {error || saveError}
          {saveError && (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving || busy}
              onClick={() => void save()}
            >
              重试保存
            </Button>
          )}
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
              if (busy) return;
              const spec = e.dataTransfer.getData("application/x-dedsi-design");
              if (spec) {
                try {
                  const value = canvasDesignSchema.parse(JSON.parse(spec));
                  const bounds = host.current!.getBoundingClientRect();
                  const point = scene.current!.group.getInnerPoint({ x: e.clientX - bounds.left, y: e.clientY - bounds.top });
                  addDesignCard(value, point);
                } catch { notify("无法读取设计规范", "error"); }
              } else void insertImage(e.dataTransfer.files[0]);
            }}
            role="application"
            aria-label="无边记画布"
          />
          <CanvasGuides
            getGuides={() => {
              const s = scene.current;
              if (
                !s ||
                !s.gesturing() ||
                !s.app.editor.moving ||
                drawing ||
                busy
              )
                return [];
              const ids = new Set(s.app.editor.list.map((node) => node.id));
              const moving = [...s.entries.values()].filter((e) =>
                ids.has(e.data.id),
              );
              if (!moving.length) return [];
              const boxes = moving.map((e) => e.node.getBounds("box", "world"));
              const x = Math.min(...boxes.map((b) => b.x));
              const y = Math.min(...boxes.map((b) => b.y));
              const bounds = {
                x,
                y,
                width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
                height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
              };
              const peers = [...s.entries.values()]
                .filter(
                  (e) =>
                    !ids.has(e.data.id) &&
                    !ids.has(e.data.containerId) &&
                    e.data.kind !== "connector",
                )
                .map((e) => e.node.getBounds("box", "world"));
              return alignmentGuides(bounds, peers);
            }}
          />
          {drawing && (
            <div className="note-drawing-status" role="status">
              {drawStarted ? "点击终点完成连线" : "点击画布设置连线起点"}
              <Button variant="ghost" size="sm" onClick={stopDrawing}>
                取消
              </Button>
            </div>
          )}
          <div className="note-tools" aria-label="添加内容">
            <Button
              variant="ghost"
              size="icon-sm"
              title="选择 / 框选"
              aria-label="选择或框选"
              onClick={() => {
                stopDrawing();
                scene.current?.app.editor.cancel();
              }}
            >
              <MousePointer2 />
            </Button>
            <Button
              variant={drawing ? "secondary" : "ghost"}
              size="icon-sm"
              title="连线"
              aria-label="添加连线"
              aria-pressed={drawing}
              disabled={busy}
              onClick={beginDrawing}
            >
              <ArrowUpRight />
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
            <Button size="icon-sm" variant={library === "design" ? "secondary" : "ghost"} title="UI 设计规范" aria-label="UI 设计规范" aria-pressed={library === "design"} disabled={busy} onClick={() => { stopDrawing(); setLibrary(library === "design" ? null : "design"); }}>
              <Palette />
            </Button>
            <Button
              variant={library === "containers" ? "secondary" : "ghost"}
              size="icon-sm"
              title="容器"
              aria-label="添加容器"
              aria-pressed={library === "containers"}
              disabled={busy}
              onClick={() => {
                stopDrawing();
                setLibrary(library === "containers" ? null : "containers");
              }}
            >
              <Frame />
            </Button>
            <Button
              variant={library === "shapes" ? "secondary" : "ghost"}
              size="icon-sm"
              title="形状"
              aria-label="添加形状"
              aria-pressed={library === "shapes"}
              disabled={busy}
              onClick={() => {
                stopDrawing();
                setLibrary(library === "shapes" ? null : "shapes");
              }}
            >
              <Shapes />
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
            <EmptyState
              className="note-canvas-empty"
              icon={Layers2}
              title="从一段文字、一张图片开始"
              description="使用工具栏添加文字、图片或图形。"
            />
          )}
          {library === "design" && (
            <CanvasDesignPanel getAnchor={inspectorAnchor} value={selected?.designSpec ?? design} editingCard={!!selected?.designSpec} onAdd={addDesignCard} disabled={busy} onClose={() => setLibrary(null)} onChange={(value) => {
              if (selected?.designSpec) { patch({ designSpec: value, fill: value.colors.surface, stroke: value.colors.border }); return; }
              designRef.current = value;
              setDesign(value);
              change.current();
            }} />
          )}
          {library && library !== "design" && (
            <CanvasLibrary
              key={library}
              mode={library}
              busy={busy}
              onClose={() => setLibrary(null)}
              onAdd={add}
              dimensions={
                selected &&
                selected.kind !== "text" &&
                selected.kind !== "image" &&
                selected.kind !== "connector" ? (
                  <CanvasDimensions
                    key={selected.id}
                    value={selected}
                    busy={busy}
                    onChange={patch}
                  />
                ) : undefined
              }
            />
          )}
          {!library && selection.length > 1 && (
            <CanvasInspector
              label="多选排列"
              getAnchor={inspectorAnchor}
              quickActions={
                <>
                  <Button size="icon-sm" variant="ghost" title="组合（Mac：⌘G；Windows：Ctrl+G）" aria-keyshortcuts="Meta+G Control+G" aria-label="组合" onClick={() => organizeSelection()}><GroupIcon /></Button>
                  {selection.some(n => n.groupId) && <Button size="icon-sm" variant="ghost" title="取消组合（Mac：⇧⌘G；Windows：Ctrl+Shift+G）" aria-keyshortcuts="Meta+Shift+G Control+Shift+G" aria-label="取消组合" onClick={() => organizeSelection(true)}><Ungroup /></Button>}
                  <Button size="icon-sm" variant="ghost" title="锁定" aria-label="锁定" onClick={lockSelection}><LockKeyhole /></Button>
                  {selection.some((n) => n.designSpec) && <Button size="icon-sm" variant="ghost" disabled={busy} title="按选中规范生成 UI 图片" aria-label="按选中规范生成 UI 图片" onClick={() => void generateUI()}><Sparkles /></Button>}
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
                      disabled={busy}
                      onClick={() => arrange(action)}
                    >
                      <Icon />
                    </Button>
                  ))}
                  {(
                    [
                      [
                        "horizontal",
                        "水平等间距分布",
                        AlignHorizontalDistributeCenter,
                      ],
                      [
                        "vertical",
                        "垂直等间距分布",
                        AlignVerticalDistributeCenter,
                      ],
                    ] as const
                  ).map(([action, label, Icon]) => (
                    <Button
                      key={action}
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy || selection.length < 3}
                      title={`保持两端位置，${label}`}
                      aria-label={label}
                      onClick={() => arrange(action)}
                    >
                      <Icon />
                    </Button>
                  ))}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="删除选中元素"
                    aria-label="删除选中元素"
                    disabled={busy}
                    onClick={() => setRemoveTarget(selection.map((n) => n.id))}
                  >
                    <Trash2 />
                  </Button>
                </>
              }
            >
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
                  size="icon-sm"
                  title="水平应用自定义间距"
                  aria-label="水平应用自定义间距"
                  disabled={busy || gap < 0 || gap > 2000}
                  onClick={() => arrange("horizontal", true)}
                >
                  <AlignHorizontalDistributeCenter />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  title="垂直应用自定义间距"
                  aria-label="垂直应用自定义间距"
                  disabled={busy || gap < 0 || gap > 2000}
                  onClick={() => arrange("vertical", true)}
                >
                  <AlignVerticalDistributeCenter />
                </Button>
              </div>
            </CanvasInspector>
          )}
          {!library && selected && (
            <CanvasInspector
              key={selected.id}
              label="元素属性"
              getAnchor={inspectorAnchor}
              quickActions={
                <><Button size="icon-sm" variant="ghost" title="锁定" aria-label="锁定" onClick={lockSelection}><LockKeyhole /></Button>{selected.designSpec ? <>
                  <Button size="icon-sm" variant="ghost" title="复制为新风格" aria-label="复制为新风格" onClick={() => { setRenameSpec(selected); setVariantName(`${selected.designSpec!.name.slice(0, 32)} · 副本`); }}><Copy /></Button>
                  <Button size="icon-sm" variant="ghost" title="编辑设计规范" aria-label="编辑设计规范" onClick={() => setLibrary("design")}><Palette /></Button>
                  <Button size="icon-sm" variant="ghost" title="删除规范卡" aria-label="删除规范卡" onClick={() => setRemoveTarget([selected.id])}><Trash2 /></Button>
                </> : <CanvasQuickTools
                  value={selected}
                  busy={busy}
                  onChange={patch}
                  onRemove={() => setRemoveTarget([selected.id])}
                  onLayer={layer}
                  onGenerateUI={
                    selected.kind === "container" ||
                    selected.kind === "text" ||
                    (selected.kind === "image" && selected.uiDesign)
                      ? () => void generateUI()
                      : undefined
                  }
                />}</>
              }
            >
              {selected.kind === "connector" && (
                <ConnectorProperties
                  value={selected}
                  busy={busy}
                  onChange={patch}
                />
              )}
              {!selected.designSpec && selected.kind !== "image" && selected.kind !== "connector" && (
                <>
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
              {!selected.designSpec && selected.kind !== "image" && selected.kind !== "connector" && (
                <div
                  className="note-property-row note-text-alignment"
                  role="group"
                  aria-label="文字对齐方式"
                >
                  <span>文字对齐</span>
                  <div>
                    {(
                      [
                        ["left", "文字左对齐", TextAlignStart],
                        ["center", "文字居中对齐", TextAlignCenter],
                        ["right", "文字右对齐", TextAlignEnd],
                      ] as const
                    ).map(([align, label, Icon]) => (
                      <Button
                        key={align}
                        variant={
                          (selected.textAlign ??
                            (selected.kind === "text" ? "left" : "center")) ===
                          align
                            ? "secondary"
                            : "ghost"
                        }
                        size="icon-sm"
                        aria-label={label}
                        title={label}
                        aria-pressed={
                          (selected.textAlign ??
                            (selected.kind === "text" ? "left" : "center")) ===
                          align
                        }
                        disabled={busy}
                        onClick={() => patch({ textAlign: align })}
                      >
                        <Icon />
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {!selected.designSpec && selected.kind !== "image" && selected.kind !== "connector" && (
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
              {selected.kind === "container" && (
                <>
                  <label className="note-font-field">
                    自动布局
                    <select
                      aria-label="容器布局"
                      value={selected.layout ?? "free"}
                      disabled={busy}
                      onChange={(e) =>
                        patch({
                          layout: e.target.value as CanvasNode["layout"],
                        })
                      }
                    >
                      <option value="free">自由布局</option>
                      <option value="horizontal">水平排列</option>
                      <option value="vertical">垂直排列</option>
                    </select>
                  </label>
                  {selected.layout && selected.layout !== "free" && (
                    <div className="note-property-row">
                      <label>
                        元素间距
                        <input
                          aria-label="容器元素间距"
                          type="number"
                          min={0}
                          max={1000}
                          step={1}
                          value={selected.layoutGap ?? 24}
                          disabled={busy}
                          onChange={(e) => {
                            if (e.target.value !== "")
                              patch({ layoutGap: Number(e.target.value) });
                          }}
                        />
                        <span>px</span>
                      </label>
                    </div>
                  )}
                </>
              )}
              {selected.kind === "rect" && (
                <div className="note-property-row">
                  <label>
                    圆角大小
                    <input
                      aria-label="圆角大小"
                      type="number"
                      min={0}
                      max={10000}
                      step={1}
                      value={selected.cornerRadius ?? 8}
                      disabled={busy}
                      onChange={(e) => {
                        if (e.target.value !== "")
                          patch({ cornerRadius: Number(e.target.value) });
                      }}
                    />
                    <span>px</span>
                  </label>
                </div>
              )}
              {isShape(selected.kind) && (
                <div className="note-property-row">
                  <label>
                    边框宽度
                    <input
                      aria-label="边框宽度"
                      type="number"
                      min={0}
                      max={20}
                      step={0.5}
                      value={selected.strokeWidth}
                      disabled={busy}
                      onChange={(e) => {
                        if (e.target.value !== "")
                          patch({ strokeWidth: Number(e.target.value) });
                      }}
                    />
                    <span>px</span>
                  </label>
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
              {selected.kind !== "text" && selected.kind !== "connector" && (
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
              )}
              <div className="note-property-row">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => layer(true)}
                  title={"置顶"}
                  aria-label={"置顶"}
                >
                  <ArrowUpToLine />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => layer(false)}
                  title={"置底"}
                  aria-label={"置底"}
                >
                  <ArrowDownToLine />
                </Button>
              </div>
            </CanvasInspector>
          )}
          {selected?.kind === "connector" &&
            !drawing &&
            scene.current &&
            [
              ...(["start", "end"] as const),
              ...(lineSettings(selected).type === "straight"
                ? []
                : ["bend" as const]),
            ].map((end) => {
              const entry = scene.current!.entries.get(selected.id);
              if (!entry) return null;
              const line = lineSettings(selected),
                point = entry.node.getWorldPoint(
                  end === "start"
                    ? { x: 0, y: 0 }
                    : end === "bend"
                      ? connectorBendPoint(line)
                      : { x: line.endX, y: line.endY },
                );
              return (
                <button
                  key={end}
                  className={`note-line-endpoint${end === "bend" ? " is-bend" : line[end === "start" ? "startBinding" : "endBinding"] ? " is-bound" : ""}`}
                  type="button"
                  style={{ left: point.x, top: point.y }}
                  aria-label={
                    end === "start"
                      ? "拖动连线起点"
                      : end === "bend"
                        ? "调整弯曲或拐点"
                        : "拖动连线终点"
                  }
                  title={
                    end === "start"
                      ? "连线起点（拖离形状可解除吸附）"
                      : end === "bend"
                        ? "拖动调整弯曲或拐点"
                        : "连线终点（拖离形状可解除吸附）"
                  }
                  disabled={busy}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    draggingEndpoint.current = {
                      id: selected.id,
                      end,
                      pointerId: event.pointerId,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={dragEndpoint}
                  onPointerUp={(event) => {
                    if (
                      draggingEndpoint.current?.pointerId === event.pointerId
                    ) {
                      dragEndpoint(event);
                      draggingEndpoint.current = null;
                      event.currentTarget.releasePointerCapture(
                        event.pointerId,
                      );
                    }
                  }}
                  onPointerCancel={() => {
                    draggingEndpoint.current = null;
                  }}
                  onKeyDown={(event) => {
                    const delta = event.shiftKey ? 10 : 1,
                      dx =
                        event.key === "ArrowLeft"
                          ? -delta
                          : event.key === "ArrowRight"
                            ? delta
                            : 0,
                      dy =
                        event.key === "ArrowUp"
                          ? -delta
                          : event.key === "ArrowDown"
                            ? delta
                            : 0;
                    if (dx || dy) {
                      event.preventDefault();
                      const inner = scene.current!.group.getInnerPoint(point);
                      const value = { x: inner.x + dx, y: inner.y + dy };
                      if (end === "bend") moveBend(selected.id, value);
                      else moveEndpoint(selected.id, end, value);
                    }
                  }}
                />
              );
            })}
          {navigatorOpen && <aside className="note-navigator" aria-label="画布定位">
            <header><strong>画布定位</strong><Button size="icon-sm" variant="ghost" aria-label="关闭画布定位" onClick={() => setNavigatorOpen(false)}><X /></Button></header>
            {!navigatorNodes.length && <EmptyState compact icon={ListTree} title="画布暂无元素" description="添加内容后，可在这里快速定位。" />}
            {navigatorNodes.map((n, i) => <div className="note-navigator-row" key={n.id}>
              <Button variant="ghost" size="sm" onClick={() => locateNode(n)} title="定位到此元素">{n.designSpec?.name || (n.uiDesign ? "生成图片" : n.kind === "container" ? "原型" : n.kind === "image" ? "图片" : n.text.slice(0, 24) || "形状")} · {i + 1}</Button>
              {n.locked && <Button variant="ghost" size="icon-sm" title="解锁" aria-label={`解锁元素 ${i + 1}`} onClick={() => { const all = scene.current?.snapshot().nodes ?? []; updateOrganization(all.filter(v => v.id === n.id || v.containerId === n.id || (n.groupId && v.groupId === n.groupId)).map(v => v.id), { locked: false }); }}><UnlockKeyhole /></Button>}
            </div>)}
          </aside>}
          <div className="note-zoom">
            <Button variant="ghost" size="icon-sm" title="画布定位" aria-label="画布定位" onClick={() => { setNavigatorNodes(scene.current?.snapshot().nodes ?? []); setNavigatorOpen(v => !v); }}><ListTree /></Button>
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
            <Button
              variant="ghost"
              size="sm"
              title="恢复到 100%"
              className="note-zoom-reset"
              aria-label="恢复到 100%"
              onClick={() => scene.current?.app.tree.zoom(1)}
            >
              {zoom}%
            </Button>
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
                fitCanvas();
              }}
            >
              <Scan />
            </Button>
          </div>
        </div>
      ) : null}
      <Dialog.Root open={!!renameSpec} onOpenChange={open => { if (!open) setRenameSpec(null); }}>
        <Dialog.Portal><Dialog.Overlay className="dialog-overlay confirmation-overlay" /><Dialog.Content className="confirmation-content">
          <Dialog.Title>复制为新风格</Dialog.Title><Dialog.Description>复制规范后可单独调整配色与布局。</Dialog.Description>
          <input aria-label="风格名称" maxLength={40} value={variantName} onChange={e => setVariantName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") duplicateSpec(); }} />
          <div className="confirmation-actions"><Button variant="outline" onClick={() => setRenameSpec(null)}>取消</Button><Button disabled={!variantName.trim()} onClick={duplicateSpec}>创建副本</Button></div>
        </Dialog.Content></Dialog.Portal>
      </Dialog.Root>
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
              选中的元素将从画布中移除并自动保存，可使用撤销快捷键恢复。
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
              {uiSource
                ? "UI 图片任务尚未结束"
                : busy
                  ? "正在处理内容"
                  : "离开前保存修改？"}
            </Dialog.Title>
            <Dialog.Description>
              {uiSource
                ? "可以继续编辑当前画布。离开前请等待图片添加完成，或在任务中取消生成并关闭任务。"
                : busy
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
              {!busy && !uiSource && (
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
