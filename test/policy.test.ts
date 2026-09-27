import { describe, expect, it } from "vitest";
import { decide, parseDecision } from "../src/policy.js";

const models = [
  {
    provider: "anthropic",
    id: "fast",
    tier: "fast",
    contextWindow: 100000,
    input: ["text"],
    cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1.2 },
  },
  {
    provider: "openai",
    id: "balanced",
    tier: "balanced",
    contextWindow: 200000,
    input: ["text", "image"],
    cost: { input: 2, output: 2, cacheRead: 0.2, cacheWrite: 2.4 },
  },
  {
    provider: "anthropic",
    id: "strong",
    tier: "strong",
    contextWindow: 200000,
    input: ["text", "image"],
    cost: { input: 3, output: 3, cacheRead: 0.3, cacheWrite: 3.6 },
  },
] as const;

describe("closed router output", () => {
  it("accepts only the exact bounded shape", () => {
    expect(
      parseDecision({ tier: "fast", confidence: "high", reasonCode: "simple" }),
    ).toEqual({ tier: "fast", confidence: "high", reasonCode: "simple" });
    expect(
      parseDecision(
        '{"tier":"fast","confidence":"high","reasonCode":"simple"}',
      ),
    ).toBeNull();
    expect(
      parseDecision({
        tier: "fast",
        confidence: "high",
        reasonCode: "simple",
        prompt: "secret",
      }),
    ).toBeNull();
    expect(
      parseDecision({
        tier: "cheapest",
        confidence: "high",
        reasonCode: "simple",
      }),
    ).toBeNull();
  });
});

describe("policy", () => {
  const base = {
    models,
    current: models[1],
    approvedProviders: ["anthropic", "openai"],
    available: models.map((m) => `${m.provider}/${m.id}`),
    contextTokens: 1000,
    needsImage: false,
    highRisk: false,
  };
  it("honors manual tier over the router", () =>
    expect(
      decide({
        ...base,
        overrideTier: "strong",
        proposal: { tier: "fast", confidence: "high", reasonCode: "simple" },
      }).model.id,
    ).toBe("strong"));
  it("lets an explicit manual tier override the high-risk floor", () =>
    expect(
      decide({
        ...base,
        highRisk: true,
        overrideTier: "fast",
        proposal: { tier: "strong", confidence: "high", reasonCode: "complex" },
      }).model.id,
    ).toBe("fast"));
  it("filters providers, auth, image, and context", () => {
    const result = decide({
      ...base,
      approvedProviders: ["openai"],
      available: ["openai/balanced"],
      needsImage: true,
      contextTokens: 120000,
      proposal: { tier: "fast", confidence: "high", reasonCode: "simple" },
    });
    expect(result.model.id).toBe("balanced");
  });
  it("enforces a high-risk floor and low-confidence no-downgrade", () => {
    expect(
      decide({
        ...base,
        highRisk: true,
        proposal: { tier: "fast", confidence: "high", reasonCode: "simple" },
      }).model.id,
    ).toBe("strong");
    expect(
      decide({
        ...base,
        proposal: { tier: "fast", confidence: "low", reasonCode: "simple" },
      }).model.id,
    ).toBe("balanced");
  });
  it("refuses to route high-risk work below the tier floor", () => {
    expect(() =>
      decide({
        ...base,
        models: models.slice(0, 2),
        highRisk: true,
        proposal: { tier: "fast", confidence: "high", reasonCode: "simple" },
      }),
    ).toThrow();
  });
  it("does not downgrade on low confidence when the current model is outside candidate constraints", () => {
    expect(() =>
      decide({
        ...base,
        current: models[2],
        available: ["anthropic/fast", "openai/balanced"],
        proposal: { tier: "fast", confidence: "low", reasonCode: "uncertain" },
      }),
    ).toThrow();
  });
  it("keeps current on router failure and large-context switching", () => {
    expect(decide({ ...base }).model.id).toBe("balanced");
    expect(
      decide({
        ...base,
        contextTokens: 70000,
        proposal: { tier: "fast", confidence: "high", reasonCode: "simple" },
      }).model.id,
    ).toBe("balanced");
  });
});
