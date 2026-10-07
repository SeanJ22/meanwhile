/**
 * Aggregate unattended-Fleet safety.
 *
 * This is an admission controller over the existing cost ledger and scheduler;
 * it is not a second budget ledger. Historical spend comes only from the
 * canonical `costs` repository. In-cycle reservations close the race between
 * concurrent model requests until their provider-reported cost is persisted.
 */
import { costEntryModelRequestBound, costEntryWorstCaseUsd, type CostEntry } from "./cost.ts";
import type { SpendHold } from "./budget.ts";
import { canonicalModelId } from "../models.ts";
import { CACHE_RATE_MULTIPLIERS, rateFor, priceMeteredUsage, readMeteredUsage } from "./model-cost.ts";
import type { ModelRequest, ModelResponse, ModelTransport, ScoutEscalationAdmission, ScoutEscalationRequest } from "./scheduler/scout-executor.ts";
import { ModelTransportError } from "./scheduler/scout-executor.ts";
import type { OpenBytes } from "./scheduler/scout-contract.ts";
import type { OpenOne } from "./scheduler/route-executor.ts";
import { httpProviderFailure, type FetchOutcome } from "./scheduler/http-executor.ts";
import { sourceReliabilityKey } from "./scheduler/scout-reliability.ts";
import { websiteRequestLimit, type WebsiteSizeForUrl } from "./scheduler/host-supervision.ts";
import { FIRST_BACKOFF_MINUTES, MAX_BACKOFF_MINUTES } from "./scheduler/debt.ts";

export const FLEET_ZONE = "America/Phoenix";

/** Admin supplies the rolling spending limit. No cycle wall or night schedule limits work. */
export interface FleetSafetyBounds {
  readonly rolling24HourModelUsd: number;
  readonly maxDownloadBytes: number;

}

export const FLEET_SAFETY_BOUNDS = {
  // Missing Admin authority permits no paid work. The dial supplies the runtime limit.
  rolling24HourModelUsd: 0,
  maxDownloadBytes: 24 * 1024 * 1024,
} as const;

/** The largest ceiling the console control accepts: a typo guard, not a spend cap. */
export const FLEET_SPEND_CEILING_MAX_USD = 10_000;

/**
 * The rolling 24-hour model-spend ceiling in force, given the owner's override
 * (or null). A missing, non-positive or non-finite override falls back to
 * {@link FLEET_SAFETY_BOUNDS}, never "no ceiling". The runner calls this only
 * for a cleanly read row; an unreadable row holds paid work instead
 * (`adminConfigForPaidWork`).
 */
export function resolveRollingCeiling(
  overrideUsd: number | null | undefined,
): { readonly rollingCeilingUsd: number; readonly source: "OVERRIDE" | "FALLBACK"; readonly fallbackUsd: number } {
  const fallbackUsd = FLEET_SAFETY_BOUNDS.rolling24HourModelUsd;
  if (overrideUsd === null || overrideUsd === undefined || !Number.isFinite(overrideUsd) || overrideUsd <= 0) {
    return { rollingCeilingUsd: fallbackUsd, source: "FALLBACK", fallbackUsd };
  }
  return { rollingCeilingUsd: overrideUsd, source: "OVERRIDE", fallbackUsd };
}

export type FleetSafetyStatus = "ACTIVE" | "PAUSED" | "SCHEDULED BLACKOUT" | "CIRCUIT BROKEN";
export type FleetStopCode =
  | "CYCLE_MODEL_SPEND_CEILING"
  | "OPERATIONAL_NIGHT_MODEL_SPEND_CEILING"
  | "ROLLING_24_HOUR_MODEL_SPEND_CEILING"
  | "PROVIDER_REQUEST_CEILING"
  | "PAYLOAD_BYTE_CEILING"
  | "WEBSITE_REQUEST_CAP"
  | "DISPATCH_CEILING"
  | "WALL_CLOCK_CEILING"
  | "UNMEASURED_MODEL_SPEND"
  | "SCHEDULED_BLACKOUT"
  | "PROVIDER_CIRCUIT_BROKEN"
  | "OWNER_PAUSED"
  | "MODEL_LANE_CLOSED";

export interface OperationalNight {
  readonly active: boolean;
  readonly start: string;
  readonly end: string;
  /** Saturday evening owns both halves of the Saturday/Sunday blackout. */
  readonly startsOnSaturday: boolean;
}

export interface ProviderCircuit {
  readonly provider: string;
  readonly condition: string;
  readonly firstObservedAt: string;
  readonly workDeferred: readonly string[];
  readonly eligibleAt: string;
  readonly failureClass?: "HARD" | "TRANSIENT";
  readonly consecutiveFailures?: number;
  readonly lastObservedAt?: string;
}

export interface FleetNamedDeferral {
  readonly work: string;
  readonly code: string;
  readonly why: string;
}

export interface FleetSafetySnapshot {
  readonly formatVersion: 1;
  readonly status: FleetSafetyStatus;
  readonly bounds: FleetSafetyBounds;
  readonly cycle: {
    readonly startedAt: string;
    readonly modelUsd: number | null;
    readonly requests: number;
    /** Application payload bytes sent plus application payload bytes consumed. */
    readonly payloadBytes: number;
    readonly dispatches: number;
    readonly elapsedMs: number;
  };
  readonly operationalNight: OperationalNight & { readonly modelUsd: number | null };
  readonly rolling24Hours: { readonly modelUsd: number | null; readonly asOf: string; readonly worstCaseCharges?: number };
  readonly stoppedBecause: readonly string[];
  readonly deferred: readonly FleetNamedDeferral[];
  readonly providerCircuits: readonly ProviderCircuit[];
  readonly lastSuccessfulActivity: string | null;
}

/** Historical snapshot shape retained; no operational night schedule remains. */
export function operationalNightAt(nowIso: string): OperationalNight {
  return { active: false, start: nowIso, end: new Date(Date.parse(nowIso) + 15 * 60_000).toISOString(), startsOnSaturday: false };
}
export function scheduledBlackoutAt(_nowIso: string): boolean { return false; }

function amount(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Recover dollars from recorded identity and billed quantities. Missing cache
 * detail is bounded at the dearest cache-write rate, never guessed as a hit. */
function recordedModelPrice(model: string | null | undefined, cost: CostEntry["cost"]): { usd: number; measured: boolean } | null {
  if (amount(cost.usd)) return { usd: cost.usd, measured: true };
  if (!model || rateFor(canonicalModelId(model)) === null || !amount(cost.outputTokens)) return null;
  const cacheFields = [cost.uncachedInputTokens, cost.cacheReadInputTokens, cost.cacheCreationInputTokens];
  const split = [cost.cacheCreation5mInputTokens, cost.cacheCreation1hInputTokens];
  const detailed = cacheFields.every(amount) &&
    (cost.inputTokens == null || (amount(cost.inputTokens) &&
      Math.abs(cost.inputTokens - cacheFields.reduce((n, value) => n + (value ?? 0), 0)) <= 1e-9)) &&
    (split.every(value => value === null || value === undefined) ||
      (split.every(amount) && split[0]! + split[1]! === cost.cacheCreationInputTokens));
  if (!detailed && !amount(cost.inputTokens)) return null;
  const priced = priceMeteredUsage(canonicalModelId(model), detailed ? {
    uncachedInputTokens: cost.uncachedInputTokens, outputTokens: cost.outputTokens,
    cacheReadInputTokens: cost.cacheReadInputTokens, cacheCreationInputTokens: cost.cacheCreationInputTokens,
    cacheCreation5mInputTokens: cost.cacheCreation5mInputTokens ?? null,
    cacheCreation1hInputTokens: cost.cacheCreation1hInputTokens ?? null, batch: cost.batch === true,
  } : {
    uncachedInputTokens: 0, outputTokens: cost.outputTokens, cacheReadInputTokens: 0,
    cacheCreationInputTokens: cost.inputTokens, cacheCreation5mInputTokens: 0,
    cacheCreation1hInputTokens: cost.inputTokens, batch: cost.batch === true,
  }, "1h");
  // An aggregate write without a TTL split is priced at 1h as a bound.
  return priced.usd === null ? null : { usd: priced.usd, measured: detailed &&
    (cost.cacheCreationInputTokens === 0 || split.every(amount)) };
}

/** A charge no price or request bound covers is counted at its worst case, so
 * spend stays a number and the budget dial keeps control. */
function entryModelPrice(entry: CostEntry): { usd: number; knownUsd: number; measured: boolean; worstCase: boolean } {
  const price = entryModelPriceOrNull(entry);
  return price.usd === null ? { ...price, usd: Math.max(price.knownUsd, costEntryWorstCaseUsd(entry)), worstCase: true }
    : { ...price, usd: price.usd, worstCase: false };
}

function entryModelPriceOrNull(entry: CostEntry): { usd: number | null; knownUsd: number; measured: boolean } {
  if (amount(entry.cost.usd)) return { usd: entry.cost.usd, knownUsd: entry.cost.usd, measured: true };
  if (entry.byModel?.length) {
    // A split must cover the recorded aggregate quantities. A partial split
    // cannot make the missing part of an attempt free.
    const shares = entry.byModel;
    const prices = shares.map(share => recordedModelPrice(share.model, { ...entry.cost, ...share }));
    const knownUsd = prices.reduce((n, price) => n + (price?.measured ? price.usd : 0), 0);
    for (const key of ["inputTokens", "outputTokens"] as const) {
      if (amount(entry.cost[key]) && (!shares.every(share => amount(share[key])) ||
        shares.reduce((n, share) => n + share[key]!, 0) !== entry.cost[key])) {
        const bound = costEntryModelRequestBound(entry);
        return { usd: bound === null ? null : Math.max(knownUsd, bound), knownUsd, measured: false };
      }
    }
    const sum = prices.some(price => price === null) ? null : prices.reduce((n, price) => n + price!.usd, 0);
    const bound = sum === null ? costEntryModelRequestBound(entry) : null;
    return { usd: sum ?? (bound === null ? null : Math.max(knownUsd, bound)),
      knownUsd,
      measured: prices.every(price => price?.measured === true) };
  }
  const price = recordedModelPrice(entry.model ?? (entry.tier === "none" ? null : entry.tier), entry.cost);
  const bound = price === null ? costEntryModelRequestBound(entry) : null;
  return { usd: price?.usd ?? bound, knownUsd: price?.measured ? price.usd : 0, measured: price?.measured === true };
}

/** Every recorded model role/identity/usage is accounted for, including a
 * tokenless Scout. Known prices remain visible beside unbounded historical
 * charges; only exact model-backed job identities may consume a hold. */
export function aggregateModelSpend(
  costs: readonly CostEntry[],
  since: string,
  until: string,
  spendHolds: readonly SpendHold[] = [],
): { readonly usd: number; readonly knownUsd: number; readonly measured: number; readonly unmeasured: number; readonly worstCaseCharges: number } {
  let usd = 0;
  let knownUsd = 0;
  let measured = 0;
  let unmeasured = 0;
  let worstCaseCharges = 0;
  const jobs = new Map<string, { usd: number; worstCaseUsd: number }>();
  const start = Date.parse(since), end = Date.parse(until);
  for (const entry of costs) {
    // Search invoices are tracked separately; the Anthropic token budget must
    // never consume Brave/Exa charges merely because they carry a dollar value.
    if (entry.role === "DISCOVERY_SEARCH" || entry.source === "api.search.brave.com" || entry.source === "api.exa.ai") continue;
    const isModelBacked =
      entry.role === "SCOUT" ||
      !!entry.requestedModel || !!entry.servedModel || !!entry.modelRequestBound ||
      !!entry.model || (entry.tier !== undefined && entry.tier !== null && entry.tier !== "none") ||
      entry.cost.inputTokens != null ||
      entry.cost.outputTokens != null ||
        entry.source === "api.anthropic.com" ||
        entry.byModel?.some((part) => part.model.startsWith("claude-"));
    if (!isModelBacked) continue;
    const at = Date.parse(entry.recordedAt);
    if (!(at >= start && at <= end)) continue;
    const price = entryModelPrice(entry);
    const jobId = entry.spendHoldJobId ?? entry.attemptId;
    const job = jobs.get(jobId) ?? { usd: 0, worstCaseUsd: 0 };
    knownUsd += price.knownUsd;
    if (price.measured) measured += 1;
    else unmeasured += 1;
    if (price.worstCase) worstCaseCharges += 1;
    job.usd += price.usd;
    if (price.worstCase) job.worstCaseUsd += price.usd;
    jobs.set(jobId, job);
  }
  const held = new Map<string, number>();
  const worstCase = new Map<string, number>();
  const seen = new Set<string>();
  for (const hold of spendHolds) {
    const at = Date.parse(hold.heldAt);
    if (seen.has(hold.holdId) || !(at >= start && at <= end) || !amount(hold.usd)) continue;
    seen.add(hold.holdId);
    worstCase.set(hold.jobId, (worstCase.get(hold.jobId) ?? 0) + hold.usd);
    if (hold.settled === null) held.set(hold.jobId, (held.get(hold.jobId) ?? 0) + hold.usd);
  }
  for (const [id, job] of jobs) {
    // Only an exact job identity can stand in for the worst case of an
    // unpriced charge: its hold is the job's actual maximum, which is tighter.
    // Obligation-only attribution can reuse one hold for several failed
    // attempts, so it never does; the worst case then stays counted.
    const known = job.usd - job.worstCaseUsd;
    const exact = job.worstCaseUsd > 0 ? worstCase.get(id) : undefined;
    usd += exact !== undefined && exact >= known ? exact : Math.max(job.usd, held.get(id) ?? 0);
    held.delete(id);
  }
  // A hold carries no provider or model. Unmatched holds may reserve a paid
  // API/search job, so they cannot be added to Anthropic spend by inference.
  return { usd, knownUsd, measured, unmeasured, worstCaseCharges };
}

export type ProviderFailureClass = "HARD" | "TRANSIENT" | "OTHER";

export function classifyProviderFailure(error: unknown): {
  readonly class: ProviderFailureClass;
  readonly condition: string;
  readonly status: number | null;
} {
  const status =
    error instanceof ModelTransportError
      ? error.status
      : typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
        ? error.status
        : null;
  const condition = error instanceof Error ? error.message : String(error);
  const hardWords = /payment required|payment failure|quota (?:is )?exhausted|exhausted quota|transfer (?:allowance )?exhausted|billing restriction|account restriction|billing disabled|insufficient credits?/i;
  if (status === 402 || hardWords.test(condition)) return { class: "HARD", condition, status };
  if (status === 429 || (status !== null && status >= 500) || /timeout|timed out|network|econnreset|eai_again|fetch failed/i.test(condition)) {
    return { class: "TRANSIENT", condition, status };
  }
  return { class: "OTHER", condition, status };
}

export class FleetSafetyRefusal extends Error {
  readonly code: FleetStopCode;
  constructor(code: FleetStopCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "FleetSafetyRefusal";
    this.code = code;
  }
}

/** This wrapper is created only when the Fleet reservation refused before the
 * provider transport was invoked. A same-code refusal after a response (notably
 * incomplete usage) must not release a durable spend hold. */
export class FleetPreSendRefusal extends FleetSafetyRefusal {
  constructor(source: FleetSafetyRefusal) {
    super(source.code, source.message);
    this.name = "FleetPreSendRefusal";
    this.message = source.message;
  }
}

interface Reservation {
  readonly usd: number;
  readonly provider: string;
  readonly work: string;
  released: boolean;
}

interface PayloadReservation {
  /** The per-download streamed-byte limit. */
  readonly streamCapBytes: number;
  readonly work: string;
  released: boolean;
}

/**
 * The total size of the resource a `Content-Range` header describes, or null
 * when it is absent, unknown (`*`), or malformed. Used to tell a 206 that
 * delivered a whole small resource from one that returned only part of it.
 */
export function parseContentRangeTotal(header: string | null): number | null {
  if (header === null) return null;
  const match = /\/\s*(\d+)\s*$/.exec(header.trim());
  if (match === null) return null;
  const total = Number(match[1]);
  return Number.isFinite(total) ? total : null;
}

/**
 * The most one model request can cost: every UTF-8 byte of its body as an
 * input token at the cache-write rate, plus its whole `max_tokens` at the
 * output rate. Null for a model with no stated rate. Reserved against the
 * rolling ceiling and the Send and area budgets.
 */
export function modelRequestWorstCaseUsd(request: ModelRequest): number | null {
  const rate = rateFor(request.model);
  if (rate === null || !amount(request.max_tokens)) return null;
  const body = JSON.stringify(request);
  const bodyBytes = Buffer.byteLength(body);
  const writeMultiplier = body.includes('"ttl":"1h"') ? CACHE_RATE_MULTIPLIERS.cacheCreation1h : CACHE_RATE_MULTIPLIERS.cacheCreation;
  const worstInput = (bodyBytes / 1_000_000) * rate.inputUsdPerMillion * writeMultiplier;
  const worstOutput = (request.max_tokens / 1_000_000) * rate.outputUsdPerMillion;
  return worstInput + worstOutput;
}

/** What a model response cost, from its provider-reported usage; null when the usage is incomplete. */
export function modelResponseUsd(response: ModelResponse): number | null {
  return priceMeteredUsage(response.model, readMeteredUsage(response.usage, response.batch === true), "5m").usd;
}

export class FleetSafetyController {
  /**
   * The bounds this cycle runs under. `rolling24HourModelUsd` is the owner's
   * override when passed, else the fallback; assigned here so a live change
   * governs the very next reservation. Read by `reserveModelRequest` and
   * `rollingCeilingReached`.
   */
  bounds: FleetSafetyBounds;
  readonly startedAt: string;
  private readonly startedMs: number;
  private readonly historicalNightUsd: number | null;
  private readonly historicalRollingUsd: number | null;
  /** Charges in the rolling window counted at worst case because nothing priced them. */
  private readonly worstCaseCharges: number;
  private readonly night: OperationalNight;
  private readonly paused: boolean;
  private readonly modelHold: string | null;
  private readonly clock: () => number;
  private readonly deferrals: FleetNamedDeferral[] = [];
  private readonly stopReasons = new Set<string>();
  private readonly circuits = new Map<string, ProviderCircuit>();
  private readonly httpPending = new Map<string, Promise<void>>();
  private readonly websiteRequests = new Map<string, Map<string, number>>();
  private readonly websiteSize?: WebsiteSizeForUrl;
  private cycleUsd = 0;
  private cycleModelSpendMeasured = true;
  private reservedUsd = 0;
  private requests = 0;
  private bytes = 0;
  private dispatches = 0;
  private lastSuccessfulActivity: string | null;

  constructor(input: {
    readonly now: string;
    readonly costs: readonly CostEntry[];
    readonly spendHolds?: readonly SpendHold[];
    /** The owner's runner-level PAUSE_RUNNER stands. The snapshot says PAUSED, and no model request is reserved. */
    readonly paused?: boolean;
    /**
     * Why the cycle's paid model lane is closed, or null/undefined while it is
     * open. Every model request is refused with this reason: the lane already
     * builds no paid caller while closed, and this is the second lock, so a
     * caller added later cannot spend past a pause or an unreadable control.
     */
    readonly modelHold?: string | null;
    readonly circuits?: readonly ProviderCircuit[];
    readonly lastSuccessfulActivity?: string | null;
    readonly costLedgerReadable?: boolean;
    /** The owner's rolling-24h ceiling override in USD, or undefined/null for the fallback. Invalid values fall back. */
    readonly rollingCeilingUsd?: number | null;
    /** Exact work covered by a separately reserved lifetime hunt allowance. */
    readonly lifetimeHuntWork?: (work: string) => boolean;
    readonly clock?: () => number;
    readonly websiteSize?: WebsiteSizeForUrl;
  }) {
    const ceiling = resolveRollingCeiling(input.rollingCeilingUsd);
    this.bounds =
      ceiling.source === "OVERRIDE"
        ? { ...FLEET_SAFETY_BOUNDS, rolling24HourModelUsd: ceiling.rollingCeilingUsd }
        : FLEET_SAFETY_BOUNDS;
    this.startedAt = input.now;
    this.startedMs = Date.parse(input.now);
    this.night = operationalNightAt(input.now);
    this.paused = input.paused ?? false;
    this.modelHold = input.modelHold ?? null;
    this.clock = input.clock ?? Date.now;
    this.websiteSize = input.websiteSize;
    this.lastSuccessfulActivity = input.lastSuccessfulActivity ?? null;
    const nightSpend = aggregateModelSpend(input.costs, this.night.start, input.now, input.spendHolds);
    const rollingSpend = aggregateModelSpend(
      input.costs,
      new Date(this.startedMs - 24 * 3_600_000).toISOString(),
      input.now,
      input.spendHolds,
    );
    this.historicalNightUsd = input.costLedgerReadable === false ? null : nightSpend.usd;
    this.historicalRollingUsd = input.costLedgerReadable === false ? null : rollingSpend.usd;
    this.worstCaseCharges = rollingSpend.worstCaseCharges;
    for (const circuit of input.circuits ?? []) {
      if (this.hardCircuit(circuit) || Date.parse(circuit.eligibleAt) > this.startedMs) this.circuits.set(circuit.provider, circuit);
    }
  }

  /**
   * The owner's dial moved mid-round: the next reservation and pre-admission
   * read use the new value. An invalid value falls back, never no ceiling.
   */
  setRollingCeilingUsd(rollingCeilingUsd: number | null | undefined): void {
    const ceiling = resolveRollingCeiling(rollingCeilingUsd);
    this.bounds = ceiling.source === "OVERRIDE"
      ? { ...FLEET_SAFETY_BOUNDS, rolling24HourModelUsd: ceiling.rollingCeilingUsd }
      : FLEET_SAFETY_BOUNDS;
  }

  defer(work: string, code: string, why: string): void {
    if (!this.deferrals.some((d) => d.work === work && d.code === code)) this.deferrals.push({ work, code, why });
    this.stopReasons.add(`${code}: ${why}`);
  }

  private refuse(work: string, code: FleetStopCode, why: string): never {
    this.defer(work, code, why);
    throw new FleetSafetyRefusal(code, why);
  }

  admitDispatch(_work: string, _nowMs: number = this.clock()): { readonly admit: true } | { readonly admit: false; readonly code: FleetStopCode; readonly why: string } {
    // Budget reservations govern paid calls; dispatches are counted for Admin.
    this.dispatches += 1;
    return { admit: true };
  }

  private expireProviderCircuits(nowMs: number = this.clock()): void {
    for (const [provider, circuit] of this.circuits) {
      if (!this.hardCircuit(circuit) && Date.parse(circuit.eligibleAt) <= nowMs) this.circuits.delete(provider);
    }
  }

  private hardCircuit(circuit: ProviderCircuit): boolean {
    return circuit.failureClass === "HARD" || (circuit.failureClass === undefined && classifyProviderFailure(new Error(circuit.condition)).class === "HARD");
  }

  /** Reuse the source queue only for an eligible HARD recovery. Healthy model
   * requests stay concurrent; waiters observe the recovery before sending. */
  private async beginProviderRecovery(provider: string): Promise<(() => void) | null> {
    for (;;) {
      const circuit = this.circuits.get(provider);
      if (!circuit || !this.hardCircuit(circuit) || Date.parse(circuit.eligibleAt) > this.clock()) return null;
      const preceding = this.httpPending.get(provider);
      if (preceding) { await preceding; continue; }
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      this.httpPending.set(provider, pending);
      return () => {
        release();
        if (this.httpPending.get(provider) === pending) this.httpPending.delete(provider);
      };
    }
  }

  private providerSucceeded(provider: string, observed: ProviderCircuit | undefined): void {
    const current = this.circuits.get(provider);
    // A response sent before a newer failure cannot erase that failure. A
    // deferred sibling may extend workDeferred without changing this generation.
    if (observed && current && (current.consecutiveFailures ?? 1) === (observed.consecutiveFailures ?? 1) &&
      (current.lastObservedAt ?? current.firstObservedAt) === (observed.lastObservedAt ?? observed.firstObservedAt)) this.circuits.delete(provider);
  }

  private retryAfterMs(response: Response): number | null {
    const retry = response.headers.get("retry-after");
    if (retry === null) return null;
    const seconds = Number(retry);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - this.clock();
    return Number.isFinite(delay) ? Math.max(0, delay) : null;
  }

  admitProviderRequest(provider: string, work: string, outboundPayloadBytes = 0): number {
    this.expireProviderCircuits();
    const circuit = this.circuits.get(provider);
    if (circuit && Date.parse(circuit.eligibleAt) > this.clock()) {
      this.circuits.set(provider, {
        ...circuit,
        workDeferred: [...new Set([...circuit.workDeferred, work])],
      });
      this.refuse(work, "PROVIDER_CIRCUIT_BROKEN", `${provider} is latched until ${circuit.eligibleAt}: ${circuit.condition}`);
    }
    // No per-cycle request or payload-total ceiling. `maxDownloadBytes`, enforced
    // while streaming in `readBoundedResponse`, is the memory bound.
    this.requests += 1;
    this.bytes += outboundPayloadBytes;
    return this.bounds.maxDownloadBytes;
  }

  recordInboundBytes(_work: string, count: number): void {
    // Accumulate the already-capped bytes for the admin panel.
    if (Number.isFinite(count) && count > 0) this.bytes += count;
  }

  private reservePayloadRequest(provider: string, work: string, outboundPayloadBytes = 0): PayloadReservation {
    // The per-download cap is a fixed memory bound per fetch, so there is no pool hold to reserve.
    const streamCapBytes = this.admitProviderRequest(provider, work, outboundPayloadBytes);
    return { streamCapBytes, work, released: false };
  }

  private settlePayloadReservation(reservation: PayloadReservation, bytes: number | null): void {
    if (reservation.released) return;
    reservation.released = true;
    // A stream that crossed the per-download cap has already transferred data we
    // cannot unreceive; charge the cap so the count reflects the failed transfer.
    this.recordInboundBytes(reservation.work, bytes === null ? reservation.streamCapBytes : bytes);
  }

  reserveModelRequest(provider: string, work: string, request: ModelRequest): Reservation {
    // Paid work only: a pause or a closed lane refuses model requests, while
    // free fetches (`admitProviderRequest`, `guardedOpenBytes`) keep running.
    if (this.paused) this.refuse(work, "OWNER_PAUSED", "the owner paused the runner; no model request is sent under the pause");
    if (this.modelHold !== null) this.refuse(work, "MODEL_LANE_CLOSED", this.modelHold);
    const bodyBytes = Buffer.byteLength(JSON.stringify(request));
    const reserve = modelRequestWorstCaseUsd(request);
    if (reserve === null) this.refuse(work, "UNMEASURED_MODEL_SPEND", `model ${request.model} has no stated rate`);
    // The rolling 24-hour ceiling is the only spend limit. A model response's
    // size is bounded by its own `max_tokens`.
    const pending = this.cycleUsd + this.reservedUsd + reserve;
    if (this.historicalRollingUsd === null) this.refuse(work, "UNMEASURED_MODEL_SPEND", "rolling-24-hour model spend is unmeasured");
    if (this.historicalRollingUsd + pending > this.bounds.rolling24HourModelUsd) this.refuse(work, "ROLLING_24_HOUR_MODEL_SPEND_CEILING", `worst-case request would exceed the $${this.bounds.rolling24HourModelUsd.toFixed(2)} rolling-24-hour ceiling`);
    this.admitProviderRequest(provider, work, bodyBytes);
    this.reservedUsd += reserve;
    return { usd: reserve, provider, work, released: false };
  }

  private releaseReservation(reservation: Reservation): void {
    if (reservation.released) return;
    reservation.released = true;
    this.reservedUsd -= reservation.usd;
  }

  settleModelRequest(reservation: Reservation, response: ModelResponse): void {
    this.releaseReservation(reservation);
    const responseBytes = Buffer.byteLength(JSON.stringify(response));
    this.recordInboundBytes(reservation.work, responseBytes);
    const usd = modelResponseUsd(response);
    if (usd === null) {
      this.cycleModelSpendMeasured = false;
      this.cycleUsd += reservation.usd;
      this.refuse(reservation.work, "UNMEASURED_MODEL_SPEND", `provider did not return complete metered usage for ${response.model}`);
    }
    this.cycleUsd += usd;
    this.lastSuccessfulActivity = new Date(this.clock()).toISOString();
  }

  failModelRequest(reservation: Reservation, error: unknown, at: string = new Date(this.clock()).toISOString(), observed?: ProviderCircuit): void {
    // A sent request whose bill was not returned consumes its actual maximum.
    // Settlement already released its reservation, including incomplete usage.
    if (!reservation.released) {
      this.cycleUsd += reservation.usd;
      this.cycleModelSpendMeasured = false;
    }
    this.releaseReservation(reservation);
    const failure = classifyProviderFailure(error);
    const failedRecovery = observed && this.hardCircuit(observed) && Date.parse(observed.eligibleAt) <= Date.parse(at) &&
      !(error instanceof FleetPreSendRefusal);
    if (failure.class === "HARD" || failure.class === "TRANSIENT" || failedRecovery) this.latchProvider(reservation.provider, failure.condition, reservation.work, at,
      error instanceof ModelTransportError ? error.retryAfterMs : null, failure.class === "OTHER" ? "HARD" : failure.class);
  }

  latchProvider(provider: string, condition: string, work: string, at: string, retryAfterMs: number | null = null,
    failureClass: "HARD" | "TRANSIENT" = classifyProviderFailure(new Error(condition)).class === "HARD" ? "HARD" : "TRANSIENT"): ProviderCircuit {
    const existing = this.circuits.get(provider);
    // A changed provider error is not a successful recovery. Keep prior HARD
    // history through transient responses until the same provider succeeds.
    const retainedClass = existing && this.hardCircuit(existing) ? "HARD" : failureClass;
    const consecutiveFailures = existing ? (existing.consecutiveFailures ?? 1) + 1 : 1;
    const backoff = retainedClass === "HARD" ? Math.min(MAX_BACKOFF_MINUTES,
      FIRST_BACKOFF_MINUTES * 2 ** Math.min(consecutiveFailures - 1, 16)) : FIRST_BACKOFF_MINUTES;
    const circuit: ProviderCircuit = {
      provider, condition, firstObservedAt: existing?.firstObservedAt ?? at,
      workDeferred: [...new Set([...(existing?.workDeferred ?? []), work])],
      eligibleAt: new Date(Date.parse(at) + Math.max(backoff * 60_000, retryAfterMs ?? 0)).toISOString(),
      failureClass: retainedClass, consecutiveFailures, lastObservedAt: at,
    };
    this.circuits.set(provider, circuit);
    this.defer(work, "PROVIDER_CIRCUIT_BROKEN", `${provider} hard-refused work: ${condition}; no automated retry before ${circuit.eligibleAt}`);
    return circuit;
  }

  recordSuccessfulActivity(at: string = new Date(this.clock()).toISOString()): void {
    this.lastSuccessfulActivity = at;
  }

  guardedModelTransport(provider: string, work: string, transport: ModelTransport): ModelTransport {
    return async (request) => {
      const releaseRecovery = await this.beginProviderRecovery(provider);
      const observed = this.circuits.get(provider);
      try {
        let reservation: Reservation;
        try { reservation = this.reserveModelRequest(provider, work, request); }
        catch (error) {
          if (error instanceof FleetSafetyRefusal) throw new FleetPreSendRefusal(error);
          throw error;
        }
        try {
          const response = await transport(request);
          this.settleModelRequest(reservation, response);
          this.providerSucceeded(provider, observed);
          return response;
        } catch (error) {
          this.failModelRequest(reservation, error, undefined, observed);
          throw error;
        }
      } finally { releaseRecovery?.(); }
    };
  }

  /**
   * Whether the rolling-24h ceiling is already reached for one more dispatch:
   * the pre-admission read of the inequality `reserveModelRequest` enforces,
   * with `worstCaseUsd` as the reserve, so an admission gate pauses the lane
   * instead of busy-looping on refusals. Read-only. Unmeasured spend returns
   * `reached: false` (the caller's ledger-unreadable check owns that case).
   */
  rollingCeilingReached(
    worstCaseUsd = 0,
    _work = "",
  ): { readonly reached: boolean; readonly spentUsd: number | null; readonly capUsd: number } {
    const capUsd = this.bounds.rolling24HourModelUsd;
    if (this.historicalRollingUsd === null) return { reached: false, spentUsd: null, capUsd };
    const projected = this.historicalRollingUsd + this.cycleUsd + this.reservedUsd + worstCaseUsd;
    return { reached: projected > capUsd, spentUsd: this.historicalRollingUsd + this.cycleUsd, capUsd };
  }

  /** Scheduling consumes known spend plus actual request/standing holds.
   * Without any sound historical bound there is no funded paid capacity. */
  admissionSpendUsd(): number {
    return this.historicalRollingUsd === null ? Number.POSITIVE_INFINITY
      : this.historicalRollingUsd + this.cycleUsd + this.reservedUsd;
  }

  private async readBoundedResponse(response: Response, cap: number, work: string): Promise<Uint8Array> {
    // Never hand up a partial document: a truncated CSV still parses. A 206 is
    // accepted only when `Content-Range` proves the whole resource fit within
    // the cap; anything else throws.
    if (response.status === 206) {
      const total = parseContentRangeTotal(response.headers.get("content-range"));
      if (total === null || total > cap) {
        await response.body?.cancel();
        throw new FleetSafetyRefusal(
          "PAYLOAD_BYTE_CEILING",
          `${work}: HTTP 206 partial content ${total === null ? "with no stated resource total" : `for a ${total}-byte resource`} exceeds the ${cap}-byte per-download cap — refusing a truncated body`,
        );
      }
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > cap) {
      await response.body?.cancel();
      throw new FleetSafetyRefusal("PAYLOAD_BYTE_CEILING", `${work}: response declares ${declared} bytes over the ${cap}-byte per-download cap`);
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    if (reader) {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        if (received + next.value.byteLength > cap) {
          await reader.cancel();
          throw new FleetSafetyRefusal("PAYLOAD_BYTE_CEILING", `${work}: streamed response exceeded the ${cap}-byte per-download cap`);
        }
        chunks.push(next.value);
        received += next.value.byteLength;
      }
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  }

  private admitWebsiteRequest(url: string, work: string): void {
    const limit = websiteRequestLimit(this.websiteSize?.(url));
    if (limit === null) return;
    // One work item shares its allowance across text/bytes readers and redirects.
    const host = new URL(url).host.toLowerCase();
    const counts = this.websiteRequests.get(work) ?? new Map<string, number>();
    const count = counts.get(host) ?? 0;
    if (count >= limit) this.refuse(work, "WEBSITE_REQUEST_CAP", `${host} has had ${count} of ${limit} requests for this work; small-publisher allowance exhausted`);
    counts.set(host, count + 1);
    this.websiteRequests.set(work, counts);
  }

  /** A fetch seam that hard-caps application payload consumption by streaming. */
  guardedOpenOne(_provider: string, work: string, fetchImpl: typeof fetch = fetch): OpenOne {
    return async ({ url, method, headers, body, timeoutMs }) => {
      // Worker processes broker requests through this shared parent. Serialize
      // one source so queued subjects see the first failure before sending.
      const source = sourceReliabilityKey(url);
      const preceding = this.httpPending.get(source);
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      this.httpPending.set(source, pending);
      await preceding;
      let sourceReleased = false;
      const releaseSource = () => {
        release(); sourceReleased = true;
        if (this.httpPending.get(source) === pending) this.httpPending.delete(source);
      };
      const started = Date.now();
      let requests = 0;
      let currentUrl = url;
      let provider = source;
      let observed: ProviderCircuit | undefined;
      const recoveries: [string, () => void][] = [];
      try {
        let currentMethod = method;
        let currentBody = body;
        let response: Response;
        let merged: Uint8Array;
        while (true) {
          provider = sourceReliabilityKey(currentUrl);
          if ((provider !== source || sourceReleased) && !recoveries.some(([key]) => key === provider)) {
            const recovery = await this.beginProviderRecovery(provider);
            if (recovery) recoveries.push([provider, recovery]);
          }
          this.expireProviderCircuits();
          observed = this.circuits.get(provider);
          if (!observed || Date.parse(observed.eligibleAt) <= this.clock()) this.admitWebsiteRequest(currentUrl, work);
          const reservation = this.reservePayloadRequest(provider, work, currentBody === undefined ? 0 : Buffer.byteLength(currentBody));
          try {
            requests++;
            response = await fetchImpl(currentUrl, {
              method: currentMethod,
              redirect: "manual",
              // Do not ask JSON APIs for a byte range. The streaming reader
              // enforces the download limit without altering response semantics.
              headers,
              signal: AbortSignal.timeout(timeoutMs),
              ...(currentBody === undefined ? {} : { body: currentBody }),
            });
            // The bounded reader can reject a partial body before decoding it.
            // Persist that source failure before its download-limit exception.
            if (response.status === 206 || response.headers.has("content-range")) {
              const partial = httpProviderFailure(currentUrl, { status: response.status, bytes: 0,
                body: "", contentType: "", durationMs: 0, transportError: null,
                contentRange: response.headers.get("content-range") });
              if (partial) this.latchProvider(provider, partial, work, new Date(this.clock()).toISOString());
            }
            merged = await this.readBoundedResponse(response, reservation.streamCapBytes, work);
            this.settlePayloadReservation(reservation, merged.byteLength);
          } catch (error) {
            this.settlePayloadReservation(reservation, error instanceof FleetSafetyRefusal ? null : 0);
            throw error;
          }
          const location = response.headers.get("location");
          if (![301, 302, 303, 307, 308].includes(response.status) || location === null) break;
          const nextUrl = new URL(location, currentUrl).toString();
          if (sourceReliabilityKey(nextUrl) !== provider) {
            if (provider === source && !sourceReleased) releaseSource();
            const index = recoveries.findIndex(([key]) => key === provider);
            if (index !== -1) recoveries.splice(index, 1)[0][1]();
          }
          currentUrl = nextUrl;
          if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === "POST")) {
            currentMethod = "GET";
            currentBody = undefined;
          }
        }
        const outcome: FetchOutcome = {
          status: response.status, bytes: merged.byteLength,
          contentType: response.headers.get("content-type") ?? "application/octet-stream",
          body: new TextDecoder().decode(merged), durationMs: Date.now() - started,
          transportError: null, requestCount: requests, contentRange: response.headers.get("content-range"),
        };
        const failure = httpProviderFailure(currentUrl, outcome);
        const hard = classifyProviderFailure(new ModelTransportError(
          `HTTP ${response.status}: ${outcome.body.slice(0, 300)}`, response.status));
        if (failure !== null || hard.class === "HARD") {
          this.latchProvider(provider, failure ?? hard.condition, work, new Date(this.clock()).toISOString(),
            this.retryAfterMs(response), hard.class === "HARD" ? "HARD" : "TRANSIENT");
        } else if (response.ok) this.providerSucceeded(provider, observed);
        return outcome;
      } catch (error) {
        if (error instanceof FleetSafetyRefusal) this.defer(work, error.code, error.message);
        else if (requests > 0) this.latchProvider(provider,
          `transport failed: ${error instanceof Error ? error.message : String(error)}`, work, new Date(this.clock()).toISOString());
        return { status: null, bytes: 0, contentType: "", body: "", durationMs: Date.now() - started,
          transportError: error instanceof Error ? error.message : String(error), requestCount: requests };
      } finally {
        recoveries.forEach(([, release]) => release());
        releaseSource();
      }
    };
  }

  /**
   * `followRedirects: false` answers the first hop, with its `location`, so a
   * caller that must read permission on every new host can walk the chain itself.
   */
  guardedOpenBytes(
    _provider: string,
    work: string,
    fetchImpl: typeof fetch = fetch,
    options: { readonly followRedirects?: boolean } = {},
  ): OpenBytes {
    const follow = options.followRedirects !== false;
    return async ({ url, headers }) => {
      const started = Date.now();
      const recoveries: [string, () => void][] = [];
      let provider = sourceReliabilityKey(url);
      let observed: ProviderCircuit | undefined;
      let sent = false;
      let partialFailureObserved = false;
      try {
        let currentUrl = url;
        let response: Response;
        let merged: Uint8Array;
        let location: string | null = null;
        while (true) {
          provider = sourceReliabilityKey(currentUrl);
          if (!recoveries.some(([key]) => key === provider)) {
            const recovery = await this.beginProviderRecovery(provider);
            if (recovery) recoveries.push([provider, recovery]);
          }
          observed = this.circuits.get(provider);
          if (!observed || Date.parse(observed.eligibleAt) <= this.clock()) this.admitWebsiteRequest(currentUrl, work);
          const reservation = this.reservePayloadRequest(provider, work);
          try {
            sent = true;
            partialFailureObserved = false;
            response = await fetchImpl(currentUrl, {
              method: "GET",
              redirect: "manual",
              headers,
            });
            // The bounded reader may refuse a partial response before it can
            // be classified below. Record this actual failed recovery once;
            // a complete oversized body remains a local memory refusal.
            if (observed && this.hardCircuit(observed) && (response.status === 206 || response.headers.has("content-range"))) {
              this.latchProvider(provider, `partial HTTP ${response.status} response`, work,
                new Date(this.clock()).toISOString(), this.retryAfterMs(response), "TRANSIENT");
              partialFailureObserved = true;
            }
            merged = await this.readBoundedResponse(response, reservation.streamCapBytes, work);
            this.settlePayloadReservation(reservation, merged.byteLength);
          } catch (error) {
            this.settlePayloadReservation(reservation, error instanceof FleetSafetyRefusal ? null : 0);
            throw error;
          }
          location = response.headers.get("location");
          if (![301, 302, 303, 307, 308].includes(response.status) || location === null || !follow) break;
          const nextUrl = new URL(location, currentUrl).toString();
          if (sourceReliabilityKey(nextUrl) !== provider) {
            const index = recoveries.findIndex(([key]) => key === provider);
            if (index !== -1) recoveries.splice(index, 1)[0][1]();
          }
          currentUrl = nextUrl;
        }
        const decoded = new TextDecoder().decode(merged.subarray(0, Math.min(merged.byteLength, 300)));
        const failure = classifyProviderFailure(new ModelTransportError(`HTTP ${response.status}: ${decoded}`, response.status));
        const recoveryFailure = observed && this.hardCircuit(observed) ? httpProviderFailure(currentUrl, {
          status: response.status, bytes: merged.byteLength, body: new TextDecoder().decode(merged),
          contentType: response.headers.get("content-type") ?? "", durationMs: Date.now() - started,
          transportError: null, contentRange: response.headers.get("content-range"),
        }) : null;
        if (!partialFailureObserved && failure.class === "HARD") this.latchProvider(provider, failure.condition, work, new Date(this.clock()).toISOString(), this.retryAfterMs(response), "HARD");
        else if (!partialFailureObserved && observed && this.hardCircuit(observed) && (failure.class === "TRANSIENT" || recoveryFailure !== null)) {
          this.latchProvider(provider, recoveryFailure ?? failure.condition, work, new Date(this.clock()).toISOString(), this.retryAfterMs(response), "TRANSIENT");
        } else if (response.ok && recoveryFailure === null) this.providerSucceeded(provider, observed);
        return {
          status: response.status,
          bytes: merged,
          contentType: response.headers.get("content-type") ?? "application/octet-stream",
          finalUrl: response.url || null,
          durationMs: Date.now() - started,
          transportError: null,
          ...(follow ? {} : { location: [301, 302, 303, 307, 308].includes(response.status) ? location : null }),
        };
      } catch (error) {
        if (error instanceof FleetSafetyRefusal) this.defer(work, error.code, error.message);
        else if (!partialFailureObserved && sent && observed && this.hardCircuit(observed)) {
          const failure = classifyProviderFailure(error);
          this.latchProvider(provider, failure.condition, work, new Date(this.clock()).toISOString(), null,
            failure.class === "HARD" ? "HARD" : "TRANSIENT");
        }
        return {
          status: null,
          bytes: new Uint8Array(0),
          contentType: "",
          finalUrl: null,
          durationMs: Date.now() - started,
          transportError: error instanceof Error ? error.message : String(error),
        };
      } finally { recoveries.forEach(([, release]) => release()); }
    };
  }

  snapshot(now: string = new Date(this.clock()).toISOString()): FleetSafetySnapshot {
    this.expireProviderCircuits(Date.parse(now));
    const blackout = scheduledBlackoutAt(now);
    const status: FleetSafetyStatus = blackout
      ? "SCHEDULED BLACKOUT"
      : this.paused
        ? "PAUSED"
        : [...this.circuits.values()].some(circuit => Date.parse(circuit.eligibleAt) > Date.parse(now))
          ? "CIRCUIT BROKEN"
          : "ACTIVE";
    return {
      formatVersion: 1,
      status,
      bounds: this.bounds,
      cycle: {
        startedAt: this.startedAt,
        modelUsd: this.cycleModelSpendMeasured ? this.cycleUsd : null,
        requests: this.requests,
        payloadBytes: this.bytes,
        dispatches: this.dispatches,
        elapsedMs: Math.max(0, Date.parse(now) - this.startedMs),
      },
      operationalNight: {
        ...this.night,
        modelUsd: this.historicalNightUsd === null || !this.cycleModelSpendMeasured ? null : this.historicalNightUsd + this.cycleUsd,
      },
      rolling24Hours: {
        modelUsd: this.historicalRollingUsd === null || !this.cycleModelSpendMeasured ? null : this.historicalRollingUsd + this.cycleUsd,
        asOf: now,
        worstCaseCharges: this.worstCaseCharges,
      },
      stoppedBecause: [...this.stopReasons],
      deferred: [...this.deferrals],
      providerCircuits: [...this.circuits.values()],
      lastSuccessfulActivity: this.lastSuccessfulActivity,
    };
  }

  /**
   * A hold for a model escalation, taken before it runs, against the same
   * rolling-24h inequality `reserveModelRequest` enforces, so a concurrent
   * Scout cannot spend its headroom. `draw` converts part of the hold into
   * settled spend as each escalated turn is priced; `release` returns the rest.
   * Each escalated request is still reserved on its own on top of the hold.
   */
  holdModelBudget(work: string, usd: number): { readonly usd: number; readonly draw: (spentUsd: number) => void; readonly release: () => void } {
    if (!Number.isFinite(usd) || usd < 0) this.refuse(work, "UNMEASURED_MODEL_SPEND", `an escalation hold of ${String(usd)} USD is not a measured amount`);
    if (this.historicalRollingUsd === null) this.refuse(work, "UNMEASURED_MODEL_SPEND", "rolling-24-hour model spend is unmeasured");
    if (this.historicalRollingUsd + this.cycleUsd + this.reservedUsd + usd > this.bounds.rolling24HourModelUsd) {
      this.refuse(work, "ROLLING_24_HOUR_MODEL_SPEND_CEILING", `the escalation's worst case ($${usd.toFixed(2)}) would exceed the $${this.bounds.rolling24HourModelUsd.toFixed(2)} rolling-24-hour ceiling`);
    }
    this.reservedUsd += usd;
    let held = usd;
    return {
      usd,
      draw: (spentUsd) => {
        const d = Math.min(held, Number.isFinite(spentUsd) ? Math.max(0, spentUsd) : 0);
        held -= d;
        this.reservedUsd -= d;
      },
      release: () => {
        this.reservedUsd -= held;
        held = 0;
      },
    };
  }
}

/**
 * The Scout executor's escalation seam (`ScoutExecutorDeps.reserveEscalation`):
 * admitted with the hold, or refused `CEILING` with the controller's code and
 * words. Any other failure is thrown to the executor (`NOT_RESERVED`).
 */
export function scoutEscalationReservation(controller: FleetSafetyController): (request: ScoutEscalationRequest) => ScoutEscalationAdmission {
  return (request) => {
    try {
      const hold = controller.holdModelBudget(request.obligationId, request.worstCaseUsd);
      return { admit: true, reservedUsd: hold.usd, draw: hold.draw, release: hold.release };
    } catch (error) {
      if (error instanceof FleetSafetyRefusal) return { admit: false, code: "CEILING", why: error.message };
      throw error;
    }
  };
}
