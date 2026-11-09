import { expect, test } from "bun:test";
import { pageSettled, plannedDescendants } from "./treeNodes.ts";

const node = (id, parent, extra = {}, messages = []) => ({
  id,
  type: "custom",
  position: { x: 0, y: 0 },
  data: { chat: { messages, parentIds: parent ? [parent] : [], childIds: [] }, ...extra },
});
const map = (...ns) => Object.fromEntries(ns.map((n) => [n.id, n]));

test("finds unwritten pages at any depth, nearest first, and skips written ones", () => {
  const nodes = map(
    node("root", null),
    node("b1", "root"),
    node("p1", "b1", { planned: { question: "q" } }),
    node("p2", "b1"),
    node("deep", "p2", { planned: { question: "q" } }),
    node("other", null, { planned: { question: "q" } }),
  );
  expect(plannedDescendants(nodes, "root")).toEqual(["p1", "deep"]);
  expect(plannedDescendants(nodes, "p1")).toEqual([]);
});

test("a page is settled once it has a finished reply and no pending question", () => {
  const reply = (status) => [{ id: "a", role: "assistant", blocks: [], createdAt: 0, status }];
  expect(pageSettled(undefined)).toBe(true);
  expect(pageSettled(node("x", null, { planned: { question: "q" } }))).toBe(false);
  expect(pageSettled(node("x", null, {}, []))).toBe(false);
  expect(pageSettled(node("x", null, {}, reply("streaming")))).toBe(false);
  expect(pageSettled(node("x", null, {}, reply("complete")))).toBe(true);
});
