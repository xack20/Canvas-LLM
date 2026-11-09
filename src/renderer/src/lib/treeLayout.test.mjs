import { expect, test } from "bun:test";
import { layoutTree } from "./treeLayout.ts";
import { NODE_WIDTH } from "./canvasConstants.ts";

const topic = (n) => ({ title: `T${n}`, blurb: "", question: "q" });

test("branches sit right of the origin and their pages one column further", () => {
  const out = layoutTree({ branches: [{ title: "A", summary: "", topics: [topic(1), topic(2)] }] }, { x: 100, y: 50 });
  const [b] = out.branches;
  expect(b.position.x).toBeGreaterThan(100 + NODE_WIDTH);
  expect(b.topics.every((t) => t.x === b.topics[0].x && t.x > b.position.x + NODE_WIDTH)).toBe(true);
  expect(b.position.y).toBe(50);
  expect(b.topics[1].y).toBeGreaterThan(b.topics[0].y);
});

test("blocks stack without overlapping, even when a branch has a single page", () => {
  const out = layoutTree(
    { branches: [{ title: "A", summary: "", topics: [topic(1)] }, { title: "B", summary: "", topics: [topic(2), topic(3), topic(4)] }] },
    { x: 0, y: 0 },
  );
  expect(out.branches[1].position.y).toBeGreaterThan(out.branches[0].position.y + 260);
  expect(out.branches[1].position.y).toBeGreaterThan(out.branches[0].topics[0].y + 270);
});
