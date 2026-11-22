import { spawn } from "node:child_process";
import { requestAnswer } from "../claude/askUserBridge";
import { resolveCommandLine } from "../commandLine";
import { shellEnv } from "../shellPath";
import { createRpc } from "./acpRpc";
import { consumeJsonl } from "./jsonlReader";
import { acpUpdateEvents, permissionOutcome, permissionQuestion } from "./kimiAcpEvents";
import { errorMessage, isAuthError, type RunAgentOpts, type RunnerEvent } from "./types";

const CANCEL_GRACE_MS = 2000;
/** How long after a reply to wait for the size report (it came with the reply in a probe). */
const SIZE_WAIT_MS = 500;
const AGENT = "Antigravity";

const sessionIdOf = (result: unknown): string => {
  const id = (result as { sessionId?: unknown } | undefined)?.sessionId;
  if (typeof id !== "string" || !id) throw new Error("Antigravity did not return a session ID.");
  return id;
};

/** The option that lets one call run, when the agent offered one. */
function allowOnce(params: unknown) {
  const options = (params as { options?: { optionId?: string; kind?: string }[] } | undefined)?.options ?? [];
  const pick = options.find((o) => o.kind === "allow_once" && o.optionId);
  return pick ? ({ outcome: "selected", optionId: pick.optionId } as const) : ({ outcome: "cancelled" } as const);
}

/**
 * Runs one Antigravity turn over `agy acp` (Agent Client Protocol on stdio). The agent has no fork,
 * so a branch off another node never gets here with a parent session: main replays the history as
 * text and the node starts its own session. Auto mode answers each permission request itself
 * (allow once); ask mode puts it to the user.
 */
export async function runAntigravity(prompt: string, opts: RunAgentOpts): Promise<void> {
  if (opts.attachments && opts.attachments.length > 0) {
    opts.onEvent({ kind: "error", message: "Image attachments are not yet supported for the antigravity provider." });
    opts.onEvent({ kind: "done", isError: true });
    return;
  }

  const bin = opts.binPath || "agy";
  let doneEmitted = false;
  const emit = (ev: RunnerEvent): void => {
    if (ev.kind === "done") doneEmitted = true;
    if (ev.kind === "error" && !ev.code && isAuthError(ev.message)) {
      opts.onEvent({ ...ev, code: "auth_required" });
      return;
    }
    opts.onEvent(ev);
  };

  let proc: ReturnType<typeof spawn> | undefined;
  try {
    const env = await shellEnv();
    const line = resolveCommandLine(bin, ["acp"], env);
    const child = spawn(line.command, line.args, {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env,
      windowsHide: true,
      windowsVerbatimArguments: line.windowsVerbatimArguments,
    });
    proc = child;

    let stderrBuf = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderrBuf += chunk));
    child.stdin.on("error", () => undefined); // a dead agent is reported through `close` below

    let sessionId: string | undefined;
    let sizeReported: () => void = () => undefined;
    const sizeArrived = new Promise<void>((resolve) => (sizeReported = resolve));
    const rpc = createRpc((text) => child.stdin.write(`${text}\n`), {
      onNotification: (method, params) => {
        const update = (params as { update?: unknown } | undefined)?.update;
        if (method !== "session/update") return;
        const events = acpUpdateEvents(update);
        events.forEach(emit);
        if (events.some((ev) => ev.kind === "context")) sizeReported();
      },
      onRequest: async (method, params) => {
        if (method !== "session/request_permission") throw new Error(`Unsupported request: ${method}`);
        if (opts.approval !== "ask") return { outcome: allowOnce(params) };
        const response = await requestAnswer([permissionQuestion(params, AGENT)], opts.client, opts.nodeId, opts.signal).catch(
          () => ({ id: "", cancelled: true }) as const,
        );
        return { outcome: permissionOutcome(params, response) };
      },
    });

    child.on("error", (err: NodeJS.ErrnoException) =>
      rpc.failAll(
        new Error(err.code === "ENOENT" ? `agy executable not found (tried "${bin}"). Install the Antigravity CLI.` : errorMessage(err)),
      ),
    );
    child.on("close", (code) =>
      rpc.failAll(new Error(`agy exited with code ${code}${stderrBuf ? `\n${stderrBuf.trim()}` : ""}`)),
    );
    void consumeJsonl(child.stdout, rpc.feed).catch(() => undefined);

    const onAbort = (): void => {
      if (sessionId) rpc.notify("session/cancel", { sessionId });
      setTimeout(() => child.kill("SIGTERM"), CANCEL_GRACE_MS).unref();
    };
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener("abort", onAbort, { once: true });

    await rpc.call("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });

    const common = { cwd: opts.cwd, mcpServers: [] };
    if (opts.currentSession) {
      sessionId = opts.currentSession.id;
      await rpc.call("session/resume", { sessionId, ...common });
    } else {
      // The system prompt goes in the session's own slot: text put in front of the prompt was ignored in a probe.
      const meta = opts.systemPrompt ? { _meta: { antigravity: { systemPrompt: { append: opts.systemPrompt } } } } : {};
      sessionId = sessionIdOf(await rpc.call("session/new", { ...common, ...meta }));
    }
    emit({ kind: "session", session: { provider: "antigravity", id: sessionId } });

    if (opts.model) await rpc.call("session/set_model", { sessionId, modelId: opts.model });

    await rpc.call("session/prompt", { sessionId, prompt: [{ type: "text", text: prompt }] });
    await Promise.race([sizeArrived, new Promise<void>((resolve) => setTimeout(resolve, SIZE_WAIT_MS).unref())]);
    emit({ kind: "done", isError: false });
  } catch (err) {
    if (opts.signal?.aborted) {
      if (!doneEmitted) emit({ kind: "done", isError: false });
    } else {
      emit({ kind: "error", message: errorMessage(err) });
      if (!doneEmitted) emit({ kind: "done", isError: true });
    }
  } finally {
    proc?.kill("SIGTERM");
  }
}
