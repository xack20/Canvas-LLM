import type { CanvasNode, NodeId } from "@shared/types";

/** Unwritten pages below `rootId`, following each node's primary parent. Nearest first. */
export function plannedDescendants(nodes: Record<NodeId, CanvasNode>, rootId: NodeId): NodeId[] {
  const kids = new Map<NodeId, NodeId[]>();
  for (const n of Object.values(nodes)) {
    const parent = n.data.chat.parentIds[0];
    if (parent) kids.set(parent, [...(kids.get(parent) ?? []), n.id]);
  }
  const out: NodeId[] = [];
  const queue = [...(kids.get(rootId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift() as NodeId;
    if (nodes[id]?.data.planned) out.push(id);
    queue.push(...(kids.get(id) ?? []));
  }
  return out;
}

/** True once a page that was sent has stopped streaming (or was deleted). */
export function pageSettled(node: CanvasNode | undefined): boolean {
  if (!node) return true;
  if (node.data.planned) return false;
  const reply = [...node.data.chat.messages].reverse().find((m) => m.role === "assistant");
  return reply !== undefined && reply.status !== "streaming";
}
