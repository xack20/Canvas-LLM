import type { TreeOutline } from "@shared/treeOutline";
import { HORIZONTAL_PADDING, NODE_WIDTH } from "./canvasConstants";

type Point = { x: number; y: number };
export type TreeLayout = { branches: { position: Point; topics: Point[] }[] };

const COLUMN_GAP = HORIZONTAL_PADDING * 2;
/** Estimated heights: nodes aren't measured yet when the tree is placed. A placeholder measured 204
 *  with a one-line question, so this leaves room for a longer one and a gap. */
const TOPIC_HEIGHT = 270;
const BRANCH_BASE_HEIGHT = 260;
const BRANCH_ROW_HEIGHT = 40;
const BLOCK_GAP = 60;

/**
 * Two columns to the right of `origin`: a block per branch with the branch on top and its pages
 * stacked in the next column. A block is as tall as the taller of its branch node and its pages.
 */
export function layoutTree(outline: TreeOutline, origin: Point): TreeLayout {
  const branchX = origin.x + NODE_WIDTH + COLUMN_GAP;
  const topicX = branchX + NODE_WIDTH + COLUMN_GAP;
  let y = origin.y;
  const branches = outline.branches.map((branch) => {
    const n = branch.topics.length;
    const blockHeight = Math.max(n * TOPIC_HEIGHT, BRANCH_BASE_HEIGHT + n * BRANCH_ROW_HEIGHT);
    const laid = {
      position: { x: branchX, y },
      topics: branch.topics.map((_, i) => ({ x: topicX, y: y + i * TOPIC_HEIGHT })),
    };
    y += blockHeight + BLOCK_GAP;
    return laid;
  });
  return { branches };
}
