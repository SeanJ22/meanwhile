/** One unattended cycle: reclaim, schedule, retry, dispatch, record, digest. */

import type { FreshnessDebt, Incident, StalenessRisk } from "./debt.ts";
import type { DispatchResult, ExecutorDecision, ExecutorKind, MethodMaturity, ReclaimSweep, DeclaredExecutor, WorkerBound } from "./dispatch.ts";
import type { SettledOccurrence } from "./durable.ts";
import type { FreshnessObligation, ScheduledObligation, UnscheduledObligation } from "./obligation.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { DiskRows } from "./disk-rows.ts";
import { runStreamedCycle } from "./streamed-cycle.ts";
import { closeStreamedCycleOccurrences } from "./cycle-closure.ts";

/** One cycle's inputs. Every clock and every seam is injected. */
export interface CycleInput {
  readonly repos: ControlPlaneRepositories;
  /** Only filtered occurrence histories are recovered; dispatch still uses the shared repositories. */
  readonly recoveryRepos?: ControlPlaneRepositories;
  readonly obligations?: Iterable<FreshnessObligation> | AsyncIterable<FreshnessObligation>;
  readonly obligationSource?: {
    readonly visit:(visit:(obligation:FreshnessObligation)=>void|Promise<void>)=>Promise<void>;
    readonly read:(id:string)=>Promise<FreshnessObligation|null>;
  };
  /** Debt carried in from the previous cycle. Durable state, passed through. */
  readonly debts: Iterable<FreshnessDebt> | AsyncIterable<FreshnessDebt>;
  /** Obligation id → the RouteTask that works it, where one is registered. */
  readonly routeTaskFor: (obligationId: string) => string | null;
  /** The standing runner opens only its bounded lane slots, retaining all other due rows. */
  readonly requireOpenOccurrence?: boolean;
  /** Opens an obligation's occurrence just-in-time, after admission; returns whether it is open, or `{ settled }` for an occurrence an interrupted cycle already disposed. Absent, `requireOpenOccurrence` governs. */
  readonly openOccurrence?: (
    row: ScheduledObligation,
  ) => Promise<boolean | { readonly settled: SettledOccurrence }>;
  /** Settled occurrences recovered before any lane runs, whatever their lane, due time, backoff or admission; each is withheld from both lanes. */
  readonly settledOccurrences?: Iterable<SettledOccurrence> | AsyncIterable<SettledOccurrence>;
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
  readonly placePriority?:()=>Promise<{readonly revision:string;readonly rank:(id:string)=>number|null}>;
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
  readonly schedule: {readonly scheduled:DiskRows<ScheduledObligation>;readonly unscheduled:DiskRows<UnscheduledObligation>};
  readonly dueCount: number;
  readonly dispatched: DiskRows<DispatchResult>;
  /** Due work this cycle did NOT reach, and the reason. Never silent. */
  readonly deferred: DiskRows<{readonly obligationId:string;readonly why:string}>;
  /** Obligations DISCHARGED this cycle — a committed disposition, each one. */
  readonly worked: DiskRows<string>;
  /**
   * Open occurrences whose route an interrupted cycle had already disposed,
   * closed with that disposition and never dispatched. Apart from `dispatched`
   * and `worked`, because nothing ran for them this cycle.
   */
  readonly recovered: DiskRows<RecoveredOccurrence>;
  /** Obligations whose executor deliberately did nothing. Still owed. */
  readonly simulated: DiskRows<string>;
  readonly debts: DiskRows<FreshnessDebt>;
  readonly incidents: DiskRows<Incident>;
  readonly risk: StalenessRisk;
  /** Per-lane counts when research lanes ran; null when the cycle ran one queue. */
  readonly lanes: LaneCounts | null;
  /** Always false in this module. */
  readonly promotedToReaderTruth: false;
  readonly summary:{
    readonly cadenceSources:Readonly<Record<string,number>>;
    readonly outcomes:Readonly<Record<string,number>>;
    readonly executors:Readonly<Record<string,number>>;
    readonly usdByExecutor:Readonly<Record<string,number>>;
    readonly dispositions:Readonly<Record<string,number>>;
    readonly recoveredDispositions:Readonly<Record<string,number>>;
    readonly committed:number;
    readonly artifacts:number;
    readonly costUsd:number;
    readonly costedAttempts:number;
    readonly recoveredReadings:number;
  };
  /** Records remain available through final persistence/reporting; then the caller releases their temporary files. */
  readonly close:()=>Promise<void>;
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
export async function runPool<T>(items: Iterable<T>, limit: number, fn: (item: T) => Promise<void>,
  comparator?: () => Promise<(left: T, right: T) => number>,
  huntFor?: (item: T) => string | null | undefined,
  /** Items sharing a key run at most `limit` at once; the limit is read each time an item is taken. */
  limitOf?: (item: T) => PoolLimit | null): Promise<void> {
  if(!comparator&&!huntFor&&!limitOf){
    const rows=items[Symbol.iterator]();let sequence=0,firstFailure:{index:number;error:unknown}|null=null;
    const workers=Array.from({length:Math.max(1,limit)},async()=>{
      for(;;){const row=rows.next();if(row.done)return;const index=sequence++;
        try{await fn(row.value);}catch(error){if(firstFailure===null||index<firstFailure.index)firstFailure={index,error};}
      }
    });
    await Promise.all(workers);
    if(firstFailure!==null)throw (firstFailure as {error:unknown}).error;
    return;
  }
  const pending = [...items];
  const compareRound = huntFor ? huntRoundComparator(pending, huntFor) : () => 0;
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
  const workers = Array.from({ length: Math.max(1, Math.min(limit, pending.length || 1)) }, async () => {
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
  return runStreamedCycle(input);
}

/** Close what the cycle dispatched and recovered by one rule: DISCHARGED only on a committed reading, UNRESOLVED otherwise. */
export async function closeCycleOccurrences(
  repos:ControlPlaneRepositories,
  input:{readonly cycle:{readonly dispatched:Iterable<DispatchResult>;readonly recovered:Iterable<RecoveredOccurrence>};readonly occurrenceFor:(id:string)=>string|null;readonly now:string;readonly concurrency?:number},
):Promise<void> {
  return closeStreamedCycleOccurrences(repos,input);
}

/** The digest as lines, so a console run, a run record and a test say the same thing. */
export function digestLines(cycle: Pick<CycleResult,"reclaim"|"dueCount"|"summary"|"promotedToReaderTruth"> & {
  readonly schedule:{readonly scheduled:{readonly length:number};readonly unscheduled:{readonly length:number}};
  readonly dispatched:{readonly length:number};readonly worked:{readonly length:number};readonly simulated:{readonly length:number};
  readonly recovered:{readonly length:number};readonly deferred:{readonly length:number};readonly debts:{readonly length:number};readonly incidents:{readonly length:number};
}):string[] {
  const summary=cycle.summary,out:string[]=[];
  out.push("ACTIVITY — what this cycle did");
  out.push(`  obligations        ${cycle.schedule.scheduled.length} scheduled · ${cycle.schedule.unscheduled.length} unscheduled`);
  out.push(`  due this cycle     ${cycle.dueCount}`);
  out.push(`  dispatched         ${cycle.dispatched.length} — ${cycle.worked.length} DISCHARGED, ${cycle.simulated.length} simulated (no retrieval), ${summary.outcomes.FAILED??0} failed, ${summary.outcomes.NOT_CLAIMED??0} held by another worker, ${summary.outcomes.NO_ROUTE_TASK??0} with no route task`);
  const dispositions=Object.entries(summary.dispositions).map(([name,count])=>`${count} ${name}`).join(", ");
  out.push(`  dispositions       ${summary.committed} committed — `+(summary.committed?dispositions:summary.recoveredReadings?"none by a dispatch this cycle":"none, so nothing this cycle discharged an obligation"));
  out.push(`  artifacts          ${summary.artifacts} recorded against a closed Attempt`);
  if(cycle.recovered.length)out.push(`  recovered          ${cycle.recovered.length} open occurrence(s) on a route an interrupted cycle had already disposed, closed with that committed disposition and not walked again — ${summary.recoveredReadings} reading(s) discharged, ${cycle.recovered.length-summary.recoveredReadings} still owed`);
  if(cycle.simulated.length)out.push(`      SIMULATED ${cycle.simulated.length} obligation(s) had a shadow decision and NO retrieval. They are still owed, their debt stands, and none of them is discharged.`);
  out.push(`  executors          ${summary.executors.DETERMINISTIC??0} deterministic · ${summary.executors.BOUNDED_MODEL_WORKER??0} bounded model worker`);
  out.push(`  deferred           ${cycle.deferred.length}`);
  out.push(`  cost               ${summary.costUsd.toFixed(4)} over ${summary.costedAttempts} measured Attempt(s) of ${cycle.dispatched.length} dispatched`);
  for(const kind of ["DETERMINISTIC","BOUNDED_MODEL_WORKER"] as const)out.push(`      ${kind.padEnd(21)} ${summary.executors[kind]??0} Attempt(s), ${(summary.usdByExecutor[kind]??0).toFixed(4)}`);
  out.push(`  leases             ${cycle.reclaim.reclaimed.length} reclaimed · ${cycle.reclaim.releasedSettled.length} released on an already-disposed route · ${cycle.reclaim.stillLive.length} still live · ${cycle.reclaim.refused.length} refused`);
  out.push(`  freshness debt     ${cycle.debts.length} row(s) across ${cycle.incidents.length} incident(s)`);
  out.push("");
  out.push(`  PROMOTION          none. promotedToReaderTruth=${cycle.promotedToReaderTruth}. This loop observes, acquires and records; nothing it produced changed what a reader is told.`);
  return out;
}
