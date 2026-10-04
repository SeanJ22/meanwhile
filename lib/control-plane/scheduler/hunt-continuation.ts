/** Keep a directed, total-budget hunt moving while its last cycle made
 * progress and left eligible member work behind. A cycle remains bounded; the
 * next one starts promptly rather than waiting for the ordinary hourly tick.
 * No reading, no Send receipt, or no scoped dispatch means no fast loop.
 */
import type { AssignmentCycleReading } from "../expansion/assignment-budget.ts";
import type { ExpansionCycleReading } from "../expansion/reading.ts";
import type { ExpansionScopeDecision } from "../expansion/scopes.ts";

export interface ContinuingHunt {
  readonly key: string;
  readonly label: string;
  readonly due: number;
  readonly dispatched: number;
}

/** A funded Send is a hunt with its own lifetime dollar allowance. Every funded Send gets the same rules:
 * it continues between ordinary cycles, runs through any scheduled blackout, and its allowance replaces
 * older rolling limits on the work it covers. */
export function isFundedHunt(scope: { readonly budgetStartedAt?: string | null; readonly budgetUsd: number }): boolean {
  return Boolean(scope.budgetStartedAt) && scope.budgetUsd > 0;
}

/** Historical receipt identity for consumers still being migrated by their owners (the Cochise-only source
 * rules in manual-producer-invocation.ts). Execution and continuation select current funded scopes, never this constant. */
export const ORIGINAL_LIFETIME_HUNT = {
  key: "zcta:2020/85635", receiptId: "expansion.scope.set:scope:85635:1yfuc2c:pgfomast",
  budgetStartedAt: "2026-09-27T22:17:50.236Z", budgetUsd: 50,
} as const;

export interface LifetimeHuntContinuation extends ContinuingHunt {
  readonly delayMs: number;
  readonly reason: "DUE_AFTER_PROGRESS" | "ELIGIBLE_ZERO_DISPATCH";
}

/** A bounded next cycle for each selected hunt. A zero-dispatch cycle backs off
 * to fifteen minutes while it remains eligible; only a measured budget or
 * actual external refusal may hold it. No estimated dollars authorize work. */
function lifetimeHuntContinuation(
  scopes: readonly ExpansionScopeDecision[],
  expansion: ExpansionCycleReading | null,
  assignments: AssignmentCycleReading | null,
  stalledCycles: number,
): LifetimeHuntContinuation | null {
  if (expansion === null || assignments === null || !Number.isSafeInteger(stalledCycles) || stalledCycles < 0) return null;
  const scope = scopes.find(isFundedHunt);
  if (!scope) return null;
  const read = expansion.scopes.find(row => row.key === scope.key);
  const assignment = assignments.assignments.find(row => row.key === scope.key && row.ref === scope.receiptId);
  if (!read || !assignment || assignment.completion?.kind !== "NOT_COMPLETE") return null;
  const budget = assignment.budget;
  if (!assignments.costsReadable || !budget?.lifetime || budget.since !== scope.budgetStartedAt ||
    budget.spentUsd === null || budget.leftUsd === null || budget.leftUsd <= 0) return null;
  const due = read.work?.dueThisCycle ?? 0;
  const dispatched = read.work?.dispatchedThisCycle ?? 0;
  if (!Number.isSafeInteger(due) || !Number.isSafeInteger(dispatched) || due < 0 || dispatched < 0) return null;
  // A standing slice can dispatch every due obligation while its opened
  // WorkItems still owe parser, validation, audit or publication. The exact
  // assignment's completion exceptions, not today's standing due count, are
  // the remaining-work authority. Its downstream workers retain their own
  // provider and retry admission on the next bounded cycle.
  const incomplete = assignment.completion;
  const remaining = (incomplete.unsettledCount ?? 0) + (incomplete.refusedCount ?? 0) || incomplete.exceptions.length;
  if (due <= dispatched && remaining <= 0) return null;
  if (dispatched > 0) return { key: scope.key, label: scope.geography.label, due, dispatched,
    delayMs: 60_000, reason: "DUE_AFTER_PROGRESS" };
  if (budget.refused > 0 && budget.admitted === 0) return null;
  return { key: scope.key, label: scope.geography.label, due, dispatched,
    delayMs: stalledCycles === 0 ? 5 * 60_000 : 15 * 60_000, reason: "ELIGIBLE_ZERO_DISPATCH" };
}

export function lifetimeHuntContinuations(
  scopes: readonly ExpansionScopeDecision[], expansion: ExpansionCycleReading | null,
  assignments: AssignmentCycleReading | null, stalledCycles: number,
): readonly LifetimeHuntContinuation[] {
  return scopes.flatMap(scope => {
    const continuation = lifetimeHuntContinuation([scope], expansion, assignments, stalledCycles);
    return continuation ? [continuation] : [];
  });
}
export function originalLifetimeHuntContinuation(
  scopes: readonly ExpansionScopeDecision[], expansion: ExpansionCycleReading | null,
  assignments: AssignmentCycleReading | null, stalledCycles: number,
): LifetimeHuntContinuation | null {
  return lifetimeHuntContinuations(scopes, expansion, assignments, stalledCycles)[0] ?? null;
}

export function continuingDirectedHunt(
  scopes: readonly ExpansionScopeDecision[],
  expansion: ExpansionCycleReading | null,
  assignments: AssignmentCycleReading | null,
): ContinuingHunt | null {
  if (expansion === null || assignments === null) return null;
  for (const scope of scopes) {
    if (!scope.budgetStartedAt) continue;
    const read = expansion.scopes.find(row => row.key === scope.key);
    const assignment = assignments.assignments.find(row => row.key === scope.key && row.ref === scope.receiptId);
    const due = read?.work?.dueThisCycle ?? 0;
    const dispatched = read?.work?.dispatchedThisCycle ?? 0;
    if (assignment?.completion?.kind !== "NOT_COMPLETE") continue;
    if (dispatched > 0 && due > dispatched) return { key: scope.key, label: scope.geography.label, due, dispatched };
  }
  return null;
}
