import { randomUUID } from "node:crypto";
import { mkdir, open, chmod } from "node:fs/promises";
import { join } from "node:path";

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  reasoning?: number;
}
export interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  tiers?: (Omit<Rates, "tiers" | "cacheWrite1h"> & {
    inputTokensAbove: number;
  })[];
}
export interface EventBase {
  schemaVersion: 1;
  eventId: string;
  type: "provider_response" | "router_call" | "request_settled";
  sessionId: string;
  requestId: string;
  timestamp: string;
  estimatedCostUsd: number;
}
export type UsageEvent = EventBase & {
  provider?: string;
  model?: string;
  tier?: string;
  confidence?: string;
  reasonCode?: string;
  usage?: Usage;
  pricing?: Rates;
  latencyMs?: number;
  stopReason?: string;
  responses?: number;
};
export function safeIdentifier(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : "redacted";
}
export function estimateCost(usage: Usage, rates: Rates): number {
  const hour = Math.min(usage.cacheWrite1h ?? 0, usage.cacheWrite);
  const totalInput = usage.input + usage.cacheRead + usage.cacheWrite;
  const chosen =
    [...(rates.tiers ?? [])]
      .filter((tier) => totalInput > tier.inputTokensAbove)
      .sort((a, b) => b.inputTokensAbove - a.inputTokensAbove)[0] ?? rates;
  const explicitOneHourRate = (chosen as Rates).cacheWrite1h;
  const cacheWrite1hRate =
    typeof explicitOneHourRate === "number"
      ? explicitOneHourRate
      : chosen.input * 2;
  return (
    (usage.input * chosen.input +
      usage.output * chosen.output +
      usage.cacheRead * chosen.cacheRead +
      (usage.cacheWrite - hour) * chosen.cacheWrite +
      hour * cacheWrite1hRate) /
    1e6
  );
}
export function responseRecord(
  message: {
    provider: string;
    model: string;
    role?: string;
    content?: unknown;
    usage?: Usage;
    stopReason?: string;
    timestamp?: number;
  },
  meta: {
    sessionId: string;
    requestId: string;
    tier: string;
    confidence: string;
    reasonCode: string;
    pricing?: Rates;
    latencyMs?: number;
  },
): UsageEvent {
  const usage = message.usage && {
    input: message.usage.input,
    output: message.usage.output,
    cacheRead: message.usage.cacheRead,
    cacheWrite: message.usage.cacheWrite,
    ...(message.usage.cacheWrite1h !== undefined
      ? { cacheWrite1h: message.usage.cacheWrite1h }
      : {}),
    ...(message.usage.reasoning !== undefined
      ? { reasoning: message.usage.reasoning }
      : {}),
  };
  return {
    schemaVersion: 1,
    eventId: randomUUID(),
    type: "provider_response",
    sessionId: meta.sessionId,
    requestId: meta.requestId,
    timestamp: new Date(message.timestamp ?? Date.now()).toISOString(),
    provider: safeIdentifier(message.provider),
    model: safeIdentifier(message.model),
    tier: meta.tier,
    confidence: meta.confidence,
    reasonCode: meta.reasonCode,
    ...(usage ? { usage } : {}),
    ...(meta.pricing ? { pricing: meta.pricing } : {}),
    estimatedCostUsd:
      usage && meta.pricing ? estimateCost(usage, meta.pricing) : 0,
    ...(meta.latencyMs !== undefined ? { latencyMs: meta.latencyMs } : {}),
    ...(message.stopReason ? { stopReason: message.stopReason } : {}),
  };
}
export class UsageStore {
  constructor(
    private readonly root: string,
    private readonly sessionId: string,
  ) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionId) ||
      sessionId.includes("..")
    )
      throw new Error("Invalid session ID");
  }
  async append(event: UsageEvent): Promise<void> {
    const month = event.timestamp.slice(0, 7);
    const usageDir = join(this.root, "usage");
    const monthDir = join(usageDir, month);
    await mkdir(monthDir, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
    await chmod(usageDir, 0o700);
    await chmod(monthDir, 0o700);
    const path = join(monthDir, `${this.sessionId}.jsonl`);
    const file = await open(path, "a", 0o600);
    try {
      await file.chmod(0o600);
      await file.writeFile(`${JSON.stringify(event)}\n`);
    } finally {
      await file.close();
    }
  }
}
