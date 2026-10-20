/**
 * Hands due work to disposable workers: claim, decide the executor, run, record, compute next due.
 * Leases and reclaim belong to the coordinator. Nothing here closes an Attempt in a `finally`: a killed
 * process runs none, so death is observed from outside by an expired lease (`sweepExpiredLeases`).
 */

import { type AttemptCost, type AttemptOutcome, type ExecutionLease, type WorkerRef } from "../attempt.ts";
import { forEachAggregate } from "../workers/streamed-history.ts";
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
import { isProofProject, type COST_RESULT_WITHOUT_DISPOSITION, type CostEntry, type CostModelShare, type ModelRequestBound } from "../cost.ts";
import { questionOfObligation } from "../work-question.ts";

import { currentAssignmentRefs, type FreshnessObligation, type ScheduledObligation } from "./obligation.ts";

type CostResultWithoutDisposition = (typeof COST_RESULT_WITHOUT_DISPOSITION)[number];

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

export function proofChargeOf(project: string | null | undefined): { readonly costProject?: string; readonly nonProduction?: true } {
  return typeof project === "string" && isProofProject(project) ? { costProject: project, nonProduction: true } : {};
}

export const EXECUTOR_KINDS = ["DETERMINISTIC", "BOUNDED_MODEL_WORKER"] as const;
export type ExecutorKind = (typeof EXECUTOR_KINDS)[number];

/** The ceiling a model worker runs under. Stated, never implicit. */
export interface WorkerBound {
  readonly maxAttempts: number;
  readonly maxWallMs: number;
  /** Legacy diagnostic annotation; actual spend is reserved per request. */
  readonly maxCostUnits?: number;
}

/** The wall on every hunter, below the worker process's own 10-minute kill timeout so the hunter saves its case file first. `WTP_HUNTER_WALL_MS` overrides it. */
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

export type MethodMaturity = (route: string | null) => "GRADUATED" | "UNGRADUATED";

/** Choose the executor. An obligation with no route id is ungraduated and goes to the bounded worker. */
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
 * The one executor-decision rule: a machine-executable shape (declared, or graduated since) runs
 * DETERMINISTIC; genuine novelty with no shape to replay runs BOUNDED_MODEL_WORKER. A disagreement between
 * the declaration and the method store, or a declaration contradicting its own opening, is recorded.
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

/** DISPOSED (a terminal disposition; the only kind that may clear debt), SIMULATED (chosen and deliberately not done) or ABORTED (attempted, no boundary). None is a statement about the publisher. */
export const WORK_OUTCOME_KINDS = ["DISPOSED", "RESULT_RECORDED", "SIMULATED", "ABORTED"] as const;
export type WorkOutcomeKind = (typeof WORK_OUTCOME_KINDS)[number];

/** An artifact the worker retrieved. `attemptId` and `workItemId` are filled by the dispatcher, never the worker. */
export type WorkArtifact = Omit<ArtifactRecord, "attemptId" | "workItemId" | "routeTaskId">;

/** The terminal disposition minus `attemptId`, `at` and `artifactIds`, which the dispatcher owns. */
export type WorkDisposition = Omit<RouteDisposition, "attemptId" | "at" | "artifactIds">;

export interface WorkOutcome {
  readonly failureOutcome?: Exclude<AttemptOutcome, "COMPLETED">;
  readonly endedAt?: string;
  readonly workerResult?: UncommittedWorkerResult;
  readonly kind: WorkOutcomeKind;
  /** Which executor actually ran. Required; the dispatcher records this and reports any disagreement with the decision. */
  readonly ranAs: ExecutorKind;
  /** Required when kind is DISPOSED, refused otherwise. */
  readonly disposition?: WorkDisposition;
  readonly artifacts?: readonly WorkArtifact[];
  /** Measured. `ZERO_COST` is a measurement of nothing, not an absent one. */
  readonly cost?: AttemptCost;
  /** Exact existing job hold carried by the runner's typed Scout result. */
  readonly spendHoldJobId?: string;
  /** The per-model split of `cost` when the worker ran more than one model; written to the ledger as `byModel`. */
  readonly costByModel?: readonly CostModelShare[];
  /** A sent model request whose usage never came back, at its send limit; `cost` holds the answered ones. */
  readonly unansweredRequest?: ModelRequestBound;
  readonly detail: string;
}

export interface DispatchResult {
  readonly obligationId: string;
  readonly repositoryCalls?: number;
  readonly routeTaskId: string | null;
  /** What actually ran, as the worker reported it. */
  readonly executor: ExecutorKind | null;
  /** What `chooseExecutor` decided. The DECISION, kept for the disagreement. */
  readonly executorChosen: ExecutorKind | null;
  readonly decisionDisagreement: string | null;
  /** True when the worker ran something other than what was chosen. Recorded, not refused. */
  readonly executorMismatch: boolean;
  readonly claimed: boolean;
  /** Null when nothing ran. `WORKED` is issued only on a committed disposition. */
  readonly outcome:
    | "WORKED"
    | "FAILED"
    | "SIMULATED"
    | "NOT_CLAIMED"
    | "NO_ROUTE_TASK"
    | null;
  readonly attemptId: string | null;
  /** True only when `disposeRouteTask` committed a terminal disposition. */
  readonly dispositionCommitted: boolean;
  readonly disposition: string | null;
  /** Artifact ids recorded against the Attempt. Never a count on its own. */
  readonly artifactIds: readonly string[];
  readonly cost: AttemptCost | null;
  readonly worker: WorkerRef | null;
  readonly detail: string;
}

/** The dispositions that are a fresh reading of the record. Every other disposition is a fact about the route and refreshes nothing. */
export const DISCHARGING_DISPOSITIONS: readonly string[] = ["INGESTED", "WALKED_NO_YIELD"];

/** Only a committed reading discharges a freshness obligation. A new outcome is not discharging unless this function changes. */
export function dischargesObligation(result: DispatchResult): boolean {
  return (
    result.outcome === "WORKED" &&
    result.dispositionCommitted &&
    result.disposition !== null &&
    DISCHARGING_DISPOSITIONS.includes(result.disposition)
  );
}

/** The executor seam. Never throws for a route-level failure, which would be indistinguishable from a scheduler defect. */
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

/** An executor declares its lane before any Attempt is persisted; a `ranAs` contradicting the declaration is refused. */
export interface DeclaredExecutor {
  readonly lane: ExecutorKind;
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

/** The ledger fields for an outcome's unanswered request; its model is the one requested. */
function unanswered(outcome: WorkOutcome | undefined): Pick<CostEntry, "modelRequestBound" | "requestedModel"> {
  const bound = outcome?.unansweredRequest;
  return bound ? { modelRequestBound: bound, requestedModel: bound.model } : {};
}

/**
 * Claim one obligation's due work and run it through the canonical lifecycle: claim, begin Attempt, run,
 * record artifacts, dispose, close Attempt, release lease, record cost. A losing claim is a normal outcome.
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
    readonly executor: DeclaredExecutor;
    /** The canonical decision from `decideExecutor`; absent, the maturity-only `chooseExecutor` stands in. */
    readonly decision?: ExecutorDecision;
    readonly methodVersion?: number;
    readonly policyVersion?: string;
    /** The project the charge is written under. Absent: `freshness`, the standing runner's. */
    readonly costProject?: string;
    /** A proof or test run: its charges say so, and stay inside every total and ceiling. */
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
  /* The declared lane, not the chosen one, builds the worker identity the Attempt opens under. */
  const lane = input.executor.lane;
  const worker = (input.executor.workerFor ?? DEFAULT_WORKER_FOR)({
    executor: lane,
    obligation: input.obligation,
    holder: input.holder,
  });
  const workItemId = claimOutcome.task.value.workItemId;

  /* The Attempt opens before the work runs so artifacts can be attributed while it runs. */
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

  /** Every measured cost reaches the ledger whatever the outcome; the append is idempotent by record id. */
  const claimedRouteTaskId: string = input.routeTaskId;
  /* Every charge says what it was for, and a proof run says it is one. */
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
        ...unanswered(outcome),
        recordedAt: at,
        ...purpose,
        resultKind,
        ...proof,
        ...(byModel !== undefined && byModel.length > 0 ? { byModel } : {}),
      },
      at,
    ).catch(() => undefined);
  };

  /** `executorMismatch` compares the declared lane with `chooseExecutor`, not with `ranAs` (checked separately and refused). */
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
    /* A thrown error is a worker defect: the Attempt closes ABORTED and nothing is recorded about the publisher. */
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

  /* A worker that contradicts its own declaration is refused and the Attempt abandoned. */
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
   * Artifacts are recorded first so a disposition can cite them. An artifact the log refuses (same content
   * under another canonical URL) is recorded by name and does not leave the Attempt open.
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
    /* A no-op may not clear debt: SIMULATED is its own outcome, and neither it nor FAILED discharges. */
    const simulated = outcome.kind === "SIMULATED";
    await abandonAttempt(repos, {
      routeTaskId: input.routeTaskId,
      attemptId,
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

  /* The CAS precondition is the revision the claim read, so a returning stale worker cannot overwrite its replacement. */
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
    /* The domain refused the conclusion; the Attempt is abandoned so the route stays owed. */
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
        ...unanswered(outcome),
        recordedAt: terminalAt,
        ...purpose,
        resultKind: disposition.disposition,
        ...proof,
        /* An escalated Scout's one charge, split by model. */
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

/** Reclaim every route whose holder stopped renewing. A live lease is skipped, never forced. */
export interface ReclaimSweep {
  readonly reclaimed: readonly string[];
  /** Expired leases on routes already disposed, released as dead state; each appears once. */
  readonly releasedSettled: readonly string[];
  readonly stillLive: readonly string[];
  readonly refused: readonly { readonly routeTaskId: string; readonly why: string }[];
}

export async function sweepExpiredLeases(
  repos: ControlPlaneRepositories,
  input: { readonly now: string; readonly observedBy: string; readonly workItemIds?: readonly string[] },
): Promise<ReclaimSweep> {
  // A committed result outranks an expired heartbeat. Apply commits before declaring a worker dead.
  await reconcileWorkerCompletions(repos, input.workItemIds === undefined ? undefined : { workItemIds: input.workItemIds });
  const reclaimed: string[] = [];
  const releasedSettled: string[] = [];
  const stillLive: string[] = [];
  const refused: { routeTaskId: string; why: string }[] = [];

  const visitLease = async (row: { readonly value: Pick<ExecutionLease, "released" | "expiresAt" | "routeTaskId"> }) => {
    const lease = row.value;
    if (lease.released) return;
    if (!(Date.parse(lease.expiresAt) <= Date.parse(input.now))) {
      stillLive.push(lease.routeTaskId);
      return;
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
  };
  const projection = { released: true, expiresAt: true, routeTaskId: true } as const;
  if (input.workItemIds === undefined) await forEachAggregate(repos.leases, visitLease, projection);
  else for (const workItemId of new Set(input.workItemIds)) {
    const tasks = await repos.routeTasks.listWhereNarrowed(["workItemId"], workItemId, {});
    for (const task of tasks) {
      const lease = await repos.leases.readNarrowed(task.id, projection);
      if (lease) await visitLease(lease as { readonly value: Pick<ExecutionLease, "released" | "expiresAt" | "routeTaskId"> });
    }
  }
  return { reclaimed, releasedSettled, stillLive, refused };
}
