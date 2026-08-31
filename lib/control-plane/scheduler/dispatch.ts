/**
 * **DISPATCH — THE SCHEDULER HANDS DUE WORK TO DISPOSABLE WORKERS.**
 * (Session B, W3.4, 2026-08-30.)
 *
 * ```
 *   claim due work  ->  decide the executor  ->  run it  ->  record  ->
 *   compute next due  ->  repeat, without an operator
 * ```
 *
 * ## What is NOT here, deliberately
 *
 * No lease implementation, no CAS, no reclaim rule. `coordinator.ts` owns all
 * of that and it is already proven — the Pima shadow run recorded a lease
 * expiring, partial evidence preserved, and a reclaimed replacement Attempt.
 * A scheduler that re-implemented claiming would be a second control plane
 * beside the repositories, which RULING 220's step 7 forbids by name. This
 * module decides WHAT to run and WHO runs it, and asks the coordinator for
 * everything else.
 *
 * ## The executor choice, and why it is a rule rather than a preference
 *
 * ```
 *   a GRADUATED method exists   ->  deterministic code
 *   otherwise                   ->  a bounded headless model worker
 * ```
 *
 * A graduated route is one the method store has seen work repeatedly enough to
 * classify. Running a model against a route we already know how to walk spends
 * tokens to re-derive a known answer and introduces variance into a
 * deterministic result. Running deterministic code against a route nobody has
 * graduated is a guess with a fixed shape. The rule is one line and it is the
 * whole of the choice.
 *
 * `bounded` is load-bearing on the model side: a worker with no ceiling on
 * attempts, wall time or cost is a worker that can spend the budget on one
 * route. The bound is stated per dispatch and recorded with the result.
 *
 * ## The seeded failure this module is written against
 *
 * > A worker killed mid-Attempt leaves no terminal disposition and the
 * > RouteTask is reclaimed by the next worker.
 *
 * That is why `runDueWork` does not close an Attempt in a `finally`. A killed
 * process runs no `finally`, so a design that depended on one would pass a test
 * that simulated death by throwing and fail the one that actually kills. Death
 * is observed from OUTSIDE, by a lease that stopped being renewed, and the
 * recovery path is `reclaimRouteTask` — which is the coordinator's, and which
 * `sweepExpiredLeases` below simply drives.
 */

import { isExpired } from "../attempt.ts";
import {
  claimRouteTask,
  reclaimRouteTask,
  type ClaimOutcome,
} from "../repository/coordinator.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";

import type { ScheduledObligation } from "./obligation.ts";

/** Who runs a piece of due work. Decided per obligation, recorded per run. */
export const EXECUTOR_KINDS = ["DETERMINISTIC", "BOUNDED_MODEL_WORKER"] as const;
export type ExecutorKind = (typeof EXECUTOR_KINDS)[number];

/** The ceiling a model worker runs under. Stated, never implicit. */
export interface WorkerBound {
  readonly maxAttempts: number;
  readonly maxWallMs: number;
  /** Tokens, or whatever unit the cost ledger counts. Zero is not "unlimited". */
  readonly maxCostUnits: number;
}

export const DEFAULT_WORKER_BOUND: WorkerBound = {
  maxAttempts: 3,
  maxWallMs: 120_000,
  maxCostUnits: 50_000,
};

/**
 * What the method store says about this route, reduced to the one bit dispatch
 * needs. Injected rather than imported so this module stays pure over data and
 * the method store stays the method store's business.
 */
export type MethodMaturity = (route: string | null) => "GRADUATED" | "UNGRADUATED";

/**
 * Choose the executor.
 *
 * An obligation with NO route id is ungraduated by definition — there is no
 * route to have graduated — and goes to the bounded worker, whose first job is
 * to find one. That is the honest reading: "we do not know how to walk this"
 * is exactly the case the model worker exists for.
 */
export function chooseExecutor(
  obligation: ScheduledObligation,
  maturity: MethodMaturity,
): { readonly kind: ExecutorKind; readonly why: string } {
  const routeId = obligation.obligation.routeId;
  if (routeId !== null && maturity(routeId) === "GRADUATED") {
    return {
      kind: "DETERMINISTIC",
      why: `route ${routeId} is graduated in the method store, so the deterministic walker owns it`,
    };
  }
  return {
    kind: "BOUNDED_MODEL_WORKER",
    why:
      routeId === null
        ? "this obligation names no route yet, so there is nothing graduated to run"
        : `route ${routeId} is not graduated, so a bounded worker walks it under a stated ceiling`,
  };
}

/** What one dispatched unit of work did. Recorded whatever the outcome. */
export interface DispatchResult {
  readonly obligationId: string;
  readonly routeTaskId: string | null;
  readonly executor: ExecutorKind | null;
  readonly claimed: boolean;
  /** Null when nothing ran. Never a default outcome standing in for a run. */
  readonly outcome: "WORKED" | "FAILED" | "NOT_CLAIMED" | "NO_ROUTE_TASK" | null;
  readonly detail: string;
}

/**
 * The executor seam. The shadow runner and the tests supply this; nothing in
 * this module knows how to fetch anything.
 *
 * It returns a disposition-shaped result and NEVER throws for a route-level
 * failure — a thrown transport error would be indistinguishable here from a
 * defect in the scheduler itself, and the two need different handling.
 */
export type RunWork = (input: {
  readonly obligation: ScheduledObligation;
  readonly routeTaskId: string;
  readonly executor: ExecutorKind;
  readonly bound: WorkerBound;
  readonly holder: string;
}) => Promise<{ readonly ok: boolean; readonly detail: string }>;

/**
 * Claim and run one obligation's due work.
 *
 * A losing claim is a NORMAL outcome and is recorded as one. Two workers
 * reaching for one route is the contention the lease exists to arbitrate, and
 * treating the loser as an error would make ordinary concurrency read as a
 * failure rate.
 */
export async function dispatchOne(
  repos: ControlPlaneRepositories,
  input: {
    readonly obligation: ScheduledObligation;
    readonly routeTaskId: string | null;
    readonly holder: string;
    readonly now: string;
    readonly leaseTtlMs: number;
    readonly bound?: WorkerBound;
    readonly maturity: MethodMaturity;
    readonly run: RunWork;
  },
): Promise<DispatchResult> {
  const obligationId = input.obligation.obligation.id;
  if (input.routeTaskId === null) {
    return {
      obligationId,
      routeTaskId: null,
      executor: null,
      claimed: false,
      outcome: "NO_ROUTE_TASK",
      detail:
        "this obligation has no RouteTask registered, so there is nothing to claim. Recorded " +
        "rather than skipped: an obligation the dispatcher cannot reach is a scheduling gap, " +
        "and a gap nothing counts is a gap nobody fixes.",
    };
  }

  let claimOutcome: ClaimOutcome;
  try {
    claimOutcome = await claimRouteTask(repos, {
      routeTaskId: input.routeTaskId,
      holder: input.holder,
      now: input.now,
      ttlMs: input.leaseTtlMs,
    });
  } catch (error) {
    /* A live foreign lease. The other worker has it; this one moves on. */
    return {
      obligationId,
      routeTaskId: input.routeTaskId,
      executor: null,
      claimed: false,
      outcome: "NOT_CLAIMED",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const executor = chooseExecutor(input.obligation, input.maturity);
  const result = await input.run({
    obligation: input.obligation,
    routeTaskId: input.routeTaskId,
    executor: executor.kind,
    bound: input.bound ?? DEFAULT_WORKER_BOUND,
    holder: input.holder,
  });

  return {
    obligationId,
    routeTaskId: input.routeTaskId,
    executor: executor.kind,
    claimed: true,
    outcome: result.ok ? "WORKED" : "FAILED",
    detail: `${executor.why}; lease ${claimOutcome.lease.value.id}: ${result.detail}`,
  };
}

/**
 * **RECLAIM EVERY ROUTE WHOSE HOLDER STOPPED RENEWING.**
 *
 * This is the answer to the seeded failure. A worker killed mid-Attempt runs
 * no cleanup, so the ONLY observable trace is a lease that stopped being
 * renewed — which is precisely what this looks for, from outside, on the next
 * pass. `reclaimRouteTask` closes the abandoned Attempt with its partial
 * evidence attributed to the DEAD worker and leaves the task reclaimable.
 *
 * A lease that is still live is skipped rather than forced: "this process has
 * not heard from that worker" is not "that worker is dead", and reclaiming a
 * live lease would let two workers walk one route, which is the duplicated side
 * effect the whole lease mechanism exists to prevent.
 */
export interface ReclaimSweep {
  readonly reclaimed: readonly string[];
  readonly stillLive: readonly string[];
  readonly refused: readonly { readonly routeTaskId: string; readonly why: string }[];
}

export async function sweepExpiredLeases(
  repos: ControlPlaneRepositories,
  input: { readonly now: string; readonly observedBy: string },
): Promise<ReclaimSweep> {
  const reclaimed: string[] = [];
  const stillLive: string[] = [];
  const refused: { routeTaskId: string; why: string }[] = [];

  for (const row of await repos.leases.list()) {
    const lease = row.value;
    if (lease.released) continue;
    if (!isExpired(lease, input.now)) {
      stillLive.push(lease.routeTaskId);
      continue;
    }
    try {
      await reclaimRouteTask(repos, {
        routeTaskId: lease.routeTaskId,
        now: input.now,
        observedBy: input.observedBy,
      });
      reclaimed.push(lease.routeTaskId);
    } catch (error) {
      /* NothingToReclaim is the honest case where a lease expired before any
         Attempt opened. Recorded, never swallowed. */
      refused.push({
        routeTaskId: lease.routeTaskId,
        why: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { reclaimed, stillLive, refused };
}
