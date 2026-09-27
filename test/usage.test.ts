import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageStore, estimateCost, responseRecord } from "../src/usage.js";

describe("usage", () => {
  it("prices cache rates and does not double count reasoning", () => {
    expect(
      estimateCost(
        { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 1 },
        { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
      ),
    ).toBe((1 + 4 + 9 + 16) / 1e6);
  });
  it("applies request-wide pricing tiers to all token categories", () => {
    expect(
      estimateCost(
        { input: 2, output: 3, cacheRead: 2, cacheWrite: 1 },
        {
          input: 1,
          output: 1,
          cacheRead: 1,
          cacheWrite: 1,
          tiers: [
            {
              inputTokensAbove: 4,
              input: 2,
              output: 3,
              cacheRead: 4,
              cacheWrite: 5,
            },
          ],
        },
      ),
    ).toBe((4 + 9 + 8 + 5) / 1e6);
  });
  it("prices one-hour cache writes at twice the selected input rate", () => {
    expect(
      estimateCost(
        {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 3,
          cacheWrite1h: 2,
        },
        {
          input: 1,
          output: 1,
          cacheRead: 0.1,
          cacheWrite: 1.25,
          tiers: [
            {
              inputTokensAbove: 2,
              input: 2,
              output: 3,
              cacheRead: 0.2,
              cacheWrite: 2.5,
            },
          ],
        },
      ),
    ).toBe((1 * 2.5 + 2 * 4) / 1e6);
  });
  it("records only allowlisted fields, including with hostile content", () => {
    const record = responseRecord(
      {
        role: "assistant",
        content: [{ type: "text", text: "SECRET_PROMPT" }],
        provider: "anthropic",
        model: "m",
        usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        stopReason: "stop",
        timestamp: 1,
      },
      {
        sessionId: "s",
        requestId: "r",
        tier: "fast",
        confidence: "high",
        reasonCode: "simple",
      },
    );
    expect(JSON.stringify(record)).not.toContain("SECRET_PROMPT");
    expect(record.usage?.output).toBe(2);
  });
  it("redacts path-like provider and model identifiers", () => {
    const record = responseRecord(
      {
        provider: "/private/project",
        model: "/home/user/secret",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        sessionId: "s",
        requestId: "r",
        tier: "fast",
        confidence: "high",
        reasonCode: "simple",
      },
    );
    expect(JSON.stringify(record)).not.toContain("/home/user");
    expect(record.model).toBe("redacted");
  });
  it("appends private JSONL beneath monthly session file", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-coder-test-"));
    const store = new UsageStore(root, "session");
    await store.append({
      schemaVersion: 1,
      eventId: "a",
      type: "request_settled",
      sessionId: "session",
      requestId: "r",
      timestamp: "2026-09-26T00:00:00.000Z",
      estimatedCostUsd: 0,
    });
    const path = join(root, "usage", "2026-09", "session.jsonl");
    expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(1);
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(join(root, "usage"))).mode & 0o777).toBe(0o700);
    }
  });
  it("rejects path-like session IDs for the file name", () => {
    expect(() => new UsageStore("/tmp", "../escape")).toThrow();
  });
  it("restricts an existing state root before writing", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "pi-coder-root-"));
    await chmod(root, 0o755);
    await new UsageStore(root, "session").append({
      schemaVersion: 1,
      eventId: "a",
      type: "request_settled",
      sessionId: "session",
      requestId: "r",
      timestamp: "2026-09-26T00:00:00.000Z",
      estimatedCostUsd: 0,
    });
    expect((await stat(root)).mode & 0o777).toBe(0o700);
  });
});
