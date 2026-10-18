import { expect, test } from "bun:test";
import { canvasNodeSchema } from "../shared/canvas-note";
import {
  copyCanvasNodes,
  readCanvasClipboard,
  cloneCanvasNodes,
} from "../shared/canvas-clipboard";
const make = (extra = {}) =>
  canvasNodeSchema.parse({
    id: crypto.randomUUID(),
    kind: "rect",
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    ...extra,
  });

test("copies container descendants and remaps internal references without modifying originals", () => {
  const container = make({ kind: "container" });
  const child = make({ containerId: container.id, fontSize: 32 });
  const external = make();
  const line = make({
    kind: "connector",
    containerId: container.id,
    line: {
      endX: 100,
      endY: 10,
      startBinding: { nodeId: child.id, u: 1, v: 0.5 },
      endBinding: { nodeId: external.id, u: 0, v: 0.5 },
    },
  });
  const text = copyCanvasNodes(
    [container, child, external, line],
    [container.id],
  )!;
  const nodes = readCanvasClipboard(text)!;
  expect(nodes).toHaveLength(3);
  const clones = cloneCanvasNodes(nodes, 24);
  expect(clones[0]!.id).not.toBe(container.id);
  expect(clones[1]!.containerId).toBe(clones[0]!.id);
  expect(clones[1]!.fontSize).toBe(32);
  expect(clones[2]!.line!.startBinding!.nodeId).toBe(clones[1]!.id);
  expect(clones[2]!.line!.endBinding).toBeUndefined();
  expect(clones[0]!.x).toBe(34);
  expect(container.x).toBe(10);
});
test("standalone child detaches from original container; repeated pastes have distinct ids", () => {
  const child = make({ containerId: crypto.randomUUID() });
  const a = cloneCanvasNodes([child], 24),
    b = cloneCanvasNodes([child], 48);
  expect(a[0]!.containerId).toBeUndefined();
  expect(a[0]!.id).not.toBe(b[0]!.id);
  expect(b[0]!.x).toBe(58);
});
test("clipboard format validates data and leaves plain text to native text insertion", () => {
  expect(copyCanvasNodes([], [])).toBeNull();
  expect(readCanvasClipboard("hello")).toBeNull();
  expect(() =>
    readCanvasClipboard('DedsiWork/canvas-v1\n{"nodes":[{}]}'),
  ).toThrow();
});

test("group copies include every member, preserve persisted locks and isolate pasted groups", () => {
  const groupId = crypto.randomUUID();
  const a = make({ groupId, locked: true });
  const b = make({ groupId });
  const original = readCanvasClipboard(copyCanvasNodes([a, b, make()], [a.id])!)!;
  expect(original).toHaveLength(2);
  expect(original[0]!.locked).toBe(true);
  const copy = cloneCanvasNodes(original, 24);
  expect(copy[0]!.groupId).toBe(copy[1]!.groupId);
  expect(copy[0]!.groupId).not.toBe(groupId);
  expect(copy[0]!.locked).toBe(false);
  expect(a.groupId).toBe(groupId);
});
