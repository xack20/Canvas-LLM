# Antigravity Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (run natively; the user asked to build it).

**Goal:** A new provider `antigravity` (UI name "Antigravity"), run through `agy acp`.

**Architecture:** A runner `antigravityAcp.ts` copies `runKimiAcp`'s sequence. Event and permission mapping reuse `kimiAcpEvents.ts` (generalised by an `agent` name argument). Models come from `session/new` → `models.availableModels`, cached, served on a new `providers:antigravityModels` channel.

**Spec:** `docs/superpowers/specs/2026-11-22-antigravity-provider-design.md`

## Global Constraints

- Provider id `antigravity`; UI label "Antigravity"; executable `agy` (default bin name).
- Never pass `--dangerously-skip-permissions`; auto mode answers permission requests itself (`allow_once`).
- Branch `feat/antigravity-provider`; PR only; `bun run typecheck`; one `bun test` process per file.
- No change to other providers' behavior.

## Facts from the real probe (agy 1.5.14)

- `session/set_model { sessionId, modelId }` works with an id from `availableModels` (e.g. `gemini-3.8-flash-low`).
- `tool_call` carries `name` (e.g. `run_command`), `title` (the command) and `rawInput` (the input).
- `session/request_permission` offers `allow` (`allow_once`) and `deny` (`reject_once`) only.
- `usage_update { used, size }` arrives (size 1048576) → exact context.
- No `session/fork`: a branch off a parent node replays the history as text.

## Review Focus

- `agy` missing → clear "not found, install Antigravity CLI" error, not a crash.
- Not signed in → `auth_required` error code.
- Stop button mid-run → one `done`, process killed.
- Ask mode "Deny" → tool rejected, run continues.
- A branch off an Antigravity node → full-history replay, own new session.

### Task 1: Event mapping generalised

**Files:** Modify `src/main/agents/kimiAcpEvents.ts`; Test `src/main/agents/kimiAcpEvents.test.mjs`

**Interfaces:**
- Produces: `acpUpdateEvents(update: unknown): RunnerEvent[]` now also emits `input: u.rawInput ?? {}` and uses `u.name` before `u.title`/`u.kind`; `permissionQuestion(params: unknown, agent = "Kimi"): AskUserQuestion` (agent name in question and option text; preview also from `toolCall.rawInput.CommandLine` when content is empty).

- [ ] Write tests: a `tool_call` with `rawInput` gives `input` equal to it and `name` from `name`; `permissionQuestion(p, "Antigravity")` says "Allow Antigravity to use ls?" and offers only Allow once / Deny for `allow_once`/`reject_once` options; default stays "Kimi".
- [ ] Run `bun test src/main/agents/kimiAcpEvents.test.mjs` → FAIL.
- [ ] Implement; run → PASS (existing Kimi tests unchanged).

### Task 2: Runner and models

**Files:** Create `src/main/agents/antigravityAcp.ts`, `src/main/agents/antigravityModels.ts`; Modify `src/main/agents/index.ts`, `src/main/agents/approvalSupport.ts` (text mentions Antigravity), `src/shared/types.ts` (Provider, PROVIDERS, `AntigravityModelInfo = { id: string; displayName: string }`), `src/shared/history.ts` (`isProvider`)

**Interfaces:**
- Produces: `runAntigravity(prompt: string, opts: RunAgentOpts): Promise<void>`; `listAntigravityModels(bin?: string): Promise<AntigravityModelInfo[]>` (spawns `agy acp`, `initialize` + `session/new`, reads `models.availableModels`, kills it; `[]` on any failure; cached 60 s).
- Runner sequence: `initialize` → own session `session/resume` else `session/new` → emit `session` → `session/set_model` when `opts.model` → `session/prompt` → wait ≤500 ms for `usage_update` → `done`. Permission requests: `approval === "ask"` → `requestAnswer([permissionQuestion(params, "Antigravity")])`; otherwise answer `allow_once` immediately. Text on a fresh session = `composePromptWithSystem`. Attachments → error like Kimi. ENOENT → "agy executable not found … Install Antigravity CLI". Auth errors → `code: "auth_required"`.

- [ ] Test (`antigravityAcp.test.mjs`): `parseAntigravityModels` pure function over a `session/new` result returns `[{id, displayName}]`, skips malformed entries, `[]` for no `models`.
- [ ] Implement, run test → PASS; `bun run typecheck` clean after Task 3 exhaustiveness fixes.

### Task 3: Wiring (the four-place rule + provider tables)

**Files:** Modify `src/shared/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/lib/webBridge.ts` (channel `providers:antigravityModels`, API `providers.antigravityModels()`), `src/main/auth/providerAuth.ts` (default bin `agy`, `probeAntigravity`: installed when `agy --version` runs; authenticated when `listAntigravityModels` is non-empty), `src/main/modelProbes.ts` (adapter probe) and the model-check candidates in `index.ts`, `chat:start` in `index.ts` (a parent session is **not** compatible for `antigravity`, so a branch replays).

- [ ] Add the channel in all four places; `bun run typecheck` surfaces every exhaustive `Record<Provider,…>`/switch to fill.

### Task 4: UI

**Files:** Modify `ProviderLogo.tsx` (plain "A" mark), `OtherProviderModels.tsx` (`AntigravitySection`, title "Antigravity"), `CompareBadge.tsx`, `providerInfo.ts` (install URL `https://antigravity.google/download#antigravity-cli`), `LinkProvidersStep.tsx`, `SettingsModal.tsx` (placeholder + model datalist), `useProviderInfo.ts` (default model `""`, label), `ContextBadge.tsx` (exact size, no "estimated" note), `useContextView.ts` (antigravity treated like Codex: only real reports).

- [ ] Typecheck; click through in a dev build (picker, run, ask mode, branch).

### Task 5: Docs and PR

- [ ] README (provider list, install and login line, Windows note) and CLAUDE.md/AGENTS.md provider mentions; commit; push; open PR (do not merge).

## Self-review

Spec coverage: models live (Task 2), ask mode + auto (Task 2), replay for branches (Task 3), Windows (resolveCommandLine), system prompt (Task 2), docs (Task 5). Open items resolved by the probe: set_model works, usage reported, tool input in `rawInput`.
