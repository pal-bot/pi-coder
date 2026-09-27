import { describe, expect, it } from "vitest";
import { LlmRoutingEngine } from "../src/router.js";

describe("LLM router", () => {
  it("sends only latest prompt and coarse metadata through a tool call", async () => {
    let sent: unknown;
    const engine = new LlmRoutingEngine(async (request) => {
      sent = request;
      return {
        decision: { tier: "fast", confidence: "high", reasonCode: "simple" },
        usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 },
        provider: "openai",
        model: "router",
        stopReason: "toolUse",
      };
    });
    expect(
      (
        await engine.route({
          prompt: "latest",
          contextBand: "small",
          hasImage: false,
          currentTier: "balanced",
          highRisk: false,
        })
      ).decision?.tier,
    ).toBe("fast");
    expect(JSON.stringify(sent)).toContain("latest");
    expect(JSON.stringify(sent)).not.toContain("transcript");
  });
  it("rejects invalid tool arguments", async () => {
    const engine = new LlmRoutingEngine(async () => ({
      decision: { tier: "unknown", confidence: "high", reasonCode: "simple" },
    }));
    expect(
      (
        await engine.route({
          prompt: "x",
          contextBand: "small",
          hasImage: false,
          currentTier: "balanced",
          highRisk: false,
        })
      ).decision,
    ).toBeNull();
  });
});
