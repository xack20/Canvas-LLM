import { expect, test } from "bun:test";
import {
  MAX_BRANCHES,
  MAX_TOPICS,
  MAX_TREE_NODES,
  branchIndexMarkdown,
  parseTreeOutline,
} from "./treeOutline.ts";

const topic = (n) => ({ title: `Topic ${n}`, blurb: `About ${n}`, question: `What is ${n}?` });
const outline = (branches) => JSON.stringify({ branches });

test("parses branches and topics", () => {
  const out = parseTreeOutline(outline([{ title: "Cards", summary: "All about cards.", topics: [topic(1), topic(2)] }]));
  expect(out.branches).toHaveLength(1);
  expect(out.branches[0].topics.map((t) => t.title)).toEqual(["Topic 1", "Topic 2"]);
  expect(out.branches[0].topics[0].question).toBe("What is 1?");
});

test("accepts a json code fence inside the block", () => {
  const body = "\n```json\n" + outline([{ title: "A", topics: [topic(1)] }]) + "\n```\n";
  expect(parseTreeOutline(body).branches[0].title).toBe("A");
});

test("returns null for bad JSON, a wrong shape, or no usable branch", () => {
  expect(parseTreeOutline("not json")).toBeNull();
  expect(parseTreeOutline("{}")).toBeNull();
  expect(parseTreeOutline(outline([]))).toBeNull();
  expect(parseTreeOutline(outline([{ summary: "no title", topics: [topic(1)] }]))).toBeNull();
});

test("skips topics without a title or a question", () => {
  const out = parseTreeOutline(
    outline([{ title: "A", topics: [{ title: "No question" }, { question: "No title" }, topic(1)] }]),
  );
  expect(out.branches[0].topics).toHaveLength(1);
});

test("caps branches, topics per branch, and total nodes", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    title: `B${i}`,
    topics: Array.from({ length: 20 }, (_, j) => topic(j)),
  }));
  const out = parseTreeOutline(outline(many));
  expect(out.branches.length).toBeLessThanOrEqual(MAX_BRANCHES);
  expect(out.branches.every((b) => b.topics.length <= MAX_TOPICS)).toBe(true);
  const total = out.branches.reduce((n, b) => n + 1 + b.topics.length, 0);
  expect(total).toBeLessThanOrEqual(MAX_TREE_NODES);
});

test("a branch index lists its pages in a table and escapes pipes", () => {
  const md = branchIndexMarkdown({
    title: "A",
    summary: "Summary.",
    topics: [{ title: "x | y", blurb: "line\nbreak", question: "q" }],
  });
  expect(md).toContain("Summary.");
  expect(md).toContain("| **x \\| y** | line break |");
});

test("a branch without pages is just its summary", () => {
  expect(branchIndexMarkdown({ title: "A", summary: "Only this.", topics: [] })).toBe("Only this.");
});
