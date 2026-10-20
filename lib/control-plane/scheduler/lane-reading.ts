/** Per-lane due, dispatched, running and waiting counts, with every skip reason, so the reasons sum to the skipped count (or a line says they do not). Pure. */
import type { LaneCounts } from "./shadow-loop.ts";
import { waitingSince, type QueueDebt } from "./obligation.ts";
import { plainCode } from "../plain-words.ts";

export interface QueueLaneReading {
  readonly due: number;
  readonly dispatched: number;
  readonly active: number | null;
  /** Due rows not started and not running: due − dispatched − active. */
  readonly waiting: number;
  /** Every reason a due row was not dispatched, by code. Null while the cycle runs. */
  readonly skippedBy: Readonly<Record<string, number>> | null;
  /**
   * How long the oldest waiting row has been owed; null when none waits or it was not recorded.
   * Paid Scout: the earliest next-due. Plain code: the earliest time a waiting row joined the
   * queue (`waitingSince`): its next-due, or after a failed attempt the end of its backoff.
   */
  readonly oldestWaitingDueAt: string | null;
}

export interface QueueLanes {
  readonly at: string;
  /** True once the cycle has finished and every reason is counted. */
  readonly final: boolean;
  readonly deterministic: QueueLaneReading;
  readonly model: QueueLaneReading;
  readonly autonomous: QueueLaneReading | null;
}

export type LaneKey = "deterministic" | "model" | "autonomous";

export const LANE_WORDS: Readonly<Record<LaneKey, string>> = {
  deterministic: "Plain-code reads",
  model: "Paid research (Scout)",
  autonomous: "Registered work items",
};

function finalLane(lane: {
  readonly due: number;
  readonly dispatched: number;
  readonly deferredBy: Readonly<Record<string, number>>;
  readonly recovered: number;
  readonly oldestWaitingDueAt: string | null;
}): QueueLaneReading {
  const skippedBy: Record<string, number> = { ...lane.deferredBy };
  if (lane.recovered > 0) skippedBy.RECOVERED = (skippedBy.RECOVERED ?? 0) + lane.recovered;
  return {
    due: lane.due,
    dispatched: lane.dispatched,
    active: 0,
    waiting: Math.max(0, lane.due - lane.dispatched),
    skippedBy,
    oldestWaitingDueAt: lane.oldestWaitingDueAt,
  };
}

export function lanesAtCycleEnd(lanes: LaneCounts, autonomous: QueueLaneReading | null, at: string): QueueLanes {
  return { at, final: true, deterministic: finalLane(lanes.deterministic), model: finalLane(lanes.model), autonomous };
}

export interface DueRow {
  readonly obligation: { readonly id: string };
  readonly nextDueAt: string;
}

/** The reading while the cycle runs: no reason is counted yet, and the plain-code lane records none in flight. */
export function lanesInFlight(input: {
  readonly at: string;
  readonly deterministicRows: Iterable<DueRow> & { readonly length: number };
  readonly modelRows: Iterable<DueRow> & { readonly length: number };
  readonly deterministicDispatched: number;
  readonly modelDispatched: number;
  readonly startedIds: ReadonlySet<string>;
  readonly runningIds: ReadonlySet<string>;
  readonly debtFor?: (obligationId: string) => QueueDebt | null | undefined;
}): QueueLanes {
  const oldest = (rows: Iterable<DueRow>, since: (row: DueRow) => string): string | null => {
    let held: string | null = null;
    for (const row of rows) {
      if (input.startedIds.has(row.obligation.id) || input.runningIds.has(row.obligation.id)) continue;
      const at = since(row);
      if (held === null || at < held) held = at;
    }
    return held;
  };
  const nextDue = (row: DueRow): string => row.nextDueAt;
  const queuedSince = (row: DueRow): string => waitingSince(row, input.debtFor?.(row.obligation.id));
  let running = 0;
  for (const row of input.modelRows) if (input.runningIds.has(row.obligation.id)) running++;
  return {
    at: input.at,
    final: false,
    deterministic: {
      due: input.deterministicRows.length,
      dispatched: input.deterministicDispatched,
      active: null,
      waiting: Math.max(0, input.deterministicRows.length - input.deterministicDispatched),
      skippedBy: null,
      oldestWaitingDueAt: oldest(input.deterministicRows, queuedSince),
    },
    model: {
      due: input.modelRows.length,
      dispatched: input.modelDispatched,
      active: running,
      waiting: Math.max(0, input.modelRows.length - input.modelDispatched - running),
      skippedBy: null,
      oldestWaitingDueAt: oldest(input.modelRows, nextDue),
    },
    autonomous: null,
  };
}

export interface CoordinatorPass {
  readonly considered: number;
  readonly decisions: Iterable<{ readonly workItemId: string; readonly action: string; readonly task: unknown; readonly reason: string }>;
  readonly dispatches?: { readonly length: number };
  readonly dispatched?: number;
  readonly deferred: Iterable<{ readonly workItemId: string; readonly reason: string }>;
}

export function coordinatorDecisionCode(decision: { readonly action: string; readonly task: unknown; readonly reason: string }): string {
  const lead = /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/.exec(decision.reason)?.[1];
  if (lead !== undefined) return lead;
  if ((decision.action === "WORKER" || decision.action === "SCOUT") && decision.task === null) return "COORDINATOR_NOTHING_TO_RUN";
  return `COORDINATOR_${decision.action}`;
}

/**
 * The coordinator's pass as a lane. A work item it deferred counts under the
 * deferral's code; one it decided not to run (BLOCKED, STAGED, or a decision
 * with no task) counts under its decision's code — those were silent before.
 */
export function coordinatorLane(pass: CoordinatorPass): QueueLaneReading {
  const dispatched = pass.dispatched ?? pass.dispatches?.length ?? 0;
  const skippedBy: Record<string, number> = {};
  for (const d of pass.deferred) skippedBy[d.reason] = (skippedBy[d.reason] ?? 0) + 1;
  for (const d of pass.decisions) {
    const runs = (d.action === "WORKER" || d.action === "SCOUT") && d.task !== null;
    if (runs) continue;
    const code = coordinatorDecisionCode(d);
    skippedBy[code] = (skippedBy[code] ?? 0) + 1;
  }
  return {
    due: pass.considered,
    dispatched,
    active: 0,
    waiting: Math.max(0, pass.considered - dispatched),
    skippedBy,
    oldestWaitingDueAt: null,
  };
}


const SKIP_WORDS: Readonly<Record<string, string>> = {
  NO_OPEN_OCCURRENCE: "its round could not be opened this cycle",
  DISPATCH_CEILING: "the cycle's plain-code start limit was reached",
  CEILING: "the rolling spend ceiling was reached, or could not be read",
  CYCLE_MAX: "a diagnostic per-cycle Scout limit was reached",
  LANE_DISABLED: "the paid lane is closed",
  PAUSED: "you paused paid research",
  FREE_WALK_FIRST: "the free walk reads the site first",
  RECOVERED: "an interrupted cycle had already settled it, so it was closed, not re-run",
  COORDINATOR_CYCLE_MAX: "the coordinator's per-cycle limit was reached",
  SCOUT_CYCLE_MAX: "the coordinator's Scout limit was reached",
  REPOSITORY_LOCK_HELD: "another process held its lock",
  COORDINATOR_BLOCKED: "the coordinator found it blocked",
  COORDINATOR_STAGED: "its results are staged and wait on promotion",
  COORDINATOR_NOTHING_TO_RUN: "the coordinator found no task to run",
};

export function skipWords(code: string): string {
  return SKIP_WORDS[code] ?? plainCode(code).toLowerCase();
}

export interface SkipReason {
  readonly lane: LaneKey;
  readonly code: string;
  readonly words: string;
  readonly count: number;
}

export interface LaneSkips {
  readonly lane: LaneKey;
  readonly name: string;
  readonly due: number;
  readonly skipped: number;
  /** Null while the cycle runs: the reasons are counted at its end. */
  readonly reasons: readonly SkipReason[] | null;
  /** Null when the reasons sum to the skipped count (or are not counted yet); else the line that says they do not. */
  readonly mismatch: string | null;
}

export interface SkippedWork {
  readonly final: boolean;
  readonly at: string;
  readonly lanes: readonly LaneSkips[];
  readonly skipped: number;
  readonly due: number;
  /** Generated from the figures above; never a fixed sentence. */
  readonly says: string;
  readonly mismatches: readonly string[];
}

function laneSkips(lane: LaneKey, r: QueueLaneReading): LaneSkips {
  const skipped = Math.max(0, r.due - r.dispatched - (r.active ?? 0));
  if (r.skippedBy === null) return { lane, name: LANE_WORDS[lane], due: r.due, skipped, reasons: null, mismatch: null };
  const reasons = Object.entries(r.skippedBy)
    .filter(([, n]) => n > 0)
    .map(([code, count]) => ({ lane, code, words: skipWords(code), count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  const summed = reasons.reduce((n, x) => n + x.count, 0);
  const mismatch =
    summed === skipped
      ? null
      : `MISMATCH in ${LANE_WORDS[lane].toLowerCase()}: ${skipped.toLocaleString("en-US")} of ${r.due.toLocaleString("en-US")} due were not started, and the recorded reasons account for ${summed.toLocaleString("en-US")}` +
        (summed < skipped ? ` — ${(skipped - summed).toLocaleString("en-US")} skipped without a recorded reason.` : ` — ${(summed - skipped).toLocaleString("en-US")} more reasons than skipped rows.`);
  return { lane, name: LANE_WORDS[lane], due: r.due, skipped, reasons, mismatch };
}

export function skippedWork(lanes: QueueLanes | null | undefined): SkippedWork | null {
  if (lanes === null || lanes === undefined) return null;
  const rows: LaneSkips[] = [laneSkips("deterministic", lanes.deterministic), laneSkips("model", lanes.model)];
  if (lanes.autonomous !== null) rows.push(laneSkips("autonomous", lanes.autonomous));
  const skipped = rows.reduce((n, l) => n + l.skipped, 0);
  const due = rows.reduce((n, l) => n + l.due, 0);
  const mismatches = rows.flatMap((l) => (l.mismatch === null ? [] : [l.mismatch]));
  const lead = `${skipped.toLocaleString("en-US")} of ${due.toLocaleString("en-US")} due ${due === 1 ? "item was" : "items were"} not started ${lanes.final ? "this cycle" : "so far this cycle"}`;
  const says = !lanes.final
    ? `${lead}; the cycle is still running, so why each was held is counted when it ends. Nothing was dropped.`
    : skipped === 0
      ? `Every due item was started this cycle (${due.toLocaleString("en-US")}).`
      : mismatches.length === 0
        ? `${lead}. The reasons below add up to that number. Nothing was dropped; each keeps its place in line.`
        : `${lead}. The recorded reasons do not add up for ${mismatches.length} ${mismatches.length === 1 ? "lane" : "lanes"}, named below.`;
  return { final: lanes.final, at: lanes.at, lanes: rows, skipped, due, says, mismatches };
}


export interface LaneGauge {
  readonly lane: LaneKey;
  readonly name: string;
  readonly active: number | null;
  readonly waiting: number;
  readonly oldestWaitingDueAt: string | null;
  readonly blockedBy: string | null;
}

export function laneGauges(lanes: QueueLanes | null | undefined): readonly LaneGauge[] | null {
  if (lanes === null || lanes === undefined) return null;
  const gauge = (lane: LaneKey, r: QueueLaneReading): LaneGauge => {
    const top = r.skippedBy === null ? null : Object.entries(r.skippedBy).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null;
    return {
      lane,
      name: LANE_WORDS[lane],
      active: r.active,
      waiting: r.waiting,
      oldestWaitingDueAt: r.oldestWaitingDueAt,
      blockedBy: r.waiting === 0 || top === null ? null : `${top[1].toLocaleString("en-US")} held because ${skipWords(top[0])}`,
    };
  };
  const out = [gauge("deterministic", lanes.deterministic), gauge("model", lanes.model)];
  if (lanes.autonomous !== null) out.push(gauge("autonomous", lanes.autonomous));
  return out;
}

export function pulseLanesOf(state: unknown): { readonly at: string; readonly final: boolean; readonly gauges: readonly LaneGauge[] } | null {
  const lanes = queueLanesOf(state);
  const gauges = laneGauges(lanes);
  return lanes === null || gauges === null ? null : { at: lanes.at, final: lanes.final, gauges };
}

/** A value read off an untyped research state: a QueueLanes, or null when the field is absent or malformed. */
export function queueLanesOf(state: unknown): QueueLanes | null {
  const lanes = (state as { readonly queue?: { readonly lanes?: unknown } } | null | undefined)?.queue?.lanes;
  if (lanes === null || typeof lanes !== "object") return null;
  const l = lanes as Partial<QueueLanes>;
  const ok = (r: unknown): r is QueueLaneReading =>
    r !== null && typeof r === "object" && typeof (r as QueueLaneReading).due === "number" && typeof (r as QueueLaneReading).dispatched === "number";
  if (typeof l.at !== "string" || typeof l.final !== "boolean" || !ok(l.deterministic) || !ok(l.model)) return null;
  return { at: l.at, final: l.final, deterministic: l.deterministic, model: l.model, autonomous: ok(l.autonomous) ? l.autonomous : null };
}
