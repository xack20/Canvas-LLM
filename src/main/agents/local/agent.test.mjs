// .mjs keeps the bun:test import out of `bun run typecheck`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeRequest } from "../../claude/askUserBridge.ts";
import { runLocal } from "./agent.ts";

const cwd = mkdtempSync(join(tmpdir(), "local-agent-"));
const requests = [];
let server;
let servers;

const sse = (...chunks) => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
const delta = (d, finish) => ({ choices: [{ delta: d, finish_reason: finish ?? null }] });

// A model that first asks to write a file, then (having seen the tool result) answers.
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json();
      requests.push(body);
      const sawToolResult = body.messages.some((m) => m.role === "tool");
      if (!sawToolResult) {
        return sse(
          delta({ tool_calls: [{ index: 0, id: "c1", function: { name: "Write", arguments: "{\"file_path\":\"out.txt\"," } }] }),
          delta({ tool_calls: [{ index: 0, function: { arguments: "\"content\":\"hi\"}" } }] }, "tool_calls"),
        );
      }
      const toolText = body.messages.find((m) => m.role === "tool").content;
      // Real models often open with blank lines.
      return sse(delta({ content: "\n\n" }), delta({ content: `saw: ${toolText}` }, "stop"), { choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } });
    },
  });
  const base = `http://localhost:${server.port}`;
  servers = { lmstudio: { label: "LM Studio", base }, ollama: { label: "Ollama", base } };
});
afterAll(() => {
  server.stop(true);
  rmSync(cwd, { recursive: true, force: true });
});

function fakeClient(decision) {
  const client = {
    sent: [],
    send(channel, payload) {
      client.sent.push({ channel, payload });
      setTimeout(() => completeRequest({ id: payload.id, cancelled: false, answers: { decision } }), 0);
    },
    isGone: () => false,
    onGone: () => () => {},
  };
  return client;
}

async function run(extra = {}, decision = "Allow once") {
  requests.length = 0;
  const events = [];
  const client = fakeClient(decision);
  await runLocal("make a file", { cwd, model: "lmstudio:test", client, nodeId: "n1", onEvent: (e) => events.push(e), ...extra }, servers);
  return { events, client };
}

describe("runLocal", () => {
  test("runs the tool the model asks for, feeds the result back, and finishes with usage", async () => {
    rmSync(join(cwd, "out.txt"), { force: true });
    const { events } = await run();
    expect(events.map((e) => e.kind)).toEqual(["tool_use", "tool_result", "text_delta", "done"]);
    expect(events[0]).toMatchObject({ toolUseId: "c1", name: "Write", input: { file_path: "out.txt", content: "hi" } });
    expect(existsSync(join(cwd, "out.txt"))).toBe(true);
    expect(events[2].text).toStartWith("saw: Wrote 2 characters to out.txt");
    expect(events.at(-1)).toMatchObject({ kind: "done", isError: false, usage: { inputTokens: 10, outputTokens: 4 } });
  });

  test("sends the model, a system prompt naming the folder, the prompt and the tools", async () => {
    await run({ systemPrompt: "be brief" });
    const first = requests[0];
    expect(first.model).toBe("test");
    expect(first.stream).toBe(true);
    expect(first.messages[0].content).toContain(cwd);
    expect(first.messages[0].content).toContain("be brief");
    expect(first.messages[1]).toEqual({ role: "user", content: "make a file" });
    expect(first.tools.map((t) => t.function.name)).toEqual(["Read", "LS", "Glob", "Grep", "Write", "Edit", "Bash"]);
  });

  test("ask mode stops for approval; Deny leaves the file unwritten and tells the model", async () => {
    rmSync(join(cwd, "out.txt"), { force: true });
    const { events, client } = await run({ approval: "ask" }, "Deny");
    expect(client.sent[0].payload.questions[0].question).toBe("Allow the local model to use Write?");
    expect(existsSync(join(cwd, "out.txt"))).toBe(false);
    expect(events.find((e) => e.kind === "tool_result")).toMatchObject({ isError: true });
    expect(events.at(-1).kind).toBe("done");
  });

  test("ask mode runs the tool once approved", async () => {
    rmSync(join(cwd, "out.txt"), { force: true });
    await run({ approval: "ask" }, "Allow once");
    expect(existsSync(join(cwd, "out.txt"))).toBe(true);
  });

  test("an unreachable server is reported plainly and still ends the chat", async () => {
    const dead = { lmstudio: { label: "LM Studio", base: "http://localhost:1" }, ollama: { label: "Ollama", base: "http://localhost:1" } };
    const events = [];
    await runLocal("hi", { cwd, model: "lmstudio:x", client: fakeClient("Deny"), nodeId: "n2", onEvent: (e) => events.push(e) }, dead);
    expect(events[0].message).toContain("Couldn't reach the local model server");
    expect(events.at(-1)).toEqual({ kind: "done", isError: true });
  });

  test("images are refused", async () => {
    const { events } = await run({ attachments: [{ mediaType: "image/png", base64: "x" }] });
    expect(events[0].message).toContain("not yet supported");
    expect(events.at(-1)).toEqual({ kind: "done", isError: true });
  });
});
