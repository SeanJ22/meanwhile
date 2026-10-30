/** A field the records cannot answer stays null and carries its gap, so the box never renders as a finished answer. */
import { formatEastern } from "../eastern-time.ts";

/** Why a dead-end field is missing, per field. A field with a value has no gap. */
export interface DeadEndGaps {
  readonly ruledOut?: string;
  readonly wouldSettle?: string;
  readonly whoMoves?: string;
}

export interface RoutineReadFact {
  readonly state: string;
  readonly failureCode: string | null;
  readonly acquisitionSucceeded: boolean;
  readonly attemptedAt: string;
  readonly failed: boolean;
  /** Our own code or configuration failed before the site was asked. */
  readonly jobFailure: boolean;
}

export function routineRuledOut(reads: readonly RoutineReadFact[], describe: (read: RoutineReadFact) => string): { readonly ruledOut: string | null; readonly gap: string | null } {
  const last = reads[0];
  if (last === undefined || !last.failed) return { ruledOut: null, gap: "the last read did not fail" };
  if (last.jobFailure) {
    return { ruledOut: null, gap: "our own code failed before the site was asked, so nothing about the site is ruled out yet" };
  }
  let streak = 0;
  while (streak < reads.length && reads[streak]!.failed && reads[streak]!.state === last.state && reads[streak]!.failureCode === last.failureCode) streak += 1;
  const before = reads[streak];
  if (streak >= 2) {
    return {
      ruledOut: `A one-off failure: the last ${streak} reads, from ${formatEastern(reads[streak - 1]!.attemptedAt)} to ${formatEastern(last.attemptedAt)}, all ${describe(last)}.`,
      gap: null,
    };
  }
  if (before !== undefined && !before.failed) {
    return { ruledOut: `That the source is gone for good: the read before, ${formatEastern(before.attemptedAt)}, ${describe(before)}.`, gap: null };
  }
  return {
    ruledOut: null,
    gap: before === undefined ? "only this one read is recorded in the window, so nothing is ruled out yet" : "the reads before it failed in other ways, so no single cause is ruled out",
  };
}
