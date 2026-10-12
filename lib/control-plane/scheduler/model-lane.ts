import type { ResearchIntent, ResearchIntentRequest } from "./research-policy.ts";

/**
 * Why the research cycle's model lane is closed, or null when it is open. The first reason that holds wins.
 * An owner control that cannot be read closes the lane as if paused.
 */
import { ModelTransportError, type AnthropicRateLimits, type ModelRequest, type ModelTransport } from "./scout-executor.ts";

export interface ModelLaneFacts {
  /** The standing hunter lane admits paid work, so this round does not. Read last: a pause or an unreadable control still closes the lane under its own name. */
  readonly paidWorkInHunterLane?: boolean;
  readonly dry: boolean;
  readonly noModel: boolean;
  readonly credentialConfigured: boolean;
  /** The credential's variable NAME, for the reason line. Never its value. */
  readonly credentialVar: string;
  readonly paused: boolean;
  readonly pauseIntentId: string | null;
  readonly runnerPaused: boolean;
  readonly runnerPauseIntentId: string | null;
  /**
   * Each owner spending control this cycle could not read or found malformed,
   * as a sentence. Empty when every control read cleanly.
   */
  readonly unreadableControls: readonly string[];
  /** Existing shared spend accounting could not safely admit a model request. */
  readonly spendHold?: string | null;
}

export interface ModelLaneClosure {
  readonly code: "LANE_DISABLED" | "PAUSED";
  readonly reason: string;
  /** Closed only because paid work runs in the standing hunter lane; the round queues planned work for it. */
  readonly hunterLane?: true;
}

/** The latest saved lane decision awaiting this normal cycle's acknowledgement. */
export function pendingResearchLaneAcknowledgment(
  log: readonly ResearchIntent[],
  laneClosure: ModelLaneClosure | null,
): { readonly intent: ResearchIntentRequest; readonly detail: string } | null {
  const pending = log
    .filter((r): r is ResearchIntentRequest =>
      r.kind === "INTENT" && (r.action === "PAUSE" || r.action === "RESUME"))
    .sort((a, b) => a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : 0);
  const latest = pending.at(-1);
  if (latest === undefined || log.some(r => r.kind === "HONORED" && r.honors === latest.intentId)) return null;
  return {
    intent: latest,
    detail: latest.action === "PAUSE"
      ? "model lane closed for this cycle"
      : laneClosure === null
        ? "model lane reopened"
        : `model lane reopened by the owner, but it stays closed this cycle: ${laneClosure.reason}`,
  };
}

export function modelLaneClosure(f: ModelLaneFacts): ModelLaneClosure | null {
  if (f.dry) return { code: "LANE_DISABLED", reason: "--dry: no retrieval of any kind runs, so no Scout runs" };
  if (f.noModel) return { code: "LANE_DISABLED", reason: "--no-model: the Scout lane is held closed for this diagnostic cycle" };
  if (f.paused) return { code: "PAUSED", reason: `paused by owner intent ${f.pauseIntentId ?? "(id unrecorded)"}` };
  if (f.runnerPaused) {
    return { code: "PAUSED", reason: `the owner paused the runner (intent ${f.runnerPauseIntentId ?? "(id unrecorded)"}); no paid model work runs under it` };
  }
  if (f.unreadableControls.length > 0) {
    return {
      code: "PAUSED",
      reason:
        `held closed as if paused, because an owner spending control could not be read: ${f.unreadableControls.join("; ")}. ` +
        "Plain-code work, routine publication and free discovery walks continue",
    };
  }
  if (!f.credentialConfigured) {
    return { code: "LANE_DISABLED", reason: `${f.credentialVar} is not set in this process, so no model can be invoked` };
  }
  if (f.spendHold != null) {
    return { code: "LANE_DISABLED", reason: `${f.spendHold}; paid model work waits while held and plain-code work continue` };
  }
  if (f.paidWorkInHunterLane) {
    return { code: "LANE_DISABLED", hunterLane: true, reason: "paid model work runs in the standing hunter lane (WTP_CONTINUOUS_HUNTERS=1); this round plans and queues it, and plain-code work continues" };
  }
  return null;
}

interface ProviderTurn {
  at: number;
  input: number;
  output: number;
}

/** One shared broker for the existing workers. Each model has its own provider bucket.
 * Reservation is synchronous; concurrent workers cannot spend the same minute twice.
 * Unknown limits permit one discovery request, then follow its returned capacity.
 * Waiting for capacity never expires a scout or retries a failed request.
 */
export class ModelProviderQueue {
  private readonly tiers = new Map<string, { limits: AnthropicRateLimits | null; turns: ProviderTurn[]; active: number; tail: Promise<void>; retryAt: number; failures: number }>();
  private readonly options: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    requestsPerMinute?: number;
  };
  constructor(options: ModelProviderQueue["options"] = {}) { this.options = options; }

  private tier(model: string) {
    let tier = this.tiers.get(model);
    if (!tier) {
      tier = { limits: null, turns: [], active: 0, tail: Promise.resolve(), retryAt: 0, failures: 0 };
      this.tiers.set(model, tier);
    }
    return tier;
  }

  observe(model: string, limits: AnthropicRateLimits): void {
    const tier = this.tier(model);
    const prior = tier.limits;
    tier.limits = { requestsPerMinute: limits.requestsPerMinute ?? prior?.requestsPerMinute ?? null,
      inputTokensPerMinute: limits.inputTokensPerMinute ?? prior?.inputTokensPerMinute ?? null,
      outputTokensPerMinute: limits.outputTokensPerMinute ?? prior?.outputTokensPerMinute ?? null,
      retryAfterMs: limits.retryAfterMs };
    if (limits.retryAfterMs !== null) tier.retryAt = Math.max(tier.retryAt, this.now() + limits.retryAfterMs);
    const remaining = limits.remaining;
    if (remaining) {
      const now = this.now();
      for (const [left, reset] of [[remaining.requests, remaining.requestsResetAt],
        [remaining.inputTokens, remaining.inputResetAt], [remaining.outputTokens, remaining.outputResetAt]]) {
        if (left === 0) tier.retryAt = Math.max(tier.retryAt, reset ?? now + 60_000);
      }
    }
  }

  limits(model: string): AnthropicRateLimits | null { return this.tier(model).limits; }
  private now() { return (this.options.now ?? Date.now)(); }
  private sleep(ms: number) { return (this.options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms))))(ms); }

  transport(transport: ModelTransport): ModelTransport {
    return async (request: ModelRequest) => {
      const tier = this.tier(request.model);
      // UTF-8 bytes reserve conservatively before provider usage refunds unused tokens.
      const turn: ProviderTurn = { at: 0, input: Buffer.byteLength(JSON.stringify(request)), output: request.max_tokens };
      const admission = tier.tail.then(async () => {
        for (;;) {
          const now = this.now();
          tier.turns = tier.turns.filter(previous => previous.at + 60_000 > now);
          const limits = tier.limits;
          const requests = limits?.requestsPerMinute ?? this.options.requestsPerMinute;
          const input = limits?.inputTokensPerMinute;
          const output = limits?.outputTokensPerMinute;
          if ((input != null && turn.input > input) || (output != null && turn.output > output)) {
            throw new ModelTransportError("PROVIDER_REQUEST_EXCEEDS_MINUTE_TOKEN_CAPACITY: reduce this request representation or output allowance", 400);
          }
          const full = (requests != null && tier.turns.length >= requests) ||
            (input != null && tier.turns.reduce((sum, t) => sum + t.input, 0) + turn.input > input) ||
            (output != null && tier.turns.reduce((sum, t) => sum + t.output, 0) + turn.output > output);
          const unknownBusy = requests == null && tier.active > 0;
          if (!full && !unknownBusy && tier.retryAt <= now) {
            turn.at = now;
            tier.turns.push(turn);
            tier.active++;
            return;
          }
          const due = Math.max(tier.retryAt, full && tier.turns.length ? tier.turns[0].at + 60_000 : now + 100);
          await this.sleep(Math.max(1, due - now));
        }
      });
      tier.tail = admission.catch(() => undefined);
      await admission;
      try {
        const response = await transport(request);
        tier.failures = 0;
        const usage = response.usage;
        if (usage.input_tokens !== undefined && usage.cache_creation_input_tokens !== undefined) turn.input = usage.input_tokens + usage.cache_creation_input_tokens;
        if (usage.output_tokens !== undefined) turn.output = usage.output_tokens;
        return response;
      } catch (error) {
        if (error instanceof ModelTransportError && (error.status === 429 || (error.status ?? 0) >= 500 || error.status === null)) {
          tier.failures++;
          const delay = error.retryAfterMs ?? Math.min(6 * 3_600_000, 1000 * 2 ** Math.min(tier.failures, 15));
          tier.retryAt = Math.max(tier.retryAt, this.now() + delay);
        }
        throw error;
      } finally { tier.active--; }
    };
  }
}
