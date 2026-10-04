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

import { isExpired, type AttemptCost, type AttemptOutcome, type WorkerRef } from "../attempt.ts";
import {
  abandonAttempt,
  beginAttemptFor,
  claimRouteTask,
  disposeRouteTask,
  reclaimRouteTask,
  recordArtifactMetadata,
  recordCost,
  renewLease,
  type ClaimOutcome,
} from "../repository/coordinator.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../repository/types.ts";
import type { RouteDisposition } from "../route-task.ts";
import { completeWorkerTask, reconcileWorkerCompletions, type UncommittedWorkerResult } from "../repository/worker-completion.ts";
import { PolicyRefusal } from "../capability.ts";
import { isProofProject, type COST_RESULT_WITHOUT_DISPOSITION, type CostEntry, type CostModelShare } from "../cost.ts";
import { questionOfObligation } from "../work-question.ts";

import { currentAssignmentRefs, type FreshnessObligation, type ScheduledObligation } from "./obligation.ts";

type CostResultWithoutDisposition = (typeof COST_RESULT_WITHOUT_DISPOSITION)[number];

/**
 * **WHAT A CHARGE WAS FOR** (MW-001, MW-013; 2026-09-25), from the obligation
 * the dispatch is a round of: its id, the owner's Sends recorded on it (an
 * empty list is a fact: none reached it), its record class, and the question
 * the round asks. The question is derived only for a durable standing row —
 * one that carries its occurrence count — exactly as `openOccurrence` derived
 * it for the round's work item; a caller's hand-built obligation gets none.
 */
export function chargePurposeOf(o: FreshnessObligation): Pick<CostEntry, "obligationId" | "assignmentKeys" | "assignmentRefs" | "recordClass" | "question"> {
  const standingRow = typeof (o as { readonly occurrenceCount?: unknown }).occurrenceCount === "number";
  const question = standingRow ? questionOfObligation(o) : null;
  return {
    obligationId: o.id,
    assignmentKeys: [...new Set((o.assignments ?? []).map((a) => a.assignmentKey))],
    assignmentRefs: currentAssignmentRefs(o.assignments),
    recordClass: o.recordClass,
    ...(question !== null ? { question } : {}),
  };
}

/**
 * MW-024: the `dispatchOne` inputs that keep a proof run's charges apart — its
 * own project and the non-production mark — when the work belongs to a proof
 * or conformance project; nothing otherwise, so production charges are
 * written exactly as before.
 */
export function proofChargeOf(project: string | null | undefined): { readonly costProject?: string; readonly nonProduction?: true } {
  return typeof project === "string" && isProofProject(project) ? { costProject: project, nonProduction: true } : {};
}

/** Who runs a piece of due work. Decided per obligation, recorded per run. */
export const EXECUTOR_KINDS = ["DETERMINISTIC", "BOUNDED_MODEL_WORKER"] as const;
export type ExecutorKind = (typeof EXECUTOR_KINDS)[number];

/** The ceiling a model worker runs under. Stated, never implicit. */
export interface WorkerBound {
  readonly maxAttempts: number;
  readonly maxWallMs: number;
  /** Legacy diagnostic annotation; actual spend is reserved per request. */
  readonly maxCostUnits?: number;
}

/**
 * CH-07: the clock on every hunter. A hunter that reaches it stops, saves the
 * steps it walked as its case file and hands the next turn to a detective. It
 * sits below the worker process's own kill timeout (10 minutes) so the hunter
 * ends itself, with its case file, before the process is killed. A code
 * default until the admin setting exists; `WTP_HUNTER_WALL_MS` overrides it.
 */
export const HUNTER_WALL_LIMIT_MS = 8 * 60_000;

export function hunterWallLimitMs(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = Number(env.WTP_HUNTER_WALL_MS);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : HUNTER_WALL_LIMIT_MS;
}

export const DEFAULT_WORKER_BOUND: WorkerBound = {
  maxAttempts: 3,
  maxWallMs: HUNTER_WALL_LIMIT_MS,
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

/**
 * **THE ONE EXECUTOR-DECISION RULE.** (Level 1 activation, 2026-09-01. RULING 240.)
 *
 * Two classifications exist and they encode DIFFERENT facts, so both survive:
 *
 * ```
 *   descriptor.executorClass + open.kind   the PROVIDER's declaration: does a
 *                                          derived, machine-executable shape
 *                                          exist for THIS representation?
 *   method maturity                        the METHOD STORE's knowledge: has
 *                                          the project learned a route by
 *                                          this id? (route ids and method ids
 *                                          are different namespaces today, so
 *                                          this is usually UNGRADUATED)
 * ```
 *
 * The rule, entire:
 *
 * ```
 *   a machine-executable shape exists (declared, or graduated since)  ->  DETERMINISTIC
 *   no shape exists to replay — genuine unresolved novelty            ->  BOUNDED_MODEL_WORKER
 * ```
 *
 * A route declared DETERMINISTIC never consumes a model because one is
 * available. A route declared BOUNDED_MODEL_WORKER that the store has since
 * graduated AND that has an executable opening runs deterministically — the
 * legitimate graduation case — and the disagreement is RECORDED. A
 * declaration that contradicts its own opening is recorded as a contradiction
 * and never silently reconciled.
 */
export interface ExecutorDecision {
  readonly kind: ExecutorKind;
  readonly why: string;
  /** A disagreement between the two classifications, or a contradiction within one. Never reconciled silently. */
  readonly disagreement: string | null;
}

export interface DecidableDescriptor {
  readonly executorClass: ExecutorKind;
  readonly open: { readonly kind: string };
  readonly executorReason?: string;
}

export function decideExecutor(input: {
  readonly routeId: string | null;
  readonly descriptor: DecidableDescriptor | null;
  readonly maturity: MethodMaturity;
}): ExecutorDecision {
  const { routeId, descriptor } = input;
  const graduated = routeId !== null && input.maturity(routeId) === "GRADUATED";
  if (descriptor === null) {
    return graduated
      ? {
          kind: "DETERMINISTIC",
          why: `route ${routeId} is graduated in the method store and no descriptor overrides it`,
          disagreement: null,
        }
      : {
          kind: "BOUNDED_MODEL_WORKER",
          why:
            routeId === null
              ? "this obligation names no route and no descriptor, so a Scout's first job is to find one"
              : `route ${routeId} has no descriptor and is not graduated, so nothing exists to replay`,
          disagreement: null,
        };
  }
  const executable = descriptor.open.kind !== "NOT_MACHINE_EXECUTABLE";
  const reason = descriptor.executorReason ? ` (${descriptor.executorReason})` : "";

  if (descriptor.executorClass === "DETERMINISTIC") {
    if (executable) {
      return {
        kind: "DETERMINISTIC",
        why: `the provider declares a derived ${descriptor.open.kind} shape for route ${routeId}${reason}; a model is never spent on a known shape`,
        disagreement: null,
      };
    }
    return {
      kind: "DETERMINISTIC",
      why: `route ${routeId} is declared DETERMINISTIC; a declared-deterministic route never consumes a model`,
      disagreement:
        `CONTRADICTION: route ${routeId} is declared DETERMINISTIC with a NOT_MACHINE_EXECUTABLE opening. ` +
        "The deterministic executor will dispose REQUIRES_NEW_ADAPTER; the provider's declaration is wrong on its own terms.",
    };
  }

  /* Declared BOUNDED_MODEL_WORKER. */
  if (executable && graduated) {
    return {
      kind: "DETERMINISTIC",
      why: `route ${routeId} was declared novel and the method store has since graduated it with an executable opening; deterministic replay owns it now`,
      disagreement: `GRADUATED_SINCE_DECLARED: the provider still declares route ${routeId} BOUNDED_MODEL_WORKER; the method store lists it as learned`,
    };
  }
  if (executable) {
    return {
      kind: "BOUNDED_MODEL_WORKER",
      why: `route ${routeId} is declared novel${reason}; the declaration is honoured`,
      disagreement:
        `DECLARED_NOVEL_WITH_EXECUTABLE_OPENING: route ${routeId} carries a ${descriptor.open.kind} opening while declared ` +
        "BOUNDED_MODEL_WORKER; the Scout may open it through its tools",
    };
  }
  return {
    kind: "BOUNDED_MODEL_WORKER",
    why: `route ${routeId} has no machine-executable opening${reason}; genuine unresolved novelty runs a bounded Scout`,
    disagreement: graduated
      ? `GRADUATED_WITHOUT_OPENING: the method store lists route ${routeId} as learned but no executable opening is registered for it`
      : null,
  };
}

/**
 * **WHAT A WORKER PRODUCED, AND WHETHER IT IS A CONCLUSION.**
 * (Session B resume, W3.A, 2026-08-31.)
 *
 * The three kinds are not severity levels. They are three different things to
 * have happened, and the reason they are separate is that the previous seam
 * returned `{ ok: boolean }` — under which a no-op executor's `ok: true` was
 * indistinguishable from a completed retrieval, and cleared the freshness debt
 * on that basis. Eight dispatches read WORKED having fetched nothing.
 *
 * ```
 *   DISPOSED    a route was walked to a terminal disposition. The ONLY kind
 *               that may clear debt, and it must carry the disposition.
 *   SIMULATED   a shadow decision. Work was chosen, and deliberately not done.
 *   ABORTED     work was attempted and reached no boundary.
 * ```
 *
 * SIMULATED and ABORTED differ in what they say about the world: the first is
 * a statement about US (we declined to walk it), the second about the ATTEMPT
 * (we walked and got nowhere). Neither is a statement about the publisher, and
 * neither may become one.
 */
export const WORK_OUTCOME_KINDS = ["DISPOSED", "RESULT_RECORDED", "SIMULATED", "ABORTED"] as const;
export type WorkOutcomeKind = (typeof WORK_OUTCOME_KINDS)[number];

/**
 * An artifact the worker actually retrieved, as the control plane records it.
 *
 * The bytes go to the evidence vault; this is the attribution. `attemptId` and
 * `workItemId` are filled by the dispatcher, because a worker that chose its
 * own attribution could attribute evidence to an Attempt that never ran.
 */
export type WorkArtifact = Omit<ArtifactRecord, "attemptId" | "workItemId" | "routeTaskId">;

/**
 * The terminal disposition, minus the three fields the dispatcher owns.
 *
 * `attemptId`, `at` and `artifactIds` are omitted deliberately: they are facts
 * about the execution the dispatcher supervised, not findings the worker is
 * entitled to assert. A worker that could set its own `artifactIds` could
 * claim an INGESTED disposition over artifacts it never recorded.
 */
export type WorkDisposition = Omit<RouteDisposition, "attemptId" | "at" | "artifactIds">;

export interface WorkOutcome {
  readonly failureOutcome?: Exclude<AttemptOutcome, "COMPLETED">;
  readonly endedAt?: string;
  readonly workerResult?: UncommittedWorkerResult;
  readonly kind: WorkOutcomeKind;
  /**
   * **WHICH EXECUTOR ACTUALLY RAN.** (Session B closure, W3.E, 2026-08-31.)
   *
   * `chooseExecutor` DECIDES; the injected worker RUNS. Nothing connected the
   * two, so the run record reported the decision as though it were the fact —
   * and it was wrong on every cycle of the 2026-08-31 shadow runs, which
   * recorded 10 BOUNDED_MODEL_WORKER Attempts for work a deterministic HTTP
   * walker did.
   *
   * That is a cost and provenance defect, not a cosmetic one: an Attempt
   * labelled as a model worker invites a reader of the ledger to attribute
   * model spend and model variance to a run that had neither.
   *
   * Required, so a worker cannot decline to say. The dispatcher records THIS
   * as the executor and reports a disagreement with the decision rather than
   * quietly preferring either.
   */
  readonly ranAs: ExecutorKind;
  /** Required when kind is DISPOSED, refused otherwise. */
  readonly disposition?: WorkDisposition;
  readonly artifacts?: readonly WorkArtifact[];
  /** Measured. `ZERO_COST` is a measurement of nothing, not an absent one. */
  readonly cost?: AttemptCost;
  /** Exact existing job hold carried by the runner's typed Scout result. */
  readonly spendHoldJobId?: string;
  /**
   * The per-model split of `cost` when the worker ran more than one model
   * (MW-031, 2026-09-25: a Scout that escalated). Written onto the ledger row
   * as `byModel`, so a cost-by-model view gives each model its own part of
   * the ONE charge instead of all of it to the model the Attempt started on.
   */
  readonly costByModel?: readonly CostModelShare[];
  readonly detail: string;
}

/** What one dispatched unit of work did. Recorded whatever the outcome. */
export interface DispatchResult {
  readonly obligationId: string;
  readonly routeTaskId: string | null;
  /**
   * What actually ran, as the worker reported it. The FACT.
   *
   * Named `executor` still, because that is what every consumer means by it —
   * and it now holds the thing they were all assuming it held.
   */
  readonly executor: ExecutorKind | null;
  /** What `chooseExecutor` decided. The DECISION, kept for the disagreement. */
  readonly executorChosen: ExecutorKind | null;
  /** The decision rule's own recorded disagreement between classifications, if any. */
  readonly decisionDisagreement: string | null;
  /**
   * True when the worker ran something other than what was chosen.
   *
   * Recorded rather than refused. A seam whose implementation ignores the
   * decision is a real and sometimes legitimate arrangement — the shadow
   * runner injects one deterministic walker for every obligation — and the
   * defect was never that it happened, but that nothing said so.
   */
  readonly executorMismatch: boolean;
  readonly claimed: boolean;
  /**
   * Null when nothing ran. Never a default outcome standing in for a run.
   *
   * `WORKED` is issued by exactly one code path below — the one that committed
   * a disposition through the coordinator — and `dispositionCommitted` beside
   * it is what a test asserts against, so a WORKED with no committed
   * disposition is not merely wrong but unrepresentable.
   */
  readonly outcome:
    | "WORKED"
    | "FAILED"
    | "SIMULATED"
    | "NOT_CLAIMED"
    | "NO_ROUTE_TASK"
    | null;
  /** The Attempt this dispatch opened, when it opened one. */
  readonly attemptId: string | null;
  /** True only when `disposeRouteTask` committed a terminal disposition. */
  readonly dispositionCommitted: boolean;
  /** The disposition committed, for the digest. Null whenever none was. */
  readonly disposition: string | null;
  /** Artifact ids recorded against the Attempt. Never a count on its own. */
  readonly artifactIds: readonly string[];
  readonly cost: AttemptCost | null;
  /** The worker that ran it — model and provider included. Null if none ran. */
  readonly worker: WorkerRef | null;
  readonly detail: string;
}

/**
 * **THE DISPOSITIONS THAT ARE A FRESH READING OF THE RECORD.**
 *
 * Exactly two, and the list is short for a reason that is the acquisition
 * doctrine's rather than the scheduler's.
 *
 * ```
 *   INGESTED          the route was walked and returned the record
 *   WALKED_NO_YIELD   the route was REACHED and genuinely returned nothing
 * ```
 *
 * Every other disposition is a fact about the ROUTE, not a reading of the
 * record. `BLOCKED_CURRENTLY` says a wall stopped us; `REQUIRES_NEW_ADAPTER`
 * says we lack the tooling; `RECORDS_REQUEST_PENDING` says we asked and are
 * waiting; `RECHECK_DUE` says the answer has aged out. Each of those closes a
 * RouteTask and NONE of them refreshes anything a reader is shown.
 *
 * "A route disposition closes a RouteTask and never closes the record
 * obligation" is CLAUDE.md's, and this is where a freshness clock either
 * honours it or quietly does not: a scheduler that treated a committed
 * `BLOCKED_CURRENTLY` as discharge would clear the debt, recompute the
 * next-due from a walk that hit a wall, and report the record as fresh. That
 * is a blocked route becoming a blocked fact by arithmetic.
 */
export const DISCHARGING_DISPOSITIONS: readonly string[] = ["INGESTED", "WALKED_NO_YIELD"];

/**
 * **ONLY A COMMITTED READING DISCHARGES A FRESHNESS OBLIGATION.**
 *
 * One exported predicate rather than an `outcome === "WORKED"` comparison at
 * each call site, because the rule it encodes is the one the resume audit
 * found broken and the one most likely to be re-broken by a later edit that
 * adds a fourth outcome. A new outcome is not discharging unless someone
 * changes this function, and changing this function is a visible act.
 */
export function dischargesObligation(result: DispatchResult): boolean {
  return (
    result.outcome === "WORKED" &&
    result.dispositionCommitted &&
    result.disposition !== null &&
    DISCHARGING_DISPOSITIONS.includes(result.disposition)
  );
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
  readonly workItemId: string;
  /** The Attempt this work runs inside. Artifacts attribute to it. */
  readonly attemptId: string;
  readonly executor: ExecutorKind;
  readonly bound: WorkerBound;
  readonly holder: string;
  /** The existing canonical heartbeat owns renewal health for publication callers. */
  readonly assertLeaseHealthy?: () => void;
}) => Promise<WorkOutcome>;

/**
 * Who the dispatcher says is running this, when the caller does not say.
 *
 * A `WorkerRef` is required to open an Attempt at all, and the version field
 * is the one RULING-named threat this carries: "silent model/provider change".
 * A deterministic walker is not a model and says so in both fields rather than
 * borrowing a model's identity.
 */
/**
 * **AN EXECUTOR DECLARES ITS LANE BEFORE ANYTHING IS PERSISTED.**
 * (Session B closure, W3.E regression, 2026-08-31.)
 *
 * `ranAs` on the outcome fixed the RETURNED result and left the PERSISTED one
 * wrong. `dispatchOne` chose a lane, built a `WorkerRef` from it, opened the
 * Attempt with that WorkerRef, and only afterwards learned what had actually
 * run — so a deterministic HTTP walk was persisted under
 * `provider: "anthropic", version: "unspecified-model"`, and the cost ledger
 * keyed on that Attempt inherited the same fiction. The returned object said
 * DETERMINISTIC while the durable record said a model ran.
 *
 * The fix is ordering, not reconciliation: the lane is DECLARED by the
 * executor, the WorkerRef is built from the declaration, and the Attempt is
 * opened with the truth. `chooseExecutor`'s decision is kept beside it and any
 * disagreement is recorded — the shadow runner legitimately injects one
 * deterministic walker for every obligation, and that is an arrangement to
 * state rather than to forbid.
 *
 * A worker whose `ranAs` then contradicts its own declaration IS refused. That
 * is not a disagreement between two honest parties; it is one party lying about
 * itself after the record was written on its word.
 */
export interface DeclaredExecutor {
  /** The lane this executor runs in. Known before any Attempt is opened. */
  readonly lane: ExecutorKind;
  /** The worker identity, when the executor knows its own. */
  readonly workerFor?: WorkerFor;
  readonly run: RunWork;
  /** A process worker claims and renews the same canonical lease itself. */
  readonly dispatch?: (input: Omit<Parameters<typeof dispatchOne>[1], "executor">) => Promise<DispatchResult>;
}

export type WorkerFor = (input: {
  readonly executor: ExecutorKind;
  readonly obligation: ScheduledObligation;
  readonly holder: string;
}) => WorkerRef;

export const DEFAULT_WORKER_FOR: WorkerFor = ({ executor, holder }) =>
  executor === "DETERMINISTIC"
    ? {
        role: "ACQUIRER",
        provider: "we-the-people",
        version: "deterministic-walker",
        instance: holder,
      }
    : {
        role: "SCOUT",
        provider: "anthropic",
        version: "unspecified-model",
        instance: holder,
      };

/**
 * Claim one obligation's due work and run it through the CANONICAL LIFECYCLE.
 *
 * ```
 *   claim  ->  begin Attempt  ->  run  ->  record artifacts  ->
 *   dispose  ->  close Attempt  ->  release lease  ->  record cost
 * ```
 *
 * ## Why every one of those steps is here rather than in the caller
 *
 * They were not here, and the resume audit is the reason they are now. This
 * function used to claim the task, call `run()`, and return WORKED on
 * `ok: true` — no Attempt opened, no artifact attributed, no disposition
 * written, no lease released. The loop above then deleted the freshness debt
 * on the strength of that WORKED, and the next cycle found an expired lease it
 * could not reclaim because no Attempt existed to attribute the abandonment
 * to. Every one of those is a step the coordinator already implemented; what
 * was missing was anybody calling them.
 *
 * The steps after `run()` are NOT in a `finally`, and that is the same
 * deliberate choice the module header describes: a killed process runs no
 * `finally`. Death is observed from outside by `sweepExpiredLeases`. What a
 * `finally` would buy is cleanup after a THROW, and a throw is handled
 * explicitly below — as an abandonment, which is what it is.
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
    /** Actual wall time for claim, Attempt start and terminal writes. `now`
     * remains the cycle's scheduling observation. Omission keeps deterministic
     * legacy callers on their supplied timestamp. */
    readonly clock?: () => string;
    readonly leaseTtlMs: number;
    readonly bound?: WorkerBound;
    readonly maturity: MethodMaturity;
    /** The executor, WITH its lane declared before anything is persisted. */
    readonly executor: DeclaredExecutor;
    /**
     * The canonical executor decision, when the caller made one with the
     * route descriptor in hand (`decideExecutor`). Absent, the maturity-only
     * `chooseExecutor` stands in, which is what the tests written before the
     * registry existed exercise.
     */
    readonly decision?: ExecutorDecision;
    readonly methodVersion?: number;
    readonly policyVersion?: string;
    /** The project the charge is written under. Absent: `freshness`, the standing runner's. */
    readonly costProject?: string;
    /** A proof or test run (MW-024): its charges say so, and stay inside every total and ceiling. */
    readonly nonProduction?: boolean;
  },
): Promise<DispatchResult> {
  const timed = (value:string, floor:string, stage:string):string => {
    const at=Date.parse(value), minimum=Date.parse(floor);
    if (!Number.isFinite(at) || !Number.isFinite(minimum)) throw new Error(`DISPATCH_CLOCK_INVALID:${stage}`);
    if (at<minimum) throw new Error(`DISPATCH_CLOCK_BACKWARDS:${stage}`);
    return value;
  };
  const obligationId = input.obligation.obligation.id;
  const nothingRan = {
    executorChosen: null,
    decisionDisagreement: null,
    executorMismatch: false,
    attemptId: null,
    dispositionCommitted: false,
    disposition: null,
    artifactIds: [] as readonly string[],
    cost: null,
    worker: null,
  } as const;

  if (input.routeTaskId === null) {
    return {
      obligationId,
      routeTaskId: null,
      executor: null,
      claimed: false,
      outcome: "NO_ROUTE_TASK",
      ...nothingRan,
      detail:
        "this obligation has no RouteTask registered, so there is nothing to claim. Recorded " +
        "rather than skipped: an obligation the dispatcher cannot reach is a scheduling gap, " +
        "and a gap nothing counts is a gap nobody fixes.",
    };
  }

  const claimAt=timed(input.clock?.()??input.now,input.now,"CLAIM");
  let claimOutcome: ClaimOutcome;
  try {
    claimOutcome = await claimRouteTask(repos, {
      routeTaskId: input.routeTaskId,
      holder: input.holder,
      now: claimAt,
      ttlMs: input.leaseTtlMs,
    });
  } catch (error) {
    /* A live foreign lease — the other worker has it — or a settled route the
       coordinator refuses (`RouteTaskSettled`). Either way nothing was claimed,
       no Attempt opens, and this one moves on. */
    return {
      obligationId,
      routeTaskId: input.routeTaskId,
      executor: null,
      claimed: false,
      outcome: "NOT_CLAIMED",
      ...nothingRan,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const executor = input.decision ?? chooseExecutor(input.obligation, input.maturity);
  const decisionDisagreement = input.decision?.disagreement ?? null;
  /*
   * **THE DECLARED LANE, NOT THE CHOSEN ONE, BUILDS THE WORKER.**
   *
   * This is the whole of the ordering fix. `executor.kind` is what the method
   * store's maturity implies; `input.executor.lane` is what is about to run.
   * The Attempt is a durable record of an execution, so it is opened with the
   * identity of the thing executing.
   */
  const lane = input.executor.lane;
  const worker = (input.executor.workerFor ?? DEFAULT_WORKER_FOR)({
    executor: lane,
    obligation: input.obligation,
    holder: input.holder,
  });
  const workItemId = claimOutcome.task.value.workItemId;

  /*
   * THE ATTEMPT OPENS BEFORE THE WORK RUNS, and it has to. An artifact is
   * attributed to an Attempt at the moment it is recorded, so a worker that
   * fetched first and opened an Attempt afterwards would have nothing to
   * attribute its own evidence to for the duration of the fetch — which is
   * precisely the window in which it might die.
   */
  const startedAt=timed(input.clock?.()??claimAt,claimAt,"ATTEMPT_START");
  const attempt = await beginAttemptFor(repos, {
    routeTaskId: input.routeTaskId,
    workItemId,
    worker,
    lease: claimOutcome.lease.value,
    now: startedAt,
    methodVersion: input.methodVersion ?? 0,
    policyVersion: input.policyVersion ?? "unversioned",
  });
  const attemptId = attempt.value.id;
  /*
   * `executor` is filled in per return with what the worker REPORTED, so the
   * chosen kind cannot leak into the record as the fact. `base` deliberately
   * does not carry it.
   */
  const base = {
    obligationId,
    routeTaskId: input.routeTaskId,
    executorChosen: executor.kind,
    decisionDisagreement,
    claimed: true,
    attemptId,
    worker,
  };

  /**
   * **EVERY MEASURED COST REACHES THE LEDGER, WHATEVER THE OUTCOME.**
   * (Level 1 activation, 2026-09-01.)
   *
   * Cost was recorded only on the disposing path. A model worker that walked
   * its ladder to NO_PROGRESS spent real tokens and left no ledger entry, so a
   * rolling spend ceiling read from the ledger would under-count precisely the
   * Attempts most likely to be repeated. The append is idempotent by record id.
   */
  const claimedRouteTaskId: string = input.routeTaskId;
  /* MW-013/MW-024: every charge says what it was for, and a proof run says it is one. */
  const purpose = chargePurposeOf(input.obligation.obligation);
  const project = input.costProject ?? "freshness";
  const proof = input.nonProduction === true ? { nonProduction: true as const } : {};
  const ledgerCost = async (cost: AttemptCost, resultKind: CostResultWithoutDisposition, at:string, byModel?: readonly CostModelShare[]): Promise<void> => {
    let source: string | null = null;
    try {
      source = (await repos.routeTasks.read(claimedRouteTaskId))?.value.target ?? null;
    } catch {
      source = null;
    }
    await recordCost(
      repos,
      {
        attemptId,
        workItemId,
        routeTaskId: claimedRouteTaskId,
        routeId: input.obligation.obligation.routeId,
        source,
        jurisdiction: input.obligation.obligation.subjectId,
        project,
        role: worker.role,
        model: worker.provider === "anthropic" ? (byModel?.[0]?.model ?? worker.version) : null,
        cost,
        spendHoldJobId: outcome?.spendHoldJobId,
        recordedAt: at,
        ...purpose,
        resultKind,
        ...proof,
        ...(byModel !== undefined && byModel.length > 0 ? { byModel } : {}),
      },
      at,
    ).catch(() => undefined);
  };

  /**
   * What ran, and whether it disagreed with the DECISION.
   *
   * The lane is the declaration, which is what the Attempt was opened under.
   * `executorMismatch` compares it against `chooseExecutor` — a legitimate and
   * common disagreement — and NOT against `ranAs`, which is checked separately
   * and is a refusal rather than a note.
   */
  const ran = () => ({
    executor: lane,
    executorMismatch: lane !== executor.kind,
  });

  let outcome: WorkOutcome;
  // The TTL detects a dead process; it does not end a live investigation.
  let renewal: Promise<unknown> | null = null;
  let renewalFailure: unknown = null;
  const renew = setInterval(() => {
    if (renewal !== null || renewalFailure !== null) return;
    renewal = renewLease(repos, { routeTaskId: input.routeTaskId!, holder: input.holder,
      now: input.clock?.() ?? new Date().toISOString(), ttlMs: input.leaseTtlMs })
      .catch(error => { renewalFailure = error; })
      .finally(() => { renewal = null; });
  }, Math.max(1, Math.floor(input.leaseTtlMs / 3)));
  renew.unref();
  try {
    outcome = await input.executor.run({
      obligation: input.obligation,
      routeTaskId: input.routeTaskId,
      workItemId,
      attemptId,
      executor: lane,
      bound: input.bound ?? DEFAULT_WORKER_BOUND,
      holder: input.holder,
      assertLeaseHealthy: () => { if (renewalFailure !== null) throw renewalFailure; },
    });
    clearInterval(renew);
    await renewal;
    if (renewalFailure !== null) throw renewalFailure;
  } catch (error) {
    /*
     * A THROWN error is a defect in the worker, not a fact about the route.
     * The Attempt closes as ABORTED — an outcome `mayWriteDisposition` refuses
     * to let carry a conclusion — so nothing about the publisher is recorded.
     */
    const why = error instanceof Error ? error.message : String(error);
    const terminalAt=timed(input.clock?.()??input.now,startedAt,"THROWN_END");
    await abandonAttempt(repos, {
      routeTaskId: input.routeTaskId,
      attemptId,
      outcome: error instanceof PolicyRefusal || (error instanceof Error && error.message.startsWith("DENIED_BY_POLICY")) ? "DENIED_BY_POLICY" : "ABORTED",
      reason: `the worker threw before reaching a boundary: ${why}`,
      now: terminalAt,
    });
    return {
      ...base,
      /* The worker threw before it could say what it was. The decision is the
         only thing known, and `executorMismatch` stays false because nothing
         disagreed with it — nothing reported at all. */
      ...ran(),
      outcome: "FAILED",
      dispositionCommitted: false,
      disposition: null,
      artifactIds: [],
      cost: null,
      detail: `${executor.why}; the worker threw and the Attempt was abandoned: ${why}`,
    };
  } finally {
    clearInterval(renew);
    await renewal;
  }

  // The executor's measured end is authoritative when it supplies one. A
  // missing end uses the injected wall clock. An invalid/backward reported end
  // is named and replaced only by a separately valid wall-clock observation.
  const observedEnd=input.clock?.()??input.now;
  // A worker-result record's own endedAt is the time completeWorkerTask will
  // persist; a separate outcome end must never mask a malformed record clock.
  const reportedEnd=outcome.kind==="RESULT_RECORDED"?outcome.workerResult?.endedAt:outcome.endedAt;
  let clockIssue="";
  let terminalAt:string;
  try {
    terminalAt=timed(reportedEnd??observedEnd,startedAt,"EXECUTOR_END");
    if (reportedEnd!==undefined && input.clock!==undefined && Number.isFinite(Date.parse(observedEnd)) &&
      Date.parse(reportedEnd)>Date.parse(observedEnd)) throw new Error("DISPATCH_CLOCK_FUTURE:EXECUTOR_END");
  }
  catch (error) {
    if (reportedEnd===undefined) throw error;
    terminalAt=timed(observedEnd,startedAt,"OBSERVED_END");
    clockIssue=`; ${error instanceof Error?error.message:"DISPATCH_CLOCK_INVALID:EXECUTOR_END"}; observed terminal clock used`;
  }

  /*
   * **A WORKER THAT CONTRADICTS ITS OWN DECLARATION IS REFUSED.**
   *
   * The Attempt was persisted under the declared lane's worker identity, on
   * this executor's word. An outcome claiming a different lane means that
   * record is already wrong, and the honest response is to abandon the Attempt
   * rather than to reconcile a contradiction after the fact — reconciling it
   * would mean choosing which of two statements from the same party to trust.
   */
  if (outcome.ranAs !== lane) {
    const why =
      `the executor declared lane ${lane} and reported running as ${outcome.ranAs}. The Attempt ` +
      `was already opened under ${lane}'s worker identity (${worker.provider}/${worker.version}), ` +
      "so that durable record is wrong on the executor's own account. Refused rather than " +
      "reconciled: a masquerade is not a disagreement.";
    await abandonAttempt(repos, {
      routeTaskId: input.routeTaskId,
      attemptId,
      outcome: "DENIED_BY_POLICY",
      reason: why+clockIssue,
      now: terminalAt,
      ...(outcome.cost ? { cost: outcome.cost } : {}),
    }).catch(() => undefined);
    if (outcome.cost) await ledgerCost(outcome.cost, "LANE_MISMATCH", terminalAt, outcome.costByModel);
    return {
      ...base,
      ...ran(),
      outcome: "FAILED",
      dispositionCommitted: false,
      disposition: null,
      artifactIds: [],
      cost: outcome.cost ?? null,
      detail: why+clockIssue,
    };
  }

  if (outcome.kind === "RESULT_RECORDED") {
    const record = outcome.workerResult;
    if (record && clockIssue) {
      await abandonAttempt(repos,{routeTaskId:input.routeTaskId,attemptId,outcome:"DENIED_BY_POLICY",
        reason:`WORKER_RESULT_CLOCK_REFUSED${clockIssue}`,now:terminalAt,cost:record.cost});
      await ledgerCost(record.cost,"NO_DISPOSITION",terminalAt,outcome.costByModel);
      return {...base,...ran(),outcome:"FAILED",dispositionCommitted:false,disposition:null,
        artifactIds:[],cost:record.cost,detail:`WORKER_RESULT_CLOCK_REFUSED${clockIssue}`};
    }
    if (!record || record.attemptId !== attemptId || record.routeTaskId !== input.routeTaskId || record.workItemId !== workItemId) {
      await abandonAttempt(repos, { routeTaskId: input.routeTaskId, attemptId, outcome: "DENIED_BY_POLICY", reason: "WORKER_RESULT_DISPATCH_BINDING_REFUSED"+clockIssue, now: terminalAt });
      return { ...base, ...ran(), outcome: "FAILED", dispositionCommitted: false, disposition: null, artifactIds: [], cost: null, detail: "WORKER_RESULT_DISPATCH_BINDING_REFUSED" };
    }
    // A computational result is not an acquisition and may not acquire a civic disposition.
    await completeWorkerTask(repos, record);
    return { ...base, ...ran(), outcome: "WORKED", dispositionCommitted: false, disposition: null,
      artifactIds: record.inputArtifactIds, cost: record.cost, detail: outcome.detail };
  }

  /*
   * Artifacts are recorded FIRST, so a disposition can cite them.
   *
   * **ONE ARTIFACT THE LOG REFUSES MAY NOT LEAVE THE ATTEMPT OPEN.**
   * (Level 1 activation, 2026-09-01 — measured on the first live Scout.)
   *
   * An artifact id is derived from its CONTENT. Two hosts serving
   * byte-identical bodies — `bensonaz.gov/robots.txt` and
   * `www.bensonaz.gov/robots.txt` — produce one id under two canonical URLs,
   * and the append-only log refuses the second as a history rewrite. That
   * refusal used to propagate out of this function after the worker had
   * finished, so the Attempt stayed OPEN with its lease, its cost never
   * reached the ledger, and the cycle counted a completed investigation as a
   * dispatch that threw. The refusal is a fact about attribution, not about
   * the work: it is recorded by name, the disposition cites only what the log
   * accepted, and the Attempt closes.
   */
  const artifactIds: string[] = [];
  const artifactRefusals: string[] = [];
  const seenArtifactIds = new Set<string>();
  for (const artifact of outcome.artifacts ?? []) {
    if (seenArtifactIds.has(artifact.artifactId)) continue;
    seenArtifactIds.add(artifact.artifactId);
    const record: ArtifactRecord = {
      ...artifact,
      workItemId,
      routeTaskId: input.routeTaskId,
      attemptId,
    };
    try {
      await recordArtifactMetadata(repos, record, terminalAt);
      artifactIds.push(record.artifactId);
    } catch (error) {
      artifactRefusals.push(
        `${record.artifactId} <${record.canonicalUrl}> not attributed: ${
          error instanceof Error ? error.message.split("\n")[0] : String(error)
        }`,
      );
    }
  }
  const attributionNote =
    artifactRefusals.length === 0
      ? ""
      : ` ${artifactRefusals.length} artifact(s) were vaulted and NOT attributed to this Attempt by the log (${artifactRefusals.join("; ")}).`;

  if (outcome.kind !== "DISPOSED" || outcome.disposition === undefined) {
    /*
     * **A NO-OP MAY NOT CLEAR DEBT, AND THIS IS WHERE THAT IS ENFORCED.**
     *
     * SIMULATED is returned as its own outcome rather than folded into FAILED,
     * because they mean opposite things about whether anything is wrong. A
     * shadow cycle in which every dispatch is SIMULATED is working exactly as
     * designed; one in which every dispatch FAILED is not. What they share —
     * and the only thing that matters to the obligation — is that neither
     * discharges it.
     */
    const simulated = outcome.kind === "SIMULATED";
    await abandonAttempt(repos, {
      routeTaskId: input.routeTaskId,
      attemptId,
      /* Both close as ABORTED: neither reached a boundary, and `ABORTED` is
         the outcome that says so without implying the worker died. The REASON
         is what distinguishes them, and it is the field a later reader gets. */
      outcome: outcome.failureOutcome ?? "ABORTED",
      reason: simulated
        ? `SHADOW_DECISION: the executor deliberately performed no retrieval. ${outcome.detail}${clockIssue}`
        : outcome.failureOutcome ? outcome.detail+clockIssue : `the worker reached no boundary. ${outcome.detail}${clockIssue}`,
      now: terminalAt,
      ...(outcome.cost ? { cost: outcome.cost } : {}),
    });
    if (outcome.cost) await ledgerCost(outcome.cost, simulated ? "SIMULATED" : "NO_DISPOSITION", terminalAt, outcome.costByModel);
    return {
      ...base,
      ...ran(),
      outcome: simulated ? "SIMULATED" : "FAILED",
      dispositionCommitted: false,
      disposition: null,
      artifactIds,
      cost: outcome.cost ?? null,
      detail: `${executor.why}; ${
        simulated
          ? "no retrieval was performed, so nothing is discharged and the debt stands"
          : "no terminal disposition was reached"
      }: ${outcome.detail}${attributionNote}${clockIssue}`,
    };
  }

  /*
   * The CAS precondition is the revision the claim read. `disposeRouteTask`
   * refuses on a mismatch, which is the stale-writer refusal: a worker that
   * comes back from the dead cannot overwrite the finding of the worker that
   * replaced it.
   */
  const taskRow = await repos.routeTasks.mustRead(input.routeTaskId);
  const disposition: RouteDisposition = {
    ...outcome.disposition,
    note:outcome.disposition.note+clockIssue,
    attemptId,
    at: terminalAt,
    artifactIds,
  };

  try {
    await disposeRouteTask(repos, {
      routeTaskId: input.routeTaskId,
      attemptId,
      expectedTaskRevision: taskRow.revision,
      disposition,
      now: terminalAt,
      artifactIds,
      ...(outcome.cost ? { cost: outcome.cost } : {}),
    });
  } catch (error) {
    /*
     * The domain refused the conclusion — an INGESTED with no artifact, a
     * WALKED_NO_YIELD over an unreachable transport, a task that moved. The
     * refusal is the system working; what would not be working is recording
     * WORKED anyway. The Attempt is abandoned so the route stays owed.
     */
    const why = error instanceof Error ? error.message : String(error);
    await abandonAttempt(repos, {
      routeTaskId: input.routeTaskId,
      attemptId,
      outcome: "ABORTED",
      reason: `the control plane refused the proposed disposition: ${why}`,
      now: terminalAt,
      ...(outcome.cost ? { cost: outcome.cost } : {}),
    }).catch(() => undefined);
    if (outcome.cost) await ledgerCost(outcome.cost, "DISPOSITION_REFUSED", terminalAt, outcome.costByModel);
    return {
      ...base,
      ...ran(),
      outcome: "FAILED",
      dispositionCommitted: false,
      disposition: null,
      artifactIds,
      cost: outcome.cost ?? null,
      detail: `${executor.why}; the disposition was refused and the route remains owed: ${why}${attributionNote}${clockIssue}`,
    };
  }

  if (outcome.cost) {
    await recordCost(
      repos,
      {
        attemptId,
        workItemId,
        routeTaskId: input.routeTaskId,
        routeId: input.obligation.obligation.routeId,
        source: taskRow.value.target,
        jurisdiction: input.obligation.obligation.subjectId,
        project,
        role: worker.role,
        model: worker.provider === "anthropic" ? (outcome.costByModel?.[0]?.model ?? worker.version) : null,
        cost: outcome.cost,
        spendHoldJobId: outcome.spendHoldJobId,
        recordedAt: terminalAt,
        ...purpose,
        resultKind: disposition.disposition,
        ...proof,
        /* MW-031: an escalated Scout's one charge, split by the model each part was for. */
        ...(outcome.costByModel !== undefined && outcome.costByModel.length > 0 ? { byModel: outcome.costByModel } : {}),
      },
      terminalAt,
    );
  }

  return {
    ...base,
    ...ran(),
    outcome: "WORKED",
    dispositionCommitted: true,
    disposition: disposition.disposition,
    artifactIds,
    cost: outcome.cost ?? null,
    detail:
      `${executor.why}; lease ${claimOutcome.lease.value.id}; Attempt ${attemptId} closed ` +
      `COMPLETED with disposition ${disposition.disposition} over ${artifactIds.length} ` +
      `artifact(s): ${outcome.detail}${attributionNote}${clockIssue}`,
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
  /**
   * Expired leases on RouteTasks that were ALREADY DISPOSED, released as dead
   * state (2026-09-22). Nothing was reopened, and a released lease is skipped by
   * every later sweep, so each appears here once.
   */
  readonly releasedSettled: readonly string[];
  readonly stillLive: readonly string[];
  readonly refused: readonly { readonly routeTaskId: string; readonly why: string }[];
}

export async function sweepExpiredLeases(
  repos: ControlPlaneRepositories,
  input: { readonly now: string; readonly observedBy: string },
): Promise<ReclaimSweep> {
  // A committed result outranks an expired heartbeat. Apply commits before declaring a worker dead.
  await reconcileWorkerCompletions(repos);
  const reclaimed: string[] = [];
  const releasedSettled: string[] = [];
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
      const outcome = await reclaimRouteTask(repos, {
        routeTaskId: lease.routeTaskId,
        now: input.now,
        observedBy: input.observedBy,
      });
      (outcome.settled ? releasedSettled : reclaimed).push(lease.routeTaskId);
    } catch (error) {
      /* NothingToReclaim is the honest case where a lease expired before any
         Attempt opened. Recorded, never swallowed. */
      refused.push({
        routeTaskId: lease.routeTaskId,
        why: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { reclaimed, releasedSettled, stillLive, refused };
}
