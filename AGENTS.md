# AGENTS.md

Guide for AI coding agents (Claude Code, Cursor, Codex, etc.) working in this repo.

## Project

`local-lmcanvas` is a fully-local, canvas-based branching AI conversation tool. Electron 33 + React 19 + TypeScript 5.6 (strict). Supports multiple CLI-backed providers (Claude, Codex, Cursor, Kimi) and local models (LM Studio, Ollama) with per-provider model selection; collects no telemetry.

## Branches and pull requests

`main` is the default branch and the only long-lived one. **Never commit or push to `main` directly, and never force-push it.** Every change reaches `main` through a pull request.

1. Start from an up-to-date `main`: `git switch main && git pull --ff-only && git switch -c <type>/<short-name>`.
2. Name the branch `<type>/<short-name>`; the types are the commit types (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`), e.g. `fix/thread-order`.
3. Keep one concern per branch. Commit as `<type>: <description>`.
4. Before opening the PR, run `bun run typecheck` and the tests for the files you touched. CI only runs on version tags, so a PR gets no automatic checks.
5. Push the branch and open a PR into `main` (`gh pr create --base main`), filling in `.github/PULL_REQUEST_TEMPLATE.md`.
6. Don't merge your own PR unless asked, and don't commit or push unless asked. Delete the branch once it is merged.

Building and installing the app for a test happens from the branch. Syncing with upstream follows the same path: branch from `main`, `git fetch upstream && git merge upstream/main`, then a PR.

## Build & verify

```bash
bun install
bun run dev         # launches the Electron app
bun run typecheck   # REQUIRED before claiming work complete
bun run build       # production build
```

Unit tests are `*.test.mjs` files run with Bun. Run each file in its own `bun test` process; never pass several files to one `bun test` invocation. `settings.test.mjs` redirects `HOME` and refuses to run once another file has loaded the storage modules. This loop also picks up new, uncommitted test files:

```bash
for f in $(git ls-files --cached --others --exclude-standard '*.test.mjs'); do bun test "$f" >/dev/null 2>&1 && echo "PASS $f" || echo "FAIL $f"; done
```

Tests must never touch the real `~/.local-lmcanvas`. There's no lint script.

## Project layout

- `src/main/` — Electron main process (Node), channel handlers, file I/O. Touch for: spawning the LLM CLI, persisting canvases, settings.
  - `src/main/api/` — the shared call table (`registry.ts`) behind both IPC and the browser-access web server, plus clients (desktop window or browser tab) and active chats.
  - `src/main/web/` — browser access over Tailscale:
    - `service.ts`: on/off, Tailscale checks, keep-awake, pairing links;
    - `server.ts`: loopback HTTP + WebSocket;
    - `security.ts`: the request gate;
    - `tailscale.ts`: Serve control;
    - `devices.ts`: paired devices;
    - `browserClients.ts`: reconnect and replay;
    - `canvasLocks.ts`: one place at a time.
- `src/preload/` — `contextBridge`. Touch for: adding new channels exposed to the renderer.
- `src/renderer/` — React UI, xyflow canvas. Touch for: UI changes. In a browser, `src/renderer/src/lib/webBridge.ts` installs the same `window.api` over HTTPS + WebSocket.
- `src/shared/` — types and graph helpers used by both sides. Touch for: changing the data model or message-history reconstruction.

## Hot files

- `src/main/index.ts` — channel registration, `BrowserWindow` setup, browser-access wiring.
- `src/shared/history.ts` — graph traversal / message-history reconstruction.
- `src/renderer/src/hooks/useCanvasStore.ts` — Zustand store, ~1100 lines.
- `src/renderer/src/components/Canvas/CustomNode.tsx` — node UI, ~440 lines.

## Conventions

- TypeScript strict. No `any` unless a third-party type forces it.
- No `@ts-ignore` / `@ts-expect-error`.
- Minimal comments — names should carry the meaning.
- No backwards-compat shims for code you delete.
- Channels must stay in sync across four places:
  1. typed in `src/shared/ipc.ts`;
  2. registered with `api.handle(channel, handler, scope)` in `src/main/index.ts`;
  3. exposed in `src/preload/index.ts`;
  4. mirrored in the browser adapter `src/renderer/src/lib/webBridge.ts`.
- Channels are desktop-only by default. Pass `"shared"` only when a paired browser may call the channel. Anything that opens native UI or manages browser access stays desktop-only.
- Two exceptions to the four-place rule:
  - **Browser-only helper channels** (`chat:isActive`, `client:bye`) live only in `src/main/index.ts` and `webBridge.ts`.
  - **Main → renderer events** (`chat:event`, `askUser:request`, `canvas:lockLost`) are sent with `client.send(channel, payload)`, not registered with `api.handle`. They need an `ipcRenderer.on` listener in the preload and a `subscribe()` in `webBridge.ts`.

## Before you finish

1. Run `bun run typecheck`.
2. Run the test files you touched, plus any that cover the code you changed (one `bun test` process per file).
3. Run `bun run dev` and click through what you changed.
4. Summarize what you did.
