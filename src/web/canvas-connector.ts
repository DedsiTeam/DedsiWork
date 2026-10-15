import type { CanvasNode, Connector } from "../shared/canvas-note";
export const connectorTypes = [
  { value: "straight", label: "直线" },
  { value: "curve", label: "曲线" },
  { value: "polyline", label: "折线" },
  { value: "rounded", label: "圆角折线" },
] as const;
export const connectorArrows = [
  { value: "none", label: "无箭头" },
  { value: "angle", label: "开放箭头" },
  { value: "triangle", label: "实心箭头" },
  { value: "circle", label: "圆点" },
  { value: "diamond", label: "菱形" },
] as const;
export function lineSettings(data: CanvasNode): Connector {
  return (
    data.line || {
      type: "straight",
      endX: 240,
      endY: 80,
      startArrow: "none",
      endArrow: "triangle",
      style: "solid",
    }
  );
}
export function connectorBendPoint(line: Connector) {
  if (line.bend) {
    if (line.type === "curve") return line.bend;
    return Math.abs(line.endX) >= Math.abs(line.endY)
      ? { x: line.bend.x, y: line.endY / 2 }
      : { x: line.endX / 2, y: line.bend.y };
  }
  const { endX: x, endY: y } = line;
  if (line.type === "curve") {
    const bend = Math.min(80, Math.max(Math.abs(x), Math.abs(y)) * 0.25);
    if (Math.abs(y) < 4) return { x: x / 2, y: y / 2 - bend * 0.75 };
    if (Math.abs(x) < 4) return { x: x / 2 + bend * 0.75, y: y / 2 };
  }
  return { x: x / 2, y: y / 2 };
}
function roundedPath(points: { x: number; y: number }[], rounded: boolean) {
  const list = points.filter(
    (p, i) =>
      !i || Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y) > 0.001,
  );
  if (!list.length) return "";
  let path = `M ${list[0]!.x} ${list[0]!.y}`;
  for (let i = 1; i < list.length - 1; i++) {
    const a = list[i - 1]!,
      b = list[i]!,
      c = list[i + 1]!,
      before = Math.hypot(b.x - a.x, b.y - a.y),
      after = Math.hypot(c.x - b.x, c.y - b.y);
    if (!rounded) {
      path += ` L ${b.x} ${b.y}`;
      continue;
    }
    const r = Math.min(16, before / 2, after / 2);
    path += ` L ${b.x - ((b.x - a.x) / before) * r} ${b.y - ((b.y - a.y) / before) * r} Q ${b.x} ${b.y} ${b.x + ((c.x - b.x) / after) * r} ${b.y + ((c.y - b.y) / after) * r}`;
  }
  const last = list[list.length - 1]!;
  return path + ` L ${last.x} ${last.y}`;
}
export function connectorPath(line: Connector) {
  const { endX: x, endY: y, type } = line;
  if (type === "straight") return `M 0 0 L ${x} ${y}`;
  if (type === "curve") {
    if (line.bend)
      return `M 0 0 Q ${2 * line.bend.x - x / 2} ${2 * line.bend.y - y / 2} ${x} ${y}`;
    const bend = Math.min(80, Math.max(Math.abs(x), Math.abs(y)) * 0.25);
    if (Math.abs(y) < 4)
      return `M 0 0 C ${x / 3} ${-bend} ${(x * 2) / 3} ${-bend} ${x} ${y}`;
    if (Math.abs(x) < 4)
      return `M 0 0 C ${bend} ${y / 3} ${bend} ${(y * 2) / 3} ${x} ${y}`;
    return `M 0 0 C ${x / 2} 0 ${x / 2} ${y} ${x} ${y}`;
  }
  const horizontal = Math.abs(x) >= Math.abs(y),
    mid = horizontal ? (line.bend?.x ?? x / 2) : (line.bend?.y ?? y / 2);
  const points = horizontal
    ? [
        { x: 0, y: 0 },
        { x: mid, y: 0 },
        { x: mid, y },
        { x, y },
      ]
    : [
        { x: 0, y: 0 },
        { x: 0, y: mid },
        { x, y: mid },
        { x, y },
      ];
  return roundedPath(points, type === "rounded");
}
export function connectorStyle(data: CanvasNode) {
  const line = lineSettings(data),
    width = data.strokeWidth;
  return {
    path: connectorPath(line),
    fill: undefined,
    stroke: data.stroke,
    strokeWidth: width,
    strokeAlign: "center" as const,
    startArrow: line.startArrow,
    endArrow: line.endArrow,
    strokeCap: line.style === "dotted" ? ("round" as const) : ("none" as const),
    strokeJoin: "round" as const,
    dashPattern:
      line.style === "solid"
        ? undefined
        : line.style === "dotted"
          ? [0.01, Math.max(3, width * 2.5)]
          : [Math.max(4, width * 4), Math.max(3, width * 2.5)],
  };
}
