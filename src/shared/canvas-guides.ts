export type GuideBox = { x: number; y: number; width: number; height: number };
export type AlignmentGuide = { x1: number; y1: number; x2: number; y2: number };

// Bounds and tolerance are in screen pixels, so zoom does not change sensitivity.
export function alignmentGuides(
  moving: GuideBox,
  others: GuideBox[],
  tolerance = 3,
): AlignmentGuide[] {
  const guides: AlignmentGuide[] = [];
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "width" : "height";
    const cross = axis === "x" ? "y" : "x";
    const crossSize = axis === "x" ? "height" : "width";
    let best = Infinity;
    let coordinate = 0;
    let matched: GuideBox[] = [];
    for (const other of others) {
      for (const fraction of [0, 0.5, 1]) {
        const target = other[axis] + other[size] * fraction;
        for (const origin of [0, 0.5, 1]) {
          const distance = Math.abs(
            moving[axis] + moving[size] * origin - target,
          );
          if (distance > tolerance) continue;
          if (distance < best - 0.001) {
            best = distance;
            coordinate = target;
            matched = [other];
          } else if (
            Math.abs(target - coordinate) < 0.001 &&
            Math.abs(distance - best) < 0.001
          ) {
            matched.push(other);
          }
        }
      }
    }
    if (!matched.length) continue;
    const boxes = [moving, ...matched];
    const start = Math.min(...boxes.map((b) => b[cross])) - 12;
    const end = Math.max(...boxes.map((b) => b[cross] + b[crossSize])) + 12;
    guides.push(
      axis === "x"
        ? { x1: coordinate, y1: start, x2: coordinate, y2: end }
        : { x1: start, y1: coordinate, x2: end, y2: coordinate },
    );
  }
  return guides;
}
