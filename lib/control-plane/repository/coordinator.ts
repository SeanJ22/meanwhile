/**
 * THE COORDINATOR — atomic claim, lease, and disposition over durable state.
 *
 * ============================================================================
 * WHAT THIS FILE IS FOR
 *
 * `attempt.ts`, `route-task.ts`, `work-item.ts` and `completion.ts` hold the
 * RULES, purely, over values. `repository/` holds the STORAGE, neutrally. This
 * file is the only place the two meet, and it is where the architecture's claim
 *
 *     A CRASHED WORKER LOSES ITS ATTEMPT AND NOTHING ELSE
 *
 * becomes something a test can fail.
 *
 * IT DUPLICATES NO RULE. Every domain question — may this Attempt carry a
 * disposition, is this lease expired, does this Attempt leave the task
 * reclaimable, may this obligation end — is asked of the module that owns it.
 * What is added here is exactly and only what a pure function cannot do: decide
 * a race against PERSISTED state, and make a two-aggregate write atomic.
 * ============================================================================
 *
 * THE THREE MECHANISMS, and the failure each one exists for:
 *
 *   1. COMPARE-AND-SET ON THE LEASE SLOT. The lease is stored under the ROUTE
 *      TASK's id — one slot per task — so "who holds this task" is a single
 *      persisted cell and claiming it is a single conditional write. Two workers
 *      that both read an empty slot both try to create it; exactly one creation
 *      succeeds and the other is refused. `claimRouteTask` is deliberately
 *      LOCK-FREE for this reason: correctness comes from the conditional write,
 *      not from a mutual-exclusion section a crashed process could hold forever.
 *
 *   2. OWNERSHIP ON RENEWAL. `heartbeat()` in `attempt.ts` checks EXPIRY and
 *      cannot check ownership — it is handed a lease value and has no way to
 *      know who is asking. That check belongs here, where the caller's identity
 *      and the persisted holder are both available. Without it, a worker whose
 *      task was reclaimed could keep a live lease alive under someone else's
 *      name and two workers would walk one route believing they each held it.
 *
 *   3. A WRITE-AHEAD COMMIT FOR DISPOSITION. Disposing a route writes two
 *      aggregates — the RouteTask records the disposition, the Attempt closes.
 *      Two files is two writes, and a process dying between them leaves a
 *      half-write: a disposed route whose Attempt is still open, or a closed
 *      Attempt against a route that shows nothing. Both are lies to the next
 *      reader. So the pair is committed as ONE append to an append-only log and
 *      the aggregate writes are the APPLICATION of that commit. Either the
 *      commit is there — and `reconcile()` finishes it, deterministically, from
 *      values the domain already computed — or nothing happened at all.
 *
 * COST IS ORTHOGONAL TO TRUTH, mechanically. Nothing in the disposition path
 * reads a budget, a cap or a cost. A budget refusal changes what runs NEXT; it
 * cannot produce, alter or withhold a `RouteDisposition`. The only route out of
 * a cost stop is an Attempt that ends `ABORTED`, and `disposeRoute` refuses an
 * `ABORTED` Attempt by name. A scheduling fact is never a finding about a
 * government. See `COST_SCHEDULING_INVARIANT` in `cost.ts`.
 *
 * TIME IS ALWAYS A PARAMETER. Nothing here reads a clock.
 */

import {
  AttemptContract,
  beginAttempt,
  claim,
  endAttempt,
  heartbeat,
  isExpired,
  release as releaseLease,
  type Attempt,
  type AttemptCost,
  type AttemptOutcome,
  type ExecutionLease,
  type WorkerRef,
} from "../attempt.ts";
import type { AuditFinding, Contradiction, ValidationRecord } from "../audit.ts";
import {
  release as releaseBudgetSlot,
  tryAcquire,
  type AcquireResult,
  type BudgetLedger,
} from "../budget.ts";
import type { CompletionSnapshot } from "../completion.ts";
import { costEntryWithModel, type CostEntry } from "../cost.ts";
import { fingerprint } from "../ids.ts";
import {
  disposeRoute,
  denyByPolicy,
  reclaim,
  type RouteDisposition,
  type RouteTask,
} from "../route-task.ts";
import { withRouteTasks, type Escalation, type WorkItem, type WorkItemState } from "../work-item.ts";
import {
  AppendOnlyViolation,
  ConcurrentModification,
  IdentityCollision,
  canonicalJson,
  type AppendOutcome,
  type ArtifactRecord,
  type ControlPlaneRepositories,
  type DispositionCommit,
  type Persisted,
  type RecordedTransition,
} from "./types.ts";
import { loadWorkerCompletionEvidence, reconcileWorkerCompletions } from "./worker-completion.ts";

/** ------------------------------------------------------------- refusals */

/**
 * Someone who does not hold this lease tried to act as though they did.
 *
 * The distinction from `LeaseConflict` matters and is not cosmetic.
 * `LeaseConflict` says "you cannot TAKE this, someone else has it" and is the
 * correct, expected answer to a losing claim. `LeaseNotHeld` says "you are
 * acting as though you already had this, and you do not" — which is a worker
 * operating on a belief the control plane has already overwritten, and is the
 * shape a stale worker takes just before it writes a stale conclusion.
 */
export class LeaseNotHeld extends Error {
  readonly routeTaskId: string;
  readonly claimant: string;
  readonly actualHolder: string;

  constructor(routeTaskId: string, claimant: string, actualHolder: string, detail: string) {
    super(
      `${claimant} does not hold the lease on RouteTask ${routeTaskId}; it is held by ` +
        `${actualHolder}. ${detail} A worker acting on a lease it no longer holds is a worker ` +
        "about to write a conclusion the control plane has already replaced.",
    );
    this.name = "LeaseNotHeld";
    this.routeTaskId = routeTaskId;
    this.claimant = claimant;
    this.actualHolder = actualHolder;
  }
}

/** A reclaim was attempted while the lease was still being renewed. */
export class LeaseStillLive extends Error {
  readonly routeTaskId: string;
  readonly holder: string;
  readonly expiresAt: string;

  constructor(routeTaskId: string, holder: string, expiresAt: string, now: string) {
    super(
      `RouteTask ${routeTaskId} cannot be reclaimed at ${now}: ${holder} holds a LIVE lease until ` +
        `${expiresAt}. Death is observed from OUTSIDE, from a lease that stopped being renewed — ` +
        "never inferred from impatience, and never from one worker's belief that another is stuck.",
    );
    this.name = "LeaseStillLive";
    this.routeTaskId = routeTaskId;
    this.holder = holder;
    this.expiresAt = expiresAt;
  }
}

/** A reclaim found no Attempt to attribute the abandonment to. */
export class NothingToReclaim extends Error {
  readonly routeTaskId: string;

  constructor(routeTaskId: string) {
    super(
      `RouteTask ${routeTaskId} has no Attempt to reclaim. Marking a task RECLAIMABLE with no ` +
        "Attempt behind it would record an abandonment that nobody performed, and the next " +
        "session would inherit a walk that never started as a walk that failed.",
    );
    this.name = "NothingToReclaim";
    this.routeTaskId = routeTaskId;
  }
}

/**
 * A claim reached a RouteTask that already carries a disposition.
 *
 * (2026-09-22.) `claimRouteTask` refused only WORKER tasks outside PENDING and
 * RECLAIMABLE, so a settled civic route could be claimed again. The claim
 * overwrote its state from DISPOSED to CLAIMED, and the dispatch behind it
 * opened an Attempt that no disposition could close (`disposeRoute` refuses a
 * second one) and no reclaim could return (`reclaim` refuses a settled route),
 * leaving its lease for the sweep. Production held 65 such tasks.
 *
 * Settled is a fact about this ROUTE, not about the obligation. What the
 * obligation still owes — parsing, verifying and publishing what the route
 * retrieved, or another route when this one returned nothing — is carried by
 * the durable evidence and by the obligation's next occurrence, never by
 * walking a settled route again.
 */
export class RouteTaskSettled extends Error {
  readonly routeTaskId: string;
  readonly disposition: string;

  constructor(routeTaskId: string, disposition: string) {
    super(
      `RouteTask ${routeTaskId} is already disposed as ${disposition} and cannot be claimed. ` +
        "A claim on a settled route opens an Attempt no disposition can close and no reclaim " +
        "can return. The committed disposition stands; the obligation's remaining work belongs " +
        "to its evidence and to a new occurrence with its own RouteTask.",
    );
    this.name = "RouteTaskSettled";
    this.routeTaskId = routeTaskId;
    this.disposition = disposition;
  }
}

/** ------------------------------------------------------------ registration */

/** Idempotently persist a WorkItem. A re-put of the identical item is a no-op. */
export async function registerWorkItem(
  repos: ControlPlaneRepositories,
  item: WorkItem,
  now: string,
): Promise<Persisted<WorkItem>> {
  const outcome = await repos.workItems.put(item.id, item, now);
  return outcome.persisted;
}

/**
 * Idempotently persist a RouteTask and link it to its WorkItem.
 *
 * The link write is skipped when it would be a no-op, so re-registering a task
 * does not churn the WorkItem's revision. A revision that moves for no reason
 * makes every legitimate compare-and-set above it fail for no reason, and a
 * guard that fails for no reason is a guard about to be removed.
 */
export async function registerRouteTask(
  repos: ControlPlaneRepositories,
  task: RouteTask,
  now: string,
): Promise<Persisted<RouteTask>> {
  const outcome = await repos.routeTasks.put(task.id, task, now);
  const item = await repos.workItems.mustRead(task.workItemId);
  const linked = withRouteTasks(item.value, [task.id]);
  if (canonicalJson(linked) !== canonicalJson(item.value)) {
    await repos.workItems.compareAndSet(item.id, item.revision, linked, now);
  }
  return outcome.persisted;
}

/** ----------------------------------------------------------------- claim */

export interface ClaimOutcome {
  readonly lease: Persisted<ExecutionLease>;
  readonly task: Persisted<RouteTask>;
}

/**
 * Claim a RouteTask against durable state, or lose cleanly.
 *
 * LOCK-FREE BY DESIGN. The race is decided by a single conditional write to the
 * lease slot: an idempotent create when the slot is empty, a compare-and-set
 * when a dead lease is being taken over. A mutual-exclusion section would be the
 * wrong instrument here — a process that dies holding one blocks every future
 * claimant, which is precisely the failure mode this whole subsystem exists to
 * remove.
 *
 * Both storage-level refusals are translated into `LeaseConflict`, the domain's
 * own word for "someone else has it". A caller does not need to learn the
 * storage layer's vocabulary to understand that it lost a claim, and translating
 * keeps the losing path identical whether the loser was beaten to an empty slot
 * (`IdentityCollision`) or beaten to an expired one (`ConcurrentModification`).
 *
 * A RouteTask that already carries a disposition is refused with
 * `RouteTaskSettled`, and the refusal writes nothing: it is checked before the
 * lease slot is touched, so neither the task nor its lease moves. A dead lease
 * already on that slot stays where the sweep releases it.
 */
export async function claimRouteTask(
  repos: ControlPlaneRepositories,
  input: {
    routeTaskId: string;
    holder: string;
    now: string;
    ttlMs: number;
  },
): Promise<ClaimOutcome> {
  // Refuses with UnknownAggregate if the task is not persisted: claiming a task
  // that does not exist would create a lease nothing can ever reclaim.
  const held = await repos.routeTasks.mustRead(input.routeTaskId);
  // `disposition !== null` is the test `reclaim` and `disposeRoute` apply. A
  // worker task carries no civic disposition and keeps its own state rule below.
  if (!held.value.workerTask && held.value.disposition !== null) {
    throw new RouteTaskSettled(input.routeTaskId, held.value.disposition.disposition);
  }

  const existing = await repos.leases.read(input.routeTaskId);
  // The DOMAIN decides whether this claim is permitted. `claim` throws
  // LeaseConflict on a live foreign lease; that rule is not re-implemented here.
  const proposed = claim(
    input.routeTaskId,
    input.holder,
    input.now,
    input.ttlMs,
    existing?.value ?? null,
  );

  let lease: Persisted<ExecutionLease>;
  try {
    lease =
      existing === null
        ? (await repos.leases.put(input.routeTaskId, proposed, input.now)).persisted
        : await repos.leases.compareAndSet(
            input.routeTaskId,
            existing.revision,
            proposed,
            input.now,
          );
  } catch (error) {
    if (error instanceof IdentityCollision || error instanceof ConcurrentModification) {
      const winner = await repos.leases.read(input.routeTaskId);
      if (winner !== null) {
        // Re-run the domain check against the winner so the refusal this caller
        // receives is the same object a first-pass loser would have received.
        claim(input.routeTaskId, input.holder, input.now, input.ttlMs, winner.value);
      }
    }
    throw error;
  }

  // Read the task FRESH, after winning. Reading it before the race and writing
  // it after would reintroduce the window the conditional write just closed.
  const current = await repos.routeTasks.mustRead(input.routeTaskId);
  // A sibling may have read PENDING before the previous worker recorded its
  // policy denial and released the lease. Only the scheduler can reauthorize it.
  if (!current.value.workerTask && current.value.state === "POLICY_DENIED") {
    await repos.leases.compareAndSet(input.routeTaskId, lease.revision, releaseLease(lease.value), input.now);
    throw new AttemptContract("ROUTE_TASK_POLICY_DENIED");
  }
  if (current.value.workerTask && !["PENDING", "RECLAIMABLE"].includes(current.value.state)) {
    await repos.leases.compareAndSet(input.routeTaskId, lease.revision, releaseLease(lease.value), input.now);
    throw new AttemptContract("WORKER_TASK_NOT_DISPATCHABLE");
  }
  // Disposed while this claim raced for the slot: give back the lease just won
  // and refuse, exactly as the worker refusal above does. The task is not written.
  if (!current.value.workerTask && current.value.disposition !== null) {
    try {
      await repos.leases.compareAndSet(input.routeTaskId, lease.revision, releaseLease(lease.value), input.now);
    } catch (error) {
      // The disposition path releases whatever lease holds the slot; if it
      // already released this one, the refusal is still the settled route.
      if (!(error instanceof ConcurrentModification)) throw error;
    }
    throw new RouteTaskSettled(input.routeTaskId, current.value.disposition.disposition);
  }
  const claimed: RouteTask = { ...current.value, state: "CLAIMED" };
  const task =
    canonicalJson(claimed) === canonicalJson(current.value)
      ? current
      : await repos.routeTasks.compareAndSet(
          input.routeTaskId,
          current.revision,
          claimed,
          input.now,
        );

  return { lease, task };
}

/**
 * Renew a lease this worker actually holds.
 *
 * TWO CHECKS, IN THIS ORDER, and the order is deliberate:
 *
 *   1. OWNERSHIP, here. `heartbeat()` cannot make this check — it receives a
 *      lease value and has no idea who is asking — so a system that only called
 *      `heartbeat` would let any worker keep any lease alive.
 *   2. EXPIRY, in `attempt.ts`. Not re-implemented here. An expired lease is not
 *      renewable by anyone including its own holder; it must be re-claimed, so
 *      that taking it back is a decision the lease slot arbitrates rather than
 *      one a straggler makes unilaterally.
 *
 * Ownership is checked first because it is the more specific fact about the
 * CALLER. A stranger renewing an expired lease is both a stranger and late, and
 * "you do not hold this" is the sentence that tells it what to do next.
 */
export async function renewLease(
  repos: ControlPlaneRepositories,
  input: { routeTaskId: string; holder: string; now: string; ttlMs: number },
): Promise<Persisted<ExecutionLease>> {
  const current = await repos.leases.mustRead(input.routeTaskId);
  if (current.value.holder !== input.holder) {
    throw new LeaseNotHeld(
      input.routeTaskId,
      input.holder,
      current.value.holder,
      `The renewal at ${input.now} was refused on OWNERSHIP, before expiry was considered.`,
    );
  }
  // Throws when the lease has already expired. The rule lives in attempt.ts.
  const renewed = heartbeat(current.value, input.now, input.ttlMs);
  return repos.leases.compareAndSet(input.routeTaskId, current.revision, renewed, input.now);
}

/** ------------------------------------------------------------- attempts */

/**
 * Open an Attempt under a lease this worker holds.
 *
 * The lease identity is re-checked against durable state rather than trusted
 * from the caller's copy. A worker holding a stale `ExecutionLease` object is
 * exactly the thing that happens after a reclaim, and letting it open an Attempt
 * would put two live Attempts on one route.
 */
export async function beginAttemptFor(
  repos: ControlPlaneRepositories,
  input: {
    routeTaskId: string;
    workItemId: string;
    worker: WorkerRef;
    lease: ExecutionLease;
    now: string;
    methodVersion: number;
    policyVersion: string;
  },
): Promise<Persisted<Attempt>> {
  const current = await repos.leases.mustRead(input.routeTaskId);
  if (current.value.id !== input.lease.id || current.value.holder !== input.lease.holder) {
    throw new LeaseNotHeld(
      input.routeTaskId,
      input.lease.holder,
      current.value.holder,
      `The Attempt was opened under lease ${input.lease.id}; the durable lease is ` +
        `${current.value.id}.`,
    );
  }
  const attempt = beginAttempt({
    routeTaskId: input.routeTaskId,
    workItemId: input.workItemId,
    worker: input.worker,
    lease: current.value,
    now: input.now,
    methodVersion: input.methodVersion,
    policyVersion: input.policyVersion,
  });
  const outcome = await repos.attempts.put(attempt.id, attempt, input.now);
  return outcome.persisted;
}

/**
 * Every Attempt against one RouteTask, oldest first.
 *
 * A FILTERED read, never the whole table (2026-09-22). This listed every
 * Attempt and filtered in process: 44 sequential 100-row pages over 4,324 rows
 * on the production control plane, once per expired lease the sweep walked.
 * `listWhere` returns exactly `list()` filtered, in the same id order, so the
 * sort below sees the same input and returns the same rows in the same order.
 */
export async function attemptsForRouteTask(
  repos: ControlPlaneRepositories,
  routeTaskId: string,
): Promise<readonly Persisted<Attempt>[]> {
  const mine = await repos.attempts.listWhere(["routeTaskId"], routeTaskId);
  return [...mine].sort((a, b) => (a.value.startedAt < b.value.startedAt ? -1 : 1));
}

/** ---------------------------------------------------- artifact metadata */

/**
 * Record that an artifact exists, and whose Attempt produced it.
 *
 * METADATA ONLY. The bytes live in the evidence vault; what the control plane
 * owes is attribution. The named Attempt must already be persisted, because an
 * artifact attributed to an Attempt nobody recorded cannot be walked back to the
 * obligation it answers — and an artifact that cannot be walked back is not
 * evidence, whatever it contains.
 */
export async function recordArtifactMetadata(
  repos: ControlPlaneRepositories,
  record: ArtifactRecord,
  now: string,
): Promise<AppendOutcome<ArtifactRecord>> {
  await repos.attempts.mustRead(record.attemptId);
  try {
    return await repos.artifacts.append(record.workItemId, record.artifactId, record, now);
  } catch (error) {
    if (!(error instanceof AppendOnlyViolation)) throw error;
    /*
     * **A RE-OBSERVATION OF ONE ARTIFACT IS IDEMPOTENT, NOT A REWRITE.**
     *
     * An artifact IS its content: `artifactId` is content-derived, and
     * `contentHash`/`byteLength`/`canonicalUrl`/`tier`/`partial` are the bytes
     * and how they were classified. When a resumed occurrence re-runs a route
     * whose prior observation was recorded but whose occurrence was never
     * closed — a killed cycle, a crash-restart — a SECOND Attempt retrieves
     * byte-identical content and offers the SAME artifact under a new
     * `attemptId`/`recordedAt`. The append-only log sees a differing record
     * under one id and refuses it as a history rewrite. It is not one: the fact
     * (this content, at this URL, for this work) already exists, and the FIRST
     * observation's attribution stands. So a content-identical re-record is an
     * idempotent success and the cycle proceeds — the disposition cites the
     * artifact from the disposing Attempt's own declared ids, not from the
     * log's attribution, so nothing false is recorded.
     *
     * A collision on the same id with DIFFERENT content is a genuine violation
     * (a broken content-address, a hash collision) and is re-thrown untouched.
     * Without this, one such re-record aborts the entire cycle with no run
     * record, and every crash-restart re-resumes the same occurrence into the
     * same death — the recovery loop that required manual surgery.
     */
    const held = await repos.artifacts.read(record.workItemId);
    const position = held.findIndex((a) => a.artifactId === record.artifactId);
    const prior = position >= 0 ? held[position] : undefined;
    const contentIdentical =
      prior !== undefined &&
      prior.contentHash === record.contentHash &&
      prior.byteLength === record.byteLength &&
      prior.canonicalUrl === record.canonicalUrl &&
      prior.tier === record.tier &&
      prior.partial === record.partial;
    if (!contentIdentical) throw error;
    return { appended: false, recordId: record.artifactId, record: prior, position };
  }
}

/** Artifacts attributed to one Attempt. Attribution is never re-pointed. */
export async function artifactsForAttempt(
  repos: ControlPlaneRepositories,
  workItemId: string,
  attemptId: string,
): Promise<readonly ArtifactRecord[]> {
  const all = await repos.artifacts.read(workItemId);
  return all.filter((record) => record.attemptId === attemptId);
}

/** ------------------------------------------------------------ reclaiming */

export interface ReclaimOutcome {
  readonly task: Persisted<RouteTask>;
  readonly closed: readonly Persisted<Attempt>[];
  /**
   * True when the RouteTask was ALREADY DISPOSED. Nothing was returned to the
   * pool and no Attempt was read or closed: the only write was releasing the
   * dead lease. A caller must not count this as a reclaim.
   */
  readonly settled: boolean;
}

/**
 * Observe a worker's death from OUTSIDE and return the route to the pool.
 *
 * The only admissible evidence of death is a lease that stopped being renewed.
 * A dead worker is by construction unavailable to report that it died, so a
 * design that waits for it to say so has already lost the case it was built for.
 * `LeaseStillLive` refuses the impatient reading.
 *
 * The abandoned Attempt is closed as `LEASE_EXPIRED` by the CONTROL PLANE, with
 * a named `abortReason` — never as `COMPLETED`, and never with a disposition.
 * Its partial artifacts are carried onto the closed Attempt exactly as recorded,
 * still attributed to the worker that fetched them. Preserving the evidence
 * while withholding the conclusion is the whole of the rule: there was never a
 * conclusion to keep.
 */
export async function reclaimRouteTask(
  repos: ControlPlaneRepositories,
  input: { routeTaskId: string; now: string; observedBy: string },
): Promise<ReclaimOutcome> {
  const task = await repos.routeTasks.mustRead(input.routeTaskId);
  const lease = await repos.leases.read(input.routeTaskId);

  if (lease !== null && !isExpired(lease.value, input.now)) {
    throw new LeaseStillLive(
      input.routeTaskId,
      lease.value.holder,
      lease.value.expiresAt,
      input.now,
    );
  }

  /*
   * **A DEAD LEASE ON A SETTLED ROUTE IS RELEASED, AND NOTHING ELSE MOVES.**
   * (2026-09-22.)
   *
   * `reclaim()` refuses to reopen a disposed RouteTask, and must: a dead
   * Attempt cannot unsettle a settled route. But that refusal fired inside the
   * loop below, BEFORE the lease release at the end of this function, so an
   * expired lease on a disposed task was never released and
   * `sweepExpiredLeases` walked it again every cycle. The production control
   * plane held 65 of them (disposed tasks re-claimed by a later dispatch whose
   * own write was then refused), and walking them took 348 s of a 417 s
   * pre-dispatch, so every due deterministic item was deferred.
   *
   * On a settled route the lease is the only dead state. The disposition, the
   * Attempts, the cost ledger and the debt are history this path does not
   * read or write: it performs exactly the release the disposition path
   * performs (`applyDispositionCommit`), one compare-and-set of the lease to
   * `released`, which is how every release is recorded. A lease re-claimed
   * since it was read loses that compare-and-set and is left alone. "Disposed"
   * is `reclaim()`'s own test (`disposition !== null`), so this fires only
   * where that refusal would, and only when there is a lease left to release.
   */
  if (task.value.disposition !== null && lease !== null && !lease.value.released) {
    await repos.leases.compareAndSet(
      input.routeTaskId,
      lease.revision,
      releaseLease(lease.value),
      input.now,
    );
    return { task, closed: [], settled: true };
  }

  const attempts = await attemptsForRouteTask(repos, input.routeTaskId);
  if (attempts.length === 0) throw new NothingToReclaim(input.routeTaskId);

  const closed: Persisted<Attempt>[] = [];
  let next = task.value;

  for (const row of attempts) {
    let closedAttempt = row.value;
    if (row.value.outcome === null) {
      const artifacts = await artifactsForAttempt(repos, row.value.workItemId, row.value.id);
      closedAttempt = endAttempt(row.value, "LEASE_EXPIRED", input.now, {
        abortReason:
          `The lease ${row.value.leaseId} stopped being renewed and expired` +
          (lease === null ? "" : ` at ${lease.value.expiresAt}`) +
          `; ${input.observedBy} observed the abandonment from outside the worker. ` +
          `${artifacts.length} partial artifact(s) are preserved and remain attributed to this ` +
          "Attempt. No route conclusion is recorded, because none was reached.",
        artifactIds: artifacts.map((a) => a.artifactId),
      });
      closed.push(await repos.attempts.compareAndSet(row.id, row.revision, closedAttempt, input.now));
    }
    // `reclaim` refuses to reopen a settled route. That rule stays in route-task.ts.
    next = reclaim(next, closedAttempt);
  }

  const persistedTask =
    canonicalJson(next) === canonicalJson(task.value)
      ? task
      : await repos.routeTasks.compareAndSet(task.id, task.revision, next, input.now);

  if (lease !== null && !lease.value.released) {
    await repos.leases.compareAndSet(
      input.routeTaskId,
      lease.revision,
      releaseLease(lease.value),
      input.now,
    );
  }

  return { task: persistedTask, closed, settled: false };
}

/**
 * **A LIVING WORKER THAT GAVE UP, WHICH IS NOT A WORKER THAT DIED.**
 * (Session B resume, W3.A, 2026-08-31.)
 *
 * `reclaimRouteTask` above refuses a lease that is still live, and that refusal
 * is right: death is only ever observed from outside, and a process that can
 * still tell us something has not died. But that leaves a real case with no
 * path — a worker that is alive, holds a live lease, and reached no boundary:
 * a bounded model worker that spent its ceiling, a route that returned nothing
 * usable, a shadow executor that deliberately performed no retrieval.
 *
 * Without this, such a worker had exactly two options and both were wrong. It
 * could write a terminal disposition it did not earn — which is how a failure
 * of ours becomes a claim about a government — or it could walk away holding
 * the lease until the TTL elapsed, so that the NEXT cycle diagnosed a live
 * worker as a dead one. The second is the shape the resume audit found: WORKED
 * with no Attempt, then an expired lease with nothing to reclaim.
 *
 * So the giving-up is recorded AS giving up. The Attempt closes under a
 * NON-disposition-bearing outcome, which `mayWriteDisposition` already refuses
 * to let carry a conclusion; its partial artifacts are preserved and stay
 * attributed to it; the RouteTask returns to RECLAIMABLE; and the lease is
 * released now rather than expiring later. The route is owed exactly as much
 * after this call as before it, which is the property that matters.
 */
export async function abandonAttempt(
  repos: ControlPlaneRepositories,
  input: {
    routeTaskId: string;
    attemptId: string;
    /** Any outcome except COMPLETED. A conclusion needs `disposeRouteTask`. */
    outcome: Exclude<AttemptOutcome, "COMPLETED">;
    /** Named, always. `endAttempt` refuses an unnamed one and so does this. */
    reason: string;
    now: string;
    /**
     * What the abandoned Attempt MEASURED. (Level 1 activation, 2026-09-01.)
     * A model worker that walked its ladder and reached no conclusion still
     * spent real tokens; an abandoned Attempt that dropped its cost would let
     * the rolling spend ceiling under-count exactly the Attempts most likely
     * to be repeated. Optional, because a killed worker reports nothing.
     */
    cost?: AttemptCost;
  },
): Promise<{ readonly task: Persisted<RouteTask>; readonly attempt: Persisted<Attempt> }> {
  const attemptRow = await repos.attempts.mustRead(input.attemptId);
  if (attemptRow.value.outcome !== null) {
    throw new AttemptContract(
      `Attempt ${input.attemptId} already ended as ${attemptRow.value.outcome}; abandoning it ` +
        "again would rewrite a settled record.",
    );
  }

  const artifacts = await artifactsForAttempt(
    repos,
    attemptRow.value.workItemId,
    attemptRow.value.id,
  );
  const closedAttempt = endAttempt(attemptRow.value, input.outcome, input.now, {
    abortReason: input.reason,
    artifactIds: artifacts.map((a) => a.artifactId),
    ...(input.cost ? { cost: input.cost } : {}),
  });
  const attempt = await repos.attempts.compareAndSet(
    attemptRow.id,
    attemptRow.revision,
    closedAttempt,
    input.now,
  );

  const taskRow = await repos.routeTasks.mustRead(input.routeTaskId);
  const next = closedAttempt.outcome === "DENIED_BY_POLICY"
    ? denyByPolicy(taskRow.value, closedAttempt, input.reason.includes("AUDIT_ROLLING_COST_CEILING")
      ? "The existing rolling-cost window must permit admission; never raise the ceiling to clear this refusal."
      : input.reason.includes("AUDIT_MODEL_TRANSPORT_UNAVAILABLE") ? "The configured audit model transport must become available."
        : input.reason.includes("SCOUT_POLICY_DENIED") ? "Our own spending guard refused the request before anything was sent; the work is checked again on a fixed pace and goes back in line when the guard permits it."
        : "The named capability or policy refusal must be resolved under current project law before reauthorization.")
    : reclaim(taskRow.value, closedAttempt);
  const task =
    canonicalJson(next) === canonicalJson(taskRow.value)
      ? taskRow
      : await repos.routeTasks.compareAndSet(taskRow.id, taskRow.revision, next, input.now);

  const lease = await repos.leases.read(input.routeTaskId);
  if (lease !== null && !lease.value.released) {
    await repos.leases.compareAndSet(
      input.routeTaskId,
      lease.revision,
      releaseLease(lease.value),
      input.now,
    );
  }

  return { task, attempt };
}

/** ---------------------------------------------------------- disposition */

/** The commit id is a pure function of what is being committed. */
export function dispositionCommitId(
  routeTaskId: string,
  attemptId: string,
  disposition: RouteDisposition,
): string {
  return `dc-${fingerprint([routeTaskId, attemptId, disposition.disposition, disposition.at])}`;
}

export interface DisposeOutcome {
  readonly task: Persisted<RouteTask>;
  readonly attempt: Persisted<Attempt>;
  readonly commit: DispositionCommit;
  /** False when this exact commit was already recorded — an idempotent retry. */
  readonly committed: boolean;
}

/**
 * Close an Attempt and dispose of its route, atomically.
 *
 * THE ORDER IS THE DESIGN:
 *
 *   1. Read both aggregates.
 *   2. COMPARE-AND-SET PRECONDITION, checked before anything is written. The
 *      caller states the RouteTask revision it read. A mismatch means the task
 *      moved underneath it — reclaimed, or disposed by someone else — and the
 *      write is refused by `ConcurrentModification`, naming what was expected
 *      and what was found. This is the stale-writer refusal, and it is the
 *      reason a worker that comes back from the dead cannot overwrite the
 *      finding of the worker that replaced it.
 *   3. LEASE OWNERSHIP, an independent guard. The revision check catches a task
 *      that MOVED; this catches a task whose lease changed hands without the
 *      revision happening to differ. Two guards, because one of them being
 *      sufficient in every case we thought of is not a proof.
 *   4. The DOMAIN computes both next values. `endAttempt` refuses an unnamed
 *      abort and a double close; `disposeRoute` refuses an Attempt that never
 *      reached a boundary, a second disposition, an `INGESTED` with no artifact,
 *      and a `WALKED_NO_YIELD` over an unreachable transport. Every one of those
 *      refusals fires HERE, before a single byte is written.
 *   5. ONE APPEND commits the pair. This is the atomic instant.
 *   6. The aggregate writes APPLY the commit, and are replayable.
 *
 * A process that dies between 5 and 6 leaves a commit whose application
 * `reconcile()` completes. A process that dies before 5 leaves nothing. There is
 * no third state, which is what "no half-write is observable by a later reader"
 * requires.
 */
export async function disposeRouteTask(
  repos: ControlPlaneRepositories,
  input: {
    routeTaskId: string;
    attemptId: string;
    /** The RouteTask revision this writer read. The compare half of the CAS. */
    expectedTaskRevision: number;
    disposition: RouteDisposition;
    now: string;
    artifactIds?: readonly string[];
    cost?: AttemptCost;
  },
): Promise<DisposeOutcome> {
  const task = await repos.routeTasks.mustRead(input.routeTaskId);
  if (task.value.workerTask) throw new AttemptContract("WORKER_TASK_CANNOT_WRITE_CIVIC_DISPOSITION");
  const attempt = await repos.attempts.mustRead(input.attemptId);

  if (task.revision !== input.expectedTaskRevision) {
    throw new ConcurrentModification(
      "RouteTask",
      input.routeTaskId,
      input.expectedTaskRevision,
      task.revision,
    );
  }

  const lease = await repos.leases.read(input.routeTaskId);
  if (lease !== null && lease.value.id !== attempt.value.leaseId) {
    throw new LeaseNotHeld(
      input.routeTaskId,
      attempt.value.worker.instance,
      lease.value.holder,
      `Attempt ${attempt.value.id} ran under lease ${attempt.value.leaseId}; the durable lease ` +
        `is now ${lease.value.id}.`,
    );
  }

  const closedAttempt = endAttempt(attempt.value, "COMPLETED", input.now, {
    artifactIds: input.artifactIds,
    cost: input.cost,
  });
  const disposedTask = disposeRoute(task.value, closedAttempt, input.disposition);

  const commit: DispositionCommit = {
    commitId: dispositionCommitId(input.routeTaskId, input.attemptId, input.disposition),
    routeTaskId: input.routeTaskId,
    workItemId: task.value.workItemId,
    attemptId: input.attemptId,
    disposition: input.disposition,
    closedAttempt,
    disposedTask,
    taskRevision: task.revision,
    attemptRevision: attempt.revision,
    committedAt: input.now,
  };

  const appended = await repos.dispositions.append(
    input.routeTaskId,
    commit.commitId,
    commit,
    input.now,
  );

  const applied = await applyDispositionCommit(repos, commit, input.now);
  return { ...applied, commit, committed: appended.appended };
}

/**
 * Apply a committed disposition to its two aggregates, idempotently.
 *
 * Called on the happy path and again by `reconcile()` after a crash, and it must
 * behave identically in both. "Already applied" is detected by VALUE — the
 * persisted aggregate already equals the committed one — rather than by
 * revision, because a recovery run has no way to know how many revisions the
 * store has taken since, and a revision-based check would refuse to finish a
 * recovery it is supposed to finish.
 */
async function applyDispositionCommit(
  repos: ControlPlaneRepositories,
  commit: DispositionCommit,
  now: string,
): Promise<{ readonly task: Persisted<RouteTask>; readonly attempt: Persisted<Attempt> }> {
  const attemptRow = await repos.attempts.mustRead(commit.attemptId);
  const attempt =
    canonicalJson(attemptRow.value) === canonicalJson(commit.closedAttempt)
      ? attemptRow
      : await repos.attempts.compareAndSet(
          commit.attemptId,
          attemptRow.revision,
          commit.closedAttempt,
          now,
        );

  const taskRow = await repos.routeTasks.mustRead(commit.routeTaskId);
  const task =
    canonicalJson(taskRow.value) === canonicalJson(commit.disposedTask)
      ? taskRow
      : await repos.routeTasks.compareAndSet(
          commit.routeTaskId,
          taskRow.revision,
          commit.disposedTask,
          now,
        );

  const lease = await repos.leases.read(commit.routeTaskId);
  if (lease !== null && !lease.value.released) {
    await repos.leases.compareAndSet(
      commit.routeTaskId,
      lease.revision,
      releaseLease(lease.value),
      now,
    );
  }

  return { task, attempt };
}

export interface ReconcileReport {
  readonly commitsSeen: number;
  /** Commit ids whose aggregate writes this run completed. */
  readonly healed: readonly string[];
}

/**
 * Finish every committed disposition whose aggregate writes did not land.
 *
 * This is what a fresh instance runs before it believes anything it reads. A
 * store with an unapplied commit is not corrupt and is not ambiguous — the
 * decision was made and recorded, and only its projection is missing. Recovering
 * it is a replay of values the domain already computed, so it cannot reach a
 * different answer than the one that was committed.
 */
export async function reconcile(
  repos: ControlPlaneRepositories,
  now: string,
): Promise<ReconcileReport> {
  const commits = await repos.dispositions.readAll();
  const healed: string[] = [];
  if (commits.length === 0) return { commitsSeen: 0, healed };
  const [taskRows, attemptRows] = await Promise.all([repos.routeTasks.list(), repos.attempts.list()]);
  const tasks = new Map(taskRows.map(row => [row.id, row]));
  const attempts = new Map(attemptRows.map(row => [row.id, row]));
  for (const commit of commits) {
    const task = tasks.get(commit.routeTaskId) ?? null;
    const attempt = attempts.get(commit.attemptId) ?? null;
    const taskApplied = task !== null && canonicalJson(task.value) === canonicalJson(commit.disposedTask);
    const attemptApplied =
      attempt !== null && canonicalJson(attempt.value) === canonicalJson(commit.closedAttempt);
    if (taskApplied && attemptApplied) continue;
    const applied = await applyDispositionCommit(repos, commit, now);
    tasks.set(commit.routeTaskId, applied.task);
    attempts.set(commit.attemptId, applied.attempt);
    healed.push(commit.commitId);
  }
  return { commitsSeen: commits.length, healed };
}

/** ------------------------------------------------- transitions and asks */

/** Move a WorkItem and append the transition to its replayable history. */
export async function transitionWorkItem(
  repos: ControlPlaneRepositories,
  input: { workItemId: string; to: WorkItemState; by: string; why: string; now: string },
): Promise<Persisted<WorkItem>> {
  const current = await repos.workItems.mustRead(input.workItemId);
  const transition = {
    from: current.value.state,
    to: input.to,
    at: input.now,
    by: input.by,
    why: input.why,
  };
  const next: WorkItem = {
    ...current.value,
    state: input.to,
    transitions: [...current.value.transitions, transition],
  };
  const persisted = await repos.workItems.compareAndSet(
    input.workItemId,
    current.revision,
    next,
    input.now,
  );
  const recorded: RecordedTransition = {
    transitionId: `tr-${fingerprint([input.workItemId, current.value.state, input.to, input.now, input.by])}`,
    workItemId: input.workItemId,
    transition,
  };
  await repos.transitions.append(input.workItemId, recorded.transitionId, recorded, input.now);
  return persisted;
}

/** Record an escalation on a WorkItem and in the replayable escalation log. */
export async function recordEscalation(
  repos: ControlPlaneRepositories,
  input: { workItemId: string; escalation: Escalation; now: string },
): Promise<Persisted<WorkItem>> {
  const current = await repos.workItems.mustRead(input.workItemId);
  const next: WorkItem = {
    ...current.value,
    escalations: [...current.value.escalations, input.escalation],
  };
  const persisted = await repos.workItems.compareAndSet(
    input.workItemId,
    current.revision,
    next,
    input.now,
  );
  await repos.escalations.append(
    input.workItemId,
    input.escalation.id,
    input.escalation,
    input.now,
  );
  return persisted;
}

/** ------------------------------------------------------ shared budgets */

/**
 * Ask the ONE shared budget for permission to make ONE request.
 *
 * Read, decide and write happen inside a single exclusive section, so N workers
 * contend on one persisted ledger rather than on N copies of it. Per-worker
 * politeness multiplies and is therefore not politeness — twelve individually
 * correct workers are twelve times the request rate the publisher was told to
 * expect.
 *
 * The result is a SCHEDULING answer. It cannot become a route disposition: there
 * is no path from here into `disposeRouteTask`, and the only way a budget stop
 * reaches an Attempt at all is as an `ABORTED` closure, which `disposeRoute`
 * refuses to let carry a conclusion.
 */
export async function acquireHostBudget(
  repos: ControlPlaneRepositories,
  input: { host: string; now: string; credentialId?: string },
): Promise<AcquireResult> {
  const outcome = await repos.budget.mutate<AcquireResult>((ledger: BudgetLedger) => {
    const result = tryAcquire(ledger, input.host, input.now, { credentialId: input.credentialId });
    return { ledger: result.ledger, result };
  }, input.now);
  return outcome.result;
}

/** Return a slot to the shared budget. */
export async function releaseHostBudget(
  repos: ControlPlaneRepositories,
  input: { host: string; now: string; credentialId?: string },
): Promise<BudgetLedger> {
  const outcome = await repos.budget.mutate<null>((ledger: BudgetLedger) => {
    const next = releaseBudgetSlot(ledger, input.host, { credentialId: input.credentialId });
    return { ledger: next, result: null };
  }, input.now);
  return outcome.persisted.value;
}

/** Append a cost record. Scheduling evidence, never truth evidence. */
export async function recordCost(
  repos: ControlPlaneRepositories,
  entry: CostEntry,
  now: string,
): Promise<AppendOutcome<CostEntry>> {
  const recordId = `ce-${fingerprint([entry.attemptId, entry.routeTaskId, entry.recordedAt])}`;
  return repos.costs.append(entry.workItemId, recordId, costEntryWithModel(entry, entry.model ?? null), now);
}

/** ----------------------------------------------------------- completion */

/**
 * Build a `CompletionSnapshot` from DURABLE state.
 *
 * `reconcile` runs first, always. A reader that evaluated completion over a
 * store with an unapplied commit would see a RouteTask with no disposition and
 * refuse an obligation that is in fact finished — and the refusal would be
 * indistinguishable from a genuine one, which is the worst possible shape for a
 * wrong answer in this system.
 *
 * Validations, audits, contradictions and upstream states are supplied by the
 * caller rather than loaded here: they belong to modules this one does not own,
 * and an absent input must refuse rather than default. `evaluateCompletion`
 * already treats an upstream missing from the map as UNRESOLVED.
 */
export async function loadCompletionSnapshot(
  repos: ControlPlaneRepositories,
  input: {
    workItemId: string;
    now: string;
    validations?: readonly ValidationRecord[];
    audits?: readonly AuditFinding[];
    contradictions?: readonly Contradiction[];
    upstreamStates?: ReadonlyMap<string, WorkItemState>;
    denominatorComplete?: boolean | null;
    /**
     * Instance/check ids a canonical instrument run has evaluated GREEN on a
     * qualifying tree. Supplied by the caller for the same reason validations
     * and audits are: the run records belong to `lib/health`, which this
     * module does not own, and loading them here would make the control plane
     * depend on the health harness rather than the other way round.
     */
    instrumentGreens?: ReadonlySet<string>;
  },
): Promise<CompletionSnapshot> {
  await reconcile(repos, input.now);
  await reconcileWorkerCompletions(repos);
  const workerEvidence = await loadWorkerCompletionEvidence(repos, input.workItemId);
  const item = await repos.workItems.mustRead(input.workItemId);
  const tasks = await repos.routeTasks.list();
  return {
    item: item.value,
    routeTasks: tasks
      .filter((row) => row.value.workItemId === input.workItemId)
      .map((row) => row.value),
    validations: workerEvidence.managed ? workerEvidence.validations : input.validations ?? [],
    audits: workerEvidence.managed ? workerEvidence.audits : input.audits ?? [],
    contradictions: input.contradictions ?? [],
    upstreamStates: input.upstreamStates ?? new Map<string, WorkItemState>(),
    denominatorComplete: input.denominatorComplete ?? null,
    /* Absent input is an EMPTY set, never a permissive one: a caller that did
       not read the canonical run records has not proven a verdict, and the
       contract clause refuses on exactly that. */
    instrumentGreens: input.instrumentGreens ?? new Set<string>(),
    now: input.now,
  };
}
