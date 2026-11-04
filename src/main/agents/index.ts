import type { Provider } from "@shared/types";
import { runClaude } from "../claude/runner";
import { approvalRefusal } from "./approvalSupport";
import { runCodex } from "./codex";
import { runCursor } from "./cursor";
import { runKimi } from "./kimi";
import { runLocal } from "./local/agent";
import type { RunAgentOpts, RunnerEvent } from "./types";

export type { RunAgentOpts, RunnerEvent };
export type AgentRunner = (prompt: string, opts: RunAgentOpts) => Promise<void>;

export async function runAgent(
  provider: Provider,
  prompt: string,
  opts: RunAgentOpts
): Promise<void> {
  const refusal = approvalRefusal(provider, opts.approval);
  if (refusal) {
    opts.onEvent({ kind: "error", message: refusal });
    opts.onEvent({ kind: "done", isError: true });
    return;
  }
  switch (provider) {
    case "claude":
      return runClaude(prompt, opts);
    case "codex":
      return runCodex(prompt, opts);
    case "cursor":
      return runCursor(prompt, opts);
    case "kimi":
      return runKimi(prompt, opts);
    case "local":
      return runLocal(prompt, opts);
  }
}
