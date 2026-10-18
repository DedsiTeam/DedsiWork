import type { CanvasNode } from "./canvas-note";
function bounds(node: CanvasNode) {
  const a = (node.rotation * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  const corners = [
    [0, 0],
    [node.width * node.scaleX, 0],
    [node.width * node.scaleX, node.height * node.scaleY],
    [0, node.height * node.scaleY],
  ].map(([x, y]) => ({
    x: node.x + x! * c - y! * s,
    y: node.y + x! * s + y! * c,
  }));
  return {
    left: Math.min(...corners.map((p) => p.x)),
    right: Math.max(...corners.map((p) => p.x)),
    top: Math.min(...corners.map((p) => p.y)),
    bottom: Math.max(...corners.map((p) => p.y)),
  };
}
export function reconcileContainers(
  previous: CanvasNode[],
  current: CanvasNode[],
  selectedIds: Set<string> = new Set(),
  dragging = false,
) {
  const old = new Map(previous.map((n) => [n.id, n]));
  const containers = current.filter((n) => n.kind === "container");
  const moved = current.map((node) => {
    const parent = containers.find((n) => n.id === node.containerId),
      before = parent && old.get(parent.id);
    if (!parent || !before || selectedIds.has(node.id)) return node;
    const dx = parent.x - before.x,
      dy = parent.y - before.y;
    return dx || dy
      ? {
          ...node,
          x: Math.max(-100000, Math.min(100000, node.x + dx)),
          y: Math.max(-100000, Math.min(100000, node.y + dy)),
        }
      : node;
  });
  const members = moved.map((node) => {
    if (node.kind === "container" || node.kind === "connector")
      return { ...node, containerId: undefined };
    const b = bounds(node);
    const existing = containers.find((c) => c.id === node.containerId);
    const before = old.get(node.id);
    if (
      existing?.layout &&
      existing.layout !== "free" &&
      before &&
      (!dragging || (node.x === before.x && node.y === before.y))
    )
      return { ...node };
    const parent = containers
      .filter((c) => {
        const box = bounds(c);
        return (
          b.left >= box.left &&
          b.right <= box.right &&
          b.top >= box.top &&
          b.bottom <= box.bottom
        );
      })
      .sort((a, b) => a.width * a.height - b.width * b.height)[0];
    return { ...node, containerId: parent?.id };
  });
  if (dragging) return members;
  for (const frame of members.filter(
    (n) => n.kind === "container" && n.layout && n.layout !== "free",
  )) {
    const horizontal = frame.layout === "horizontal";
    const children = members
      .filter((n) => n.containerId === frame.id)
      .sort((a, b) =>
        horizontal
          ? a.x - b.x || a.y - b.y || a.id.localeCompare(b.id)
          : a.y - b.y || a.x - b.x || a.id.localeCompare(b.id),
      );
    if (!children.length) continue;
    const padding = 24,
      top = Math.max(48, frame.fontSize * 1.5 + 24),
      gap = frame.layoutGap ?? 24;
    const sizes = children.map((child) => {
      const b = bounds(child);
      return { child, b, width: b.right - b.left, height: b.bottom - b.top };
    });
    const main =
      sizes.reduce(
        (sum, size) => sum + (horizontal ? size.width : size.height),
        0,
      ) +
      gap * (sizes.length - 1);
    const cross = Math.max(
      ...sizes.map((size) => (horizontal ? size.height : size.width)),
    );
    const width = Math.max(
      frame.width,
      (horizontal ? main : cross) + padding * 2,
    );
    const height = Math.max(
      frame.height,
      (horizontal ? cross : main) + top + padding,
    );
    // Preserve valid geometry at the canvas limits rather than losing members.
    if (
      width > 20000 ||
      height > 20000 ||
      frame.x + width > 100000 ||
      frame.y + height > 100000
    )
      continue;
    frame.width = width;
    frame.height = height;
    let offset = 0;
    for (const { child, b, width, height } of sizes) {
      child.x += frame.x + padding + (horizontal ? offset : 0) - b.left;
      child.y += frame.y + top + (horizontal ? 0 : offset) - b.top;
      offset += (horizontal ? width : height) + gap;
    }
  }
  return members;
}
