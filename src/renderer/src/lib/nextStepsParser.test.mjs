import { expect, test } from "bun:test";
import { createNextStepsStreamer, createTagStreamer } from "./nextStepsParser.ts";

function run(open, close, deltas) {
  const out = { text: "", blocks: [] };
  const s = createTagStreamer(open, close, { onText: (t) => (out.text += t), onBlock: (b) => out.blocks.push(b) });
  deltas.forEach(s.ingest);
  s.flush();
  return out;
}

test("a block split across deltas is stripped and handed over whole", () => {
  const out = run("<tree-outline>", "</tree-outline>", ["Overview.\n<tree-", "outline>{\"a\":", "1}</tree-out", "line>"]);
  expect(out.text).toBe("Overview.\n");
  expect(out.blocks).toEqual(['{"a":1}']);
});

test("an unterminated block is restored as text", () => {
  const out = run("<x>", "</x>", ["hi <x>half"]);
  expect(out.text).toBe("hi <x>half");
  expect(out.blocks).toEqual([]);
});

test("text that only looks like an opener is passed through", () => {
  expect(run("<x>", "</x>", ["a <", "b"]).text).toBe("a <b");
});

test("next-steps still yields suggestions", () => {
  let got = [];
  let text = "";
  const s = createNextStepsStreamer({ onText: (t) => (text += t), onSuggestions: (x) => (got = x) });
  s.ingest("Done.\n<next-steps>\n- Go :: Do it\n</next-steps>");
  s.flush();
  expect(text).toBe("Done.\n");
  expect(got).toEqual([{ label: "Go", prompt: "Do it" }]);
});
