/**
 * ATTEMPTS AND LEASES — the layer where "workers are disposable" becomes
 * mechanical rather than aspirational.
 *
 * The load-bearing sentence of the target architecture is:
 *
 *     A crashed or interrupted Attempt is ABORTED and may preserve artifacts,
 *     but it cannot leave behind YIELDED, ZERO, BLOCKED, or NOT_APPLICABLE as
 *     if the route finished.
 *
 * This file is the only place in the system permitted to say whether an
 * execution reached a completion boundary. Everything downstream — the
 * disposition writer, the completion evaluator, the method-candidate intake —
 * asks THIS module rather than trusting a worker's own account of itself.
 *
 * Why that separation exists: a worker that dies is, by construction, not
 * available to report that it died. The only honest reading of a dead worker is
 * made from OUTSIDE it, from a lease that stopped being renewed. A design that
 * asks the worker to write its own terminal state has already lost the cases it
 * was built for.
 *
 * TIME IS ALWAYS A PARAMETER HERE. No function in this file reads a clock. A
 * library that reaches for the wall clock cannot be replayed, and the
 * reproducibility attack mode in the threat model exists precisely to catch
 * that class of drift.
 */

import { attemptId, leaseId } from "./ids.ts";
import type { CapabilityGrant } from "./capability.ts";

/** ------------------------------------------------------------- attempts */

/**
 * How an Attempt ENDED. This is execution state and is never a
 * `RouteDisposition`.
 *
 * The distinction is the entire point. `ABORTED` says something about our
 * worker. `WALKED_NO_YIELD` says something about a government. Collapsing them
 * is how "our process died" becomes "this record is not published", which is
 * the one failure this product cannot survive.
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

/**
 * The outcomes that permit a terminal route disposition to be written.
 *
 * Exactly one member, and it should stay that way. Every proposal to widen this
 * list is a proposal to let one of our failures describe a government.
 */
export const DISPOSITION_BEARING_OUTCOMES: readonly AttemptOutcome[] = ["COMPLETED"];

/** Outcomes that leave the RouteTask reclaimable by a replacement Attempt. */
export const RECLAIMABLE_OUTCOMES: readonly AttemptOutcome[] = [
  "ABORTED",
  "TIMED_OUT",
  "LEASE_EXPIRED",
  "CRASHED",
];

export const WORKER_ROLES = [
  "SCOUT",
  "ACQUIRER",
  "PARSER",
  "DETECTIVE",
  "ENGINEERING",
  "VALIDATOR",
  "ADVERSARIAL_AUDITOR",
  "RELEASE_ORCHESTRATOR",
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

/** Measured, never estimated. An unmeasurable field is null, not a guess. */
export interface AttemptCost {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly usd: number | null;
  readonly durationMs: number | null;
  readonly bytesFetched: number | null;
  readonly requestCount: number | null;
}

export const ZERO_COST: AttemptCost = {
  inputTokens: null,
  outputTokens: null,
  usd: null,
  durationMs: null,
  bytesFetched: null,
  requestCount: null,
};

export interface Attempt {
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

/** ---------------------------------------------------------------- leases */

/**
 * A time-bounded claim on a RouteTask.
 *
 * Two workers claiming the same RouteTask is not a hypothetical; it is the
 * expected steady state of a system that fans out. The lease is what makes the
 * second one lose cleanly instead of duplicating a side effect against a
 * government server.
 *
 * Expiry is evaluated against a caller-supplied `now` for the same reason
 * everything else here is: so a test can put the clock where it needs it, and
 * so replay is exact.
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

/**
 * Claim a RouteTask, or refuse.
 *
 * `existing` is the current lease if there is one. A live lease held by someone
 * else is a `LeaseConflict` — the caller does not get to override it, because
 * "I am sure the other worker is dead" is exactly the belief that produces two
 * concurrent writes against one publisher.
 */
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

/**
 * Close an Attempt.
 *
 * Two refusals live here, and both describe failures that have cost this
 * project real time:
 *
 *   - A non-`COMPLETED` outcome without a named `abortReason`. "It failed" is
 *     not a reason; the next session cannot act on it and the auditor cannot
 *     attack it.
 *   - Closing an Attempt twice. A second close is a lost update in disguise.
 */
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
    // Artifacts accumulate even on abort. Preserving partial evidence is the
    // reason an interrupted walk is not a total loss.
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
