/** One unattended cycle: reclaim, schedule, retry, dispatch, record, digest. */

import {
  aggregateIncidents,
  debtCauseForDisposition,
  recordFailure,
  retryable,
  stalenessRisk,
  type FreshnessDebt,
  type Incident,
  type StalenessRisk,
} from "./debt.ts";
import {
  DISCHARGING_DISPOSITIONS,
  dischargesObligation,
  dispatchOne,
  sweepExpiredLeases,
  type DispatchResult,
  type ExecutorDecision,
  type ExecutorKind,
  type MethodMaturity,
  type ReclaimSweep,
  type DeclaredExecutor,
  type WorkerBound,
} from "./dispatch.ts";
import {
  closeOccurrence,
  closeSettledOccurrence,
  settledUnresolvedReason,
  type SettledOccurrence,
} from "./durable.ts";
import {
  dueNow,
  plainCodeQueueOrder,
  scheduleAll,
  waitingSince,
  type FreshnessObligation,
  type ScheduledObligation,
  type SchedulePass,
} from "./obligation.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";

/** One cycle's inputs. Every clock and every seam is injected. */
export interface CycleInput {
  readonly repos: ControlPlaneRepositories;
  /** Only filtered occurrence histories are recovered; dispatch still uses the shared repositories. */
  readonly recoveryRepos?: ControlPlaneRepositories;
  readonly obligations: readonly FreshnessObligation[];
  /** Debt carried in from the previous cycle. Durable state, passed through. */
  readonly debts: readonly FreshnessDebt[];
  /** Obligation id → the RouteTask that works it, where one is registered. */
  readonly routeTaskFor: (obligationId: string) => string | null;
  /** The standing runner opens only its bounded lane slots, retaining all other due rows. */
  readonly requireOpenOccurrence?: boolean;
  /** Opens an obligation's occurrence just-in-time, after admission; returns whether it is open, or `{ settled }` for an occurrence an interrupted cycle already disposed. Absent, `requireOpenOccurrence` governs. */
  readonly openOccurrence?: (
    row: ScheduledObligation,
  ) => Promise<boolean | { readonly settled: SettledOccurrence }>;
  /** Settled occurrences recovered before any lane runs, whatever their lane, due time, backoff or admission; each is withheld from both lanes. */
  readonly settledOccurrences?: readonly SettledOccurrence[];
  /** Observability only; recovery still completes before any worker is admitted. */
  readonly onRecoveryComplete?: () => void;
  readonly maturity: MethodMaturity;
  /** The executor with its lane declared, or a function choosing one per obligation; the lane is declared before the Attempt is persisted. */
  readonly executor: DeclaredExecutor | ((obligation: ScheduledObligation) => DeclaredExecutor);
  readonly methodVersion?: number;
  readonly policyVersion?: string;
  readonly holder: string;
  readonly now: string;
  /** Actual timestamps for each dispatch lifecycle, separate from the frozen
   * cycle scheduling observation. */
  readonly clock?: () => string;
  readonly leaseTtlMs: number;
  readonly bound?: WorkerBound;
  /** A ceiling on how many due items one cycle dispatches. Stated, not implied. */
  readonly maxDispatches?: number;
  readonly workerCapacity?: number;
  /** Within each hunt preserve service order; serve one row per hunt per round. */
  readonly huntFor?: (row: ScheduledObligation) => string | null;
  /**
   * Aggregate Fleet admission, shared with the worker lanes that follow this
   * scheduler. A refusal is durably named in `deferred`; it never becomes an
   * Attempt and can never be mistaken for completed work.
   */
  readonly admitDispatch?: (
    row: ScheduledObligation,
  ) => { readonly admit: true } | { readonly admit: false; readonly code: string; readonly why: string };
  /** The provider a deterministic row's request goes to and how many of its rows may run at once, read as each row is taken. */
  readonly providerLimitOf?: (row: ScheduledObligation) => PoolLimit | null;
  /** A tightly scoped canary may skip the whole lease sweep; normal cycles never do. */
  readonly skipReclaim?: boolean;
  /** Obligation ids the owner dispatched, placed first in both lanes; a dispatch reorders and nothing else. */
  readonly placeFirst?: ReadonlySet<string>;
  readonly placeComparator?: () => Promise<(left: ScheduledObligation, right: ScheduledObligation) => number>;
  /** Two lanes in one cycle: deterministic rows run the serial queue under `maxDispatches`; model rows are hunted in their government's packet and only counted here. Absent, one serial queue. */
  readonly research?: ResearchLanes;
}

export interface ResearchLanes {
  readonly decide: (row: ScheduledObligation) => ExecutorDecision;
  readonly onDispatched?: (result: DispatchResult, lane: ExecutorKind) => void | Promise<void>;
}

/** What an older cycle's pre-warm request reported, as its run record holds it. */
export type PrewarmOutcome =
  | {
      readonly status: "WARMED";
      readonly at: string;
      readonly cacheCreationInputTokens: number | null;
      readonly cacheReadInputTokens: number | null;
      readonly uncachedInputTokens: number | null;
      readonly usd: number | null;
      readonly durationMs: number;
    }
  | { readonly status: "FAILED"; readonly at: string; readonly detail: string; readonly durationMs: number }
  /* No paid call was made — the loop's start model's prefix could not be shown to reach its cacheable minimum. */
  | { readonly status: "SKIPPED"; readonly at: string; readonly model: string; readonly code: string; readonly detail: string; readonly durationMs: number };

/** Every due row ends in exactly one place per lane: `dispatched + Σ deferredBy + recovered = due`. */
export interface LaneCounts {
  readonly deterministic: {
    readonly due: number;
    readonly dispatched: number;
    /** Deferral counts by code (NO_OPEN_OCCURRENCE, BUDGET, DISPATCH_CEILING, an aggregate admission code). */
    readonly deferredBy: Readonly<Record<string, number>>;
    /** Rows recovered with an already-committed disposition: neither dispatched nor deferred. */
    readonly recovered: number;
    /** The earliest time a deferred row joined the queue (`waitingSince`); null when none was deferred. */
    readonly oldestWaitingDueAt: string | null;
  };
  readonly model: {
    readonly due: number;
    readonly dispatched: number;
    readonly deferred: number;
    /** Deferral counts by the admit code, so a cap reads as a cap and a pause as a pause. */
    readonly deferredBy: Readonly<Record<string, number>>;
    /** Rows recovered with an already-committed disposition: neither dispatched nor deferred. */
    readonly recovered: number;
    /** The earliest next-due among the deferred rows; null when none was deferred. */
    readonly oldestWaitingDueAt: string | null;
    /** The cycle's pre-warm, when a Scout was admitted and the lane has one. Null when no Scout was admitted. */
    readonly prewarm?: PrewarmOutcome | null;
  };
}

export interface CycleResult {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly reclaim: ReclaimSweep;
  readonly schedule: SchedulePass;
  readonly dueCount: number;
  readonly dispatched: readonly DispatchResult[];
  /** Due work this cycle did NOT reach, and the reason. Never silent. */
  readonly deferred: readonly { readonly obligationId: string; readonly why: string }[];
  /** Obligations DISCHARGED this cycle — a committed disposition, each one. */
  readonly worked: readonly string[];
  /**
   * Open occurrences whose route an interrupted cycle had already disposed,
   * closed with that disposition and never dispatched. Apart from `dispatched`
   * and `worked`, because nothing ran for them this cycle.
   */
  readonly recovered: readonly RecoveredOccurrence[];
  /** Obligations whose executor deliberately did nothing. Still owed. */
  readonly simulated: readonly string[];
  readonly debts: readonly FreshnessDebt[];
  readonly incidents: readonly Incident[];
  readonly risk: StalenessRisk;
  /** Per-lane counts when research lanes ran; null when the cycle ran one queue. */
  readonly lanes: LaneCounts | null;
  /** Always false in this module. */
  readonly promotedToReaderTruth: false;
}

/** A settled occurrence the cycle recovered, and whether its disposition was a reading. */
export interface RecoveredOccurrence extends SettledOccurrence {
  /** True when the committed disposition is in `DISCHARGING_DISPOSITIONS`. */
  readonly discharged: boolean;
}

/** Capture each hunt's rounds over the full queue. Filtering completed work or
 * refreshing place priority must not move a hunt's second item ahead of
 * another hunt's first. Items keep their original order within their hunt. */
export function huntRoundComparator<T>(items: readonly T[], huntFor: (item: T) => string | null | undefined): (left: T, right: T) => number {
  const counts = new Map<string, number>();
  const rounds = new Map<T, number>();
  for (const item of items) {
    const key = huntFor(item) ?? "standing";
    const round = counts.get(key) ?? 0;
    rounds.set(item, round);
    counts.set(key, round + 1);
  }
  return (left, right) => (rounds.get(left) ?? Number.MAX_SAFE_INTEGER) - (rounds.get(right) ?? Number.MAX_SAFE_INTEGER);
}

/** A pool key and how many of its items may run at once. */
interface PoolLimit { readonly key: string; readonly limit: number }

/** A bounded pool: at most `limit` items in flight, in input order. */
export async function runPool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>,
  comparator?: () => Promise<(left: T, right: T) => number>,
  huntFor?: (item: T) => string | null | undefined,
  /** Items sharing a key run at most `limit` at once; the limit is read each time an item is taken. */
  limitOf?: (item: T) => PoolLimit | null): Promise<void> {
  const pending = [...items];
  const compareRound = huntFor ? huntRoundComparator(items, huntFor) : () => 0;
  const running = new Map<string, number>();
  const keys = new Map<T, string | undefined>();
  let finished: () => void = () => {};
  let selection = Promise.resolve();
  let compare: (left: T, right: T) => number = () => 0;
  const take = (): Promise<T | undefined> => {
    let item: T | undefined;
    const next = selection.then(async () => {
      if (pending.length && (comparator || huntFor)) {
        if (comparator) {
          try { compare = await comparator(); }
          catch (error) {
            console.warn(`Place priority read failed; keeping last order: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        pending.sort((left, right) => compareRound(left, right) || compare(left, right));
      }
      for (;;) {
        const at = pending.findIndex(candidate => {
          const limit = limitOf?.(candidate) ?? null;
          return limit === null || (running.get(limit.key) ?? 0) < Math.max(1, limit.limit);
        });
        if (at >= 0) {
          item = pending.splice(at, 1)[0];
          const key = limitOf?.(item!)?.key;
          if (key !== undefined) running.set(key, (running.get(key) ?? 0) + 1);
          keys.set(item!, key);
          return;
        }
        if (!pending.length) return;
        await new Promise<void>(resolve => { finished = resolve; });
      }
    });
    selection = next.catch(() => undefined);
    return next.then(() => item);
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    for (;;) {
      const item = await take();
      if (item === undefined) break;
      const key = keys.get(item);
      keys.delete(item);
      try { await fn(item); }
      finally { if (key !== undefined) { running.set(key, running.get(key)! - 1); finished(); } }
    }
  });
  await Promise.all(workers);
}

/** Move rows whose obligation id is in `first` to the front, keeping relative order. Pure and stable. */
export function placeFirstRows<T extends { readonly obligation: { readonly id: string } }>(
  rows: readonly T[],
  first: ReadonlySet<string> | undefined,
): readonly T[] {
  if (first === undefined || first.size === 0) return rows;
  return [...rows.filter((r) => first.has(r.obligation.id)), ...rows.filter((r) => !first.has(r.obligation.id))];
}

/** Run one full cycle. Unattended: nothing here can ask a question. */
export async function runCycle(input: CycleInput): Promise<CycleResult> {
  const startedAt = input.now;
  const nowMs = Date.parse(input.now);

  /* 1 · Reclaim first, so a worker that died since the last cycle costs one cycle of latency. */
  const reclaim = input.skipReclaim
    ? { reclaimed: [], releasedSettled: [], stillLive: [], refused: [] }
    : await sweepExpiredLeases(input.recoveryRepos ?? input.repos, {
        now: input.now,
        observedBy: input.holder,
      });
  input.onRecoveryComplete?.();

  /* 2 · SCHEDULE. Both lists; the unscheduled are named, never defaulted. */
  const schedule = scheduleAll(input.obligations, nowMs);

  /* 3 · RETRY. Debt whose backoff has elapsed rejoins the due set. */
  const retryIds = new Set(retryable(input.debts, nowMs).map((d) => d.obligationId));

  /* Debt backoff gates re-dispatch: an obligation carrying debt is due only when its backoff has elapsed, and is otherwise deferred by name. */
  const backedOff = new Map(
    input.debts
      .filter((d) => d.consecutiveFailures > 0 && !retryIds.has(d.obligationId))
      .map((d) => [d.obligationId, d]),
  );

  const due = dueNow(schedule, nowMs).filter((row) => !backedOff.has(row.obligation.id));
  const alsoDue = schedule.scheduled.filter(
    (row) => retryIds.has(row.obligation.id) && !due.includes(row),
  );
  /* The owner's dispatch goes first; everything else keeps the oldest-first order above. */
  const workNow = placeFirstRows([...due, ...alsoDue], input.placeFirst);

  /* 4 · DISPATCH, under a stated ceiling. Anything beyond it is DEFERRED with
        a reason rather than dropped — a queue that silently truncates reports
        the same number whatever the backlog is. */
  const ceiling = input.maxDispatches ?? workNow.length;
  const dispatched: DispatchResult[] = [];
  const worked: string[] = [];
  const recovered: RecoveredOccurrence[] = [];
  const simulated: string[] = [];
  const deferred: { obligationId: string; why: string }[] = [];
  const debtsById = new Map(input.debts.map((d) => [d.obligationId, d]));

  /* A settled occurrence is recovered, never dispatched: a reading discharges its debt; any other disposition accrues debt and stays owed. */
  const recover = (row: ScheduledObligation, settled: SettledOccurrence): void => {
    const discharged = DISCHARGING_DISPOSITIONS.includes(settled.disposition.disposition);
    recovered.push({ ...settled, discharged });
    if (discharged) {
      debtsById.delete(row.obligation.id);
      return;
    }
    debtsById.set(
      row.obligation.id,
      recordFailure(debtsById.get(row.obligation.id) ?? null, {
        obligationId: row.obligation.id,
        cause: debtCauseForDisposition(settled.disposition.disposition),
        detail: settledUnresolvedReason(settled.disposition),
        target: row.obligation.routeId ?? row.obligation.subjectId,
        dueAt: row.nextDueAt,
        now: input.now,
      }),
    );
  };

  /* 3b · Recover before any lane, and withhold recovered rows from both lanes. */
  const scheduledById = new Map(schedule.scheduled.map((row) => [row.obligation.id, row] as const));
  for (const settled of input.settledOccurrences ?? []) {
    const row = scheduledById.get(settled.obligationId);
    if (row !== undefined) recover(row, settled);
  }
  const recoveredBeforeDispatch = new Set(recovered.map((r) => r.obligationId));

  for (const [obligationId, debt] of backedOff) {
    if (recoveredBeforeDispatch.has(obligationId)) continue;
    deferred.push({
      obligationId,
      why: debt.cause === 'AWAITING_ADAPTER'
        ? 'AWAITING_ADAPTER: the required adapter has not changed; elapsed backoff cannot supply missing code. The obligation remains owed to Engineer.'
        :
        `its clock has passed and it is holding ${debt.consecutiveFailures} consecutive failure(s), ` +
        `so the backoff computed for it stands until ${debt.retryAt}. Held out of this cycle ` +
        "and counted here — a walled route re-opened every cycle is a hot loop reported as an outage.",
    });
  }

  /*
   * The record step, shared by both lanes. Applied to each result as it
   * arrives; the two lanes interleave on `await` boundaries only, and every
   * Map operation below is synchronous, so the shared debt map cannot lose an
   * update to concurrency.
   */
  const record = (row: ScheduledObligation, result: DispatchResult): void => {
    dispatched.push(result);
    /* 5 · Record. A failure becomes debt; debt is cleared only by a committed disposition (`dischargesObligation`). */
    if (dischargesObligation(result)) {
      debtsById.delete(row.obligation.id);
      worked.push(row.obligation.id);
    } else if (result.outcome === "SIMULATED") {
      /* A shadow decision neither becomes debt nor clears it; the obligation stays due. */
      simulated.push(row.obligation.id);
    } else if (result.outcome !== "NOT_CLAIMED") {
      /* FAILED, NO_ROUTE_TASK, or a WORKED result whose disposition is not a reading: the obligation is still owed and its debt accrues. */
      debtsById.set(
        row.obligation.id,
        recordFailure(debtsById.get(row.obligation.id) ?? null, {
          obligationId: row.obligation.id,
          cause:
            result.outcome === "NO_ROUTE_TASK"
              ? "NEVER_DISPATCHED"
              : result.dispositionCommitted
                ? debtCauseForDisposition(result.disposition ?? "")
                : "UPSTREAM_ERROR",
          detail: result.dispositionCommitted
            ? `the route was disposed ${result.disposition}, which closes the RouteTask and is ` +
              `not a reading of the record: ${result.detail}`
            : result.detail,
          target: row.obligation.routeId ?? row.obligation.subjectId,
          dueAt: row.nextDueAt,
          now: input.now,
        }),
      );
    }
    /* NOT_CLAIMED is not a failure. Another worker holds it; that is the lease
       working, and counting it as debt would make ordinary concurrency read as
       a backlog. */
  };


  /* An unexpected throw from one obligation is recorded as a FAILED dispatch and the cycle continues. */
  const dispatchRow = async (
    row: ScheduledObligation,
    opts: { readonly executor: DeclaredExecutor; readonly leaseTtlMs: number; readonly decision?: ExecutorDecision },
  ): Promise<DispatchResult> => {
    let result: DispatchResult;
    try {
      const dispatch = opts.executor.dispatch ?? (request => dispatchOne(input.repos, { ...request, executor: opts.executor }));
      result = await dispatch({
        obligation: row,
        routeTaskId: input.routeTaskFor(row.obligation.id),
        holder: input.holder,
        now: input.now,
        clock: input.clock,
        leaseTtlMs: opts.leaseTtlMs,
        bound: input.bound,
        maturity: input.maturity,
        ...(opts.decision !== undefined ? { decision: opts.decision } : {}),
        ...(input.methodVersion !== undefined ? { methodVersion: input.methodVersion } : {}),
        ...(input.policyVersion !== undefined ? { policyVersion: input.policyVersion } : {}),
      });
    } catch (error) {
      result = {
        obligationId: row.obligation.id,
        routeTaskId: input.routeTaskFor(row.obligation.id),
        executor: null,
        executorChosen: opts.decision?.kind ?? null,
        decisionDisagreement: opts.decision?.disagreement ?? null,
        executorMismatch: false,
        claimed: false,
        outcome: "FAILED",
        attemptId: null,
        dispositionCommitted: false,
        disposition: null,
        artifactIds: [],
        cost: null,
        worker: null,
        detail:
          "the dispatch threw and was isolated so the cycle could continue rather than aborting " +
          `every other due occurrence: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    record(row, result);
    return result;
  };

  const research = input.research;
  const decisions = new Map<string, ExecutorDecision>();
  const deterministicRows: ScheduledObligation[] = [];
  const modelRows: ScheduledObligation[] = [];
  /* A row recovered before dispatch is withheld from both lanes, so it is recovered once and never walked. */
  const laneWork = workNow.filter((row) => !recoveredBeforeDispatch.has(row.obligation.id));
  if (research === undefined) {
    deterministicRows.push(...laneWork);
  } else {
    for (const row of laneWork) {
      const decision = research.decide(row);
      decisions.set(row.obligation.id, decision);
      (decision.kind === "BOUNDED_MODEL_WORKER" ? modelRows : deterministicRows).push(row);
    }
  }
  /* The plain-code lane serves the longest wait first (`waitingSince`), then the owner's placed-first rows go to the front. */
  const debtAtCycleStart = new Map(input.debts.map((d) => [d.obligationId, d] as const));
  const debtOf = (obligationId: string) => debtAtCycleStart.get(obligationId);
  const plainCodeQueue = placeFirstRows(plainCodeQueueOrder(deterministicRows, debtOf), input.placeFirst);
  const deferredBy: Record<string, number> = {};
  let modelDeferred = 0;
  let modelOldestWaiting: string | null = null;
  const deterministicDeferredBy: Record<string, number> = {};
  let deterministicDispatched = 0;
  let deterministicRecovered = 0;
  let deterministicOldestWaiting: string | null = null;
  const earlier = (held: string | null, row: ScheduledObligation): string =>
    held === null || row.nextDueAt < held ? row.nextDueAt : held;
  /* The deterministic lane's one deferral tally: every hold below names its code here, so its reasons sum. */
  const holdDeterministic = (row: ScheduledObligation, code: string): void => {
    deterministicDeferredBy[code] = (deterministicDeferredBy[code] ?? 0) + 1;
    const since = waitingSince(row, debtOf(row.obligation.id));
    if (deterministicOldestWaiting === null || since < deterministicOldestWaiting) deterministicOldestWaiting = since;
  };
  const holdModel = (row: ScheduledObligation, code: string): void => {
    modelDeferred += 1;
    deferredBy[code] = (deferredBy[code] ?? 0) + 1;
    modelOldestWaiting = earlier(modelOldestWaiting, row);
  };

  /** The admission's code when it refused, so each lane counts the refusal under the code that made it; null when admitted. */
  const aggregateRefusal = (row: ScheduledObligation): string | null => {
    const admission = input.admitDispatch?.(row) ?? { admit: true as const };
    if (admission.admit) return null;
    deferred.push({
      obligationId: row.obligation.id,
      why: `${admission.code}: ${admission.why}. Deferred with its next-due, never dropped and never reported complete.`,
    });
    return admission.code;
  };

  /* With `openOccurrence`, a lane opens only the rows it is about to run. */
  const tryOpen = async (
    row: ScheduledObligation,
  ): Promise<boolean | { readonly settled: SettledOccurrence }> => {
    if (input.openOccurrence === undefined) return true;
    try {
      return await input.openOccurrence(row);
    } catch {
      return false;
    }
  };

  /* Shared worker processes preserve each hunt's longest-wait order. */
  const deterministicLane = async (): Promise<void> => {
    let admitted = 0;
    await runPool(plainCodeQueue, input.workerCapacity ?? 1, async row => {
      if (input.openOccurrence === undefined && input.requireOpenOccurrence && input.routeTaskFor(row.obligation.id) === null) {
        deferred.push({ obligationId: row.obligation.id, why: "NO_OPEN_OCCURRENCE: outside this cycle's reserved lane slots; work remains due." });
        holdDeterministic(row, "NO_OPEN_OCCURRENCE");
        return;
      }
      if (admitted >= ceiling) {
        deferred.push({
          obligationId: row.obligation.id,
          why:
            `this cycle dispatched its stated ceiling of ${ceiling} item(s) and ${deterministicRows.length - ceiling} ` +
            "remained due. They are deferred to the next cycle, counted here, and their debt " +
            "continues to age — a ceiling that dropped them silently would report the same number " +
            "whatever the backlog was",
        });
        holdDeterministic(row, "DISPATCH_CEILING");
        return;
      }
      admitted += 1;
      const opened = await tryOpen(row);
      if (opened === false) {
        admitted--;
        deferred.push({ obligationId: row.obligation.id, why: "NO_OPEN_OCCURRENCE: the occurrence could not be opened in step with dispatch this cycle; work remains due." });
        holdDeterministic(row, "NO_OPEN_OCCURRENCE");
        return;
      }
      if (opened !== true) {
        admitted--;
        recover(row, opened.settled);
        deterministicRecovered += 1;
        return;
      }
      const refusedBy = aggregateRefusal(row);
      if (refusedBy !== null) {
        admitted--;
        holdDeterministic(row, refusedBy);
        return;
      }
      deterministicDispatched += 1;
      const result = await dispatchRow(row, {
        executor: typeof input.executor === "function" ? input.executor(row) : input.executor,
        leaseTtlMs: input.leaseTtlMs,
        ...(research !== undefined ? { decision: decisions.get(row.obligation.id) } : {}),
      });
      if (research?.onDispatched) await research.onDispatched(result, "DETERMINISTIC");
    }, input.placeComparator, input.huntFor, input.providerLimitOf);
  };

  /* Model rows are hunted in their government's packet by the hunters, never here. */
  for (const row of modelRows) {
    deferred.push({ obligationId: row.obligation.id, why: "HUNTED_IN_PACKET: its government's packet carries this blank to the hunters; work remains due until a fact is checked." });
    holdModel(row, "HUNTED_IN_PACKET");
  }

  await deterministicLane();

  const lanes: LaneCounts | null =
    research === undefined
      ? null
      : {
          /* Counted where each row is started, so a lane's dispatched count cannot drift from the rows it held. */
          deterministic: {
            due: deterministicRows.length,
            dispatched: deterministicDispatched,
            deferredBy: deterministicDeferredBy,
            recovered: deterministicRecovered,
            oldestWaitingDueAt: deterministicOldestWaiting,
          },
          model: {
            due: modelRows.length,
            dispatched: 0,
            deferred: modelDeferred,
            deferredBy,
            recovered: 0,
            oldestWaitingDueAt: modelOldestWaiting,
          },
        };

  const debts = [...debtsById.values()];
  /* A recovered reading is a reading: its obligation is not overdue. Counted over
     the due set, because a recovery before dispatch can be a row that was not due. */
  const readThisCycle = new Set([...worked, ...recovered.filter((r) => r.discharged).map((r) => r.obligationId)]);
  const risk = stalenessRisk({
    scheduled: schedule.scheduled.length,
    unscheduled: schedule.unscheduled.length,
    overdue: workNow.filter((row) => !readThisCycle.has(row.obligation.id)).length,
    debts,
    nowMs,
  });

  return {
    startedAt,
    finishedAt: new Date(nowMs).toISOString(),
    reclaim,
    schedule,
    dueCount: workNow.length,
    dispatched,
    worked,
    recovered,
    simulated,
    deferred,
    debts,
    incidents: aggregateIncidents(debts, nowMs),
    risk,
    lanes,
    promotedToReaderTruth: false,
  };
}

/** Close what the cycle dispatched and recovered by one rule: DISCHARGED only on a committed reading, UNRESOLVED otherwise. */
export async function closeCycleOccurrences(
  repos: ControlPlaneRepositories,
  input: {
    readonly cycle: Pick<CycleResult, "dispatched" | "recovered">;
    readonly occurrenceFor: (obligationId: string) => string | null;
    readonly now: string;
    /** Independent resource groups in flight; provider-neutral callers stay serial. */
    readonly concurrency?: number;
  },
): Promise<void> {
  const operations: { occurrenceId: string; obligationId: string; run: () => Promise<unknown> }[] = [];
  for (const result of input.cycle.dispatched) {
    const occurrenceId = input.occurrenceFor(result.obligationId);
    if (occurrenceId === null) continue;
    operations.push({ occurrenceId, obligationId: result.obligationId, run: () => {
      const discharged = dischargesObligation(result);
      return closeOccurrence(repos, {
        occurrenceId,
        disposition: discharged ? result.disposition : null,
        unresolvedReason: discharged ? null : result.detail,
        now: input.now,
      });
    } });
  }
  for (const recovered of input.cycle.recovered) {
    operations.push({ occurrenceId: recovered.occurrenceId, obligationId: recovered.obligationId,
      run: () => closeSettledOccurrence(repos, { settled: recovered, now: input.now }) });
  }
  // Closing also updates the standing obligation. Join both resource identities
  // so duplicate occurrence aliases and two periods of one obligation stay serial.
  const parents = new Map<string, string>();
  const root = (key: string): string => {
    let resolved = key;
    const path: string[] = [];
    while (parents.has(resolved) && parents.get(resolved) !== resolved) {
      path.push(resolved);
      resolved = parents.get(resolved)!;
    }
    parents.set(resolved, resolved);
    for (const prior of path) parents.set(prior, resolved);
    return resolved;
  };
  for (const operation of operations) parents.set(root(`occurrence:${operation.occurrenceId}`), root(`obligation:${operation.obligationId}`));
  const groups = new Map<string, { index: number; run: () => Promise<unknown> }[]>();
  operations.forEach((operation, index) => {
    const key = root(`occurrence:${operation.occurrenceId}`);
    const group = groups.get(key) ?? [];
    group.push({ index, run: operation.run });
    groups.set(key, group);
  });
  const failures: { index: number; error: unknown }[] = [];
  await runPool([...groups.values()], input.concurrency ?? 1, async group => {
    for (const operation of group) {
      try { await operation.run(); }
      catch (error) {
        failures.push({ index: operation.index, error });
        break; // A dependent closure cannot retry the unchanged failed resource.
      }
    }
  });
  // No closure remains running when finalization observes the failed cycle.
  if (failures.length) throw failures.sort((a, b) => a.index - b.index)[0]!.error;
}

/** The digest as lines, so a console run, a run record and a test say the same thing. */
export function digestLines(cycle: CycleResult): string[] {
  const out: string[] = [];
  out.push("ACTIVITY — what this cycle did");
  out.push(
    `  obligations        ${cycle.schedule.scheduled.length} scheduled · ` +
      `${cycle.schedule.unscheduled.length} unscheduled`,
  );
  for (const u of cycle.schedule.unscheduled) {
    out.push(`      UNSCHEDULED ${u.obligation.id}: ${u.reason}`);
  }
  out.push(`  due this cycle     ${cycle.dueCount}`);
  out.push(
    `  dispatched         ${cycle.dispatched.length} — ` +
      `${cycle.worked.length} DISCHARGED, ` +
      `${cycle.simulated.length} simulated (no retrieval), ` +
      `${cycle.dispatched.filter((d) => d.outcome === "FAILED").length} failed, ` +
      `${cycle.dispatched.filter((d) => d.outcome === "NOT_CLAIMED").length} held by another worker, ` +
      `${cycle.dispatched.filter((d) => d.outcome === "NO_ROUTE_TASK").length} with no route task`,
  );
  /*
   * DISCHARGED is counted from the disposition commits, never from the WORKED
   * label, and the line below states the artifact and disposition evidence
   * beside it so the two cannot drift apart in a report.
   */
  const committed = cycle.dispatched.filter((d) => d.dispositionCommitted);
  const recoveredReadings = cycle.recovered.filter((r) => r.discharged).length;
  out.push(
    `  dispositions       ${committed.length} committed — ` +
      (committed.length === 0
        ? recoveredReadings === 0
          ? "none, so nothing this cycle discharged an obligation"
          : "none by a dispatch this cycle"
        : committed.map((d) => `${d.disposition}`).join(", ")),
  );
  out.push(
    `  artifacts          ${committed.reduce((n, d) => n + d.artifactIds.length, 0)} recorded ` +
      "against a closed Attempt",
  );
  if (cycle.recovered.length > 0) {
    out.push(
      `  recovered          ${cycle.recovered.length} open occurrence(s) on a route an interrupted cycle ` +
        "had already disposed, closed with that committed disposition and not walked again — " +
        `${recoveredReadings} reading(s) discharged, ${cycle.recovered.length - recoveredReadings} still owed: ` +
        cycle.recovered.map((r) => r.disposition.disposition).join(", "),
    );
  }
  if (cycle.simulated.length > 0) {
    out.push(
      `      SIMULATED ${cycle.simulated.length} obligation(s) had a shadow decision and NO ` +
        "retrieval. They are still owed, their debt stands, and none of them is discharged.",
    );
  }
  const byExecutor = (kind: string): number =>
    cycle.dispatched.filter((d) => d.executor === kind).length;
  out.push(
    `  executors          ${byExecutor("DETERMINISTIC")} deterministic · ` +
      `${byExecutor("BOUNDED_MODEL_WORKER")} bounded model worker`,
  );
  out.push(`  deferred           ${cycle.deferred.length}`);
  const withCost = cycle.dispatched.filter((d) => d.cost !== null);
  const usd = withCost.reduce((n, d) => n + (d.cost?.usd ?? 0), 0);
  out.push(
    `  cost               ${usd.toFixed(4)} over ${withCost.length} measured Attempt(s) of ` +
      `${cycle.dispatched.length} dispatched`,
  );
  for (const kind of ["DETERMINISTIC", "BOUNDED_MODEL_WORKER"] as const) {
    const rows = cycle.dispatched.filter((d) => d.executor === kind);
    const spent = rows.reduce((n, d) => n + (d.cost?.usd ?? 0), 0);
    out.push(
      `      ${kind.padEnd(21)} ${rows.length} Attempt(s), ${spent.toFixed(4)}` +
        (rows.length === 0 ? "" : ` — models: ${
          [...new Set(rows.map((d) => d.worker?.version ?? "unrecorded"))].join(", ")
        }`),
    );
  }
  out.push(
    `  leases             ${cycle.reclaim.reclaimed.length} reclaimed · ` +
      `${cycle.reclaim.releasedSettled.length} released on an already-disposed route · ` +
      `${cycle.reclaim.stillLive.length} still live · ${cycle.reclaim.refused.length} refused`,
  );
  out.push(`  freshness debt     ${cycle.debts.length} row(s) across ${cycle.incidents.length} incident(s)`);
  for (const i of cycle.incidents) {
    out.push(
      `      ${i.cause} at ${i.target}: ${i.obligationsAffected} obligation(s), oldest ` +
        `${i.oldestHours.toFixed(1)}h, next retry ${i.nextRetryAt}`,
    );
  }
  out.push("");
  out.push(
    `  PROMOTION          none. promotedToReaderTruth=${cycle.promotedToReaderTruth}. This loop ` +
      "observes, acquires and records; nothing it produced changed what a reader is told.",
  );
  return out;
}
