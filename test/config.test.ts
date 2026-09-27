import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  DEFAULT_MODEL_POLICY,
  isDirect,
  loadConfig,
  pickRouterModel,
  selectModels,
} from "../src/config.js";

it("ships an opinionated default tier policy", () => {
  const config = loadConfig({});
  expect(config.models).toContainEqual({
    provider: "anthropic",
    id: "claude-haiku-4-5",
    tier: "fast",
  });
  expect(config.models).toContainEqual({
    provider: "anthropic",
    id: "claude-sonnet-4-6",
    tier: "balanced",
  });
  expect(config.models).toContainEqual({
    provider: "anthropic",
    id: "claude-opus-4-6",
    tier: "strong",
  });
  expect(config.models).toContainEqual({
    provider: "openai-codex",
    id: "gpt-5.6-sol",
    tier: "strong",
  });
  expect(DEFAULT_MODEL_POLICY.length).toBeGreaterThan(4);
});

it("rejects malformed router model configuration", () => {
  expect(() => loadConfig({ routerModel: [] })).toThrow(/routerModel/);
  expect(() => loadConfig({ routerModel: "proxy/model" })).toThrow(
    /routerModel/,
  );
  expect(() => loadConfig({ routerModel: "anthropic/" })).toThrow(
    /routerModel/,
  );
});

it("ships only exact IDs in the pinned Pi provider catalog", () => {
  const catalog = new Map<string, Set<string>>();
  for (const provider of ["anthropic", "openai", "openai-codex"]) {
    const data = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "node_modules/@earendil-works/pi-ai/dist/providers/data",
          `${provider}.json`,
        ),
        "utf8",
      ),
    ) as Record<string, Record<string, unknown>>;
    catalog.set(provider, new Set(Object.values(data).flatMap(Object.keys)));
  }
  const keys = DEFAULT_MODEL_POLICY.map(
    (model) => `${model.provider}/${model.id}`,
  );
  expect(new Set(keys).size).toBe(keys.length);
  for (const model of DEFAULT_MODEL_POLICY)
    expect(catalog.get(model.provider)?.has(model.id)).toBe(true);
});

it("uses a non-empty whitelist as allow-only mode", () => {
  const config = loadConfig({
    allowModels: ["anthropic/claude-sonnet-4-6"],
  });
  expect(config.models).toEqual([
    {
      provider: "anthropic",
      id: "claude-sonnet-4-6",
      tier: "balanced",
    },
  ]);
});

it("lets users allow an unknown direct-provider model with an explicit tier", () => {
  const config = loadConfig({
    allowModels: ["openai-codex/future-model"],
    tierOverrides: { "openai-codex/future-model": "long" },
  });
  expect(config.models).toEqual([
    { provider: "openai-codex", id: "future-model", tier: "long" },
  ]);
});

it("applies blacklist after whitelist and tier overrides", () => {
  const config = loadConfig({
    allowModels: ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-6"],
    blockModels: ["anthropic/claude-haiku-4-5"],
    tierOverrides: { "anthropic/claude-sonnet-4-6": "strong" },
  });
  expect(config.models).toEqual([
    {
      provider: "anthropic",
      id: "claude-sonnet-4-6",
      tier: "strong",
    },
  ]);
});

it("does not let tier overrides widen a legacy explicit model list", () => {
  const config = loadConfig({
    models: [{ provider: "anthropic", id: "legacy-only", tier: "strong" }],
    tierOverrides: { "openai/future-model": "fast" },
  });
  expect(config.models).toEqual([
    { provider: "anthropic", id: "legacy-only", tier: "strong" },
  ]);
});

it("does not let a tier override add a model without explicit whitelisting", () => {
  const config = loadConfig({
    tierOverrides: { "openai/future-model": "fast" },
  });
  expect(config.models).not.toContainEqual({
    provider: "openai",
    id: "future-model",
    tier: "fast",
  });
});

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
