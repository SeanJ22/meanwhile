/**
 * **THE SHADOW LOOP — one unattended cycle, end to end.**
 * (Session B, W3.5, 2026-08-30.)
 *
 * ```
 *   RECLAIM   sweep leases whose holder stopped renewing
 *   SCHEDULE  derive a next-due for every active obligation
 *   RETRY     take back the debt whose backoff has elapsed
 *   DISPATCH  claim what is due and run it through a disposable worker
 *   RECORD    results, debt, next-due — durably, through the repositories
 *   DIGEST    a reading whose headline is PILOT HEALTH
 * ```
 *
 * ## Shadow means one thing, precisely
 *
 * The loop OBSERVES, ACQUIRES, RECORDS and runs the canonical instruments.
 * **It does not promote anything to canonical reader truth.** No result of a
 * cycle changes what a reader is told. That is not a safety margin around a
 * feature that is nearly ready — it is the state RULING 212, 216 and 218
 * jointly require until the scheduler's results are INDEPENDENTLY_REPRODUCED,
 * and the session that built the scheduler cannot supply that by definition.
 *
 * `promoteToReaderTruth` does not exist in this module and no caller can pass
 * a flag that would create it. The absence is the mechanism.
 *
 * ## Why the digest leads with PILOT HEALTH and not with activity
 *
 * RULING 217. A digest that leads with *312 routes walked, 1,847 records
 * refreshed* reads as health and measures effort — and effort is not evidence.
 * The three contracts come first, each stating its own blocker, and the
 * activity counts sit underneath where they belong: as what the loop did, not
 * as how the pilot is.
 */

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
import type { ContractReading, PilotHealthRollup } from "../../health/contracts.ts";
import { freshnessContract, pilotHealth } from "../../health/contracts.ts";
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
  /**
   * **OPEN IN STEP WITH DISPATCH, NOT AHEAD OF IT.** (2026-09-18.)
   *
   * When present, each lane opens an obligation's occurrence just-in-time —
   * only after the row has passed the wall and admission gates and is about to
   * dispatch — and defers it by name when opening fails. Nothing is pre-opened,
   * so the runner opens exactly what it can dispatch before the wall instead of
   * the whole backlog, and there is no per-cycle open ceiling to size. Returns
   * whether the occurrence is now open (so `routeTaskFor` resolves it). Absent,
   * `requireOpenOccurrence` governs and the caller pre-opens.
   *
   * It may instead return `{ settled }`: the obligation's open occurrence holds
   * a RouteTask an interrupted cycle already disposed (2026-09-22). That row is
   * RECOVERED with the committed disposition and never dispatched; the caller
   * closes it in its occurrence-and-debt phase (`closeCycleOccurrences`).
   */
  readonly openOccurrence?: (
    row: ScheduledObligation,
  ) => Promise<boolean | { readonly settled: SettledOccurrence }>;
  /**
   * **SETTLED OCCURRENCES RECOVERED BEFORE ANY LANE RUNS.** (2026-09-23.)
   *
   * The caller finds them with `findSettledOccurrences`. Each one whose
   * obligation is scheduled is recovered by the rule `openOccurrence`'s
   * `{ settled }` applies, whatever its lane, due time, debt backoff or
   * admission. Its row is then withheld from both lanes, so it is recovered
   * exactly once. A recovery walks nothing and spends nothing, so no dispatch
   * gate applies to it.
   */
  readonly settledOccurrences?: readonly SettledOccurrence[];
  /** Observability only; recovery still completes before any worker is admitted. */
  readonly onRecoveryComplete?: () => void;
  readonly maturity: MethodMaturity;
  /**
    * The executor, WITH its lane declared. (W3.E regression, 2026-08-31.)
    *
    * A bare `run` let the dispatcher open the persisted Attempt under the
    * lane the method store IMPLIED rather than the one about to execute, so a
    * deterministic walk was recorded as an anthropic model worker.
    */
  /**
   * **A FUNCTION IS ACCEPTED, AND THAT IS PART D1's REQUIREMENT.**
   * (Session C, 2026-08-31.)
   *
   * One `DeclaredExecutor` for a whole cycle was right while every obligation
   * came from one corpus and was worked by one HTTP GET. It cannot express the
   * registry: a campaign-finance portfolio carries a DataTables POST that is
   * deterministic, an FTP drop no client here can open, and a records-request
   * route that ends in a human act. Those are different lanes over one cycle,
   * and the lane is DECLARED before the Attempt is persisted — so it has to be
   * decidable per obligation or the Attempt is opened under the wrong worker
   * identity, which is the exact W3.E defect wearing a registry.
   */
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
  /**
   * The canonical READER and TRUTH readings, taken by their own instruments.
   * Passed in rather than computed here: a scheduler that computed its own
   * reader health would be grading its own homework, and the digest's headline
   * has to come from the instruments that own those contracts.
   */
  readonly reader: ContractReading;
  readonly truth: ContractReading;
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
  /** A tightly scoped canary may skip the whole lease sweep; normal cycles never do. */
  readonly skipReclaim?: boolean;
  /**
   * **THE OWNER'S DISPATCH REORDERS THE DUE SET.** (ADM-8, 9.4.26 admin
   * feedback, 2026-09-04.)
   *
   * Obligation ids the owner dispatched the fleet at this cycle. They are
   * placed FIRST in the due set — ahead of the oldest-first order — in BOTH
   * lanes, with their relative order otherwise untouched. A dispatch reorders
   * and nothing else: it does not add a row, does not make an undue row due,
   * does not lift a debt backoff, and does not change any ceiling or budget.
   * Absent or empty, each lane keeps its own order: the Scout lane's
   * `compareModelRows`, and the plain-code lane's longest wait first
   * (`plainCodeQueueOrder`).
   */
  readonly placeFirst?: ReadonlySet<string>;
  readonly placeComparator?: () => Promise<(left: ScheduledObligation, right: ScheduledObligation) => number>;
  /**
   * **LEVEL 1 — TWO LANES IN ONE CYCLE.** (Level 1 activation, 2026-09-01.)
   *
   * Absent, the cycle runs exactly as before: one serial queue. Present, the
   * due set is split by the canonical executor decision: deterministic rows
   * run the existing serial queue under `maxDispatches`; model rows run a
   * bounded pool of Scouts, each admitted or DEFERRED BY NAME by `admitScout`
   * (the rolling ceiling, the per-cycle maximum, the lane state). The two
   * lanes run concurrently — they are different obligations on different
   * route tasks — so Scout minutes do not come out of the deterministic
   * drain. Both stop STARTING work at the dispatch budget.
   */
  readonly research?: ResearchLanes;
}

export interface ResearchLanes {
  readonly decide: (row: ScheduledObligation) => ExecutorDecision;
  /**
   * A shut door goes to a detective, and its plain re-read must not stop (DP-02). One occurrence
   * carries one route task, so the plain re-read runs in the same cycle only when the detective
   * is refused (paid lane paused, capped or blacked out). Absent or null, the row has no plain
   * decision to keep.
   */
  readonly plainBesideDetective?: (row: ScheduledObligation) => ExecutorDecision | null;
  /**
   * Optional canonical order for the actual due model rows. `runCycle` sorts a
   * copy of the rows it already owns, so a caller can reorder but cannot omit,
   * duplicate, or manufacture work. Absent, the historical oldest-due order
   * stands. The standing runtime supplies the reader-impact comparator that it
   * also records for Admin.
   */
  readonly compareModelRows?: (left: ScheduledObligation, right: ScheduledObligation) => number;
  /**
   * May answer asynchronously (MW-021, 2026-09-25): a budgeted Send's or
   * area's hold is taken on the shared budget ledger before the Scout starts.
   */
  readonly admitScout: (
    row: ScheduledObligation,
  ) => ScoutAdmission | Promise<ScoutAdmission>;
  readonly modelExecutor: DeclaredExecutor | ((row: ScheduledObligation) => DeclaredExecutor);
  readonly workerCapacity: number;
  readonly scoutLeaseTtlMs: number;
  /** A Scout is not STARTED when it could not finish inside the dispatch budget. */
  readonly onDispatched?: (result: DispatchResult, lane: ExecutorKind) => void | Promise<void>;
  /**
   * A Scout `admitScout` admitted that then did not run (its occurrence could
   * not be opened, it was recovered, or an aggregate refused it), so whatever
   * the admission held is released (MW-021, 2026-09-25).
   */
  readonly onAdmittedNotDispatched?: (row: ScheduledObligation, code: string) => void | Promise<void>;
  /**
   * **THE PRE-WARM.** (2026-09-06.) Called ONCE per cycle, before the first
   * admitted Scout is dispatched and after nothing else: it writes the static
   * prefix (tools + system) to the prompt cache so every Attempt this cycle
   * — including the two that start together under the concurrency bound —
   * reads it instead of each paying the write. Every admitted row awaits the
   * same promise, so no Attempt starts before the entry exists. Never called
   * when no Scout is admitted: a cycle that dispatches nothing warms nothing.
   * The outcome travels on `LaneCounts.model.prewarm`; a failure is recorded
   * there and the Attempts still run.
   */
  readonly prewarm?: () => Promise<PrewarmOutcome>;
}

/** What the cycle's pre-warm request reported, for the run record and the digest. */
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
  /* MW-033 (2026-09-25): no paid call was made — the loop's start model's prefix could not be shown to reach its cacheable minimum. */
  | { readonly status: "SKIPPED"; readonly at: string; readonly model: string; readonly code: string; readonly detail: string; readonly durationMs: number };

/**
 * **EVERY DUE ROW IS ACCOUNTED FOR, BY LANE.** (MW-014, MW-029, 2026-09-25.)
 *
 * Each due row a lane holds ends the cycle in exactly one place: dispatched,
 * deferred under one code, or recovered with a disposition an interrupted
 * cycle already committed. So `dispatched + Σ deferredBy + recovered = due`
 * for each lane, and a reader of the counts can check it rather than trust it.
 * `oldestWaitingDueAt` is how long the oldest waiting work has been owed, among
 * the rows the lane did not reach. In the model lane, it is the earliest
 * next-due. In the plain-code lane, it is the earliest time a row joined the
 * queue, which is also the queue's order (`waitingSince`). That is the row's
 * next-due, or the end of its backoff if its last attempt failed.
 */
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
  readonly health: PilotHealthRollup;
  /** Per-lane counts when research lanes ran; null when the cycle ran one queue. */
  readonly lanes: LaneCounts | null;
  /** Structural, and it is the shadow guarantee. Always false in this module. */
  readonly promotedToReaderTruth: false;
}

/** A settled occurrence the cycle recovered, and whether its disposition was a reading. */
export interface RecoveredOccurrence extends SettledOccurrence {
  /** True when the committed disposition is in `DISCHARGING_DISPOSITIONS`. */
  readonly discharged: boolean;
}

/** A bounded pool: at most `limit` items in flight, in input order. */
export type ScoutAdmission = { readonly admit: true } | { readonly admit: false; readonly code: string; readonly why: string };

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

export async function runPool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>,
  comparator?: () => Promise<(left: T, right: T) => number>,
  huntFor?: (item: T) => string | null | undefined): Promise<void> {
  const pending = [...items];
  const compareRound = huntFor ? huntRoundComparator(items, huntFor) : () => 0;
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
      item = pending.shift();
    });
    selection = next.catch(() => undefined);
    return next.then(() => item);
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    for (;;) {
      const item = await take();
      if (item === undefined) break;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Move the rows whose obligation id is in `first` to the front, keeping the
 * relative order of both groups. Pure and stable, so the cycle script's
 * opening order and the dispatcher's due order are the SAME derivation of the
 * owner's dispatch (ADM-8) — two surfaces, one ordering. An empty set returns
 * the rows as they were.
 */
export function placeFirstRows<T extends { readonly obligation: { readonly id: string } }>(
  rows: readonly T[],
  first: ReadonlySet<string> | undefined,
): readonly T[] {
  if (first === undefined || first.size === 0) return rows;
  return [...rows.filter((r) => first.has(r.obligation.id)), ...rows.filter((r) => !first.has(r.obligation.id))];
}

/**
 * Run one full cycle. Unattended: nothing here can ask a question.
 *
 * A cycle that could block on an answer is a cycle that stops the loop, and
 * RULING 146 forbids it — a decision that is genuinely the author's becomes a
 * Needs Sean row and the session keeps going. There is no prompt, no readline
 * and no confirmation in this path.
 */
export async function runCycle(input: CycleInput): Promise<CycleResult> {
  const startedAt = input.now;
  const nowMs = Date.parse(input.now);

  /*
   * 1 · RECLAIM FIRST, and the order matters. A route still leased by a dead
   * worker is a route this cycle would skip as contended. Sweeping before
   * scheduling means a worker that died since the last cycle costs one cycle
   * of latency rather than a lease TTL every cycle forever.
   */
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

  /*
   * **DEBT BACKOFF GATES RE-DISPATCH, and without this it does not.**
   * (Session C, 2026-08-31.)
   *
   * `dueNow` answers "has the clock passed?" and knows nothing about failure.
   * An obligation that has never been discharged never advances its anchor, so
   * its next-due sits permanently in the past and it was dispatched on EVERY
   * cycle regardless of the backoff `recordFailure` computed. The retry
   * schedule was therefore real, tested, and bypassed — the same shape as the
   * debt that was durable in a store nothing loaded.
   *
   * It only became visible when a permanently-walled route was registered: the
   * Arizona FTP drop this process holds no client for would have been opened,
   * refused and re-opened once a cycle forever, and the incident aggregate
   * would have reported an outage that is really a missing adapter.
   *
   * So an obligation carrying debt is due only when its backoff has ELAPSED.
   * It is held out by name and counted in `deferred`, never dropped.
   */
  const backedOff = new Map(
    input.debts
      .filter((d) => d.consecutiveFailures > 0 && !retryIds.has(d.obligationId))
      .map((d) => [d.obligationId, d]),
  );

  const due = dueNow(schedule, nowMs).filter((row) => !backedOff.has(row.obligation.id));
  const alsoDue = schedule.scheduled.filter(
    (row) => retryIds.has(row.obligation.id) && !due.includes(row),
  );
  /* The owner's dispatch (ADM-8) goes first; everything else keeps the oldest-first order above. */
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

  /*
   * **A SETTLED OCCURRENCE IS RECOVERED, NEVER DISPATCHED.** (2026-09-22.)
   *
   * An interrupted cycle committed this occurrence's disposition and ended
   * before closing it. Walking the route again would claim a settled task, so
   * the disposition already committed is recorded by the rule `record` applies
   * to a dispatch's: a reading discharges the debt; any other disposition
   * closes the route, not the obligation, and accrues debt exactly as a WORKED
   * non-reading does, so the obligation stays owed and retries on its backoff.
   */
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

  /*
   * 3b · RECOVER, BEFORE ANY LANE. (2026-09-23.) Every settled occurrence the
   * caller found is recovered here, whatever its due time, backoff, lane or
   * admission, and its row is withheld from both lanes below. An obligation
   * with no schedule has no row to recover against and is left open for the
   * caller to name.
   */
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
    /*
     * 5 · RECORD. A failure becomes DEBT — durable, self-retrying, and nobody
     * is notified (RULING 218).
     *
     * **DEBT IS CLEARED BY A COMMITTED DISPOSITION AND BY NOTHING ELSE.**
     * (Session B resume, W3.A.) This read `result.outcome === "WORKED"`, and
     * WORKED was issued on a seam that returned `ok: true` for a no-op. So a
     * shadow executor that fetched nothing deleted the obligation's debt and
     * the loop recomputed a next-due from work that never happened —
     * freshness, asserted from our own inaction. `dischargesObligation`
     * requires the disposition commit, and it is the ONLY thing that does.
     */
    if (dischargesObligation(result)) {
      debtsById.delete(row.obligation.id);
      worked.push(row.obligation.id);
    } else if (result.outcome === "SIMULATED") {
      /*
       * A SHADOW DECISION IS NOT A FAILURE AND IT IS NOT A SUCCESS.
       *
       * It does not become debt, because nothing about the publisher went
       * wrong and an incident count that rose on our own decision not to walk
       * would report a wall where there is none. It does not clear debt
       * either. Any debt the obligation already carried stands untouched, and
       * the obligation stays due — which is the honest state: still owed.
       */
      simulated.push(row.obligation.id);
    } else if (result.outcome !== "NOT_CLAIMED") {
      /*
       * FAILED, NO_ROUTE_TASK, and — the case that is easy to miss — a WORKED
       * result whose committed disposition is NOT a reading. A route disposed
       * `BLOCKED_CURRENTLY` reached a legitimate terminal state and refreshed
       * nothing, so the obligation is still owed and its debt still accrues.
       * Letting that fall through to neither branch would leave a walled route
       * with no debt row, which is an obligation that quietly stops retrying.
       */
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


  /*
   * **ONE OBLIGATION'S THROW MAY NOT ABORT THE CYCLE.** (Autonomy-recovery
   * session, 2026-09-01.)
   *
   * `dispatchOne` already converts every EXPECTED failure — a live foreign
   * lease, a refused disposition, a worker that threw — into a FAILED
   * `DispatchResult` and returns it. What it does not catch is an UNEXPECTED
   * throw from the store beneath it: a transient Neon error, or the
   * inconsistent state a killed cycle leaves behind (an occurrence whose
   * RouteTask a crash left mid-transition). Before this, such a throw
   * propagated out of `runCycle`, aborted the whole cycle, and stranded every
   * other due occurrence — and a crash-restart re-hit the same state and
   * re-aborted, which is the recovery loop that required manual surgery.
   *
   * So an unexpected throw is isolated to its obligation: recorded as a
   * FAILED dispatch (the branch above accrues debt and keeps it owed) and the
   * cycle continues. The obligation is not discharged, only deferred to a
   * retry — which is exactly the honest state.
   */
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
  const resolvedDeterministic = new Map<string, DeclaredExecutor>();
  const deterministicRows: ScheduledObligation[] = [];
  const modelRows: ScheduledObligation[] = [];
  /* A row recovered before dispatch is withheld from both lanes, so it is recovered once and never walked. */
  const laneWork = workNow.filter((row) => !recoveredBeforeDispatch.has(row.obligation.id));
  if (research === undefined) {
    deterministicRows.push(...laneWork);
  } else {
    for (const row of laneWork) {
      let decision = research.decide(row);
      if (decision.kind === "BOUNDED_MODEL_WORKER") {
        // Held discoveries declare their actual lane before any paid admission.
        // Other factories still resolve at dispatch, inheriting same-cycle work.
        const executor = typeof research.modelExecutor === "function" ? research.modelExecutor(row) : research.modelExecutor;
        if (executor.lane === "DETERMINISTIC") {
          resolvedDeterministic.set(row.obligation.id, executor);
          decision = { ...decision, kind: "DETERMINISTIC", why: "The resolved executor reuses held work without a model request." };
        }
      }
      decisions.set(row.obligation.id, decision);
      (decision.kind === "BOUNDED_MODEL_WORKER" ? modelRows : deterministicRows).push(row);
    }
    /*
     * NH328 — `dueNow` is oldest-first, but the bounded Scout lane is governed
     * by reader impact. Apply the canonical comparator to the ACTUAL due model
     * set after lane classification and before admission. Sorting this existing
     * array cannot add, remove, or duplicate an obligation; it only determines
     * which due row reaches a scarce Scout slot first. The deterministic lane
     * is ordered below, by how long each row has waited.
     */
    if (research.compareModelRows !== undefined) modelRows.sort(research.compareModelRows);
  }
  /*
   * **THE PLAIN-CODE LANE SERVES THE LONGEST WAIT FIRST.** (2026-09-25.) The
   * lane is ordered by `waitingSince`, using the debt carried into the cycle.
   * A row whose last attempt failed rejoins behind every row already waiting.
   * It does not keep its first next-due and jump back to the head each time
   * its backoff ends, as it did before. Then the owner's placed-first rows go
   * to the front, in the same order (ADM-8). Sorting this array can reorder
   * rows. It cannot add, drop or duplicate one, and it changes no cadence and
   * no backoff.
   */
  const debtAtCycleStart = new Map(input.debts.map((d) => [d.obligationId, d] as const));
  const debtOf = (obligationId: string) => debtAtCycleStart.get(obligationId);
  const plainCodeQueue = placeFirstRows(plainCodeQueueOrder(deterministicRows, debtOf), input.placeFirst);
  const deferredBy: Record<string, number> = {};
  let modelDispatched = 0;
  let modelDeferred = 0;
  let modelRecovered = 0;
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

  /*
   * Open in step with dispatch when the caller supplies `openOccurrence`:
   * nothing is pre-opened, so a lane opens only the rows it is about to run, and
   * the wall — not a per-cycle open ceiling — bounds how many it opens. Absent,
   * the pre-open path stands and this is a no-op; the early `requireOpenOccurrence`
   * check governs instead.
   */
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
        executor: resolvedDeterministic.get(row.obligation.id) ?? (typeof input.executor === "function" ? input.executor(row) : input.executor),
        leaseTtlMs: input.leaseTtlMs,
        ...(research !== undefined ? { decision: decisions.get(row.obligation.id) } : {}),
      });
      if (research?.onDispatched) await research.onDispatched(result, "DETERMINISTIC");
    }, input.placeComparator, input.huntFor);
  };

  /*
   * THE MODEL LANE — a bounded pool of Scouts. Every row is admitted or
   * DEFERRED BY CODE (the rolling ceiling, the per-cycle maximum, a paused or
   * unconfigured lane), and a Scout that could not finish inside the dispatch
   * budget is not started at all: a Scout killed mid-walk by the supervisor
   * leaves an Attempt with no outcome and a lease to reclaim.
   */
  /**
   * The cycle's one pre-warm (2026-09-06). Created by the first admitted
   * Scout and awaited by every admitted Scout, so the two that start together
   * under the concurrency bound both find the static prefix written.
   */
  let prewarmOnce: Promise<PrewarmOutcome> | null = null;
  let prewarmOutcome: PrewarmOutcome | null = null;
  const warmStaticPrefix = async (): Promise<void> => {
    if (research?.prewarm === undefined) return;
    if (prewarmOnce === null) {
      prewarmOnce = research.prewarm().catch(
        (error): PrewarmOutcome => ({ status: "FAILED", at: new Date(nowMs).toISOString(), detail: error instanceof Error ? error.message : String(error), durationMs: 0 }),
      );
    }
    prewarmOutcome = await prewarmOnce;
  };

  /** The plain re-read that keeps running beside (or instead of) a detective for a shut door. */
  const plainBeside = async (row: ScheduledObligation): Promise<void> => {
    const plain = research?.plainBesideDetective?.(row) ?? null;
    if (plain === null || plain.kind === "BOUNDED_MODEL_WORKER") return;
    if (input.openOccurrence === undefined && input.requireOpenOccurrence && input.routeTaskFor(row.obligation.id) === null) return;
    const opened = await tryOpen(row);
    if (opened !== true) return;
    if (aggregateRefusal(row) !== null) return;
    deterministicDispatched += 1;
    const result = await dispatchRow(row, {
      executor: typeof input.executor === "function" ? input.executor(row) : input.executor,
      leaseTtlMs: input.leaseTtlMs,
      decision: plain,
    });
    if (research?.onDispatched) await research.onDispatched(result, "DETERMINISTIC");
  };

  const modelLane = async (): Promise<void> => {
    if (research === undefined) return;
    await runPool(modelRows, research.workerCapacity, async (row) => {
      if (input.openOccurrence === undefined && input.requireOpenOccurrence && input.routeTaskFor(row.obligation.id) === null) {
        deferred.push({ obligationId: row.obligation.id, why: "NO_OPEN_OCCURRENCE: outside this cycle's reserved lane slots; work remains due." });
        holdModel(row, "NO_OPEN_OCCURRENCE");
        return;
      }
      const admit = await research.admitScout(row);
      if (!admit.admit) {
        deferred.push({
          obligationId: row.obligation.id,
          why: `${admit.code}: ${admit.why}. Deferred with its next-due, never dropped and never reported complete.`,
        });
        holdModel(row, admit.code);
        await plainBeside(row);
        return;
      }
      const opened = await tryOpen(row);
      if (opened === false) {
        deferred.push({ obligationId: row.obligation.id, why: "NO_OPEN_OCCURRENCE: the occurrence could not be opened in step with dispatch this cycle; work remains due." });
        holdModel(row, "NO_OPEN_OCCURRENCE");
        if (research.onAdmittedNotDispatched) await research.onAdmittedNotDispatched(row, "NO_OPEN_OCCURRENCE");
        return;
      }
      /* No Scout runs for a recovered row, so it is not counted as dispatched. */
      if (opened !== true) {
        recover(row, opened.settled);
        modelRecovered += 1;
        if (research.onAdmittedNotDispatched) await research.onAdmittedNotDispatched(row, "RECOVERED");
        return;
      }
      /* Counted under the aggregate admission's own code (a wall, a blackout), never a generic AGGREGATE. */
      const refusedBy = aggregateRefusal(row);
      if (refusedBy !== null) {
        holdModel(row, refusedBy);
        if (research.onAdmittedNotDispatched) await research.onAdmittedNotDispatched(row, refusedBy);
        await plainBeside(row);
        return;
      }
      /* Admitted: the static prefix is warmed once, before the first dispatch, and every dispatch waits for it. */
      await warmStaticPrefix();
      modelDispatched += 1;
      const result = await dispatchRow(row, {
        executor: typeof research.modelExecutor === "function" ? research.modelExecutor(row) : research.modelExecutor,
        leaseTtlMs: research.scoutLeaseTtlMs,
        decision: decisions.get(row.obligation.id),
      });
      if (research.onDispatched) await research.onDispatched(result, "BOUNDED_MODEL_WORKER");
    }, input.placeComparator, input.huntFor);
  };

  await Promise.all([deterministicLane(), modelLane()]);

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
            dispatched: modelDispatched,
            deferred: modelDeferred,
            deferredBy,
            recovered: modelRecovered,
            oldestWaitingDueAt: modelOldestWaiting,
            prewarm: prewarmOutcome,
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
    health: pilotHealth(input.reader, input.truth, freshnessContract(risk)),
    promotedToReaderTruth: false,
  };
}

/**
 * **CLOSE WHAT THE CYCLE DISPATCHED AND WHAT IT RECOVERED, BY ONE RULE.**
 *
 * The close half of the occurrence-and-debt phase. A dispatch's occurrence
 * closes DISCHARGED only on a committed reading (`dischargesObligation`); a
 * recovered one by the same rule, applied to the disposition its RouteTask
 * already carries (`closeSettledOccurrence`). Everything else closes UNRESOLVED
 * and its obligation stays owed. `occurrenceFor` names the occurrence each
 * dispatched obligation ran under; a recovered one carries its own.
 */
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

/**
 * The digest, in the order RULING 217 requires: health first, activity under.
 *
 * Returned as lines rather than printed, so the same function serves a console
 * run, a run record and a test — three surfaces that must not be able to
 * disagree about what the cycle said.
 */
export function digestLines(cycle: CycleResult): string[] {
  const out: string[] = [];
  out.push("PILOT HEALTH");
  for (const r of cycle.health.readings) {
    out.push(`  ${r.contract.padEnd(9)} ${r.state}`);
    out.push(`      ${r.reason}`);
  }
  out.push(
    `  ROLLUP    ${cycle.health.green ? "GREEN" : "NOT GREEN"}` +
      (cycle.health.blocking.length > 0
        ? ` — blocked by ${cycle.health.blocking.map((b) => `${b.contract} (${b.state})`).join(", ")}`
        : ""),
  );
  out.push("");
  out.push("ACTIVITY — what this cycle did, which is not how the pilot is");
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
