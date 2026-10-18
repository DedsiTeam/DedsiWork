import type { Group, UI } from "leafer-editor";
import { shapePoints } from "../shared/canvas-shapes";
import type { CanvasNode, Connector } from "../shared/canvas-note";
export type Attachment = NonNullable<Connector["startBinding"]>;
export type CanvasEntry = { data: CanvasNode; node: UI };
type Point = { x: number; y: number };
function shape(kind: CanvasNode["kind"]) {
  return [
    "rect",
    "ellipse",
    "circle",
    "triangle",
    "equilateral",
    "shape",
  ].includes(kind);
}
function closestSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    d = dx * dx + dy * dy,
    t = d
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d))
      : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}
function boundary(data: CanvasNode, w: number, h: number, p: Point) {
  const kind = data.kind;
  let vertices: Point[], inside: boolean;
  if (kind === "ellipse" || kind === "circle") {
    vertices = Array.from({ length: 96 }, (_, i) => {
      const a = (i * Math.PI) / 48;
      return {
        x: w / 2 + (Math.cos(a) * w) / 2,
        y: h / 2 + (Math.sin(a) * h) / 2,
      };
    });
    inside =
      ((p.x - w / 2) / (w / 2)) ** 2 + ((p.y - h / 2) / (h / 2)) ** 2 <= 1;
  } else if (kind === "triangle" || kind === "equilateral") {
    vertices = [
      { x: w / 2, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
    inside =
      p.y >= 0 &&
      p.y <= h &&
      p.x >= (w / 2) * (1 - p.y / h) &&
      p.x <= (w / 2) * (1 + p.y / h);
  } else if (kind === "shape" && data.shapeType) {
    const points = shapePoints(data.shapeType, w, h);
    vertices = Array.from({ length: points.length / 2 }, (_, i) => ({
      x: points[i * 2]!,
      y: points[i * 2 + 1]!,
    }));
    inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const a = vertices[i]!,
        b = vertices[j]!;
      if (
        a.y > p.y !== b.y > p.y &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
      )
        inside = !inside;
    }
  } else {
    const r = Math.min(data.cornerRadius ?? 8, w / 2, h / 2);
    vertices = [];
    for (const [cx, cy, start] of [
      [w - r, r, -Math.PI / 2],
      [w - r, h - r, 0],
      [r, h - r, Math.PI / 2],
      [r, r, Math.PI],
    ] as const)
      for (let i = 0; i <= 12; i++) {
        const a = start + (i * Math.PI) / 24;
        vertices.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
    inside = p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
  }
  let near = vertices[0]!,
    distance = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const q = closestSegment(
        p,
        vertices[i]!,
        vertices[(i + 1) % vertices.length]!,
      ),
      d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < distance) {
      near = q;
      distance = d;
    }
  }
  if (kind === "ellipse" || kind === "circle") {
    const angle = Math.atan2(
      (near.y - h / 2) / (h / 2),
      (near.x - w / 2) / (w / 2),
    );
    near = {
      x: w / 2 + (Math.cos(angle) * w) / 2,
      y: h / 2 + (Math.sin(angle) * h) / 2,
    };
  }
  return { near, inside };
}
export function findAttachment(
  entries: Iterable<CanvasEntry>,
  group: Group,
  point: Point,
  distance = 22,
): { point: Point; binding?: Attachment } {
  const world = group.getWorldPoint(point);
  let best: ReturnType<typeof findAttachment> = { point },
    score = Infinity;
  // The last drawn shape wins when boundaries overlap at the same distance.
  for (const entry of [...entries].reverse()) {
    if (!shape(entry.data.kind)) continue;
    const w = entry.node.width ?? entry.data.width,
      h = entry.node.height ?? entry.data.height;
    if (w <= 0 || h <= 0) continue;
    const local = entry.node.getInnerPoint(world),
      { near, inside } = boundary(entry.data, w, h, local),
      candidate = entry.node.getWorldPoint(near);
    const d = Math.hypot(candidate.x - world.x, candidate.y - world.y);
    if ((inside || d <= distance) && d < score) {
      score = d;
      best = {
        point: group.getInnerPoint(candidate),
        binding: {
          nodeId: entry.data.id,
          u: Math.max(0, Math.min(1, near.x / w)),
          v: Math.max(0, Math.min(1, near.y / h)),
        },
      };
    }
  }
  return best;
}
export function resolveAttachment(
  binding: Attachment | undefined,
  entries: Map<string, CanvasEntry>,
  group: Group,
): Point | null {
  if (!binding) return null;
  const entry = entries.get(binding.nodeId);
  if (!entry || !shape(entry.data.kind)) return null;
  return group.getInnerPoint(
    entry.node.getWorldPoint({
      x: (entry.node.width ?? entry.data.width) * binding.u,
      y: (entry.node.height ?? entry.data.height) * binding.v,
    }),
  );
}
