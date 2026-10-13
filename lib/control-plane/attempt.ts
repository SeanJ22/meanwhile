/**
 * Attempts and leases. A crashed or interrupted Attempt is ABORTED and may
 * preserve artifacts, but it cannot leave behind YIELDED, ZERO, BLOCKED or
 * NOT_APPLICABLE as if the route finished. Whether an execution reached a
 * completion boundary is decided here, from outside the worker (a lease that
 * stopped being renewed), never from the worker's own account.
 *
 * Time is always a parameter; nothing here reads a clock.
 */

import { attemptId, leaseId } from "./ids.ts";
import type { CapabilityGrant } from "./capability.ts";

/** ------------------------------------------------------------- attempts */

/**
 * How an Attempt ended: execution state, never a `RouteDisposition`. `ABORTED`
 * is about our worker; `WALKED_NO_YIELD` is about a government.
 */
export const ATTEMPT_OUTCOMES = [
  /** Reached a defined completion boundary. The ONLY outcome that may carry a disposition. */
  "COMPLETED",
  /** Ended deliberately before the boundary — cancelled, budget-exhausted, superseded. */
  "ABORTED",
  /** Exceeded its own wall-clock budget. */
  "TIMED_OUT",
  /** The holder stopped renewing; the control plane reclaimed it. */
  "LEASE_EXPIRED",
  /** The process died. Observed from outside, never self-reported. */
  "CRASHED",
  /** The policy engine refused a capability mid-execution. */
  "DENIED_BY_POLICY",
] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

/** The outcomes that permit a terminal route disposition. Widening this lets our failures describe a government. */
export const DISPOSITION_BEARING_OUTCOMES: readonly AttemptOutcome[] = ["COMPLETED"];

/** Outcomes that leave the RouteTask reclaimable by a replacement Attempt. */
export const RECLAIMABLE_OUTCOMES: readonly AttemptOutcome[] = [
  "ABORTED",
  "TIMED_OUT",
  "LEASE_EXPIRED",
  "CRASHED",
];

/** The cost role of a discovery search request. One name, used by the ledger, the Money screen and the executor. */
export const DISCOVERY_SEARCH_ROLE = "DISCOVERY_SEARCH" as const;

export const WORKER_ROLES = [
  "SCOUT",
  "ACQUIRER",
  "PARSER",
  "DETECTIVE",
  "ENGINEERING",
  "VALIDATOR",
  "ADVERSARIAL_AUDITOR",
  "RELEASE_ORCHESTRATOR",
  /* A search-API request from the meetings-discovery executor, so search spend is accounted apart from model spend. */
  DISCOVERY_SEARCH_ROLE,
] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];

/** What ran, and at whose expense. Recorded per Attempt for the cost ledger. */
export interface WorkerRef {
  /** The strict contract this invocation implements. */
  readonly role: WorkerRole;
  /** Provider identity, e.g. "anthropic". Never a person and never a nickname. */
  readonly provider: string;
  /** Exact model or tool version. "Silent model/provider change" is a named threat. */
  readonly version: string;
  /** Process/instance handle, unique per invocation. */
  readonly instance: string;
}

/**
 * Measured, never estimated; an unmeasurable field is null. `inputTokens` is
 * the whole prompt (uncached + cache reads + cache writes); the fields below
 * split it as the provider bills it, and `usd` is priced from them
 * (`priceMeteredUsage`). Older rows carry none of the six cache fields: absent
 * means UNMEASURED (`cacheMeteringOf`), never zero.
 */
export interface AttemptCost {
  readonly listPriceUsd?: number | null;
  readonly modelRequestCount?: number | null;
  readonly batchEligibleRequestCount?: number | null;
  readonly batchRequestCount?: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly usd: number | null;
  readonly durationMs: number | null;
  readonly bytesFetched: number | null;
  readonly requestCount: number | null;
  /** The provider's `cache_read_input_tokens`. */
  readonly cacheReadInputTokens: number | null;
  /** The provider's `cache_creation_input_tokens` — the AGGREGATE, defined as the 5m split plus the 1h split. Never priced on top of the split. */
  readonly cacheCreationInputTokens: number | null;
  /** `usage.cache_creation.ephemeral_5m_input_tokens`; null when the response carried no split. */
  readonly cacheCreation5mInputTokens: number | null;
  /** `usage.cache_creation.ephemeral_1h_input_tokens`; null when the response carried no split. */
  readonly cacheCreation1hInputTokens: number | null;
  /** The provider's `input_tokens`: the uncached remainder, billed at the base input price. */
  readonly uncachedInputTokens: number | null;
  /** True when the request was served through the Message Batches API. */
  readonly batch: boolean;
}

export const ZERO_COST: AttemptCost = {
  inputTokens: null,
  outputTokens: null,
  usd: null,
  durationMs: null,
  bytesFetched: null,
  requestCount: null,
  cacheReadInputTokens: null,
  cacheCreationInputTokens: null,
  cacheCreation5mInputTokens: null,
  cacheCreation1hInputTokens: null,
  uncachedInputTokens: null,
  batch: false,
};

export interface Attempt {
  /** Unattended provider work survives process/lease loss; no prompts are stored here. */
  readonly providerBatches?: readonly AttemptProviderBatch[];
  /** Granted before a fleet worker executes, including failed and denied runs. */
  readonly capabilityGrant?: CapabilityGrant;
  readonly id: string;
  readonly routeTaskId: string;
  readonly workItemId: string;
  readonly worker: WorkerRef;
  readonly leaseId: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly outcome: AttemptOutcome | null;
  /** Required whenever the outcome is not COMPLETED. Named, never "unknown". */
  readonly abortReason: string | null;
  /** Artifacts survive an abort. That is why they are preserved incrementally. */
  readonly artifactIds: readonly string[];
  readonly cost: AttemptCost;
  /** The method-store version this Attempt inherited. Replay needs it. */
  readonly methodVersion: number;
  /** The capability-grant version in force. Replay needs it too. */
  readonly policyVersion: string;
}

export interface AttemptProviderBatch {
  readonly requestHash: string;
  readonly customId: string;
  readonly batchId: string | null;
  /** Written before submission, so an ambiguous POST is never paid for again. */
  readonly submittedAt: string;
}

/** ---------------------------------------------------------------- leases */

/**
 * A time-bounded claim on a RouteTask, so a second worker loses cleanly
 * instead of duplicating a side effect. Expiry is evaluated against a
 * caller-supplied `now`.
 */
export interface ExecutionLease {
  readonly id: string;
  readonly routeTaskId: string;
  readonly holder: string;
  readonly claimedAt: string;
  /** Absolute expiry. Renewed by heartbeats; never open-ended. */
  readonly expiresAt: string;
  readonly heartbeatAt: string;
  readonly released: boolean;
}

export class LeaseConflict extends Error {
  readonly routeTaskId: string;
  readonly heldBy: string;
  readonly until: string;

  constructor(routeTaskId: string, heldBy: string, until: string) {
    super(
      `RouteTask ${routeTaskId} is leased by ${heldBy} until ${until}. ` +
        "A second claim is refused rather than duplicating the side effect.",
    );
    this.name = "LeaseConflict";
    this.routeTaskId = routeTaskId;
    this.heldBy = heldBy;
    this.until = until;
  }
}

export function isExpired(lease: ExecutionLease, now: string): boolean {
  return lease.released || Date.parse(lease.expiresAt) <= Date.parse(now);
}

/** Claim a RouteTask, or refuse. A live lease held by someone else is a `LeaseConflict` and cannot be overridden. */
export function claim(
  routeTaskId: string,
  holder: string,
  now: string,
  ttlMs: number,
  existing: ExecutionLease | null,
): ExecutionLease {
  if (existing && !isExpired(existing, now) && existing.holder !== holder) {
    throw new LeaseConflict(routeTaskId, existing.holder, existing.expiresAt);
  }
  const expiresAt = new Date(Date.parse(now) + ttlMs).toISOString();
  return {
    id: leaseId(routeTaskId, now, holder),
    routeTaskId,
    holder,
    claimedAt: now,
    expiresAt,
    heartbeatAt: now,
    released: false,
  };
}

/** Extend a live lease. An expired lease cannot be renewed — it must be re-claimed. */
export function heartbeat(lease: ExecutionLease, now: string, ttlMs: number): ExecutionLease {
  if (isExpired(lease, now)) {
    throw new Error(
      `Lease ${lease.id} expired at ${lease.expiresAt} and cannot be renewed at ${now}. ` +
        "The RouteTask is reclaimable; a replacement Attempt starts fresh.",
    );
  }
  return {
    ...lease,
    heartbeatAt: now,
    expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
  };
}

export function release(lease: ExecutionLease): ExecutionLease {
  return { ...lease, released: true };
}

/** ------------------------------------------------- opening and finishing */

export function beginAttempt(input: {
  routeTaskId: string;
  workItemId: string;
  worker: WorkerRef;
  lease: ExecutionLease;
  now: string;
  methodVersion: number;
  policyVersion: string;
}): Attempt {
  return {
    id: attemptId(input.routeTaskId, input.now, input.worker.instance),
    routeTaskId: input.routeTaskId,
    workItemId: input.workItemId,
    worker: input.worker,
    leaseId: input.lease.id,
    startedAt: input.now,
    endedAt: null,
    outcome: null,
    abortReason: null,
    artifactIds: [],
    cost: ZERO_COST,
    methodVersion: input.methodVersion,
    policyVersion: input.policyVersion,
  };
}

export class AttemptContract extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttemptContract";
  }
}

/** Close an Attempt. Refuses a non-`COMPLETED` outcome without a named `abortReason`, and a second close. */
export function endAttempt(
  attempt: Attempt,
  outcome: AttemptOutcome,
  now: string,
  opts: { abortReason?: string; artifactIds?: readonly string[]; cost?: AttemptCost } = {},
): Attempt {
  if (attempt.outcome !== null) {
    throw new AttemptContract(
      `Attempt ${attempt.id} already ended as ${attempt.outcome}; it cannot end again as ${outcome}.`,
    );
  }
  if (outcome !== "COMPLETED" && !opts.abortReason) {
    throw new AttemptContract(
      `Attempt ${attempt.id} ended as ${outcome} without a named abortReason. ` +
        "An unnamed failure is indistinguishable from an unexamined one.",
    );
  }
  return {
    ...attempt,
    outcome,
    endedAt: now,
    abortReason: opts.abortReason ?? null,
    // Artifacts accumulate even on abort.
    artifactIds: opts.artifactIds ?? attempt.artifactIds,
    cost: opts.cost ?? attempt.cost,
  };
}

/** May this Attempt's outcome carry a route disposition? */
export function mayWriteDisposition(attempt: Attempt): boolean {
  return attempt.outcome !== null && DISPOSITION_BEARING_OUTCOMES.includes(attempt.outcome);
}

/** Does this Attempt leave its RouteTask reclaimable? */
export function leavesReclaimable(attempt: Attempt): boolean {
  return attempt.outcome !== null && RECLAIMABLE_OUTCOMES.includes(attempt.outcome);
}
