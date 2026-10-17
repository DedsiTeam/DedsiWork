import { prepareAssistantSource } from "../components/personal-actions";
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
  ArrowLeft,
  ArrowUpRight,
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
import "../notes.css";
type Scene = {
  app: App;
  group: Group;
  entries: Map<string, { data: CanvasNode; node: UI }>;
  snapshot: () => CanvasContent;
  add: (data: CanvasNode) => void;
  sync: (autoAttach?: boolean) => void;
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
    editable: true,
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
      : data.kind === "triangle" || data.kind === "equilateral"
        ? new Polygon(shapeStyle(data))
        : new Rect({ ...shapeStyle(data), cornerRadius: 8 });
  box.add(background);
  box.add(new Text(labelStyle(data)));
  return box;
}
function readNode(data: CanvasNode, node: UI): CanvasNode {
  const shape = isShape(data.kind),
    background = shape ? ((node as Box).children[0] ?? node) : node;
  const label =
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
    box.children[1]?.set(labelStyle(data));
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
  const { id } = useParams(),
    navigate = useNavigate(),
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
      const entry = s.entries.get(node.id ?? "");
      return entry ? [readNode(entry.data, entry.node)] : [];
    });
    setSelection(values);
    setSelected(values.length === 1 ? values[0]! : null);
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
      group.add(node);
      node.on(PropertyEvent.CHANGE, changed);
      if (isShape(data.kind))
        for (const child of (node as Box).children)
          child.on(PropertyEvent.CHANGE, changed);
    };
    canvasContentSchema.parse(initial).nodes.forEach(add);
    const snapshot = () => {
      sync();
      return {
        nodes: group.children.map((node) => {
          const entry = entries.get(node.id ?? "")!;
          return readNode(entry.data, entry.node);
        }),
      };
    };
    scene.current = { app, group, entries, snapshot, add, sync };
    sync(true);
    baseline.current = JSON.stringify(snapshot());
    setCount(entries.size);
    app.editor.on(EditorEvent.SELECT, () => {
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
        (n) => n.kind === "text" || n.kind === "connector",
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
      window.removeEventListener("keydown", cancelDraw);
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
    scene.current.sync();
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
  async function save() {
    const s = scene.current;
    if (!s || busy) return;
    stopDrawing();
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
            disabled={busy || loading || !id || dirty || name !== savedName}
            title="先保存笔记，再将选中文字或整篇文字交给 Codex"
            onClick={async () => {
              if (!id || !workspace) return;
              try {
                navigate(
                  await prepareAssistantSource(
                    "note",
                    id,
                    workspace.id,
                    selection.map((n) => n.id),
                  ),
                );
              } catch (e) {
                notify((e as Error).message, "error");
              }
            }}
          >
            用 Codex 拆解需求
          </Button>
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
            <EmptyState
              className="note-canvas-empty"
              icon={Layers2}
              title="从一段文字、一张图片开始"
              description="使用工具栏添加文字、图片或图形。"
            />
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
              {selected.kind === "connector" && (
                <ConnectorProperties
                  value={selected}
                  busy={busy}
                  onChange={patch}
                />
              )}
              {selected.kind !== "image" && selected.kind !== "connector" && (
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
              {selected.kind !== "image" && selected.kind !== "connector" && (
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
              {selected.kind !== "image" && selected.kind !== "connector" && (
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
