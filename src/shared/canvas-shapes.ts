export const shapeTypes = [
  "diamond",
  "parallelogram",
  "trapezoid",
  "pentagon",
  "hexagon",
  "octagon",
  "star",
  "heart",
  "cross",
  "semicircle",
  "speech",
  "arrow-right",
  "arrow-left",
  "arrow-up",
  "arrow-down",
  "arrow-both",
  "chevron",
] as const;
export type ShapeType = (typeof shapeTypes)[number];
export const shapeNames: Record<ShapeType, string> = {
  diamond: "菱形",
  parallelogram: "平行四边形",
  trapezoid: "梯形",
  pentagon: "五边形",
  hexagon: "六边形",
  octagon: "八边形",
  star: "五角星",
  heart: "心形",
  cross: "十字形",
  semicircle: "半圆",
  speech: "对话气泡",
  "arrow-right": "右箭头",
  "arrow-left": "左箭头",
  "arrow-up": "上箭头",
  "arrow-down": "下箭头",
  "arrow-both": "双向箭头",
  chevron: "燕尾箭头",
};
// Normalized outlines are shared by canvas rendering, picker previews and connector snapping.
export function shapePoints(
  type: ShapeType,
  width = 100,
  height = 100,
): number[] {
  let points: number[][];
  const regular = (n: number, inner = 1) =>
    Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / n,
        r = i % 2 ? inner : 1;
      return [0.5 + Math.cos(a) * 0.5 * r, 0.5 + Math.sin(a) * 0.5 * r];
    });
  switch (type) {
    case "diamond":
      points = [
        [0.5, 0],
        [1, 0.5],
        [0.5, 1],
        [0, 0.5],
      ];
      break;
    case "parallelogram":
      points = [
        [0.25, 0],
        [1, 0],
        [0.75, 1],
        [0, 1],
      ];
      break;
    case "trapezoid":
      points = [
        [0.2, 0],
        [0.8, 0],
        [1, 1],
        [0, 1],
      ];
      break;
    case "pentagon":
      points = regular(5);
      break;
    case "hexagon":
      points = regular(6);
      break;
    case "octagon":
      points = regular(8);
      break;
    case "star":
      points = regular(10, 0.42);
      break;
    case "heart":
      points = Array.from({ length: 96 }, (_, i) => {
        const t = (i * Math.PI) / 48;
        return [
          0.5 + Math.pow(Math.sin(t), 3) / 2,
          0.5 -
            (13 * Math.cos(t) -
              5 * Math.cos(2 * t) -
              2 * Math.cos(3 * t) -
              Math.cos(4 * t)) /
              34,
        ];
      });
      break;
    case "cross":
      points = [
        [0.33, 0],
        [0.67, 0],
        [0.67, 0.33],
        [1, 0.33],
        [1, 0.67],
        [0.67, 0.67],
        [0.67, 1],
        [0.33, 1],
        [0.33, 0.67],
        [0, 0.67],
        [0, 0.33],
        [0.33, 0.33],
      ];
      break;
    case "semicircle":
      points = Array.from({ length: 49 }, (_, i) => [
        0.5 - Math.cos((i * Math.PI) / 48) / 2,
        1 - Math.sin((i * Math.PI) / 48),
      ]);
      break;
    case "speech":
      points = [
        [0, 0],
        [1, 0],
        [1, 0.75],
        [0.4, 0.75],
        [0.15, 1],
        [0.15, 0.75],
        [0, 0.75],
      ];
      break;
    case "arrow-both":
      points = [
        [0, 0.5],
        [0.25, 0],
        [0.25, 0.3],
        [0.75, 0.3],
        [0.75, 0],
        [1, 0.5],
        [0.75, 1],
        [0.75, 0.7],
        [0.25, 0.7],
        [0.25, 1],
      ];
      break;
    case "chevron":
      points = [
        [0, 0],
        [0.65, 0],
        [1, 0.5],
        [0.65, 1],
        [0, 1],
        [0.35, 0.5],
      ];
      break;
    default:
      points = [
        [0, 0.3],
        [0.6, 0.3],
        [0.6, 0],
        [1, 0.5],
        [0.6, 1],
        [0.6, 0.7],
        [0, 0.7],
      ];
      if (type === "arrow-left") points = points.map(([x, y]) => [1 - x!, y!]);
      if (type === "arrow-up") points = points.map(([x, y]) => [y!, 1 - x!]);
      if (type === "arrow-down") points = points.map(([x, y]) => [1 - y!, x!]);
  }
  return points.flatMap(([x, y]) => [x! * width, y! * height]);
}
