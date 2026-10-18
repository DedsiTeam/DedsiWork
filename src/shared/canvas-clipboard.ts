import { canvasContentSchema, type CanvasNode } from "./canvas-note";

const prefix = "DedsiWork/canvas-v1\n";

export function copyCanvasNodes(nodes: CanvasNode[], selected: string[]) {
  const ids = new Set(selected);
  let size = -1;
  while (size !== ids.size) {
    size = ids.size;
    const groups = new Set(nodes.filter(n => ids.has(n.id) && n.groupId).map(n => n.groupId));
    for (const node of nodes)
      if ((node.containerId && ids.has(node.containerId)) || (node.groupId && groups.has(node.groupId))) ids.add(node.id);
  }
  const copied = nodes.filter((node) => ids.has(node.id));
  return copied.length ? prefix + JSON.stringify({ nodes: copied }) : null;
}

export function readCanvasClipboard(text: string): CanvasNode[] | null {
  if (!text.startsWith(prefix)) return null;
  const value = canvasContentSchema.parse(
    JSON.parse(text.slice(prefix.length)),
  );
  return value.nodes;
}

export function cloneCanvasNodes(nodes: CanvasNode[], offset: number) {
  const ids = new Map(nodes.map((node) => [node.id, crypto.randomUUID()]));
  const groups = new Map(nodes.filter(n => n.groupId).map(n => [n.groupId!, crypto.randomUUID()]));
  return nodes.map((original) => {
    const node = structuredClone(original);
    node.id = ids.get(node.id)!;
    node.groupId = node.groupId ? groups.get(node.groupId) : undefined;
    node.locked = false;
    node.x += offset;
    node.y += offset;
    node.containerId = node.containerId ? ids.get(node.containerId) : undefined;
    if (node.line) {
      for (const key of ["startBinding", "endBinding"] as const) {
        const binding = node.line[key];
        const id = binding && ids.get(binding.nodeId);
        node.line[key] = binding && id ? { ...binding, nodeId: id } : undefined;
      }
    }
    return node;
  });
}
