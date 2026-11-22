import type { AskUserQuestion, AskUserResponsePayload } from "@shared/ipc";
import { kimiContext } from "./contextSnapshots";
import type { RunnerEvent } from "./types";

type Block = { type?: string; text?: string };
type ToolContent = { type?: string; content?: Block };

const ALLOW_ONCE = "Allow once";
const ALWAYS_ALLOW = "Always allow";
const DENY = "Deny";
const PREVIEW_MAX = 1000;
const APPROVAL_PREFIX = "Requesting approval to ";

// Which of the agent's offered options each of our three answers selects, in order of preference.
const KINDS_FOR: Record<string, string[]> = {
  [ALLOW_ONCE]: ["allow_once"],
  [ALWAYS_ALLOW]: ["allow_always"],
  [DENY]: ["reject_once", "reject_always"],
};

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as ToolContent[])
    .map((item) => (item?.type === "content" && typeof item.content?.text === "string" ? item.content.text : ""))
    .join("");
}

/**
 * Maps one ACP `session/update` to runner events. Kimi streams message and thought text in
 * small chunks, and reports each tool call as `tool_call` then `tool_call_update`s until a
 * `completed` or `failed` status. It sends no tool input, so the call shows by name only;
 * the approval prompt carries the command.
 */
export function acpUpdateEvents(update: unknown): RunnerEvent[] {
  if (!update || typeof update !== "object") return [];
  const u = update as Record<string, unknown>;

  switch (u.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk": {
      const text = (u.content as Block | undefined)?.text;
      if (typeof text !== "string" || !text) return [];
      return [u.sessionUpdate === "agent_message_chunk" ? { kind: "text_delta", text } : { kind: "thinking_delta", text }];
    }
    case "tool_call": {
      if (typeof u.toolCallId !== "string") return [];
      // Kimi names a call by its title and sends no input; Antigravity also sends `name` and `rawInput`.
      const name =
        typeof u.name === "string" && u.name
          ? u.name
          : typeof u.title === "string" && u.title
            ? u.title
            : typeof u.kind === "string"
              ? u.kind
              : "tool";
      return [{ kind: "tool_use", toolUseId: u.toolCallId, name, input: u.rawInput && typeof u.rawInput === "object" ? u.rawInput : {} }];
    }
    case "tool_call_update": {
      if (typeof u.toolCallId !== "string" || (u.status !== "completed" && u.status !== "failed")) return [];
      const content = textOf(u.content) || (typeof u.rawOutput === "string" ? u.rawOutput : "");
      return [{ kind: "tool_result", toolUseId: u.toolCallId, content, isError: u.status === "failed" }];
    }
    case "usage_update": {
      const context = kimiContext(u);
      return context ? [{ kind: "context", context }] : [];
    }
    default:
      return [];
  }
}

type PermissionParams = {
  toolCall?: { title?: string; content?: unknown; rawInput?: { CommandLine?: unknown } };
  options?: { optionId?: string; kind?: string }[];
};

/**
 * The approval prompt for one `session/request_permission`: the same three choices Claude's prompt has.
 * `agent` is the name shown to the user; Antigravity sends the command in `rawInput` rather than `content`.
 */
export function permissionQuestion(params: unknown, agent = "Kimi"): AskUserQuestion {
  const p = (params ?? {}) as PermissionParams;
  const title = p.toolCall?.title || "a tool";
  const command = p.toolCall?.rawInput?.CommandLine;
  const detail = textOf(p.toolCall?.content).replace(APPROVAL_PREFIX, "") || (typeof command === "string" ? command : "");
  const offered = new Set((p.options ?? []).map((o) => o.kind));
  const options = [
    { label: ALLOW_ONCE, description: "Run this one call.", preview: detail.slice(0, PREVIEW_MAX) || undefined },
    { label: ALWAYS_ALLOW, description: `Skip this question for the rest of this ${agent} session.` },
    { label: DENY, description: `Don't run it; ${agent} is told it was rejected.` },
  ].filter((option) => KINDS_FOR[option.label].some((kind) => offered.has(kind)));
  return { id: "decision", header: "Approval", question: `Allow ${agent} to use ${title}?`, multiSelect: false, options };
}

/** The `session/request_permission` result for the user's answer; anything unclear cancels the call. */
export function permissionOutcome(params: unknown, response: AskUserResponsePayload) {
  if (response.cancelled) return { outcome: "cancelled" } as const;
  const answer = response.answers.decision;
  const choice = Array.isArray(answer) ? answer[0] : answer;
  const wanted = KINDS_FOR[choice ?? ""] ?? [];
  const offered = (params as PermissionParams | undefined)?.options ?? [];
  const pick = wanted.map((kind) => offered.find((o) => o.kind === kind)).find((o) => o?.optionId);
  return pick ? ({ outcome: "selected", optionId: pick.optionId } as const) : ({ outcome: "cancelled" } as const);
}
