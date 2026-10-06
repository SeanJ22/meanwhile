/**
 * **WHAT EACH LANE HELD THIS CYCLE, AND WHY — IN NUMBERS THAT ADD UP.**
 * (MW-014, MW-029, MW-071, 2026-09-25.)
 *
 * The cycle counted every skipped row by its reason, and then threw most of
 * the reasons away: the research state kept four model-lane codes, the
 * plain-code lane kept none, the autonomous coordinator's non-dispatches were
 * silent, and the Fleet safety list dedupes by (work, code), so nothing on the
 * page could be summed. Owner question: *"why was this skipped?"* — and the
 * answer has to be a set of reasons whose counts equal the skipped count, or a
 * line that says they do not.
 *
 * ```
 *   per lane   due, dispatched, running now, waiting (due − dispatched − running),
 *              every reason a due row was not dispatched, and how long the oldest
 *              waiting row has been owed
 *   lanes      plain code (deterministic), paid Scout (model), and the autonomous
 *              coordinator's pass over registered work items
 * ```
 *
 * The reading rides on `ResearchState.queue.lanes` — a handful of small
 * numbers, never a row list — so the pulse can carry it from the one research
 * state read it already makes. Mid-cycle a lane's reasons are not counted yet
 * (`skippedBy: null`); the cycle's end writes them. PURE.
 */
import type { LaneCounts } from "./shadow-loop.ts";
import { waitingSince, type QueueDebt } from "./obligation.ts";
import { plainCode } from "../plain-words.ts";

/** One lane's reading. Small numbers only. */
export interface QueueLaneReading {
  /** Rows due to this lane this cycle (for the coordinator: registered work items it considered). */
  readonly due: number;
  /** Rows the lane started. */
  readonly dispatched: number;
  /** Rows running at the moment of the reading; null when the lane does not record in-flight work. */
  readonly active: number | null;
  /** Due rows not started and not running: due − dispatched − active. */
  readonly waiting: number;
  /**
   * Every reason a due row was not dispatched, by code — RECOVERED included,
   * for a row an interrupted cycle had already settled. Null while the cycle
   * is still running: the reasons are counted when it ends.
   */
  readonly skippedBy: Readonly<Record<string, number>> | null;
  /**
   * How long the oldest waiting row has been owed; null when none waits or it was not recorded.
   * Paid Scout: the earliest next-due. Plain code: the earliest time a waiting row joined the
   * queue (`waitingSince`): its next-due, or after a failed attempt the end of its backoff.
   */
  readonly oldestWaitingDueAt: string | null;
}

export interface QueueLanes {
  /** When the reading was taken. */
  readonly at: string;
  /** True once the cycle has finished and every reason is counted. */
  readonly final: boolean;
  readonly deterministic: QueueLaneReading;
  readonly model: QueueLaneReading;
  /** The autonomous coordinator's pass; null when it did not run this cycle. */
  readonly autonomous: QueueLaneReading | null;
}

export type LaneKey = "deterministic" | "model" | "autonomous";

export const LANE_WORDS: Readonly<Record<LaneKey, string>> = {
  deterministic: "Plain-code reads",
  model: "Paid research (Scout)",
  autonomous: "Registered work items",
};

/** A lane from the cycle's own counts: every deferral, and the recovered rows, as reasons. */
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

/** The reading at a cycle's end, from `CycleResult.lanes` and the coordinator's pass (null when it did not run). */
export function lanesAtCycleEnd(lanes: LaneCounts, autonomous: QueueLaneReading | null, at: string): QueueLanes {
  return { at, final: true, deterministic: finalLane(lanes.deterministic), model: finalLane(lanes.model), autonomous };
}

/** A due row as the cycle script holds it before dispatch. */
export interface DueRow {
  readonly obligation: { readonly id: string };
  readonly nextDueAt: string;
}

/**
 * The reading while the cycle runs: the Scout lane's running rows are active,
 * the plain-code lane runs one row at a time and records none in flight
 * (`active: null`), and no reason is counted yet. The oldest waiting row is the
 * one neither started nor running that has been owed longest. The plain-code
 * lane uses its queue key for this (`waitingSince`, from the debt carried into
 * the cycle), so the reading during the cycle and the one after it use the same
 * measure.
 */
export function lanesInFlight(input: {
  readonly at: string;
  readonly deterministicRows: readonly DueRow[];
  readonly modelRows: readonly DueRow[];
  readonly deterministicDispatched: number;
  readonly modelDispatched: number;
  /** Obligation ids already started this cycle, in either lane. */
  readonly startedIds: ReadonlySet<string>;
  /** Obligation ids of the Scouts running now. */
  readonly runningIds: ReadonlySet<string>;
  /** The debt carried into the cycle, by obligation id. Absent, every plain-code row reads as having none. */
  readonly debtFor?: (obligationId: string) => QueueDebt | null | undefined;
}): QueueLanes {
  const oldest = (rows: readonly DueRow[], since: (row: DueRow) => string): string | null => {
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
  const running = input.modelRows.filter((r) => input.runningIds.has(r.obligation.id)).length;
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

/** What `runAutonomousCoordinator` returns, as far as the accounting needs it. */
export interface CoordinatorPass {
  /** Registered work items the pass considered. */
  readonly considered: number;
  readonly decisions: readonly { readonly workItemId: string; readonly action: string; readonly task: unknown; readonly reason: string }[];
  readonly dispatches: readonly unknown[];
  readonly deferred: readonly { readonly workItemId: string; readonly reason: string }[];
}

/** The machine code a coordinator decision's reason leads with, else one named for its action. */
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
    dispatched: pass.dispatches.length,
    active: 0,
    waiting: Math.max(0, pass.considered - pass.dispatches.length),
    skippedBy,
    oldestWaitingDueAt: null,
  };
}

/* ---------------------------------------------------------------- the words */

const SKIP_WORDS: Readonly<Record<string, string>> = {
  NO_OPEN_OCCURRENCE: "its round could not be opened this cycle",
  DISPATCH_CEILING: "the cycle's plain-code start limit was reached",
  CEILING: "the rolling spend ceiling was reached, or could not be read",
  CYCLE_MAX: "a diagnostic per-cycle Scout limit was reached",
  LANE_DISABLED: "the paid lane is closed",
  PAUSED: "you paused paid research",
  FREE_WALK_FIRST: "the free walk reads the site first",
  HUNTER_PATH: "it runs as hunter work through its plan",
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

/** One reason line: the lane, the code, its words and its count. */
export interface SkipReason {
  readonly lane: LaneKey;
  readonly code: string;
  readonly words: string;
  readonly count: number;
}

/** One lane's skipped work, and whether its reasons add up. */
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
  /** Every lane whose reasons do not sum, named. Empty when they all do. */
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

/** The runner card's skipped-work reading, from the research state's queue lanes. Null when none was recorded. */
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

/* ---------------------------------------------------------------- the gauges */

/** One lane gauge for the live strip: its counts and its own blocking reason. */
export interface LaneGauge {
  readonly lane: LaneKey;
  readonly name: string;
  readonly active: number | null;
  readonly waiting: number;
  readonly oldestWaitingDueAt: string | null;
  /** The largest reason holding the lane's waiting rows, in words; null when nothing waits or it is not counted yet. */
  readonly blockedBy: string | null;
}

/** The lane gauges the pulse carries: the reading's own figures, and each lane's leading reason. */
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

/**
 * The lanes as the pulse carries them, from a research state value: one
 * derivation, so the page's first draw and every refresh say the same thing.
 */
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
