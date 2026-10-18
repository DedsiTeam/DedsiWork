import { expect, test } from "bun:test";
import { CanvasHistory } from "../shared/canvas-history";
import { canvasNodeSchema } from "../shared/canvas-note";
const node = canvasNodeSchema.parse({
  id: crypto.randomUUID(),
  kind: "rect",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
});
test("undo and redo additions, modifications and deletion independently", () => {
  const history = new CanvasHistory({ nodes: [] });
  history.record({ nodes: [node] });
  history.record({ nodes: [{ ...node, width: 200 }] });
  history.record({ nodes: [] });
  expect(history.undo()?.nodes[0]?.width).toBe(200);
  expect(history.undo()?.nodes[0]?.width).toBe(100);
  expect(history.undo()?.nodes).toEqual([]);
  expect(history.undo()).toBeNull();
  expect(history.redo()?.nodes[0]?.id).toBe(node.id);
  expect(history.redo()?.nodes[0]?.width).toBe(200);
  expect(history.redo()?.nodes).toEqual([]);
  expect(history.redo()).toBeNull();
});
test("duplicates preserve redo and a new edit discards redo", () => {
  const history = new CanvasHistory({ nodes: [] });
  history.record({ nodes: [node] });
  history.undo();
  history.record({ nodes: [] });
  expect(history.redo()?.nodes).toHaveLength(1);
  history.undo();
  history.record({ nodes: [{ ...node, x: 30 }] });
  expect(history.redo()).toBeNull();
});
test("snapshots are isolated and bounded", () => {
  const history = new CanvasHistory({ nodes: [] }, 2);
  for (let x = 1; x <= 4; x++) history.record({ nodes: [{ ...node, x }] });
  const restored = history.undo()!;
  restored.nodes[0]!.x = 100;
  expect(history.undo()?.nodes[0]?.x).toBe(2);
  expect(history.undo()).toBeNull();
  expect(history.redo()?.nodes[0]?.x).toBe(3);
});
