/**
 * CH-05 — THE FIRST HUNT STARTS IN THE SAME ROUND AS THE ORDER.
 *
 * The owner's Send writes new standing obligations in the middle of a round,
 * after that round's due list was made. They used to join through their
 * providers next round, so a Send's first attempt waited a whole round. Here
 * the rows the step just wrote are scheduled against the same clock the round
 * used, and the due ones are handed back to be added to this round's work.
 *
 * PURE: it reads rows and a clock; the caller syncs the rows and owns the lists.
 */
import { isScheduled, scheduleObligation } from "./obligation.ts";
import type { StandingObligation } from "./durable.ts";

export interface FoldedDueRow {
  readonly obligation: StandingObligation;
  readonly nextDueAt: string;
  readonly cadenceHours: number;
}

export interface SameRoundFold {
  /** Rows due now, oldest next-due first. */
  readonly due: readonly FoldedDueRow[];
  /** Rows whose derived next-due differs from the stored one: written like every other row's. */
  readonly nextDueWrites: readonly string[];
  /** Rows owed on a clock but not yet due; they wait for their time like any other. */
  readonly notYetDue: readonly string[];
  /** Rows that owe nothing on a clock (inactive, or no interval): named, never invented. */
  readonly unscheduled: readonly string[];
}

/** The old path stays behind this switch in the runner's environment file until the same-round start is checked live. */
export const FIRST_HUNT_NEXT_ROUND_SWITCH = "WTP_FIRST_HUNT_NEXT_ROUND";

export function sameRoundFirstHuntEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[FIRST_HUNT_NEXT_ROUND_SWITCH] !== "1";
}

export function foldNewWorkIntoRound(input: {
  readonly rows: readonly StandingObligation[];
  readonly nowMs: number;
}): SameRoundFold {
  const due: FoldedDueRow[] = [];
  const nextDueWrites: string[] = [];
  const notYetDue: string[] = [];
  const unscheduled: string[] = [];
  for (const row of input.rows) {
    const scheduled = scheduleObligation(row, input.nowMs);
    if (!isScheduled(scheduled)) {
      unscheduled.push(row.id);
      continue;
    }
    if (row.nextDueAt !== scheduled.nextDueAt) nextDueWrites.push(row.id);
    if (Date.parse(scheduled.nextDueAt) <= input.nowMs) due.push({ obligation: row, nextDueAt: scheduled.nextDueAt, cadenceHours: scheduled.cadenceHours });
    else notYetDue.push(row.id);
  }
  due.sort((a, b) => (a.nextDueAt < b.nextDueAt ? -1 : a.nextDueAt > b.nextDueAt ? 1 : 0));
  return { due, nextDueWrites, notYetDue, unscheduled };
}
