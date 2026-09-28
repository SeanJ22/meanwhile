/**
 * Aggregate unattended-Fleet safety.
 *
 * This is an admission controller over the existing cost ledger and scheduler;
 * it is not a second budget ledger. Historical spend comes only from the
 * canonical `costs` repository. In-cycle reservations close the race between
 * concurrent model requests until their provider-reported cost is persisted.
 */
import type { CostEntry } from "./cost.ts";
import { CACHE_RATE_MULTIPLIERS, rateFor, usdForModelUsage } from "./model-cost.ts";
import type { ModelRequest, ModelResponse, ModelTransport, ScoutEscalationAdmission, ScoutEscalationRequest } from "./scheduler/scout-executor.ts";
import { ModelTransportError } from "./scheduler/scout-executor.ts";
import type { OpenBytes } from "./scheduler/scout-contract.ts";
import type { OpenOne } from "./scheduler/route-executor.ts";

export const FLEET_ZONE = "America/Phoenix";

/**
 * Aggregate safety bounds for the standing runner.
 *
 * The per-cycle guardrails — a dispatch count, a per-cycle model-spend ceiling,
 * a provider-request count, a per-cycle payload total — were retired once prompt
 * caching cut an Attempt to about a twelfth of its pre-caching cost and those
 * numbers, set when a cycle's cost was unknown, became the throttle on the work
 * the fleet most needs at speed. What remains is deliberately small:
 *
 *   rolling24HourModelUsd  the ONE spend limit — flat out under it, paused over it
 *   maxDownloadBytes       a per-DOWNLOAD memory cap on the guarded fetch seam,
 *                          NOT a per-cycle total: a single response never reads
 *                          more than this into memory. It clears the largest
 *                          record the seam legitimately pulls (a ~9.2 MiB
 *                          campaign-finance page) with headroom; a bulk file
 *                          cannot reach this seam — bulk ingestion has its own
 *                          full-read, integrity-checked path and never rides here
 *   maxWallMsPerCycle      a cycle still has to finish — about work, not spend
 *
 * The Saturday operational-night blackout is a separate courtesy toward the
 * public sites we depend on and is kept (`scheduledBlackoutAt`).
 */
/**
 * The aggregate safety bounds, as a widening of {@link FLEET_SAFETY_BOUNDS}:
 * `rolling24HourModelUsd` is a plain `number`, not the literal constant, because
 * the value IN FORCE is the owner's console override read at runtime
 * (`AdminConfig.fleetSpendCeiling`, resolved by {@link resolveRollingCeiling}),
 * and the constant below is only the fallback.
 */
export interface FleetSafetyBounds {
  readonly rolling24HourModelUsd: number;
  readonly maxDownloadBytes: number;
  readonly maxWallMsPerCycle: number;
}

export const FLEET_SAFETY_BOUNDS = {
  // The FALLBACK rolling 24-hour model-spend ceiling. The value in force is the
  // owner's console override (`AdminConfig.fleetSpendCeiling`), read at the start
  // of every cycle through `resolveRollingCeiling`; this constant governs only
  // when the row was read and carries no override — "a ceiling that disappears
  // must not become no ceiling". A row that cannot be read or is malformed does
  // not reach this fallback: the runner holds paid work instead, because the
  // owner's dial may be set below it (2026-09-25). Restored to $100 (the pre-2026-09-19
  // value) now the console dial can move it with no deploy and no restart; the
  // interim $25 brake is retired into the dial.
  rolling24HourModelUsd: 100,
  maxDownloadBytes: 24 * 1024 * 1024,
  maxWallMsPerCycle: 15 * 60_000,
} as const;

/**
 * The largest ceiling the owner's console control accepts. Not a spend cap on
 * its own — the runtime bounds above still hold — but a typo guard, so a missing
 * decimal cannot turn $100 into an order of magnitude nobody meant.
 */
export const FLEET_SPEND_CEILING_MAX_USD = 10_000;

/**
 * The rolling 24-hour model-spend ceiling in force, given the owner's override
 * (or null when none stands).
 *
 * The fallback is the built-in {@link FLEET_SAFETY_BOUNDS} value, so a missing
 * override is still a real ceiling and never "no ceiling". The runner calls this
 * only for a row it read cleanly; an unreadable or malformed row holds paid work
 * rather than fall back (`adminConfigForPaidWork` in gateway/admin-config.ts). A
 * non-positive or non-finite override is treated as no override, for the same
 * reason — a corrupt row must not read as "spend nothing" or "spend without
 * limit". `source` lets a surface show a live override apart from the fallback.
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
  readonly rolling24Hours: { readonly modelUsd: number | null; readonly asOf: string };
  readonly stoppedBecause: readonly string[];
  readonly deferred: readonly FleetNamedDeferral[];
  readonly providerCircuits: readonly ProviderCircuit[];
  readonly lastSuccessfulActivity: string | null;
}

interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly weekday: string;
}

function zonedParts(iso: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: FLEET_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(iso));
  const part = (name: string): string => parts.find((p) => p.type === name)?.value ?? "";
  return {
    year: Number(part("year")),
    month: Number(part("month")),
    day: Number(part("day")),
    hour: Number(part("hour")),
    weekday: part("weekday"),
  };
}

function localDate(parts: Pick<ZonedParts, "year" | "month" | "day">): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Phoenix currently has no DST, but derive the offset through Intl instead of assuming it. */
function phoenixInstant(date: string, hour: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, 0, 0);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(new Date(guess).toISOString());
    const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, 0, 0);
    guess -= wall - target;
  }
  return new Date(guess).toISOString();
}

export function operationalNightAt(nowIso: string): OperationalNight {
  const now = zonedParts(nowIso);
  const today = localDate(now);
  const startDate = now.hour < 6 ? shiftDate(today, -1) : today;
  const start = phoenixInstant(startDate, 18);
  const end = phoenixInstant(shiftDate(startDate, 1), 6);
  return {
    active: Date.parse(nowIso) >= Date.parse(start) && Date.parse(nowIso) < Date.parse(end),
    start,
    end,
    startsOnSaturday: zonedParts(start).weekday === "Sat",
  };
}

export function scheduledBlackoutAt(nowIso: string): boolean {
  const night = operationalNightAt(nowIso);
  return night.active && night.startsOnSaturday;
}

/**
 * Every token-bearing or dollar-bearing entry is model-backed, irrespective
 * of role. SCOUT is intrinsically model-backed, so a Scout row whose provider
 * omitted both usage and dollars is still counted as unmeasured rather than
 * disappearing from the denominator.
 */
export function aggregateModelSpend(
  costs: readonly CostEntry[],
  since: string,
  until: string,
): { readonly usd: number | null; readonly measured: number; readonly unmeasured: number } {
  let usd = 0;
  let measured = 0;
  let unmeasured = 0;
  for (const entry of costs) {
    // Search invoices are tracked separately; the Anthropic token budget must
    // never consume Brave/Exa charges merely because they carry a dollar value.
    if (entry.role === "DISCOVERY_SEARCH" || entry.source === "api.search.brave.com" || entry.source === "api.exa.ai") continue;
    const isModelBacked =
      entry.role === "SCOUT" ||
      entry.cost.inputTokens !== null ||
      entry.cost.outputTokens !== null ||
        entry.source === "api.anthropic.com" ||
        entry.byModel?.some((part) => part.model.startsWith("claude-"));
    if (!isModelBacked) continue;
    const at = Date.parse(entry.recordedAt);
    if (at < Date.parse(since) || at > Date.parse(until)) continue;
    if (entry.cost.usd === null || entry.cost.usd === undefined || !Number.isFinite(entry.cost.usd)) unmeasured += 1;
    else {
      measured += 1;
      usd += entry.cost.usd;
    }
  }
  return { usd: unmeasured > 0 ? null : usd, measured, unmeasured };
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
  /** The per-download read cap: the `Range` ceiling and the streamed-byte limit. */
  readonly streamCapBytes: number;
  readonly work: string;
  released: boolean;
}

/**
 * The total size of the resource a `Content-Range` header describes, or null
 * when it is absent, unknown (`*`), or malformed. Used to tell a 206 that
 * delivered a whole small resource from one that truncated a large one to the
 * byte range we asked for.
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
 * input token at the cache-write rate (a conservative upper bound on input
 * tokens, and the multiplier even though only marked blocks can incur it),
 * plus its whole `max_tokens` at the output rate. Null for a model with no
 * stated rate. The per-request guard reserves exactly this against the rolling
 * ceiling, and the Send and area budgets against theirs (MW-021, 2026-09-25).
 */
export function modelRequestWorstCaseUsd(request: ModelRequest): number | null {
  const rate = rateFor(request.model);
  if (rate === null) return null;
  const bodyBytes = Buffer.byteLength(JSON.stringify(request));
  const worstInput = (bodyBytes / 1_000_000) * rate.inputUsdPerMillion * CACHE_RATE_MULTIPLIERS.cacheCreation;
  const worstOutput = (request.max_tokens / 1_000_000) * rate.outputUsdPerMillion;
  return worstInput + worstOutput;
}

/** What a model response cost, from its provider-reported usage; null when the usage is incomplete. */
export function modelResponseUsd(response: ModelResponse): number | null {
  return usdForModelUsage(response.model, {
    inputTokens: response.usage.input_tokens ?? null,
    outputTokens: response.usage.output_tokens ?? null,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? null,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? null,
  });
}

export class FleetSafetyController {
  /**
   * The bounds THIS cycle runs under. `rolling24HourModelUsd` is the owner's
   * console override when the caller passed one (read at cycle start from the
   * control plane, not this module's import), and the fallback otherwise —
   * assigned here rather than initialised to the constant so a live change
   * governs the very next reservation with no deploy and no restart. Both the
   * per-request guard (`reserveModelRequest`) and the pre-admission read
   * (`rollingCeilingReached`) read it, so moving this one value moves both.
   */
  readonly bounds: FleetSafetyBounds;
  readonly startedAt: string;
  private readonly startedMs: number;
  private readonly historicalNightUsd: number | null;
  private readonly historicalRollingUsd: number | null;
  private readonly night: OperationalNight;
  private readonly paused: boolean;
  private readonly modelHold: string | null;
  private readonly lifetimeHuntWork: (work: string) => boolean;
  private readonly clock: () => number;
  private readonly deferrals: FleetNamedDeferral[] = [];
  private readonly stopReasons = new Set<string>();
  private readonly circuits = new Map<string, ProviderCircuit>();
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
    /**
     * The owner's rolling-24h ceiling override in USD, or undefined/null to run
     * under the built-in fallback. A non-finite or non-positive value is
     * defended here too and falls back — a disappeared ceiling is never no
     * ceiling.
     */
    readonly rollingCeilingUsd?: number | null;
    /** Exact work covered by a separately reserved lifetime hunt allowance. */
    readonly lifetimeHuntWork?: (work: string) => boolean;
    readonly clock?: () => number;
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
    this.lifetimeHuntWork = input.lifetimeHuntWork ?? (() => false);
    this.clock = input.clock ?? Date.now;
    this.lastSuccessfulActivity = input.lastSuccessfulActivity ?? null;
    const nightSpend = aggregateModelSpend(input.costs, this.night.start, input.now);
    const rollingSpend = aggregateModelSpend(
      input.costs,
      new Date(this.startedMs - 24 * 3_600_000).toISOString(),
      input.now,
    );
    this.historicalNightUsd = input.costLedgerReadable === false ? null : nightSpend.usd;
    this.historicalRollingUsd = input.costLedgerReadable === false ? null : rollingSpend.usd;
    for (const circuit of input.circuits ?? []) {
      if (Date.parse(circuit.eligibleAt) > this.startedMs) this.circuits.set(circuit.provider, circuit);
    }
  }

  defer(work: string, code: string, why: string): void {
    if (!this.deferrals.some((d) => d.work === work && d.code === code)) this.deferrals.push({ work, code, why });
    this.stopReasons.add(`${code}: ${why}`);
  }

  private refuse(work: string, code: FleetStopCode, why: string): never {
    this.defer(work, code, why);
    throw new FleetSafetyRefusal(code, why);
  }

  admitDispatch(work: string, nowMs: number = this.clock()): { readonly admit: true } | { readonly admit: false; readonly code: FleetStopCode; readonly why: string } {
    const deny = (code: FleetStopCode, why: string) => {
      this.defer(work, code, why);
      return { admit: false as const, code, why };
    };
    if (scheduledBlackoutAt(new Date(nowMs).toISOString()) && !this.lifetimeHuntWork(work)) return deny("SCHEDULED_BLACKOUT", "Saturday 18:00 through Sunday 06:00 America/Phoenix permits no billable or network research");
    if (nowMs - this.startedMs >= this.bounds.maxWallMsPerCycle) return deny("WALL_CLOCK_CEILING", `cycle reached ${this.bounds.maxWallMsPerCycle}ms`);
    // No per-cycle dispatch ceiling: the wall above and the rolling daily spend
    // ceiling are the limits. `dispatches` is still counted, for the admin panel.
    this.dispatches += 1;
    return { admit: true };
  }

  admitProviderRequest(provider: string, work: string, outboundPayloadBytes = 0): number {
    if (scheduledBlackoutAt(new Date(this.clock()).toISOString()) && !this.lifetimeHuntWork(work)) this.refuse(work, "SCHEDULED_BLACKOUT", "network/provider execution is disabled during the Saturday operational-night blackout");
    const circuit = this.circuits.get(provider);
    if (circuit) {
      this.circuits.set(provider, {
        ...circuit,
        workDeferred: [...new Set([...circuit.workDeferred, work])],
      });
      this.refuse(work, "PROVIDER_CIRCUIT_BROKEN", `${provider} is latched until ${circuit.eligibleAt}: ${circuit.condition}`);
    }
    if (this.clock() - this.startedMs >= this.bounds.maxWallMsPerCycle) this.refuse(work, "WALL_CLOCK_CEILING", `cycle reached ${this.bounds.maxWallMsPerCycle}ms`);
    // No per-cycle request or payload-total ceiling. The per-DOWNLOAD cap
    // (`maxDownloadBytes`, enforced while streaming in `readBoundedResponse`) is
    // the memory bound; requests and bytes are still counted for the admin panel.
    this.requests += 1;
    this.bytes += outboundPayloadBytes;
    return this.bounds.maxDownloadBytes;
  }

  recordInboundBytes(_work: string, count: number): void {
    // Accumulate the already-capped bytes for the admin panel. The per-download
    // limit is enforced while streaming in `readBoundedResponse`; there is no
    // per-cycle payload total to refuse against.
    if (Number.isFinite(count) && count > 0) this.bytes += count;
  }

  private reservePayloadRequest(provider: string, work: string, outboundPayloadBytes = 0): PayloadReservation {
    // The per-download cap is a fixed memory bound, identical for every fetch —
    // not a slice of a shared cycle budget — so there is no pool hold to reserve
    // and no way for one in-flight fetch to starve a concurrent one.
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
    if (!this.cycleModelSpendMeasured) this.refuse(work, "UNMEASURED_MODEL_SPEND", "an earlier model response in this cycle omitted complete metered usage");
    const bodyBytes = Buffer.byteLength(JSON.stringify(request));
    const reserve = modelRequestWorstCaseUsd(request);
    if (reserve === null) this.refuse(work, "UNMEASURED_MODEL_SPEND", `model ${request.model} has no stated rate`);
    // The rolling 24-hour ceiling is the only spend limit now — no per-cycle or
    // operational-night model-spend cap. A model response's size is bounded by
    // its own `max_tokens`, so it needs no per-cycle payload check.
    const pending = this.cycleUsd + this.reservedUsd + reserve;
    if (!this.lifetimeHuntWork(work)) {
      if (this.historicalRollingUsd === null) this.refuse(work, "UNMEASURED_MODEL_SPEND", "rolling-24-hour model spend is unmeasured");
      if (this.historicalRollingUsd + pending > this.bounds.rolling24HourModelUsd) this.refuse(work, "ROLLING_24_HOUR_MODEL_SPEND_CEILING", `worst-case request would exceed the $${this.bounds.rolling24HourModelUsd.toFixed(2)} rolling-24-hour ceiling`);
    }
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
    const usd = usdForModelUsage(response.model, {
      inputTokens: response.usage.input_tokens ?? null,
      outputTokens: response.usage.output_tokens ?? null,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? null,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? null,
    });
    if (usd === null) {
      this.cycleModelSpendMeasured = false;
      this.refuse(reservation.work, "UNMEASURED_MODEL_SPEND", `provider did not return complete metered usage for ${response.model}`);
    }
    this.cycleUsd += usd;
    this.lastSuccessfulActivity = new Date(this.clock()).toISOString();
  }

  failModelRequest(reservation: Reservation, error: unknown, at: string = new Date(this.clock()).toISOString()): void {
    this.releaseReservation(reservation);
    const failure = classifyProviderFailure(error);
    if (failure.class === "HARD") this.latchProvider(reservation.provider, failure.condition, reservation.work, at);
  }

  latchProvider(provider: string, condition: string, work: string, at: string): ProviderCircuit {
    const existing = this.circuits.get(provider);
    const night = operationalNightAt(at);
    const circuit: ProviderCircuit = existing
      ? { ...existing, workDeferred: [...new Set([...existing.workDeferred, work])] }
      : { provider, condition, firstObservedAt: at, workDeferred: [work], eligibleAt: night.end };
    this.circuits.set(provider, circuit);
    this.defer(work, "PROVIDER_CIRCUIT_BROKEN", `${provider} hard-refused work: ${condition}; no automated retry before ${circuit.eligibleAt}`);
    return circuit;
  }

  recordSuccessfulActivity(at: string = new Date(this.clock()).toISOString()): void {
    this.lastSuccessfulActivity = at;
  }

  guardedModelTransport(provider: string, work: string, transport: ModelTransport): ModelTransport {
    return async (request) => {
      let reservation: Reservation;
      try {
        reservation = this.reserveModelRequest(provider, work, request);
      } catch (error) {
        if (error instanceof FleetSafetyRefusal) throw new FleetPreSendRefusal(error);
        throw error;
      }
      try {
        const response = await transport(request);
        this.settleModelRequest(reservation, response);
        return response;
      } catch (error) {
        this.failModelRequest(reservation, error);
        throw error;
      }
    };
  }

  /**
   * Whether the rolling-24h ceiling is already reached for one more model
   * dispatch — the CYCLE-START / PRE-ADMISSION read of the same inequality
   * `reserveModelRequest` enforces (`historicalRollingUsd + cycleUsd +
   * reservedUsd + reserve > ceiling`), with `worstCaseUsd` standing in for a
   * dispatch's worst-case reserve. The lane header promises "paused over it";
   * an admission gate that reads this pauses the whole lane instead of admitting
   * dispatch after dispatch for the per-request guard to refuse in a busy-loop.
   * Read-only: it reserves nothing and never refuses. Unmeasured spend returns
   * `reached: false` (the caller's ledger-unreadable check owns that case).
   */
  rollingCeilingReached(
    worstCaseUsd = 0,
    work = "",
  ): { readonly reached: boolean; readonly spentUsd: number | null; readonly capUsd: number } {
    const capUsd = this.bounds.rolling24HourModelUsd;
    if (this.lifetimeHuntWork(work)) return { reached: false, spentUsd: this.historicalRollingUsd === null ? null : this.historicalRollingUsd + this.cycleUsd, capUsd };
    if (this.historicalRollingUsd === null) return { reached: false, spentUsd: null, capUsd };
    const projected = this.historicalRollingUsd + this.cycleUsd + this.reservedUsd + worstCaseUsd;
    return { reached: projected > capUsd, spentUsd: this.historicalRollingUsd + this.cycleUsd, capUsd };
  }

  private async readBoundedResponse(response: Response, cap: number, work: string): Promise<Uint8Array> {
    // FAIL LOUD ON TRUNCATION — never hand up a partial document, because a
    // truncated CSV still parses. We send `Range: bytes=0-(cap-1)`, so a
    // range-honoring server answers 206: accept it only when `Content-Range`
    // proves the WHOLE resource fit within the cap. A larger resource, or a
    // total the server would not state, is a truncation and throws.
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

  /** A fetch seam that hard-caps application payload consumption by streaming. */
  guardedOpenOne(provider: string, work: string, fetchImpl: typeof fetch = fetch): OpenOne {
    return async ({ url, method, headers, body, timeoutMs }) => {
      const started = Date.now();
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);
      try {
        let currentUrl = url;
        let currentMethod = method;
        let currentBody = body;
        let response: Response;
        let merged: Uint8Array;
        while (true) {
          const reservation = this.reservePayloadRequest(provider, work, currentBody === undefined ? 0 : Buffer.byteLength(currentBody));
          try {
            response = await fetchImpl(currentUrl, {
              method: currentMethod,
              signal: abort.signal,
              redirect: "manual",
              headers: { ...headers, range: `bytes=0-${Math.max(0, reservation.streamCapBytes - 1)}` },
              ...(currentBody === undefined ? {} : { body: currentBody }),
            });
            merged = await this.readBoundedResponse(response, reservation.streamCapBytes, work);
            this.settlePayloadReservation(reservation, merged.byteLength);
          } catch (error) {
            this.settlePayloadReservation(reservation, error instanceof FleetSafetyRefusal ? null : 0);
            throw error;
          }
          const location = response.headers.get("location");
          if (![301, 302, 303, 307, 308].includes(response.status) || location === null) break;
          currentUrl = new URL(location, currentUrl).toString();
          if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === "POST")) {
            currentMethod = "GET";
            currentBody = undefined;
          }
        }
        const decoded = new TextDecoder().decode(merged);
        const failure = classifyProviderFailure(new ModelTransportError(`HTTP ${response.status}: ${decoded.slice(0, 300)}`, response.status));
        if (failure.class === "HARD") this.latchProvider(provider, failure.condition, work, new Date(this.clock()).toISOString());
        return {
          status: response.status,
          bytes: merged.byteLength,
          contentType: response.headers.get("content-type") ?? "application/octet-stream",
          body: decoded,
          durationMs: Date.now() - started,
          transportError: null,
        };
      } catch (error) {
        if (error instanceof FleetSafetyRefusal) {
          this.defer(work, error.code, error.message);
        }
        return {
          status: error instanceof FleetSafetyRefusal ? null : null,
          bytes: 0,
          contentType: "",
          body: "",
          durationMs: Date.now() - started,
          transportError: error instanceof Error ? error.message : String(error),
        };
      } finally {
        clearTimeout(timer);
      }
    };
  }

  /**
   * `followRedirects: false` (2026-09-23) answers the first hop, with its
   * `location`, instead of following it. A caller that must read permission
   * again on every new host (the meetings-discovery executor) walks the chain
   * itself; nothing else changes.
   */
  guardedOpenBytes(
    provider: string,
    work: string,
    fetchImpl: typeof fetch = fetch,
    options: { readonly followRedirects?: boolean } = {},
  ): OpenBytes {
    const follow = options.followRedirects !== false;
    return async ({ url, headers, timeoutMs }) => {
      const started = Date.now();
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);
      try {
        let currentUrl = url;
        let response: Response;
        let merged: Uint8Array;
        let location: string | null = null;
        while (true) {
          const reservation = this.reservePayloadRequest(provider, work);
          try {
            response = await fetchImpl(currentUrl, {
              method: "GET",
              signal: abort.signal,
              redirect: "manual",
              headers: { ...headers, range: `bytes=0-${Math.max(0, reservation.streamCapBytes - 1)}` },
            });
            merged = await this.readBoundedResponse(response, reservation.streamCapBytes, work);
            this.settlePayloadReservation(reservation, merged.byteLength);
          } catch (error) {
            this.settlePayloadReservation(reservation, error instanceof FleetSafetyRefusal ? null : 0);
            throw error;
          }
          location = response.headers.get("location");
          if (![301, 302, 303, 307, 308].includes(response.status) || location === null || !follow) break;
          currentUrl = new URL(location, currentUrl).toString();
        }
        const decoded = new TextDecoder().decode(merged.subarray(0, Math.min(merged.byteLength, 300)));
        const failure = classifyProviderFailure(new ModelTransportError(`HTTP ${response.status}: ${decoded}`, response.status));
        if (failure.class === "HARD") this.latchProvider(provider, failure.condition, work, new Date(this.clock()).toISOString());
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
        return {
          status: null,
          bytes: new Uint8Array(0),
          contentType: "",
          finalUrl: null,
          durationMs: Date.now() - started,
          transportError: error instanceof Error ? error.message : String(error),
        };
      } finally {
        clearTimeout(timer);
      }
    };
  }

  snapshot(now: string = new Date(this.clock()).toISOString()): FleetSafetySnapshot {
    const blackout = scheduledBlackoutAt(now);
    const status: FleetSafetyStatus = blackout
      ? "SCHEDULED BLACKOUT"
      : this.paused
        ? "PAUSED"
        : this.circuits.size > 0
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
      },
      stoppedBecause: [...this.stopReasons],
      deferred: [...this.deferrals],
      providerCircuits: [...this.circuits.values()],
      lastSuccessfulActivity: this.lastSuccessfulActivity,
    };
  }

  /**
   * **A HOLD FOR A MODEL ESCALATION, TAKEN BEFORE IT RUNS.** (MW-031, MW-033,
   * 2026-09-25.) When a cheaper model attempt shows a recorded reason to move
   * up a class, the second attempt's worst case is held against the SAME
   * rolling-24h inequality `reserveModelRequest` enforces, before its first
   * request — so the ceiling covers both attempts, and a concurrent Scout
   * cannot spend the headroom the escalation was admitted on. Refuses (and
   * defers the work by name) exactly as a request would. `draw` converts part
   * of the hold into settled spend as each escalated turn is priced, so the
   * hold and the spend are never counted twice; `release` returns the rest.
   * Each escalated request is still reserved on its own on top of the hold.
   */
  holdModelBudget(work: string, usd: number): { readonly usd: number; readonly draw: (spentUsd: number) => void; readonly release: () => void } {
    if (!Number.isFinite(usd) || usd < 0) this.refuse(work, "UNMEASURED_MODEL_SPEND", `an escalation hold of ${String(usd)} USD is not a measured amount`);
    if (!this.cycleModelSpendMeasured) this.refuse(work, "UNMEASURED_MODEL_SPEND", "an earlier model response in this cycle omitted complete metered usage");
    if (!this.lifetimeHuntWork(work)) {
      if (this.historicalRollingUsd === null) this.refuse(work, "UNMEASURED_MODEL_SPEND", "rolling-24-hour model spend is unmeasured");
      if (this.historicalRollingUsd + this.cycleUsd + this.reservedUsd + usd > this.bounds.rolling24HourModelUsd) {
        this.refuse(work, "ROLLING_24_HOUR_MODEL_SPEND_CEILING", `the escalation's worst case ($${usd.toFixed(2)}) would exceed the $${this.bounds.rolling24HourModelUsd.toFixed(2)} rolling-24-hour ceiling`);
      }
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
 * The Scout executor's escalation seam (`ScoutExecutorDeps.reserveEscalation`),
 * backed by this controller's hold (MW-033, 2026-09-25): admitted with the hold,
 * or refused `CEILING` with the controller's own code and words. Any other
 * failure is not a ceiling reading and is thrown to the executor, which records
 * it as `NOT_RESERVED`.
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
