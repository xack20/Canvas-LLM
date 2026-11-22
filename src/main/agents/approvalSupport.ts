import type { ApprovalMode, Provider } from "@shared/types";

/** Why a provider can't run in ask mode, or undefined when it can. Cursor's print mode has no one to ask. */
export function approvalRefusal(provider: Provider, approval: ApprovalMode | undefined): string | undefined {
  if (approval !== "ask" || provider !== "cursor") return undefined;
  return "Cursor can't ask for approval yet, so this node won't run it. Switch the node's approval to auto, or pick Claude, Codex, Kimi or Antigravity.";
}
