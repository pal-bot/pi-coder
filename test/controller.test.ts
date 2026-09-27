import { describe, expect, it } from "vitest";
import { RouteController } from "../src/controller.js";

const models = [
  {
    provider: "anthropic",
    id: "a",
    tier: "fast" as const,
    contextWindow: 100000,
    input: ["text"],
    cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
  },
  {
    provider: "openai",
    id: "b",
    tier: "balanced" as const,
    contextWindow: 100000,
    input: ["text"],
    cost: { input: 2, output: 2, cacheRead: 2, cacheWrite: 2 },
  },
];
const context = {
  models,
  available: ["anthropic/a", "openai/b"],
  current: models[1],
  contextTokens: 100,
  needsImage: false,
  highRisk: false,
};
describe("request controller", () => {
  it("routes once per fresh request, sticks through tool loops, then routes again", async () => {
    let calls = 0;
    const controller = new RouteController({
      route: async () => {
        calls++;
        return {
          decision: { tier: "fast", confidence: "high", reasonCode: "simple" },
        };
      },
    });
    const first = await controller.start("prompt", context);
    expect(first.model.id).toBe("a");
    expect(controller.active()?.model.id).toBe("a");
    expect(calls).toBe(1);
    controller.settled();
    await controller.start("next", context);
    expect(calls).toBe(2);
  });
  it("manual override beats router, and failure keeps current", async () => {
    const controller = new RouteController({
      route: async () => {
        throw new Error("offline");
      },
    });
    expect((await controller.start("x", context)).model.id).toBe("b");
    controller.settled();
    controller.setTier("fast");
    expect((await controller.start("x", context)).model.id).toBe("a");
  });
});
