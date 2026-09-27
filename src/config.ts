import type { ModelChoice, Tier } from "./policy.js";

export interface ModelSpec {
  provider: "anthropic" | "openai" | "openai-codex";
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
const tierSet = new Set(["fast", "balanced", "strong", "long"]);
export function loadConfig(value: unknown): Config {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as Config).models)
  )
    throw new Error("config.models must be an array");
  const raw = value as { models: unknown[]; routerModel?: unknown };
  const models: ModelSpec[] = [];
  for (const entry of raw.models) {
    if (!entry || typeof entry !== "object") continue;
    const m = entry as Record<string, unknown>;
    if (
      (m.provider !== "anthropic" &&
        m.provider !== "openai" &&
        m.provider !== "openai-codex") ||
      typeof m.id !== "string" ||
      !m.id ||
      !tierSet.has(m.tier as string)
    )
      continue;
    models.push({ provider: m.provider, id: m.id, tier: m.tier as Tier });
  }
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
