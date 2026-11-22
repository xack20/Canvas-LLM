# Antigravity provider (via the `agy` CLI)

## Intent

Let a node run on Google's Antigravity CLI (`agy`), so its models (Gemini 3.8 Flash, plus the
Claude, GPT-OSS and other models `agy` offers behind one Google login) are usable from a canvas
like Claude, Codex, Cursor, Kimi and Local are. Only `agy` is wanted, not the separate `gemini`
CLI. The UI calls it **Antigravity**; `agy` is only the executable's name.

## Goals

- A new provider id `antigravity`, selectable per node, with a model picker filled from the models
  `agy` reports (not hard-coded: the list changes with the user's account).
- Streaming text, thinking, tool calls and tool results shown the way other providers show them.
- Ask mode (approval before an edit or command) through `agy acp`, via the existing ask-user
  pipeline, so it behaves like Claude, Codex and Kimi.
- Works on macOS and Windows (the CLI installs on both).
- LMCanvas's system prompt (Settings box + built-in instructions + tree instruction) reaches it.

## Non-goals

- The `gemini` CLI, the Antigravity IDE or the Python SDK.
- Logging in from inside LMCanvas. The user runs `agy` once; LMCanvas only reports "not signed in".
- Image attachments in the first version (Kimi refuses them too); `agy` advertises image support,
  so this is a cheap follow-up.
- Context-size display, unless `agy` turns out to report it (see Open items).

## Anti-goals

- Don't change how the other providers behave. Every edit to a shared place is an added case.
- Don't make the user pick between `agy` modes by hand; LMCanvas's own approval setting decides.

## What the probe showed (`agy` 1.5.14, `agy acp`, no model call made)

- `initialize` works. It advertises `loadSession`, session `resume`, `close`, `load`, `list`,
  `additionalDirectories`, image prompts, and `_meta.antigravity.systemPrompt.append: true`.
  There is **no `fork`** capability.
- `session/new` returns `models.availableModels` (`modelId` + `name`), `currentModelId`, and
  `modes` (`default` asks first, `accept-edits`, `auto`, `plan`), plus `configOptions`.
  The probe signed in without any prompt, so the user's Google login is already in place.
- Auth methods: Google login, Gemini Enterprise, Gemini API key, Agent Platform (ADC).
- Models seen: `gemini-3.8-flash-{high,medium,low}`, `claude-sonnet-4-6`,
  `claude-opus-4-6-thinking`, `gpt-oss-120b-medium`.

## Approaches

1. **`agy acp`, modelled on `runKimiAcp`** (picked). Real ask mode, resume by session id, models
   from `session/new`. Most code, but the ACP client (`acpRpc.ts`, `jsonlReader.ts`) and the
   permission mapping (`kimiAcpEvents.ts`) already exist and are generic enough to reuse.
2. `agy -p --output-format stream-json`. Less code, but no ask mode: Antigravity nodes would
   always run unattended, unlike three other providers.
3. Add the `gemini` CLI as well. Rejected: the user wants only `agy`; the same ACP client makes it
   a small later addition if wanted.

The user chose "agy only, shown as Antigravity"; the ACP-over-print choice is my call.

## Design

- **Runner** `src/main/agents/antigravityAcp.ts`: spawn `agy acp` with the node's cwd (resolved with
  `resolveCommandLine` + `shellEnv`, so `.exe` / `.cmd` and PATH work on Windows), run the Kimi
  sequence: `initialize` → `session/resume` (own node) or `session/new` → `session/set_model` (or
  `set_config_option`, whichever `agy` accepts) → `session/prompt` → `done`. Map `session/update` and
  `session/request_permission` through the shared ACP helpers; reuse `kimiAcpEvents` where the
  payloads match, otherwise add a small `antigravityAcpEvents.ts` rather than bending Kimi's.
- **Branching without fork.** `agy` has no `session/fork`, so the first reply on a branch off a
  parent node replays the branch as a transcript (the existing Cursor/Local path in
  `src/shared/history.ts`), and the new node then keeps its own session id. (My call; the
  alternative, `session/load` + continuing in the parent's session, would mix two branches in one
  session.)
- **System prompt.** On a fresh session only, send it with the prompt via `composePromptWithSystem`
  (same as Kimi). Using `_meta.antigravity.systemPrompt.append` is a possible refinement; the
  builder checks which works.
- **Approval.** `nodeSettings.approval` unset = auto: choose `agy`'s `auto` mode (or
  auto-approve requests); `"ask"` = `default` mode, with each request sent through `requestAnswer`
  exactly as in `runKimiAcp`.
- **Models.** `listAntigravityModels` in main asks `agy models` (or the `session/new` response) and
  caches it; a new `antigravityModels` channel feeds the model picker, like `kimiModels`.
- **Provider plumbing** (mirror every Kimi touchpoint): `Provider` and `PROVIDERS` in
  `shared/types.ts`; `isProvider` in `shared/history.ts`; `runAgent` in `agents/index.ts`;
  `ipc.ts`, `main/index.ts`, `preload/index.ts` and `webBridge.ts` for the model channel
  (the four-place rule); `providerAuth.ts` (binary lookup and a signed-in probe);
  `modelProbes.ts`; `approvalSupport.ts` (the refusal text mentions "Claude, Codex or Kimi");
  UI: `ProviderLogo`, `OtherProviderModels`, `CompareBadge`, onboarding `providerInfo` and
  `LinkProvidersStep`, `SettingsModal` (binary path), `useProviderInfo`.
- **Docs**: README (provider list, install and login line, Windows note), CLAUDE.md and AGENTS.md
  provider lists.

## Constraints

- Follow CLAUDE.md: branch `feat/antigravity-provider` from `main`, PR only, `bun run typecheck`,
  one `bun test` process per test file.
- Unit tests for the new event mapping and model parsing, written with the code.
- Never log or store tokens; `agy` keeps its own login under `~/.gemini`.

## Left to the builder / open items

- Exact ACP shapes `agy` sends for tool calls, thinking and permission requests (run a real prompt
  once; the probe so far made no model call).
- Whether `agy` reports context usage (`usage_update`). If it does, emit the `context` event like
  Kimi; if not, show no size (like Cursor).
- Which of `session/set_model` or `session/set_config_option` selects a model.
- The Windows executable name/location (`agy.exe` under the install folder) for `providerAuth`.
- Whether the token cost of the first real prompt is acceptable to the user (it uses their Google
  account's quota).

## Calls I made (for you to check)

- ACP over print mode (above), and replay for branches because `agy` can't fork.
- Models come from `agy` live, not a fixed list.
- No image attachments, and no in-app login, in the first version.
- The doc lives in `docs/superpowers/specs/` and is not committed yet.
