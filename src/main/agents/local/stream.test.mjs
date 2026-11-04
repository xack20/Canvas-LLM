// .mjs keeps the bun:test import out of `bun run typecheck`.
import { describe, expect, test } from "bun:test";
import { createChatAccumulator, sseJson } from "./stream.ts";

const sink = () => {
  const seen = { text: "", thinking: "" };
  return { seen, sink: { text: (t) => (seen.text += t), thinking: (t) => (seen.thinking += t) } };
};
const delta = (d, finish) => ({ choices: [{ delta: d, finish_reason: finish ?? null }] });

describe("createChatAccumulator", () => {
  test("streams text and reasoning to the sink and keeps the full text", () => {
    const { seen, sink: s } = sink();
    const acc = createChatAccumulator(s);
    acc.ingest(delta({ reasoning_content: "hmm " }));
    acc.ingest(delta({ content: "Hel" }));
    acc.ingest(delta({ content: "lo" }, "stop"));
    acc.ingest({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } });
    expect(seen).toEqual({ text: "Hello", thinking: "hmm " });
    expect(acc.result()).toEqual({ content: "Hello", toolCalls: [], finishReason: "stop", usage: { promptTokens: 12, completionTokens: 3 } });
  });

  test("assembles tool calls whose arguments arrive in pieces, in index order", () => {
    const acc = createChatAccumulator(sink().sink);
    acc.ingest(delta({ tool_calls: [{ index: 1, id: "b", function: { name: "Bash", arguments: "{\"command\":" } }] }));
    acc.ingest(delta({ tool_calls: [{ index: 0, id: "a", function: { name: "Read", arguments: "{\"file_path\":\"x\"}" } }] }));
    acc.ingest(delta({ tool_calls: [{ index: 1, function: { arguments: "\"ls\"}" } }] }, "tool_calls"));
    expect(acc.result().toolCalls).toEqual([
      { id: "a", name: "Read", arguments: "{\"file_path\":\"x\"}" },
      { id: "b", name: "Bash", arguments: "{\"command\":\"ls\"}" },
    ]);
  });

  test("a call without an id gets one; a server error chunk throws", () => {
    const acc = createChatAccumulator(sink().sink);
    acc.ingest(delta({ tool_calls: [{ index: 0, function: { name: "LS", arguments: "{}" } }] }));
    expect(acc.result().toolCalls[0].id).toBe("call_0");
    expect(() => acc.ingest({ error: { message: "model not loaded" } })).toThrow("model not loaded");
  });
});

describe("sseJson", () => {
  test("yields each data payload up to [DONE], across chunk boundaries, ignoring noise", async () => {
    const enc = new TextEncoder();
    async function* body() {
      yield enc.encode(": keep-alive\n\ndata: {\"a\":1}\n\ndata: {\"b\"");
      yield enc.encode(":2}\n\ndata: not json\n\ndata: [DONE]\n\ndata: {\"late\":true}\n\n");
    }
    const out = [];
    for await (const item of sseJson(body())) out.push(item);
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
