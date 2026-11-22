import { expect, test } from "bun:test";
import { classifyFailure, hasUnchecked, isFailed, isNewSinceCheck, splitClaudeModels, splitCodexModels, withoutFailed } from "./modelCatalog.ts";

const m = (value) => ({ value, displayName: value, description: "", supportedEffortLevels: [] });
// The list Claude Code returned for this account on 2026-11-04.
const claude = [
  "default", "opus", "sonnet", "fable", "haiku", "claude-haiku-4-5-20251001", "claude-sonnet-5",
  "claude-opus-5", "claude-fable-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6",
].map(m);

test("Claude: the aliases are latest, pinned versions are older, Default is in neither", () => {
  const { latest, older } = splitClaudeModels(claude);
  expect(latest.map((x) => x.value)).toEqual(["opus", "sonnet", "fable", "haiku"]);
  expect(older).toHaveLength(8);
  expect(older.every((x) => x.value.startsWith("claude-"))).toBe(true);
});

test("Claude: a list with no aliases shows everything rather than nothing", () => {
  const { latest, older } = splitClaudeModels([m("default"), m("claude-opus-4-6")]);
  expect(latest.map((x) => x.value)).toEqual(["claude-opus-4-6"]);
  expect(older).toEqual([]);
});

const cx = (id, description, isDefault = false) => ({ id, displayName: id, description, isDefault });
// The list Codex returned for this account on 2026-11-22 (hidden models left out).
const codex = [
  cx("gpt-6.2-sol", "Fast, go-to model for coding and everyday work.", true),
  cx("gpt-6.2-astra", "Our most capable model for complex coding and professional work."),
  cx("gpt-6.1-terra", "Efficient model that excels at visual understanding."),
  cx("gpt-6.1-sol", "Previous generation model for coding and everyday work."),
  cx("gpt-6-astra", "Previous generation model for complex coding."),
  cx("gpt-6-luna", "Fast and affordable model for easier tasks."),
  cx("gpt-5.6-sol", "Legacy model for coding and everyday work."),
];

test("Codex: models Codex calls previous generation or legacy are older", () => {
  const { latest, older } = splitCodexModels(codex);
  expect(latest.map((x) => x.id)).toEqual(["gpt-6.2-sol", "gpt-6.2-astra", "gpt-6.1-terra", "gpt-6-luna"]);
  expect(older.map((x) => x.id)).toEqual(["gpt-6.1-sol", "gpt-6-astra", "gpt-5.6-sol"]);
});

test("Codex: the default stays current even when its description says legacy; an all-old list shows everything", () => {
  expect(splitCodexModels([cx("a", "Legacy model.", true), cx("b", "Legacy model.")]).latest.map((x) => x.id)).toEqual(["a"]);
  const allOld = [cx("a", "Legacy model."), cx("b", "Previous generation model.")];
  expect(splitCodexModels(allOld)).toEqual({ latest: allOld, older: [] });
});

const checks = {
  claude: { opus: { ok: false, checkedAt: 1, error: "no access" }, sonnet: { ok: true, checkedAt: 1 } },
};

test("only a model that failed its check is hidden; unchecked and passing ones stay", () => {
  expect(isFailed(checks, "claude", "opus")).toBe(true);
  expect(isFailed(checks, "claude", "sonnet")).toBe(false);
  expect(isFailed(checks, "claude", "fable")).toBe(false);
  expect(isFailed(undefined, "claude", "opus")).toBe(false);
  expect(withoutFailed(["opus", "sonnet", "fable"], "claude", checks, (x) => x)).toEqual(["sonnet", "fable"]);
});

test("unchecked detection is per provider", () => {
  expect(hasUnchecked(checks, "claude", ["opus", "sonnet"])).toBe(false);
  expect(hasUnchecked(checks, "claude", ["opus", "fable"])).toBe(true);
  expect(hasUnchecked(checks, "kimi", ["k3"])).toBe(true);
});

test("a plan or access error hides the model; a transient error does not", () => {
  expect(classifyFailure("There's an issue with the selected model (claude-opus-5-5). It may not exist or you may not have access to it.")).toBe("failed");
  expect(classifyFailure("The model `gpt-6-luna` is not supported when using Codex with a ChatGPT account")).toBe("failed");
  expect(classifyFailure("rate limit exceeded")).toBe("unknown");
  expect(classifyFailure("Claude usage limit reached")).toBe("unknown");
  expect(classifyFailure("timed out")).toBe("unknown");
  expect(classifyFailure("kimi exited with code 1\nerror: not logged in")).toBe("unknown");
  expect(classifyFailure('kimi executable not found (tried "kimi"). Install Kimi Code.')).toBe("unknown");
});

test("a model is new only once its provider has been checked without it", () => {
  expect(isNewSinceCheck(checks, "claude", "fable")).toBe(true);
  expect(isNewSinceCheck(checks, "claude", "opus")).toBe(false);
  expect(isNewSinceCheck(checks, "kimi", "k3")).toBe(false); // never checked at all: not "new", just unchecked
  expect(isNewSinceCheck(undefined, "claude", "opus")).toBe(false);
});
