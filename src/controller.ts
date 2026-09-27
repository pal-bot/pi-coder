import { randomUUID } from "node:crypto";
import {
  decide,
  type Choice,
  type ModelChoice,
  type PolicyInput,
  type Tier,
} from "./policy.js";
import type { RoutingEngine, RoutingResult } from "./router.js";

export interface StartContext<T extends ModelChoice>
  extends Omit<
    PolicyInput<T>,
    "approvedProviders" | "proposal" | "overrideTier"
  > {}
export class RouteController<T extends ModelChoice> {
  private mode: "auto" | "off" | "tier" = "auto";
  private tier?: Tier;
  private manual?: T;
  private selected?: Choice<T>;
  private routerResult?: RoutingResult;
  private requestId?: string;
  constructor(private readonly engine: RoutingEngine) {}
  setAuto() {
    this.mode = "auto";
    this.tier = undefined;
    this.manual = undefined;
  }
  setOff() {
    this.mode = "off";
    this.tier = undefined;
  }
  setTier(tier: Tier) {
    this.mode = "tier";
    this.tier = tier;
    this.manual = undefined;
  }
  setManualModel(model: T) {
    this.manual = model;
  }
  status() {
    return {
      mode: this.mode,
      tier: this.tier,
      selected: this.selected,
      manual: this.manual,
    };
  }
  active() {
    return this.selected;
  }
  activationFailed(model?: T) {
    this.selected = model
      ? {
          model,
          tier: model.tier,
          confidence: "high",
          reasonCode: "activation_failed",
        }
      : undefined;
  }
  lastRouterResult() {
    return this.routerResult;
  }
  activeRequestId() {
    return this.requestId;
  }
  async start(prompt: string, context: StartContext<T>): Promise<Choice<T>> {
    this.requestId = randomUUID();
    this.routerResult = undefined;
    const allowed = ["anthropic", "openai", "openai-codex"];
    if (this.mode === "off" || this.manual) {
      const model = this.manual ?? context.current;
      if (!model) throw new Error("No current model");
      this.selected = {
        model,
        tier: model.tier,
        confidence: "high",
        reasonCode: this.manual ? "manual_model" : "routing_off",
      };
      return this.selected;
    }
    if (this.mode === "auto") {
      try {
        this.routerResult = await this.engine.route({
          prompt,
          contextBand:
            context.contextTokens < 20000
              ? "small"
              : context.contextTokens < 80000
                ? "medium"
                : "large",
          hasImage: context.needsImage,
          currentTier: context.current?.tier ?? "balanced",
          highRisk: context.highRisk,
        });
      } catch {
        this.routerResult = undefined;
      }
    }
    this.selected = decide({
      ...context,
      approvedProviders: allowed,
      overrideTier: this.tier,
      proposal: this.routerResult?.decision,
    });
    return this.selected;
  }
  settled() {
    this.selected = undefined;
    this.requestId = undefined;
    this.routerResult = undefined;
  }
}
