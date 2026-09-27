import { expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@earendil-works/pi-ai", () => ({
  Type: {
    Object: (x: unknown) => x,
    Union: (x: unknown) => x,
    Literal: (x: unknown) => x,
  },
}));
type Handler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;

it("registers one pre-loop route hook and a settled usage hook", async () => {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, Handler>();
  const pi = {
    on: (name: string, handler: Handler) => {
      handlers.set(name, handler);
      return () => {};
    },
    registerCommand: (name: string, options: { handler: Handler }) =>
      commands.set(name, options.handler),
  };
  const extension = (await import("../src/extension.js")).default;
  extension(pi as never);
  expect(handlers.has("before_agent_start")).toBe(true);
  expect(handlers.has("message_end")).toBe(true);
  expect(handlers.has("agent_settled")).toBe(true);
  expect(commands.has("route")).toBe(true);
});

it("routes through Pi auth with only the latest prompt and records settled usage", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-coder-extension-"));
  const oldConfig = process.env.XDG_CONFIG_HOME;
  const oldState = process.env.XDG_STATE_HOME;
  process.env.XDG_CONFIG_HOME = root;
  process.env.XDG_STATE_HOME = root;
  try {
    await mkdir(join(root, "pi-coder"));
    await writeFile(
      join(root, "pi-coder", "config.json"),
      JSON.stringify({
        models: [
          { provider: "openai", id: "route", tier: "fast" },
          { provider: "anthropic", id: "work", tier: "balanced" },
        ],
      }),
    );
    const handlers = new Map<string, Handler>();
    const chosen: string[] = [];
    let activationSucceeds = true;
    const pi = {
      on: (name: string, handler: Handler) => {
        handlers.set(name, handler);
        return () => {};
      },
      registerCommand: () => {},
      setModel: async (m: { id: string }) => {
        chosen.push(m.id);
        return activationSucceeds;
      },
      setThinkingLevel: () => {},
    };
    const model = (provider: string, id: string, input: number) => ({
      provider,
      id,
      api: provider === "openai" ? "openai-responses" : "anthropic-messages",
      baseUrl:
        provider === "openai"
          ? "https://api.openai.com/v1"
          : "https://api.anthropic.com",
      contextWindow: 100000,
      input: ["text"],
      cost: { input, output: input, cacheRead: input, cacheWrite: input },
      reasoning: true,
    });
    const router = model("openai", "route", 1);
    const worker = model("anthropic", "work", 2);
    let auxiliary: unknown;
    const ctx = {
      model: worker,
      scopedModels: [],
      modelRegistry: {
        getAvailable: () => [router, worker],
        hasConfiguredAuth: () => true,
        getApiKeyAndHeaders: async () => ({ ok: true }),
        find: (p: string, id: string) =>
          [router, worker].find((m) => m.provider === p && m.id === id),
        streamSimple: (_m: unknown, context: unknown) => {
          auxiliary = context;
          return {
            result: async () => ({
              content: [
                {
                  type: "toolCall",
                  name: "select_route",
                  arguments: {
                    tier: "fast",
                    confidence: "high",
                    reasonCode: "simple",
                  },
                },
              ],
              usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 },
              provider: "openai",
              model: "route",
              stopReason: "toolUse",
            }),
          };
        },
      },
      sessionManager: { getSessionId: () => "session-id" },
      getContextUsage: () => ({
        tokens: 100,
        contextWindow: 100000,
        percent: 0.1,
      }),
      ui: { notify: () => {} },
    };
    const extension = (await import("../src/extension.js")).default;
    extension(pi as never);
    await handlers.get("before_agent_start")?.(
      { prompt: "LATEST_PROMPT", images: [] },
      ctx,
    );
    expect(JSON.stringify(auxiliary)).toContain("LATEST_PROMPT");
    expect(JSON.stringify(auxiliary)).not.toContain("OLD_TRANSCRIPT");
    expect(chosen).toEqual(["route"]);
    await handlers.get("message_end")?.(
      {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "PRIVATE_ANSWER" }],
          provider: "openai",
          model: "route",
          usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 },
          stopReason: "stop",
          timestamp: Date.now(),
        },
      },
      ctx,
    );
    await handlers.get("agent_settled")?.({}, ctx);
    const records = (
      await readFile(
        join(
          root,
          "pi-coder",
          "usage",
          new Date().toISOString().slice(0, 7),
          "session-id.jsonl",
        ),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.map((r) => r.type)).toEqual([
      "router_call",
      "provider_response",
      "request_settled",
    ]);
    expect(records[2].usage).toMatchObject({
      input: 110,
      output: 12,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(records[2].latencyMs).toBeTypeOf("number");
    expect(JSON.stringify(records)).not.toContain("PRIVATE_ANSWER");

    activationSucceeds = false;
    ctx.model = worker;
    await handlers.get("before_agent_start")?.(
      { prompt: "SECOND_PROMPT", images: [] },
      ctx,
    );
    await handlers.get("message_end")?.(
      {
        message: {
          role: "assistant",
          content: [],
          provider: "anthropic",
          model: "work",
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
          stopReason: "stop",
          timestamp: Date.now(),
        },
      },
      ctx,
    );
    await handlers.get("agent_settled")?.({}, ctx);
    const afterFailure = (
      await readFile(
        join(
          root,
          "pi-coder",
          "usage",
          new Date().toISOString().slice(0, 7),
          "session-id.jsonl",
        ),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const failedResponse = afterFailure.filter(
      (record) => record.type === "provider_response",
    )[1];
    expect(failedResponse).toMatchObject({
      provider: "anthropic",
      model: "work",
      tier: "balanced",
      reasonCode: "activation_failed",
    });
  } finally {
    if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = oldConfig;
    if (oldState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = oldState;
  }
});

it("records usage when routing has no configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-coder-empty-"));
  const oldConfig = process.env.XDG_CONFIG_HOME;
  const oldState = process.env.XDG_STATE_HOME;
  process.env.XDG_CONFIG_HOME = root;
  process.env.XDG_STATE_HOME = root;
  try {
    const handlers = new Map<string, Handler>();
    const pi = {
      on: (name: string, handler: Handler) => {
        handlers.set(name, handler);
        return () => {};
      },
      registerCommand: () => {},
      setModel: async () => true,
      setThinkingLevel: () => {},
    };
    const ctx = {
      model: { provider: "openai", id: "m" },
      scopedModels: [],
      modelRegistry: {
        getAvailable: () => [],
        hasConfiguredAuth: () => true,
        getApiKeyAndHeaders: async () => ({ ok: true }),
        find: () => undefined,
      },
      sessionManager: { getSessionId: () => "unconfigured-session" },
      getContextUsage: () => undefined,
      ui: { notify: () => {} },
    };
    (await import("../src/extension.js")).default(pi as never);
    await handlers.get("model_select")?.(
      {
        type: "model_select",
        model: {
          provider: "openai",
          id: "m",
          contextWindow: 100000,
          input: ["text"],
          cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
        },
        source: "set",
      },
      ctx,
    );
    await handlers.get("before_agent_start")?.(
      { prompt: "hello", images: [] },
      ctx,
    );
    await handlers.get("message_end")?.(
      {
        message: {
          role: "assistant",
          content: [],
          provider: "openai",
          model: "m",
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
          stopReason: "stop",
          timestamp: Date.now(),
        },
      },
      ctx,
    );
    await handlers.get("agent_settled")?.({}, ctx);
    const records = (
      await readFile(
        join(
          root,
          "pi-coder",
          "usage",
          new Date().toISOString().slice(0, 7),
          "unconfigured-session.jsonl",
        ),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.map((r) => r.type)).toEqual([
      "provider_response",
      "request_settled",
    ]);
    expect(records[0]).toMatchObject({
      tier: "balanced",
      confidence: "high",
      reasonCode: "manual_model",
    });
  } finally {
    if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = oldConfig;
    if (oldState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = oldState;
  }
});
