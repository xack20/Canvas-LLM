// .mjs keeps the bun:test import out of `bun run typecheck`.
import { describe, expect, test } from "bun:test";
import { listLocalModels, parseLmStudioModels, parseOllamaModels, splitLocalModel } from "./servers.ts";

describe("splitLocalModel", () => {
  test("splits the server prefix from names that contain slashes and colons", () => {
    expect(splitLocalModel("lmstudio:google/gemma-4-12b")).toEqual({ server: "lmstudio", name: "google/gemma-4-12b" });
    expect(splitLocalModel("ollama:qwen2.5-coder:7b")).toEqual({ server: "ollama", name: "qwen2.5-coder:7b" });
    expect(splitLocalModel("gpt-5")).toBeUndefined();
    expect(splitLocalModel(undefined)).toBeUndefined();
  });
});

describe("model lists", () => {
  test("LM Studio: chat models with their window, no embedding models", () => {
    const body = { data: [
      { id: "google/gemma-4-12b", type: "llm", max_context_length: 131072, loaded_context_length: 8192 },
      { id: "text-embedding-nomic", type: "embeddings" },
      { id: "big", type: "vlm", max_context_length: 32768 },
    ] };
    expect(parseLmStudioModels(body)).toEqual([
      { id: "lmstudio:google/gemma-4-12b", displayName: "google/gemma-4-12b", server: "lmstudio", contextSize: 8192 },
      { id: "lmstudio:big", displayName: "big", server: "lmstudio", contextSize: 32768 },
    ]);
  });

  test("Ollama: pulled models, no embedding models", () => {
    const body = { models: [{ name: "qwen2.5-coder:7b", details: { family: "qwen2" } }, { name: "nomic-embed-text:latest", details: { family: "nomic-bert" } }] };
    expect(parseOllamaModels(body).map((m) => m.id)).toEqual(["ollama:qwen2.5-coder:7b"]);
  });

  test("junk bodies give no models", () => {
    expect(parseLmStudioModels(null)).toEqual([]);
    expect(parseOllamaModels({ models: "x" })).toEqual([]);
  });
});

describe("listLocalModels", () => {
  test("a server that isn't running contributes nothing and doesn't fail the list", async () => {
    const lm = Bun.serve({ port: 0, fetch: () => Response.json({ data: [{ id: "m", type: "llm" }] }) });
    try {
      const servers = {
        lmstudio: { label: "LM Studio", base: `http://localhost:${lm.port}` },
        ollama: { label: "Ollama", base: "http://localhost:1" },
      };
      expect((await listLocalModels(servers)).map((m) => m.id)).toEqual(["lmstudio:m"]);
    } finally {
      lm.stop(true);
    }
  });
});
