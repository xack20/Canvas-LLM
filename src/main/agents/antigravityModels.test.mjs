// .mjs keeps the bun:test import out of `bun run typecheck`.
import { describe, expect, test } from "bun:test";
import { parseAntigravityModels } from "./antigravityModels.ts";

describe("parseAntigravityModels", () => {
  test("reads the models from a session/new result", () => {
    const result = {
      sessionId: "s",
      models: {
        availableModels: [
          { modelId: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
          { modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
        ],
        currentModelId: "gemini-3.8-flash-high",
      },
    };
    expect(parseAntigravityModels(result)).toEqual([
      { id: "gemini-3.8-flash-low", displayName: "Gemini 3.8 Flash (Low)" },
      { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6 (Thinking)" },
    ]);
  });

  test("falls back to the id as the name and skips entries without an id", () => {
    expect(parseAntigravityModels({ models: { availableModels: [{ modelId: "x" }, { name: "no id" }, null, { modelId: "" }] } })).toEqual([
      { id: "x", displayName: "x" },
    ]);
  });

  test("no models, or junk, gives an empty list", () => {
    for (const value of [undefined, null, {}, { models: {} }, { models: { availableModels: "x" } }]) {
      expect(parseAntigravityModels(value)).toEqual([]);
    }
  });
});
