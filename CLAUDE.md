# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`local-lmcanvas` — fully-local, canvas-based branching AI conversation tool (Electron + React + TypeScript). This is the xack20 fork; its default branch is `main`.

See [AGENTS.md](./AGENTS.md) for build commands, layout, conventions, and the four-place rule for adding channels. Read it first.

Always run `bun run typecheck` before reporting work complete.

Unit tests are `*.test.mjs` files run with Bun (`bun test src/shared/history.test.mjs` runs one). Run each file in its own `bun test <file>` process; never pass several files to one `bun test` invocation. `settings.test.mjs` redirects `HOME` and refuses to run once another file has loaded the storage modules. Tests import the `.ts` source directly by relative path (no `@shared`/`@/` aliases). There's no lint script.

## Branches and pull requests

`main` is the default branch. **Never commit or push to `main` directly, and never force-push it.** Every change reaches `main` through a pull request.

- Start each piece of work from an up-to-date `main`: `git switch main && git pull --ff-only && git switch -c <type>/<short-name>`.
- Name the branch `<type>/<short-name>`, with the same types as commit messages (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`), e.g. `fix/thread-order`.
- Push the branch and open a PR into `main` (`gh pr create --base main`), filling in `.github/PULL_REQUEST_TEMPLATE.md`. Run `bun run typecheck` and the tests for the files you touched first: CI only runs on version tags, so a PR gets no automatic checks.
- Don't merge your own PR unless asked, and don't commit or push unless asked. Delete the branch after it is merged.
- To build and install for a test, build from the branch; the PR is how it reaches `main`.
- Syncing with upstream goes the same way: branch from `main`, `git fetch upstream && git merge upstream/main`, PR.

## Architecture

**Data model.** Each canvas is one JSON file, `~/.local-lmcanvas/canvases/<id>.json`, written atomically by `src/main/storage/`. A node's `data.chat` holds its own `messages`, `parentIds`, and `providerSession` (a Claude session ID or Codex thread ID). Only `parentIds[0]` is the conversation parent. `getMessageHistoryForNode` in `src/shared/history.ts` walks that chain. Any other parents are merge inputs (`buildMergeContext`).

**A chat run, end to end:**
1. `src/renderer/src/hooks/useNodeChat.ts` calls `window.api.chat.start` with the branch history plus the node's and primary parent's `providerSession`.
2. `chat:start` in `src/main/index.ts` resolves the provider, model, cwd, and system prompt. The node setting wins, then the canvas, then `settings.json`.
3. `runAgent` in `src/main/agents/index.ts` dispatches to the Claude runner (`src/main/claude/runner.ts`, Agent SDK) or the Codex/Cursor/Kimi adapters in `src/main/agents/`.
4. Runners emit `RunnerEvent`s. Main forwards them as `chat:event` to the client that started the chat. Every chat ends with exactly one `done`, which the renderer waits for.

**Approvals.** `nodeSettings.approval` is `"ask"` or unset (= auto, the default: Claude `bypassPermissions`, Codex `approvalPolicy: "never"` with full access). Ask mode exists for Claude, Codex and Kimi: Claude runs in `default` permission mode with `canUseTool` (`src/main/claude/toolApproval.ts`), Codex uses `codexPolicy()` (`untrusted` + workspace-write sandbox), whose existing server-request handlers fire, and Kimi switches from print mode to `kimi acp` (`kimiAcp.ts`, with the JSON-RPC client in `acpRpc.ts` and the update/permission mapping in `kimiAcpEvents.ts`). They all reach the user through `requestAnswer` (the ask-user pipeline). Kimi's print and ACP sessions are interchangeable. `runAgent` refuses ask mode for Cursor via `approvalRefusal()`, because its print mode can't ask.

**Local models.** Provider `local` isn't a CLI: `src/main/agents/local/` has `servers.ts` (finds LM Studio and Ollama models; a node stores `lmstudio:<name>` or `ollama:<name>`), `stream.ts` (OpenAI-style SSE and tool-call assembly), `tools.ts` (Read, LS, Glob, Grep, Write, Edit, Bash, named like Claude Code's so approvals and the tool display treat them the same; file tools are confined to the cwd) and `agent.ts` (the loop, up to 25 rounds). Ask mode reuses `approveToolCall` from `toolApproval.ts`. There is no session, so the branch replays as text like Cursor; no context size is shown.

**Context sizes.** Codex (`thread/tokenUsage/updated`: `last.totalTokens` against `modelContextWindow`) and Kimi in ask mode (ACP `usage_update`: `used`/`size`, which arrives just after the prompt result, so `kimiAcp.ts` holds `done` up to 500 ms for it) emit the same `context` event Claude does; `contextSnapshots.ts` builds it. Kimi's print mode reports nothing, so `useContextView` estimates it against the model's configured window. Cursor shows no size.

**Tree mode.** The tree badge arms `useTreeStore` (transient, keyed by node). `useNodeChat` takes the flag on a send that goes ahead, passes `treePlan` on `chat:start` (main swaps the next-steps instruction for `TREE_PLAN_INSTRUCTION`) and cuts the `<tree-outline>` JSON out of the visible text with `createTagStreamer`. On `done`, `buildTree.ts` `growTree` adds a written node per branch (text made by `branchIndexMarkdown`) and a placeholder per page (`data.planned.question`, saved so it survives a restart), laid out by `treeLayout.ts`. Write and Write all send a placeholder's question through a prefill with auto-submit, the same path Compare uses; `writeAll` runs three at a time and polls `pageSettled`. `parseTreeOutline` (`shared/treeOutline.ts`) enforces the caps.

**Compare.** The compare badge (`CompareBadge.tsx`) stores ticked models in `useCompareStore` (transient, keyed by node). `useCompareSubmit` wraps `CustomNode`'s `submit`: it takes the ticks, adds a sibling blank node per model with `nodeSettings` passed directly (so `lastNodeSettings` isn't touched), sets the source and siblings to ask via `compareTargets.ts`, then runs the source. A follow-up from the side panel sends the ticks on the `BranchRequest`; `CanvasPane` hands them to the new child, which submits itself.

**Resume vs replay.** If the node or its primary parent has a session from the *same* provider, only the new prompt is sent. For Claude that means `resume`, plus `forkSession` when branching off the parent. Otherwise the whole branch is replayed as a `[User]`/`[Assistant]` transcript (`src/main/claude/history.ts`), which also happens after a provider switch. A Claude replay is fitted to the model's window (`replayFit.ts`, `replaySummary.ts`) and retried on overflow (`overflowRetry.ts`). The README's "Context window" section describes how this behaves for the user.

**One call table, two transports.** `src/main/api/registry.ts` is the only place handlers are registered. Every handler gets a `Client` (desktop window or browser tab) as its first argument. Scope is enforced in `invoke`: `desktop-only` is the default, `shared` lets paired browsers call it. The same table is bound to Electron IPC and to the browser-access server in `src/main/web/`. In a browser, `src/renderer/src/lib/webBridge.ts` provides the same `window.api` over HTTPS + WebSocket. Only one place (the desktop or a browser) holds a canvas lock at a time (`src/main/web/canvasLocks.ts`, `src/renderer/src/lib/lockClaims.ts`).

**Renderer state.** `useCanvasStore.ts` is a Zustand store *factory* (`createCanvasStoreApi`) provided through React context. Each canvas pane gets its own instance, so read it through the context hooks rather than a global store.
