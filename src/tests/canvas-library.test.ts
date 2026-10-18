import { describe, expect, test } from "bun:test";
import {
  canvasContentSchema,
  canvasNodeSchema,
  type CanvasNode,
} from "../shared/canvas-note";
import { reconcileContainers } from "../shared/canvas-containers";
import { shapePoints, shapeTypes } from "../shared/canvas-shapes";
const node = (extra: Partial<CanvasNode> = {}) =>
  canvasNodeSchema.parse({
    id: crypto.randomUUID(),
    kind: "rect",
    x: 20,
    y: 20,
    width: 50,
    height: 40,
    ...extra,
  });
describe("canvas containers", () => {
  test("enter, move with container, leave and delete without deleting contents", () => {
    const frame = node({
      kind: "container",
      x: 0,
      y: 0,
      width: 500,
      height: 400,
    });
    const child = node();
    const joined = reconcileContainers([], [frame, child]);
    expect(joined[1]!.containerId).toBe(frame.id);
    const moved = reconcileContainers(joined, [
      { ...joined[0]!, x: 100, y: 200 },
      joined[1]!,
    ]);
    expect([moved[1]!.x, moved[1]!.y]).toEqual([120, 220]);
    const outside = reconcileContainers(moved, [
      moved[0]!,
      { ...moved[1]!, x: 900 },
    ]);
    expect(outside[1]!.containerId).toBeUndefined();
    const removed = reconcileContainers(moved, [moved[1]!]);
    expect(removed).toHaveLength(1);
    expect(removed[0]!.containerId).toBeUndefined();
    expect(removed[0]!.x).toBe(120);
  });
  test("multiselect does not move contents twice", () => {
    const frame = node({
      kind: "container",
      x: 0,
      y: 0,
      width: 500,
      height: 400,
    });
    const child = node({ containerId: frame.id });
    const result = reconcileContainers(
      [frame, child],
      [
        { ...frame, x: 100 },
        { ...child, x: 120 },
      ],
      new Set([frame.id, child.id]),
    );
    expect(result[1]!.x).toBe(120);
  });
  test("smallest containing frame owns a fully enclosed rotated element", () => {
    const large = node({
      kind: "container",
      x: 0,
      y: 0,
      width: 1000,
      height: 1000,
    });
    const small = node({
      kind: "container",
      x: 0,
      y: 0,
      width: 300,
      height: 300,
    });
    const child = node({ x: 100, y: 100, rotation: 45 });
    expect(reconcileContainers([], [large, small, child])[2]!.containerId).toBe(
      small.id,
    );
    expect(
      reconcileContainers([], [small, { ...child, x: 290 }])[1]!.containerId,
    ).toBeUndefined();
  });
  test("resize releases elements outside without scaling contents", () => {
    const frame = node({
      kind: "container",
      x: 0,
      y: 0,
      width: 500,
      height: 400,
    });
    const child = node({ x: 300, containerId: frame.id });
    const result = reconcileContainers(
      [frame, child],
      [{ ...frame, width: 200 }, child],
    );
    expect(result[1]!.containerId).toBeUndefined();
    expect(result[1]!.width).toBe(child.width);
  });
});
test("all shape outlines and container membership survive serialization", () => {
  const frame = node({ kind: "container" });
  const shapes = shapeTypes.map((shapeType) =>
    node({ kind: "shape", shapeType, containerId: frame.id }),
  );
  const parsed = canvasContentSchema.parse(
    JSON.parse(JSON.stringify({ nodes: [frame, ...shapes] })),
  );
  expect(parsed.nodes).toEqual([frame, ...shapes]);
  for (const type of shapeTypes) {
    const points = shapePoints(type, 200, 120);
    expect(points.length).toBeGreaterThanOrEqual(6);
    expect(points.every(Number.isFinite)).toBe(true);
    for (let i = 0; i < points.length; i++)
      expect(points[i]! >= 0 && points[i]! <= (i % 2 ? 120 : 200)).toBe(true);
  }
  expect(canvasNodeSchema.safeParse({ ...frame, kind: "shape" }).success).toBe(
    false,
  );
});

describe("container auto layout", () => {
  const setup = () => {
    const frame = node({
      kind: "container",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      layout: "horizontal",
      layoutGap: 16,
    });
    return [
      frame,
      node({ x: 90, y: 60, width: 80, containerId: frame.id }),
      node({ x: 30, y: 60, width: 40, containerId: frame.id }),
    ];
  };
  test("horizontal layout follows spatial order, uses exact edge gaps and is stable", () => {
    const initial = setup(),
      result = reconcileContainers(initial, initial);
    expect(result[2]!.x).toBe(24);
    expect(result[1]!.x - result[2]!.x - result[2]!.width).toBe(16);
    expect(result[1]!.y).toBe(result[2]!.y);
    expect(reconcileContainers(result, result)).toEqual(result);
    expect(initial[1]!.x).toBe(90);
  });
  test("switch direction, change gap, grow and round-trip settings", () => {
    const initial = setup(),
      row = reconcileContainers(initial, initial);
    const changed = [
      { ...row[0]!, layout: "vertical" as const, layoutGap: 120 },
      ...row.slice(1),
    ];
    const result = reconcileContainers(row, changed);
    expect(result[1]!.x).toBe(result[2]!.x);
    expect(result[1]!.y - result[2]!.y - result[2]!.height).toBe(120);
    expect(result[0]!.height).toBeGreaterThan(200);
    expect(
      canvasContentSchema.parse(JSON.parse(JSON.stringify({ nodes: result })))
        .nodes,
    ).toEqual(result);
  });
  test("dragging permits leaving; new elements join and remaining ones close the gap", () => {
    const initial = setup(),
      row = reconcileContainers(initial, initial);
    const drag = reconcileContainers(
      row,
      [row[0]!, { ...row[1]!, x: 900 }, row[2]!],
      new Set([row[1]!.id]),
      true,
    );
    expect(drag[1]!.containerId).toBeUndefined();
    const next = reconcileContainers(drag, [...drag, node({ x: 100, y: 80 })]);
    expect(next[3]!.containerId).toBe(row[0]!.id);
    expect(next[3]!.x - next[2]!.x - next[2]!.width).toBe(16);
    const deleted = reconcileContainers(next, [next[0]!, next[3]!]);
    expect(deleted[1]!.x).toBe(24);
  });
  test("resized children stay members and expand the frame; zero gap works", () => {
    const initial = setup(),
      row = reconcileContainers(initial, initial);
    const result = reconcileContainers(row, [
      { ...row[0]!, layoutGap: 0 },
      { ...row[1]!, width: 400 },
      row[2]!,
    ]);
    expect(result[1]!.containerId).toBe(row[0]!.id);
    expect(result[1]!.x - result[2]!.x - result[2]!.width).toBe(0);
    expect(result[0]!.width).toBe(488);
    const free = reconcileContainers(result, [
      { ...result[0]!, layout: "free" as const },
      ...result.slice(1),
    ]);
    expect(free.slice(1)).toEqual(result.slice(1));
  });
  test("rotated elements use visible bounds rather than overlapping", () => {
    const initial = setup();
    const result = reconcileContainers(initial, [
      initial[0]!,
      { ...initial[1]!, rotation: 90 },
      initial[2]!,
    ]);
    expect(
      result[1]!.x - result[1]!.height - (result[2]!.x + result[2]!.width),
    ).toBeCloseTo(16);
  });
});
