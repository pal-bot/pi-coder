import { parseDecision, type Proposal, type Tier } from "./policy.js";
import type { Rates, Usage } from "./usage.js";

export interface RoutingRequest {
  prompt: string;
  contextBand: "small" | "medium" | "large";
  hasImage: boolean;
  currentTier: Tier;
  highRisk: boolean;
}
export interface RouterReply {
  decision: unknown;
  usage?: Usage;
  provider?: string;
  model?: string;
  pricing?: Rates;
  stopReason?: string;
  latencyMs?: number;
}
export interface RoutingResult extends Omit<RouterReply, "decision"> {
  decision: Proposal | null;
}
export interface RoutingEngine {
  route(request: RoutingRequest): Promise<RoutingResult>;
}
export type RouterAdapter = (request: RoutingRequest) => Promise<RouterReply>;
export class LlmRoutingEngine implements RoutingEngine {
  constructor(private readonly adapter: RouterAdapter) {}
  async route(request: RoutingRequest): Promise<RoutingResult> {
    const reply = await this.adapter(request);
    return { ...reply, decision: parseDecision(reply.decision) };
  }
}
