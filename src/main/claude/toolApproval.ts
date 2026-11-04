import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { AskUserQuestion, AskUserResponsePayload } from "@shared/ipc";

type Ask = (questions: AskUserQuestion[], signal: AbortSignal) => Promise<AskUserResponsePayload>;

/** Tools that only look at things; every other tool waits for the user's OK. */
const NO_APPROVAL_NEEDED = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "NotebookRead",
  "TodoWrite",
  "BashOutput",
  "ExitPlanMode",
  // A subagent's own tool calls come through here again, so they are still gated.
  "Task",
  "Agent",
]);
// LMCanvas's own tools (the ask-user picker) must never ask permission to ask a question.
const NO_APPROVAL_PREFIX = "mcp__lmc__";

const PREVIEW_MAX = 1000;
const ALLOW_ONCE = "Allow once";
const DENY = "Deny";

// Tools the user chose "always allow" for, per node, until the app restarts.
const allowedByNode = new Map<string, Set<string>>();

export function resetNodeApprovals(): void {
  allowedByNode.clear();
}

export function needsApproval(toolName: string, nodeId: string): boolean {
  if (NO_APPROVAL_NEEDED.has(toolName) || toolName.startsWith(NO_APPROVAL_PREFIX)) return false;
  return !allowedByNode.get(nodeId)?.has(toolName);
}

function clip(text: string): string {
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX)}…` : text;
}

/** What the user is being asked to approve, in the form they can judge it by. */
export function previewToolCall(toolName: string, input: Record<string, unknown>): string {
  const text = (key: string): string | undefined =>
    typeof input[key] === "string" ? (input[key] as string) : undefined;
  const picked =
    toolName === "Bash"
      ? text("command")
      : toolName === "WebFetch"
        ? text("url")
        : (text("file_path") ?? text("notebook_path"));
  return clip(picked ?? JSON.stringify(input));
}

export function approvalQuestion(toolName: string, input: Record<string, unknown>, agent = "Claude"): AskUserQuestion {
  return {
    id: "decision",
    header: "Approval",
    question: `Allow ${agent} to use ${toolName}?`,
    multiSelect: false,
    options: [
      { label: ALLOW_ONCE, description: "Run this one call.", preview: previewToolCall(toolName, input) },
      {
        label: alwaysLabel(toolName),
        description: "Skip this question for the tool in this node until LMCanvas restarts.",
      },
      { label: DENY, description: `Don't run it; ${agent} is told you said no.` },
    ],
  };
}

function alwaysLabel(toolName: string): string {
  return `Always allow ${toolName}`;
}

type ApproverDeps = { ask: Ask; nodeId: string; /** Who is asking, as the prompt names it. */ agent?: string };

/** Asks the user about one tool call (unless it needs no asking) and says whether it may run. */
export async function approveToolCall(
  deps: ApproverDeps,
  toolName: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<PermissionResult> {
  if (!needsApproval(toolName, deps.nodeId)) return { behavior: "allow", updatedInput: input };

  let response: AskUserResponsePayload;
  try {
    response = await deps.ask([approvalQuestion(toolName, input, deps.agent)], signal);
  } catch {
    // Stop pressed or the window closed while waiting.
    return { behavior: "deny", message: "The run was stopped before this was approved.", interrupt: true };
  }
  if (response.cancelled) {
    return { behavior: "deny", message: "Approval was cancelled.", interrupt: true };
  }

  const answer = response.answers.decision;
  const choice = Array.isArray(answer) ? answer[0] : answer;
  if (choice === ALLOW_ONCE) return { behavior: "allow", updatedInput: input };
  if (choice === alwaysLabel(toolName)) {
    allowedByNode.set(deps.nodeId, new Set(allowedByNode.get(deps.nodeId)).add(toolName));
    return { behavior: "allow", updatedInput: input };
  }
  return { behavior: "deny", message: `The user declined this ${toolName} call.` };
}

/** The `canUseTool` hook for a node whose approval mode is `ask`. */
export function createToolApprover(deps: ApproverDeps): CanUseTool {
  return (toolName, input, { signal }) => approveToolCall(deps, toolName, input, signal);
}
