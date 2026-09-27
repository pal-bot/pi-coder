import { readFileSync } from "node:fs";
import type { ModelChoice, Tier } from "./policy.js";

export type ApprovedProvider = "anthropic" | "openai" | "openai-codex";
export interface ModelSpec {
  provider: ApprovedProvider;
  id: string;
  tier: Tier;
}
export interface Config {
  models: ModelSpec[];
  routerModel?: string;
}
export interface PiModelLike extends Omit<ModelChoice, "tier"> {
  baseUrl: string;
}

const tierSet = new Set<Tier>(["fast", "balanced", "strong", "long"]);
const providerSet = new Set<ApprovedProvider>([
  "anthropic",
  "openai",
  "openai-codex",
]);

function parseModelSpec(value: unknown): ModelSpec | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const model = value as Record<string, unknown>;
  if (
    !providerSet.has(model.provider as ApprovedProvider) ||
    typeof model.id !== "string" ||
    !model.id ||
    !tierSet.has(model.tier as Tier)
  )
    return;
  return {
    provider: model.provider as ApprovedProvider,
    id: model.id,
    tier: model.tier as Tier,
  };
}

function parseModelKey(key: string): Omit<ModelSpec, "tier"> | undefined {
  const slash = key.indexOf("/");
  if (slash <= 0 || slash === key.length - 1) return;
  const provider = key.slice(0, slash) as ApprovedProvider;
  const id = key.slice(slash + 1);
  if (!providerSet.has(provider) || id.includes("/")) return;
  return { provider, id };
}

function modelKey(model: Pick<ModelSpec, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

const defaultPolicyValue = JSON.parse(
  readFileSync(
    new URL("../config/default-model-policy.json", import.meta.url),
    "utf8",
  ),
) as unknown;
if (!Array.isArray(defaultPolicyValue))
  throw new Error("default model policy must be an array");
export const DEFAULT_MODEL_POLICY: readonly ModelSpec[] =
  defaultPolicyValue.flatMap((value) => {
    const spec = parseModelSpec(value);
    return spec ? [spec] : [];
  });

export function loadConfig(value: unknown): Config {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("config must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.models !== undefined && !Array.isArray(raw.models))
    throw new Error("config.models must be an array when present");
  if (raw.allowModels !== undefined && !Array.isArray(raw.allowModels))
    throw new Error("config.allowModels must be an array when present");
  if (raw.blockModels !== undefined && !Array.isArray(raw.blockModels))
    throw new Error("config.blockModels must be an array when present");
  if (
    raw.tierOverrides !== undefined &&
    (!raw.tierOverrides ||
      typeof raw.tierOverrides !== "object" ||
      Array.isArray(raw.tierOverrides))
  )
    throw new Error("config.tierOverrides must be an object when present");

  const legacyModels = Array.isArray(raw.models)
    ? raw.models.flatMap((value) => {
        const spec = parseModelSpec(value);
        return spec ? [spec] : [];
      })
    : undefined;
  const base = (legacyModels ?? DEFAULT_MODEL_POLICY).map((model) => ({
    ...model,
  }));
  const allow = Array.isArray(raw.allowModels)
    ? raw.allowModels.filter((key): key is string => typeof key === "string")
    : [];
  const byKey = new Map(base.map((model) => [modelKey(model), model]));
  const overrides = (raw.tierOverrides ?? {}) as Record<string, unknown>;
  for (const [key, tier] of Object.entries(overrides)) {
    if (!tierSet.has(tier as Tier)) continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.tier = tier as Tier;
      continue;
    }
    const parsed = parseModelKey(key);
    if (legacyModels === undefined && allow.includes(key) && parsed)
      byKey.set(key, { ...parsed, tier: tier as Tier });
  }

  const block = new Set(
    Array.isArray(raw.blockModels)
      ? raw.blockModels.filter((key): key is string => typeof key === "string")
      : [],
  );
  const candidates = allow.length
    ? allow.flatMap((key) => {
        const model = byKey.get(key);
        return model ? [model] : [];
      })
    : [...byKey.values()];
  const models = candidates.filter((model) => !block.has(modelKey(model)));

  return {
    models,
    ...(typeof raw.routerModel === "string"
      ? { routerModel: raw.routerModel }
      : {}),
  };
}

export function isDirect(model: {
  provider: string;
  baseUrl: string;
}): boolean {
  try {
    const url = new URL(model.baseUrl);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !url.port &&
      (model.provider === "anthropic"
        ? url.hostname === "api.anthropic.com" && url.pathname === "/"
        : model.provider === "openai"
          ? url.hostname === "api.openai.com" &&
            (url.pathname === "/v1" ||
              url.pathname === "/v1/" ||
              url.pathname === "/")
          : model.provider === "openai-codex" &&
            url.hostname === "chatgpt.com" &&
            (url.pathname === "/backend-api" ||
              url.pathname === "/backend-api/"))
    );
  } catch {
    return false;
  }
}
export function selectModels<T extends PiModelLike>(
  config: Config,
  catalog: readonly T[],
  available: readonly string[],
  effectiveBaseUrls: Readonly<Record<string, string>> = {},
): (T & { tier: Tier })[] {
  return config.models.flatMap((spec) => {
    const model = catalog.find(
      (m) => m.provider === spec.provider && m.id === spec.id,
    );
    return model &&
      available.includes(`${spec.provider}/${spec.id}`) &&
      isDirect({
        provider: model.provider,
        baseUrl:
          effectiveBaseUrls[`${spec.provider}/${spec.id}`] ?? model.baseUrl,
      })
      ? [{ ...model, tier: spec.tier }]
      : [];
  });
}
export function pickRouterModel<T extends PiModelLike>(
  config: Config,
  models: readonly T[],
  promptLength: number,
): T | undefined {
  const candidates = models.filter(
    (m) =>
      m.input.includes("text") &&
      m.contextWindow >= Math.ceil(promptLength / 4) + 2048,
  );
  if (config.routerModel)
    return candidates.find(
      (m) => `${m.provider}/${m.id}` === config.routerModel,
    );
  return [...candidates].sort(
    (a, b) => a.cost.input + a.cost.output - b.cost.input - b.cost.output,
  )[0];
}
