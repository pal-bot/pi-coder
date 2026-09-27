import { expect, it } from "vitest";
import {
  isDirect,
  loadConfig,
  pickRouterModel,
  selectModels,
} from "../src/config.js";

it("accepts only direct authenticated Pi models from explicit config", () => {
  const config = loadConfig({
    models: [
      { provider: "anthropic", id: "a", tier: "fast" },
      { provider: "openrouter", id: "x", tier: "fast" },
    ],
  });
  const selected = selectModels(
    config,
    [
      {
        provider: "anthropic",
        id: "a",
        baseUrl: "https://api.anthropic.com",
        contextWindow: 100000,
        input: ["text"],
        cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
      },
      {
        provider: "openrouter",
        id: "x",
        baseUrl: "https://openrouter.ai",
        contextWindow: 100000,
        input: ["text"],
        cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
      },
    ],
    ["anthropic/a", "openrouter/x"],
  );
  expect(selected.map((m) => m.id)).toEqual(["a"]);
});
it("accepts the direct OpenAI Codex subscription provider", () => {
  const config = loadConfig({
    models: [{ provider: "openai-codex", id: "gpt-6-sol", tier: "strong" }],
  });
  const model = {
    provider: "openai-codex",
    id: "gpt-6-sol",
    baseUrl: "https://chatgpt.com/backend-api",
    contextWindow: 372000,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  };
  expect(
    selectModels(config, [model], ["openai-codex/gpt-6-sol"]).map(
      (candidate) => candidate.id,
    ),
  ).toEqual(["gpt-6-sol"]);
});
it("rejects nonstandard ports and redirected paths", () => {
  expect(
    isDirect({ provider: "openai", baseUrl: "https://api.openai.com:8443/v1" }),
  ).toBe(false);
  expect(
    isDirect({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com/proxy",
    }),
  ).toBe(false);
});
it("picks the cheapest router for its own prompt size, independent of the main context", () => {
  const models = [
    {
      provider: "anthropic",
      id: "cheap",
      tier: "fast" as const,
      baseUrl: "https://api.anthropic.com",
      contextWindow: 50000,
      input: ["text"],
      cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
    },
    {
      provider: "openai",
      id: "expensive",
      tier: "balanced" as const,
      baseUrl: "https://api.openai.com/v1",
      contextWindow: 200000,
      input: ["text"],
      cost: { input: 5, output: 5, cacheRead: 5, cacheWrite: 5 },
    },
  ];
  expect(pickRouterModel({ models: [] }, models, 100)?.id).toBe("cheap");
});
it("rejects a direct model when Pi auth overrides its endpoint to a proxy", () => {
  const config = loadConfig({
    models: [{ provider: "openai", id: "a", tier: "fast" }],
  });
  const model = {
    provider: "openai",
    id: "a",
    baseUrl: "https://api.openai.com/v1",
    contextWindow: 100000,
    input: ["text"],
    cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
  };
  expect(
    selectModels(config, [model], ["openai/a"], {
      "openai/a": "https://openrouter.ai/api/v1",
    }),
  ).toEqual([]);
});
