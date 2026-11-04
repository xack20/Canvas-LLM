export type ToolCall = { id: string; name: string; arguments: string };
export type ChatResult = {
  content: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  usage?: { promptTokens: number; completionTokens: number };
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === "object" ? (v as Json) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/**
 * Folds the chunks of an OpenAI-style streamed reply into one result. Text and reasoning go to
 * `sink` as they arrive; a tool call arrives in pieces (its arguments are split across chunks)
 * and is complete only once the stream ends.
 */
export function createChatAccumulator(sink: { text: (t: string) => void; thinking: (t: string) => void }) {
  let content = "";
  let finishReason: string | undefined;
  let usage: ChatResult["usage"];
  const calls = new Map<number, ToolCall>();

  return {
    ingest(chunk: unknown): void {
      const c = obj(chunk);
      const error = obj(c?.error);
      if (error) throw new Error(str(error.message) ?? "The model server reported an error.");
      const u = obj(c?.usage);
      if (u && typeof u.prompt_tokens === "number") {
        usage = { promptTokens: u.prompt_tokens, completionTokens: typeof u.completion_tokens === "number" ? u.completion_tokens : 0 };
      }
      const choice = obj(Array.isArray(c?.choices) ? c.choices[0] : undefined);
      if (!choice) return;
      finishReason = str(choice.finish_reason) ?? finishReason;
      const delta = obj(choice.delta);
      const thinking = str(delta?.reasoning_content) ?? str(delta?.reasoning);
      if (thinking) sink.thinking(thinking);
      const text = str(delta?.content);
      if (text) {
        content += text;
        sink.text(text);
      }
      for (const raw of Array.isArray(delta?.tool_calls) ? delta.tool_calls : []) {
        const call = obj(raw);
        if (!call) continue;
        const index = typeof call.index === "number" ? call.index : calls.size;
        const fn = obj(call.function);
        const known = calls.get(index) ?? { id: str(call.id) ?? `call_${index}`, name: "", arguments: "" };
        calls.set(index, {
          id: str(call.id) ?? known.id,
          name: known.name + (str(fn?.name) ?? ""),
          arguments: known.arguments + (str(fn?.arguments) ?? ""),
        });
      }
    },
    result(): ChatResult {
      const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call).filter((call) => call.name);
      return { content, toolCalls, finishReason, usage };
    },
  };
}

/** The JSON payloads of a server-sent-events body, up to `[DONE]`. */
export async function* sseJson(body: AsyncIterable<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const part of body) {
    buffer += decoder.decode(part, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data);
      } catch {
        // A partial or non-JSON keep-alive line carries nothing to use.
      }
    }
  }
}
