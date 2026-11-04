import type { LocalModelInfo } from "@shared/types";

export type LocalServer = LocalModelInfo["server"];

export const LOCAL_SERVERS: Record<LocalServer, { label: string; base: string }> = {
  lmstudio: { label: "LM Studio", base: "http://localhost:1234" },
  ollama: { label: "Ollama", base: "http://localhost:11434" },
};

const PROBE_TIMEOUT_MS = 1500;

type Json = Record<string, unknown>;
const rows = (v: unknown): Json[] => (Array.isArray(v) ? v.filter((x): x is Json => !!x && typeof x === "object") : []);
const positive = (v: unknown): number | undefined => (typeof v === "number" && v > 0 ? v : undefined);

/** `lmstudio:google/gemma-4-12b` → the server and the name that server knows the model by. */
export function splitLocalModel(id: string | undefined): { server: LocalServer; name: string } | undefined {
  const m = /^(lmstudio|ollama):(.+)$/.exec(id ?? "");
  return m ? { server: m[1] as LocalServer, name: m[2] } : undefined;
}

/** LM Studio's `/api/v0/models`: every downloaded model, with its kind and window. */
export function parseLmStudioModels(body: unknown): LocalModelInfo[] {
  return rows((body as Json | null)?.data)
    .filter((m) => typeof m.id === "string" && m.type !== "embeddings")
    .map((m) => ({
      id: `lmstudio:${m.id as string}`,
      displayName: m.id as string,
      server: "lmstudio" as const,
      contextSize: positive(m.loaded_context_length) ?? positive(m.max_context_length),
    }));
}

/** Ollama's `/api/tags`: pulled models. Embedding models can't chat, so they're left out. */
export function parseOllamaModels(body: unknown): LocalModelInfo[] {
  return rows((body as Json | null)?.models)
    .filter((m) => typeof m.name === "string")
    .filter((m) => !/embed/i.test(m.name as string) && !/bert/i.test(String((m.details as Json | undefined)?.family ?? "")))
    .map((m) => ({ id: `ollama:${m.name as string}`, displayName: m.name as string, server: "ollama" as const }));
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

/** Models from whichever servers are running; a server that isn't running contributes none. */
export async function listLocalModels(servers = LOCAL_SERVERS): Promise<LocalModelInfo[]> {
  const [lm, ollama] = await Promise.all([
    getJson(`${servers.lmstudio.base}/api/v0/models`).then(parseLmStudioModels, () => []),
    getJson(`${servers.ollama.base}/api/tags`).then(parseOllamaModels, () => []),
  ]);
  return [...lm, ...ollama];
}
