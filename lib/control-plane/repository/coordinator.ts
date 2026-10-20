/**
 * Atomic claim, lease and disposition over durable state. Domain rules live in attempt.ts, route-task.ts,
 * work-item.ts and completion.ts; this module adds only what a pure function cannot:
 *   1. Claims are a conditional write to the lease slot (one slot per RouteTask), lock-free on purpose.
 *   2. Lease renewal checks ownership here; `heartbeat()` can only check expiry.
 *   3. A disposition is committed as one append, and the two aggregate writes apply that commit;
 *      `reconcile()` finishes any commit whose writes did not land.
 * Nothing in the disposition path reads a budget or cost. Time is always a parameter.
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
import { costRecordId, countCharge } from "../spend-window.ts";
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

/** Distinct from `LeaseConflict` ("someone else has it"): this caller is acting on a lease it no longer holds. */
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

/** A disposed route is never claimed again; what the obligation still owes belongs to its evidence and next occurrence. */
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

/** Idempotently persist a WorkItem. A re-put of the identical item is a no-op. */
export async function registerWorkItem(
  repos: ControlPlaneRepositories,
  item: WorkItem,
  now: string,
): Promise<Persisted<WorkItem>> {
  const outcome = await repos.workItems.put(item.id, item, now);
  return outcome.persisted;
}

/** The link write is skipped when it would be a no-op, so re-registering a task does not churn the WorkItem's revision. */
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

export interface ClaimOutcome {
  readonly lease: Persisted<ExecutionLease>;
  readonly task: Persisted<RouteTask>;
}

/**
 * Lock-free: the race is one conditional write to the lease slot. Both storage refusals become
 * `LeaseConflict`. A disposed task is refused with `RouteTaskSettled` before the slot is touched.
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

/** Ownership is checked here first; expiry is checked in `attempt.ts`. An expired lease must be re-claimed, not renewed. */
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

/** The lease is re-checked against durable state: a stale lease object after a reclaim must not open a second live Attempt. */
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

/** A filtered read by RouteTask, never the whole table. */
export async function attemptsForRouteTask(
  repos: ControlPlaneRepositories,
  routeTaskId: string,
): Promise<readonly Persisted<Attempt>[]> {
  const mine = await repos.attempts.listWhere(["routeTaskId"], routeTaskId);
  return [...mine].sort((a, b) => (a.value.startedAt < b.value.startedAt ? -1 : 1));
}

/** Metadata only; the bytes live in the vault. The named Attempt must already be persisted. */
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
     * An artifact id is content-derived, so a byte-identical re-record under a new Attempt is an idempotent
     * success and the first attribution stands. The same id with different content is re-thrown.
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

export interface ReclaimOutcome {
  readonly task: Persisted<RouteTask>;
  readonly closed: readonly Persisted<Attempt>[];
  /** True when the RouteTask was already disposed: only the dead lease was released. Not a reclaim. */
  readonly settled: boolean;
}

/**
 * The only evidence of death is a lease that stopped being renewed. The abandoned Attempt closes as
 * LEASE_EXPIRED with a named reason, never COMPLETED and never with a disposition; its partial artifacts
 * stay attributed to it.
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

  /* A dead lease on a disposed route is released with one compare-and-set, and nothing else moves. */
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
 * A live worker that gave up: the Attempt closes under a non-disposition outcome, partial artifacts are
 * kept, the RouteTask returns to RECLAIMABLE and the lease is released now. The route stays owed.
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
    /** What the abandoned Attempt measured, so the spend ceiling counts it. Optional: a killed worker reports nothing. */
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
 * Order matters:
 *   1. Read both aggregates.
 *   2. Compare-and-set precondition on the RouteTask revision the caller read (stale-writer refusal).
 *   3. Lease ownership, an independent guard.
 *   4. The domain computes both next values; every refusal fires before anything is written.
 *   5. One append commits the pair.
 *   6. The aggregate writes apply the commit and are replayable via `reconcile()`.
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

/** "Already applied" is detected by value, not revision, so a recovery after a crash can finish. */
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

/** Run by a fresh instance before it believes anything it reads; a replay of values already committed. */
export async function reconcile(
  repos: ControlPlaneRepositories,
  now: string,
  scope?: { readonly workItemIds: readonly string[] },
): Promise<ReconcileReport> {
  if (scope) {
    let commitsSeen = 0;
    const healed: string[] = [];
    for (const workItemId of new Set(scope.workItemIds)) {
      const tasks = await repos.routeTasks.listWhereNarrowed(["workItemId"], workItemId, {});
      for (const task of tasks) await repos.dispositions.readChangedSince(null, undefined, { keys: [task.id], page: async rows => {
        for (const { record: commit } of rows) {
          if (commit.workItemId !== workItemId || commit.routeTaskId !== task.id) throw new Error("DISPOSITION_RECONCILE_SCOPE_MISMATCH");
          commitsSeen++;
          const [heldTask, heldAttempt] = await Promise.all([repos.routeTasks.read(task.id), repos.attempts.read(commit.attemptId)]);
          if (heldTask && canonicalJson(heldTask.value) === canonicalJson(commit.disposedTask) &&
              heldAttempt && canonicalJson(heldAttempt.value) === canonicalJson(commit.closedAttempt)) continue;
          await applyDispositionCommit(repos, commit, now);
          healed.push(commit.commitId);
        }
      } });
    }
    return { commitsSeen, healed };
  }
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

/** Read, decide and write happen in one exclusive section, so workers contend on one persisted ledger. */
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

/** Append a cost record and count its model charge in the spend window. Scheduling evidence, never truth evidence. */
export async function recordCost(
  repos: ControlPlaneRepositories,
  entry: CostEntry,
  now: string,
): Promise<AppendOutcome<CostEntry>> {
  const recorded = costEntryWithModel({ ...entry,
    ...(entry.cost.modelRequestCount === undefined ? {} : { costPolicy: "R7" as const }) }, entry.model ?? null);
  const appended = await repos.costs.append(entry.workItemId, costRecordId(entry), recorded, now);
  await countCharge(repos, recorded, now);
  return appended;
}

/** `reconcile` runs first. Validations, audits, contradictions and upstream states come from the caller; an absent input refuses. */
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
    /** Instance/check ids a canonical instrument run evaluated GREEN; supplied by the caller. */
    instrumentGreens?: ReadonlySet<string>;
  },
): Promise<CompletionSnapshot> {
  await reconcile(repos, input.now, { workItemIds: [input.workItemId] });
  await reconcileWorkerCompletions(repos, { workItemIds: [input.workItemId] });
  const workerEvidence = await loadWorkerCompletionEvidence(repos, input.workItemId);
  const item = await repos.workItems.mustRead(input.workItemId);
  const tasks = await repos.routeTasks.listWhere(["workItemId"], input.workItemId);
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
