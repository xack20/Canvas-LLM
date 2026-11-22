import type { ClaudeModelInfo, CodexModelInfo, ModelChecks, Provider } from "./types";
import { CLAUDE_DEFAULT_MODEL } from "./claudeModels";

/**
 * Splits Claude Code's model list into the current models and older pinned versions. The
 * aliases (opus, sonnet, ...) always point at the newest model, so they are "latest" and keep
 * up with Claude Code by themselves; pinned ids (`claude-opus-4-7`) are older. "Default" only
 * repeats one of the aliases, so it is in neither.
 */
export function splitClaudeModels(models: readonly ClaudeModelInfo[]): {
  latest: ClaudeModelInfo[];
  older: ClaudeModelInfo[];
} {
  const named = models.filter((m) => m.value !== CLAUDE_DEFAULT_MODEL);
  const latest = named.filter((m) => !m.value.startsWith("claude-"));
  // A list with no aliases at all: showing everything beats showing nothing.
  if (latest.length === 0) return { latest: named, older: [] };
  return { latest, older: named.filter((m) => m.value.startsWith("claude-")) };
}

/**
 * Splits Codex's model list into the current models and the ones Codex itself calls "Previous
 * generation" or "Legacy" in their description. The default model always stays current. A list
 * where every model is marked old shows everything rather than nothing.
 */
export function splitCodexModels(models: readonly CodexModelInfo[]): {
  latest: CodexModelInfo[];
  older: CodexModelInfo[];
} {
  const isOlder = (m: CodexModelInfo): boolean => !m.isDefault && /^(previous generation|legacy)\b/i.test(m.description.trim());
  const latest = models.filter((m) => !isOlder(m));
  if (latest.length === 0) return { latest: [...models], older: [] };
  return { latest, older: models.filter(isOlder) };
}

/** True when a check found the model unusable. Models never checked, or checked ok, stay. */
export function isFailed(checks: ModelChecks | undefined, provider: Provider, id: string): boolean {
  return checks?.[provider]?.[id]?.ok === false;
}

export function withoutFailed<T>(
  items: readonly T[],
  provider: Provider,
  checks: ModelChecks | undefined,
  idOf: (item: T) => string,
): T[] {
  return items.filter((item) => !isFailed(checks, provider, idOf(item)));
}

/** True when some of these models have no saved check, so the picker can offer to run one. */
export function hasUnchecked(checks: ModelChecks | undefined, provider: Provider, ids: readonly string[]): boolean {
  return ids.some((id) => checks?.[provider]?.[id] === undefined);
}

/** A model that appeared after the provider's last check (the provider has results, this one has none). */
export function isNewSinceCheck(checks: ModelChecks | undefined, provider: Provider, id: string): boolean {
  const byModel = checks?.[provider];
  return byModel !== undefined && Object.keys(byModel).length > 0 && byModel[id] === undefined;
}

// Errors that say nothing about the plan: hiding a model for these would hide a good one.
const TRANSIENT = /rate.?limit|usage limit|quota|overloaded|time(?:d)?[ -]?out|network|ECONN|ENOTFOUND|EAI_AGAIN|not (?:logged|signed) in|log ?in|authenticat|unauthorized|not found \(tried|aborted/i;

/** A refused check is `failed` (hide the model) unless the error is transient (`unknown`: try again later). */
export function classifyFailure(message: string): "failed" | "unknown" {
  return TRANSIENT.test(message) ? "unknown" : "failed";
}
