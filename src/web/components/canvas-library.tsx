import { canvasScreenSizes } from "../../shared/canvas-screen-sizes";
import type { ReactNode } from "react";
import {
  X, Frame, Scan, PanelsTopLeft, File, Smartphone, Laptop, Monitor,
  Tablet, TabletSmartphone, Watch, Columns3, Rows3,
} from "lucide-react";
import { Button } from "./ui/button";
import type { CanvasNode } from "../../shared/canvas-note";
import {
  shapeNames,
  shapePoints,
  shapeTypes,
} from "../../shared/canvas-shapes";

type Item = {
  name: string;
  kind: CanvasNode["kind"];
  extra?: Partial<CanvasNode>;
  group: string;
};
const shapes: Item[] = [
  { name: "矩形", kind: "rect", group: "基础图形" },
  {
    name: "圆角矩形",
    kind: "rect",
    extra: { cornerRadius: 24 },
    group: "基础图形",
  },
  { name: "椭圆", kind: "ellipse", group: "基础图形" },
  { name: "三角形", kind: "triangle", group: "基础图形" },
  {
    name: "胶囊",
    kind: "rect",
    extra: { cornerRadius: 10000 },
    group: "基础图形",
  },
  ...shapeTypes.map((shapeType) => ({
    name: shapeNames[shapeType],
    kind: "shape" as const,
    extra: { shapeType },
    group:
      shapeType.startsWith("arrow") || shapeType === "chevron"
        ? "方向箭头"
        : shapeType === "speech"
          ? "标注"
          : "基础图形",
  })),
];
const containers: Item[] = [
  ["自由画板", 800, 600, "通用"],
  ["选区", 600, 400, "通用"],
  ["软木板", 900, 600, "通用"],
  ["16:9", 960, 540, "演示与打印"],
  ["4:3", 800, 600, "演示与打印"],
  ["3:4", 600, 800, "演示与打印"],
  ["1:1", 600, 600, "演示与打印"],
  ["A4", 595, 842, "演示与打印"],
  ...canvasScreenSizes.map((preset) => [preset.name, preset.width, preset.height, `${preset.group}画板`]),
  ["Watch", 200, 240, "设备画板"],
].map(([name, width, height, group]) => ({
  name: String(name),
  kind: "container",
  group: String(group),
  extra: {
    width: Number(width),
    height: Number(height),
    text: String(name),
    cornerRadius: 0,
  },
}));
containers.push(
  {
    name: "水平自动布局",
    kind: "container",
    group: "自动布局",
    extra: {
      width: 600,
      height: 300,
      text: "水平布局",
      layout: "horizontal",
      layoutGap: 24,
    },
  },
  {
    name: "垂直自动布局",
    kind: "container",
    group: "自动布局",
    extra: {
      width: 400,
      height: 600,
      text: "垂直布局",
      layout: "vertical",
      layoutGap: 24,
    },
  },
);
function ContainerIcon({ item }: { item: Item }) {
  const name = item.name;
  if (item.extra?.layout === "horizontal") return <Columns3 aria-hidden="true" />;
  if (item.extra?.layout === "vertical") return <Rows3 aria-hidden="true" />;
  if (item.group === "手机画板") return <Smartphone aria-hidden="true" />;
  if (name.includes("笔记本")) return <Laptop aria-hidden="true" />;
  if (item.group === "PC画板") return <Monitor aria-hidden="true" />;
  if (name === "平板竖屏") return <TabletSmartphone aria-hidden="true" />;
  if (name === "平板横屏") return <Tablet aria-hidden="true" style={{ transform: "rotate(90deg)" }} />;
  if (name === "Watch") return <Watch aria-hidden="true" />;
  if (name === "自由画板") return <Frame aria-hidden="true" />;
  if (name === "选区") return <Scan aria-hidden="true" />;
  if (name === "软木板") return <PanelsTopLeft aria-hidden="true" />;
  if (name === "A4") return <File aria-hidden="true" />;
  const ratio = (item.extra?.width ?? 1) / (item.extra?.height ?? 1);
  const width = 88 * Math.min(1, ratio);
  const height = 88 / Math.max(1, ratio);
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <rect x={(100 - width) / 2} y={(100 - height) / 2} width={width} height={height} />
    </svg>
  );
}

export function CanvasLibrary({
  mode,
  busy,
  onClose,
  onAdd,
  dimensions,
}: {
  dimensions?: ReactNode;
  mode: "shapes" | "containers";
  busy: boolean;
  onClose: () => void;
  onAdd: (kind: CanvasNode["kind"], extra: Partial<CanvasNode>) => void;
}) {
  const items = mode === "shapes" ? shapes : containers;
  return (
    <aside
      className="note-library"
      aria-label={mode === "shapes" ? "形状库" : "容器库"}
    >
      <header>
        <strong>{mode === "shapes" ? "形状" : "容器"}</strong>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="关闭图形库"
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      {dimensions}

      <div className="note-library-grid">
        {items.map((item) => (
          <button
            type="button"
            key={item.name}
            disabled={busy}
            title={item.kind === "container" ? `${item.name} · ${item.extra?.width} × ${item.extra?.height}` : item.name}
            onClick={(event) => {
              const extra = { ...item.extra };
              if (event.shiftKey && mode === "shapes") {
                extra.width = 200;
                extra.height =
                  item.kind === "triangle" ? 100 * Math.sqrt(3) : 200;
              }
              onAdd(item.kind, extra);
            }}
          >
            {item.kind === "container" ? (
              <ContainerIcon item={item} />
            ) : (
              <svg viewBox="0 0 100 100" aria-hidden="true">
                {item.extra?.shapeType ? (
                  <polygon
                    points={shapePoints(item.extra.shapeType).join(" ")}
                  />
                ) : item.kind === "ellipse" ? (
                  <ellipse cx="50" cy="50" rx="46" ry="35" />
                ) : item.kind === "triangle" ? (
                  <polygon points="50,4 96,96 4,96" />
                ) : (
                  <rect
                    x="4"
                    y="15"
                    width="92"
                    height="70"
                    rx={Math.min(item.extra?.cornerRadius ?? 0, 35)}
                  />
                )}
              </svg>
            )}
            <span>{item.name}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
