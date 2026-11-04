import { approveToolCall } from "../../claude/toolApproval";
import { requestAnswer } from "../../claude/askUserBridge";
import { normalizeUsage } from "../usage";
import { errorMessage, type RunAgentOpts, type RunnerEvent } from "../types";
import { LOCAL_SERVERS, listLocalModels, splitLocalModel, type LocalServer } from "./servers";
import { createChatAccumulator, sseJson, type ChatResult, type ToolCall } from "./stream";
import { LOCAL_TOOLS, LOCAL_TOOL_NAMES, runLocalTool } from "./tools";

const MAX_ROUNDS = 25;

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

type Target = { server: LocalServer; name: string };

/** The server and model to use: the node's choice, else the first model any running server offers. */
async function resolveTarget(model: string | undefined, servers: typeof LOCAL_SERVERS): Promise<Target> {
  const named = splitLocalModel(model);
  if (named) return named;
  const available = await listLocalModels(servers);
  const pick = (model ? available.find((m) => m.id.endsWith(`:${model}`)) : undefined) ?? available[0];
  const found = splitLocalModel(pick?.id);
  if (!found) throw new Error("No local model server is running. Start LM Studio or Ollama and load a model.");
  return found;
}

function systemText(opts: RunAgentOpts): string {
  const base = `You are a coding assistant working in the folder ${opts.cwd}. Use the tools to read and change files and to run commands. Work in small steps and check results. Paths are relative to that folder, and the file tools cannot reach outside it.`;
  return opts.systemPrompt ? `${base}\n\n${opts.systemPrompt}` : base;
}

async function streamReply(
  url: string,
  body: unknown,
  signal: AbortSignal | undefined,
  sink: Parameters<typeof createChatAccumulator>[0],
): Promise<ChatResult> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }).catch((err: unknown) => {
    if (signal?.aborted) throw err;
    throw new Error("Couldn't reach the local model server. Is LM Studio or Ollama running with its server on?");
  });
  if (!res.ok || !res.body) throw new Error(`The model server answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const acc = createChatAccumulator(sink);
  for await (const chunk of sseJson(res.body as unknown as AsyncIterable<Uint8Array>)) acc.ingest(chunk);
  return acc.result();
}

function parseArgs(call: ToolCall): Record<string, unknown> | undefined {
  if (!call.arguments.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(call.arguments);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Runs one turn on a model served by LM Studio or Ollama, through their OpenAI-style chat API.
 * The model gets a small set of tools (named like Claude Code's); `ask` mode stops for the user's OK
 * before anything that changes files or runs a command. A node keeps no server-side session: the
 * branch is replayed in the prompt each turn, as for Cursor.
 */
export async function runLocal(prompt: string, opts: RunAgentOpts, servers = LOCAL_SERVERS): Promise<void> {
  let doneEmitted = false;
  const emit = (ev: RunnerEvent): void => {
    if (ev.kind === "done") doneEmitted = true;
    opts.onEvent(ev);
  };
  if (opts.attachments && opts.attachments.length > 0) {
    emit({ kind: "error", message: "Image attachments are not yet supported for the local provider." });
    emit({ kind: "done", isError: true });
    return;
  }

  try {
    const target = await resolveTarget(opts.model, servers);
    const url = `${servers[target.server].base}/v1/chat/completions`;
    const messages: ChatMessage[] = [
      { role: "system", content: systemText(opts) },
      { role: "user", content: prompt },
    ];
    // Models often open with blank lines; drop them until the reply has real text.
    let replyStarted = false;
    const sink = {
      text: (text: string) => {
        const shown = replyStarted ? text : text.replace(/^\s+/, "");
        if (!shown) return;
        replyStarted = true;
        emit({ kind: "text_delta", text: shown });
      },
      thinking: (text: string) => emit({ kind: "thinking_delta", text }),
    };
    const totals = { prompt_tokens: 0, completion_tokens: 0 };
    const signal = opts.signal ?? new AbortController().signal;
    const ask = (questions: Parameters<typeof requestAnswer>[0], s: AbortSignal) => requestAnswer(questions, opts.client, opts.nodeId, s);

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const reply = await streamReply(
        url,
        { model: target.name, messages, tools: LOCAL_TOOLS, stream: true, stream_options: { include_usage: true } },
        signal,
        sink,
      );
      totals.prompt_tokens += reply.usage?.promptTokens ?? 0;
      totals.completion_tokens += reply.usage?.completionTokens ?? 0;
      if (reply.toolCalls.length === 0) break;
      if (round === MAX_ROUNDS - 1) {
        emit({ kind: "text_delta", text: `\n\n(Stopped after ${MAX_ROUNDS} rounds of tool calls.)` });
        break;
      }

      messages.push({
        role: "assistant",
        content: reply.content || null,
        tool_calls: reply.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
      });
      for (const call of reply.toolCalls) {
        const args = parseArgs(call);
        emit({ kind: "tool_use", toolUseId: call.id, name: call.name, input: args ?? {} });
        let outcome: { content: string; isError: boolean };
        if (!LOCAL_TOOL_NAMES.has(call.name)) outcome = { content: `Unknown tool "${call.name}".`, isError: true };
        else if (!args) outcome = { content: "The tool arguments were not valid JSON. Call the tool again with a JSON object.", isError: true };
        else {
          const verdict =
            opts.approval === "ask"
              ? await approveToolCall({ ask, nodeId: opts.nodeId, agent: "the local model" }, call.name, args, signal)
              : { behavior: "allow" as const };
          if (verdict.behavior === "deny") {
            if (verdict.interrupt) {
              emit({ kind: "tool_result", toolUseId: call.id, content: verdict.message, isError: true });
              emit({ kind: "done", isError: false });
              return;
            }
            outcome = { content: verdict.message, isError: true };
          } else outcome = await runLocalTool(call.name, args, opts.cwd, signal);
        }
        emit({ kind: "tool_result", toolUseId: call.id, content: outcome.content, isError: outcome.isError });
        messages.push({ role: "tool", tool_call_id: call.id, content: outcome.content });
      }
    }
    emit({ kind: "done", isError: false, usage: normalizeUsage(totals) });
  } catch (err) {
    if (opts.signal?.aborted) {
      if (!doneEmitted) emit({ kind: "done", isError: false });
      return;
    }
    emit({ kind: "error", message: errorMessage(err) });
    if (!doneEmitted) emit({ kind: "done", isError: true });
  }
}
