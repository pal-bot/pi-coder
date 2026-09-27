export type Tier = "fast" | "balanced" | "strong" | "long";
export type Confidence = "low" | "medium" | "high";
export type ReasonCode =
  | "simple"
  | "routine"
  | "complex"
  | "long_context"
  | "uncertain";
export interface Proposal {
  tier: Tier;
  confidence: Confidence;
  reasonCode: ReasonCode;
}
export interface ModelChoice {
  provider: string;
  id: string;
  tier: Tier;
  contextWindow: number;
  input: readonly string[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}
export interface PolicyInput<T extends ModelChoice> {
  models: readonly T[];
  current?: T;
  approvedProviders: readonly string[];
  available: readonly string[];
  contextTokens: number;
  needsImage: boolean;
  highRisk: boolean;
  overrideTier?: Tier;
  proposal?: Proposal | null;
}
export interface Choice<T extends ModelChoice> {
  model: T;
  tier: Tier;
  confidence: Confidence;
  reasonCode: string;
}
const tiers: Tier[] = ["fast", "balanced", "strong", "long"];
const confidence: Confidence[] = ["low", "medium", "high"];
const reasons: ReasonCode[] = [
  "simple",
  "routine",
  "complex",
  "long_context",
  "uncertain",
];
export function parseDecision(value: unknown): Proposal | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== "confidence,reasonCode,tier")
    return null;
  if (
    !tiers.includes(v.tier as Tier) ||
    !confidence.includes(v.confidence as Confidence) ||
    !reasons.includes(v.reasonCode as ReasonCode)
  )
    return null;
  return v as unknown as Proposal;
}
export function decide<T extends ModelChoice>(
  input: PolicyInput<T>,
): Choice<T> {
  const eligible = input.models.filter(
    (m) =>
      input.approvedProviders.includes(m.provider) &&
      input.available.includes(`${m.provider}/${m.id}`) &&
      m.contextWindow >= input.contextTokens + 8192 &&
      (!input.needsImage || m.input.includes("image")),
  );
  if (!eligible.length)
    throw new Error(
      "No approved authenticated model satisfies request constraints",
    );
  const current = eligible.find(
    (m) =>
      input.current &&
      m.provider === input.current.provider &&
      m.id === input.current.id,
  );
  const fallback =
    current ?? eligible.find((m) => m.tier === "balanced") ?? eligible[0];
  const desiredTier = input.overrideTier ?? input.proposal?.tier;
  if (!desiredTier)
    return {
      model: fallback,
      tier: fallback.tier,
      confidence: "low",
      reasonCode: "router_failure",
    };
  let floor = input.highRisk && !input.overrideTier ? 2 : 0;
  if (
    !input.overrideTier &&
    input.proposal?.confidence === "low" &&
    input.current
  )
    floor = Math.max(floor, tiers.indexOf(input.current.tier));
  const target = Math.max(floor, tiers.indexOf(desiredTier));
  const candidates = eligible
    .filter((m) => tiers.indexOf(m.tier) >= target)
    .sort(
      (a, b) =>
        tiers.indexOf(a.tier) - tiers.indexOf(b.tier) ||
        a.cost.input + a.cost.output - b.cost.input - b.cost.output,
    );
  if (!candidates.length)
    throw new Error("No eligible model satisfies tier floor");
  let model = candidates[0];
  if (
    !input.overrideTier &&
    current &&
    model.id !== current.id &&
    model.provider !== current.provider &&
    input.contextTokens >= 20000 &&
    tiers.indexOf(model.tier) <= tiers.indexOf(current.tier)
  )
    model = current;
  if (
    !input.overrideTier &&
    current &&
    model.id !== current.id &&
    input.contextTokens >= 50000 &&
    tiers.indexOf(model.tier) < tiers.indexOf(current.tier)
  )
    model = current;
  return {
    model,
    tier: model.tier,
    confidence: input.overrideTier
      ? "high"
      : (input.proposal?.confidence ?? "low"),
    reasonCode: input.overrideTier
      ? "manual_tier"
      : model === current && model.tier !== desiredTier
        ? "policy_hold"
        : (input.proposal?.reasonCode ?? "router_failure"),
  };
}
