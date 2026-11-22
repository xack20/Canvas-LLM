import { homedir } from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Client } from "./api/client";
import { runAgent } from "./agents";
import { claudeExecutable } from "./claude/runner";
import type { Probe } from "./modelCheck";

const PROMPT = "Reply with the single word OK.";

// runAgent wants a client for the askUser tool; a check never asks the user anything.
const NO_CLIENT: Client = {
  id: "model-check",
  kind: "desktop",
  send: () => undefined,
  isGone: () => false,
  onGone: () => () => undefined,
};

/** Claude: one tool-less turn on the model, with no session saved. */
async function probeClaude(model: string, binPath: string | undefined, signal: AbortSignal) {
  const controller = new AbortController();
  signal.addEventListener("abort", () => controller.abort(), { once: true });
  const q = query({
    prompt: PROMPT,
    options: {
      cwd: homedir(),
      model,
      pathToClaudeCodeExecutable: claudeExecutable(binPath),
      tools: [],
      settingSources: [],
      persistSession: false,
      maxTurns: 1,
      abortController: controller,
    },
  });
  for await (const msg of q as AsyncIterable<SDKMessage>) {
    if (msg.type !== "result") continue;
    if (msg.is_error || msg.subtype !== "success") {
      const detail = "result" in msg && typeof msg.result === "string" ? msg.result : "";
      return { ok: false as const, error: detail || `Claude returned ${msg.subtype}` };
    }
    return { ok: true as const };
  }
  return { ok: false as const, error: "no answer" };
}

/** Codex, Kimi and Antigravity: a chat through the same adapter real nodes use. */
async function probeAdapter(provider: "codex" | "kimi" | "antigravity", model: string, binPath: string | undefined, signal: AbortSignal) {
  let text = "";
  let error = "";
  let failed = false;
  await runAgent(provider, PROMPT, {
    cwd: homedir(),
    model,
    binPath,
    signal,
    chatOnly: true,
    client: NO_CLIENT,
    nodeId: "model-check",
    onEvent: (ev) => {
      if (ev.kind === "text_delta") text += ev.text;
      else if (ev.kind === "error") error ||= ev.message;
      else if (ev.kind === "done" && ev.isError) failed = true;
    },
  });
  if (failed || error) return { ok: false as const, error: error || "the chat failed" };
  return text.trim() ? { ok: true as const } : { ok: false as const, error: "no answer" };
}

/** The probe for real providers. `binPaths` are the Settings paths, per provider. */
export function createProbe(binPaths: Partial<Record<string, string | undefined>>): Probe {
  return async ({ provider, model }, signal) => {
    if (provider === "claude") return probeClaude(model, binPaths.claude, signal);
    if (provider === "codex" || provider === "kimi" || provider === "antigravity") return probeAdapter(provider, model, binPaths[provider], signal);
    return { ok: false, error: `${provider} models can't be checked` };
  };
}
