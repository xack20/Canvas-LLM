import { spawn } from "node:child_process";
import type { AntigravityModelInfo } from "@shared/types";
import { resolveCommandLine } from "../commandLine";
import { shellEnv } from "../shellPath";
import { createRpc } from "./acpRpc";
import { consumeJsonl } from "./jsonlReader";

const LIST_TIMEOUT_MS = 15_000;
const CACHE_MS = 60_000;

/** The models in `agy`'s `session/new` result; entries without an id are skipped. */
export function parseAntigravityModels(sessionNew: unknown): AntigravityModelInfo[] {
  const list = (sessionNew as { models?: { availableModels?: unknown } } | null | undefined)?.models?.availableModels;
  if (!Array.isArray(list)) return [];
  return list.flatMap((m: { modelId?: unknown; name?: unknown } | null) =>
    typeof m?.modelId === "string" && m.modelId
      ? [{ id: m.modelId, displayName: typeof m.name === "string" && m.name ? m.name : m.modelId }]
      : [],
  );
}

let cache: { bin: string; at: number; models: AntigravityModelInfo[] } | undefined;

/**
 * The models `agy` offers this account, read from a throwaway `agy acp` session (no model call is made).
 * Empty when `agy` isn't installed or signed in. Cached briefly: the picker, Compare and Settings all ask.
 */
export async function listAntigravityModels(binPath?: string): Promise<AntigravityModelInfo[]> {
  const bin = binPath || "agy";
  if (cache && cache.bin === bin && Date.now() - cache.at < CACHE_MS) return cache.models;
  const models = await readModels(bin).catch(() => []);
  if (models.length > 0) cache = { bin, at: Date.now(), models };
  return models;
}

async function readModels(bin: string): Promise<AntigravityModelInfo[]> {
  const env = await shellEnv();
  const line = resolveCommandLine(bin, ["acp"], env);
  const child = spawn(line.command, line.args, {
    stdio: ["pipe", "pipe", "ignore"],
    env,
    windowsHide: true,
    windowsVerbatimArguments: line.windowsVerbatimArguments,
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), LIST_TIMEOUT_MS);
  try {
    child.stdin.on("error", () => undefined);
    const rpc = createRpc((text) => child.stdin.write(`${text}\n`), {
      onNotification: () => undefined,
      onRequest: async () => {
        throw new Error("Unsupported");
      },
    });
    child.on("error", (err) => rpc.failAll(err));
    child.on("close", () => rpc.failAll(new Error("agy exited")));
    void consumeJsonl(child.stdout, rpc.feed).catch(() => undefined);
    await rpc.call("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    return parseAntigravityModels(await rpc.call("session/new", { cwd: process.cwd(), mcpServers: [] }));
  } finally {
    clearTimeout(timer);
    child.kill("SIGTERM");
  }
}
