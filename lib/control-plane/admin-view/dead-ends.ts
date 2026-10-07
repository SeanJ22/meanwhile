/** A field the records cannot answer stays null and carries its gap, so the box never renders as a finished answer. */
import type { ScoutResult } from "../scheduler/scout-result.ts";
import { formatEastern } from "../eastern-time.ts";

/** Why a dead-end field is missing, per field. A field with a value has no gap. */
export interface DeadEndGaps {
  readonly ruledOut?: string;
  readonly wouldSettle?: string;
  readonly whoMoves?: string;
}

export interface DerivedDeadEnd {
  readonly ruledOut: string | null;
  readonly wouldSettle: string | null;
  readonly whoMoves: string | null;
  readonly gaps: DeadEndGaps;
}

const MAX_NAMED = 4;

function listed(items: readonly string[]): string {
  const shown = items.slice(0, MAX_NAMED);
  const more = items.length - shown.length;
  return `${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
}

export function latestScout(results: readonly ScoutResult[]): ScoutResult | null {
  let best: ScoutResult | null = null;
  for (const r of results) {
    if (best === null || r.recordedAt > best.recordedAt || (r.recordedAt === best.recordedAt && r.attemptId > best.attemptId)) best = r;
  }
  return best;
}

const WHO_BY_OUTCOME: Readonly<Record<string, string>> = {
  HUMAN_REQUIRED: "A person: the walk found that only a human or offline act remains (a records request, a call, a visit)",
  NEEDS_ADAPTER: "Engineering: the walk named a specific adapter this source needs before plain code can read it",
  BLOCKED: "The Scout lane (automatic, paid model): every rung it walked hit a wall, and its next walk starts from the rungs it named",
  NO_PROGRESS: "The Scout lane (automatic, paid model): it walked the ladder to the floor, and its next walk starts from the rungs it named",
  ROUTE_CANDIDATE: "The fleet's next worker (automatic): the walk proposed a way in, which still has to be confirmed and verified",
  EVIDENCE_FOUND: "The fleet's next worker (automatic): the walk found the record, which still has to be confirmed and verified",
};

/** A refused finish keeps its machine-derived rungs, but its outcome is not believed: the Scout lane moves next. */
export function scoutDeadEnd(result: ScoutResult | null, opts: { readonly retryAt?: string | null; readonly unlockWhen?: { readonly text: string } | null } = {}): DerivedDeadEnd {
  if (result === null) {
    const none = "no Scout walk is on record for this work, so nothing here was read from one";
    return { ruledOut: null, wouldSettle: null, whoMoves: null, gaps: { ruledOut: none, wouldSettle: none, whoMoves: none } };
  }
  const when = formatEastern(result.recordedAt);
  const gaps: { ruledOut?: string; wouldSettle?: string; whoMoves?: string } = {};

  let ruledOut: string | null = null;
  const unrecorded = result.rungs.filter((g) => g.ok === undefined).length;
  const failed = result.rungs.filter((g) => g.ok === false).map((g) => `${g.rung} at ${g.target} (${g.observed})`);
  if (failed.length > 0) {
    ruledOut = `${failed.length} ${failed.length === 1 ? "rung" : "rungs"} tried and failed in the walk of ${when}: ${listed(failed)}.`;
  } else if (result.rungs.length === 0) {
    gaps.ruledOut = `the walk of ${when} recorded no rung, so it ruled nothing out`;
  } else if (unrecorded === result.rungs.length) {
    gaps.ruledOut = `the walk of ${when} predates recording whether each rung succeeded, so what it ruled out cannot be told`;
  } else if ((result.outcome === "NO_PROGRESS" || result.outcome === "BLOCKED") && result.refusal === null) {
    const walked = result.rungs.map((g) => `${g.rung} at ${g.target}`);
    ruledOut = `${walked.length} ${walked.length === 1 ? "place" : "places"} walked in ${when} and none held it: ${listed(walked)}.`;
  } else {
    gaps.ruledOut = `every rung the walk of ${when} tried succeeded, so it ruled nothing out`;
  }

    /* The stored unlock condition wins; the walk's own next rungs are the fallback for rows without one. */
  const wouldSettle = opts.unlockWhen && opts.unlockWhen.text !== "" ? `Would unlock: ${opts.unlockWhen.text}.` :
    result.nextRungs.length > 0 ? `The next ${result.nextRungs.length === 1 ? "rung" : "rungs"} the walk of ${when} named: ${listed(result.nextRungs)}.` : null;
  if (wouldSettle === null) gaps.wouldSettle = `the walk of ${when} named no next rung`;

  const refused = result.refusal !== null && result.refusal.length > 0;
  const retry = opts.retryAt ? ` Its retry is not before ${formatEastern(opts.retryAt)}.` : "";
  const whoMoves = refused
    ? `The Scout lane (automatic, paid model): the walk's finish was refused (${result.refusal!.map((i) => i.code).join(", ")}), so its outcome is not believed and the next walk resumes from its rungs.${retry}`
    : WHO_BY_OUTCOME[result.outcome] !== undefined
      ? `${WHO_BY_OUTCOME[result.outcome]}.${retry}`
      : null;
  if (whoMoves === null) gaps.whoMoves = `the walk of ${when} ended ${result.outcome}, which names no next owner`;

  return { ruledOut, wouldSettle, whoMoves, gaps };
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
