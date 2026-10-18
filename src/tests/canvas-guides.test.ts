import { expect, test } from "bun:test";
import { alignmentGuides } from "../shared/canvas-guides";

test("shows edge and center alignment across separate objects", () => {
  const guides = alignmentGuides({ x: 101, y: 0, width: 100, height: 100 }, [
    { x: 100, y: 200, width: 100, height: 100 },
  ]);
  expect(guides).toEqual([{ x1: 100, y1: -12, x2: 100, y2: 312 }]);
  expect(
    alignmentGuides({ x: 120, y: 0, width: 60, height: 100 }, [
      { x: 100, y: 200, width: 100, height: 100 },
    ])[0]?.x1,
  ).toBe(150);
});
test("ignores distant objects and extends a shared line to all aligned peers", () => {
  const moving = { x: 0, y: 0, width: 10, height: 10 };
  expect(
    alignmentGuides(moving, [{ x: 100, y: 100, width: 10, height: 10 }]),
  ).toEqual([]);
  expect(alignmentGuides(moving, [])).toEqual([]);
  expect(
    alignmentGuides(moving, [
      { x: 0, y: 100, width: 10, height: 10 },
      { x: 0, y: 200, width: 10, height: 10 },
    ])[0]?.y2,
  ).toBe(222);
});
