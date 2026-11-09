import { nanoid } from "nanoid";
import type { Message, NodeId } from "@shared/types";
import { branchIndexMarkdown, type TreeOutline } from "@shared/treeOutline";
import { makeBlankNode, type CanvasStoreApi } from "@/hooks/useCanvasStore";
import { useTreeStore, writePage } from "@/hooks/useTreeStore";
import { FALLBACK_NODE_HEIGHT, HORIZONTAL_PADDING, NODE_WIDTH } from "./canvasConstants";
import { layoutTree } from "./treeLayout";
import { pageSettled, plannedDescendants } from "./treeNodes";

/** Pause between nodes appearing, so the tree visibly grows. */
const GROW_STEP_MS = 60;
/** Pages "Write all" has in flight at once. */
const WRITE_PARALLEL = 3;
const WRITE_POLL_MS = 500;

const message = (role: Message["role"], text: string): Message => ({
  id: nanoid(),
  role,
  blocks: [{ type: "text", text }],
  createdAt: Date.now(),
  status: "complete",
});

/**
 * Grows the outline to the right of `rootId`: a node per branch (already written, from the outline)
 * and a placeholder per page (its question waits in the prompt box). Nodes appear one after another.
 */
export function growTree(api: CanvasStoreApi, rootId: NodeId, outline: TreeOutline): void {
  const root = api.getState().nodes[rootId];
  if (!root) return;
  const layout = layoutTree(outline, root.position);
  const provider = api.getState().getEffectiveProvider(rootId);

  const steps: (() => void)[] = [];
  outline.branches.forEach((branch, i) => {
    const at = layout.branches[i];
    const branchNode = makeBlankNode(at.position, rootId);
    steps.push(() => {
      const s = api.getState();
      s.addNode(branchNode);
      s.connectEdge(rootId, branchNode.id);
      s.appendMessage(branchNode.id, message("user", branch.title));
      s.appendMessage(branchNode.id, { ...message("assistant", branchIndexMarkdown(branch)), provider });
    });
    branch.topics.forEach((topic, j) => {
      const blank = makeBlankNode(at.topics[j], branchNode.id);
      const page = {
        ...blank,
        data: { ...blank.data, title: topic.title, planned: { question: topic.question }, treePage: true as const },
      };
      steps.push(() => {
        const s = api.getState();
        s.addNode(page);
        s.connectEdge(branchNode.id, page.id);
      });
    });
  });

  steps.forEach((step, i) =>
    setTimeout(() => {
      if (api.getState().nodes[rootId]) step();
    }, i * GROW_STEP_MS),
  );
  setTimeout(() => void api.getState().save(), steps.length * GROW_STEP_MS + 100);
}

/**
 * Sends the question of every unwritten page below `rootId`, a few at a time, through each page's
 * own `submit` (see `writePage`).
 * Turning `writingAll` off in the tree store stops the queue; pages already running finish.
 */
export function writeAll(api: CanvasStoreApi, rootId: NodeId): void {
  const tree = useTreeStore.getState();
  if (tree.writingAll[rootId]) return;
  const queue = plannedDescendants(api.getState().nodes, rootId);
  if (queue.length === 0) return;
  tree.setWritingAll(rootId, true);

  const running = new Set<NodeId>();
  const finish = (): void => {
    clearInterval(timer);
    useTreeStore.getState().setWritingAll(rootId, false);
  };
  const tick = (): void => {
    const s = api.getState();
    if (!useTreeStore.getState().writingAll[rootId] || s.lock !== "held") return finish();
    for (const id of [...running]) if (pageSettled(s.nodes[id])) running.delete(id);
    while (running.size < WRITE_PARALLEL && queue.length > 0) {
      const id = queue.shift() as NodeId;
      if (!s.nodes[id]?.data.planned) continue; // written or deleted since the queue was made
      if (writePage(id)) running.add(id);
    }
    if (queue.length === 0 && running.size === 0) finish();
  };
  const timer = setInterval(tick, WRITE_POLL_MS);
  tick();
}

/**
 * Adds a child to a written page and plans a tree under it. shortcut: the child goes below
 * everything already in the columns to its right, using rough heights (nodes aren't measured here);
 * upgrade to the collision resolver if deeper trees overlap in practice.
 */
export function goDeeper(api: CanvasStoreApi, pageId: NodeId): void {
  const s = api.getState();
  const page = s.nodes[pageId];
  if (!page || s.lock !== "held") return;
  const x = page.position.x + NODE_WIDTH + HORIZONTAL_PADDING * 2;
  const bottoms = Object.values(s.nodes)
    .filter((n) => n.position.x >= x - 10)
    .map((n) => n.position.y + (n.data.chat.messages.length > 0 ? FALLBACK_NODE_HEIGHT * 2 : FALLBACK_NODE_HEIGHT));
  const y = Math.max(page.position.y, ...bottoms);
  const child = makeBlankNode({ x, y }, pageId);
  s.addNode(child);
  s.connectEdge(pageId, child.id);
  useTreeStore.getState().setArmed(child.id, true);
  const subject = page.data.title ? `"${page.data.title}"` : "this page";
  s.setPrefill(child.id, `Go deeper into ${subject}. Break it into the sub-topics that deserve their own pages.`, {
    autoSubmit: true,
  });
}
