import type { ExpansionPlan } from "../expansion/membership.ts";
import type { ExpansionScopeDecision } from "../expansion/scopes.ts";

export interface HuntSearchScope {
  readonly assignmentKeys: readonly string[];
  readonly hold: string | null;
}

/** Search has its own accounting and existing controls, never a token-budget
 * reservation. A selected hunt authorizes its actual members, including shared
 * records. A missing/stale membership reading cannot authorize another area. */
export function huntSearchScope(input: {
  readonly selected: readonly ExpansionScopeDecision[];
  readonly plan: Pick<ExpansionPlan, "scopes" | "malformedScopes"> | null;
  readonly subjectId: string;
}): HuntSearchScope {
  const hunts = input.selected.filter(scope => scope.budgetStartedAt);
  const matching = (input.plan?.scopes ?? []).filter(scope => scope.kind === "RESOLVED" &&
    scope.members.has(input.subjectId) && input.selected.some(selected => selected.key === scope.decision.key &&
      selected.budgetStartedAt === scope.decision.budgetStartedAt && selected.receiptId === scope.decision.receiptId));
  const assignmentKeys = [...new Set(matching.map(scope => scope.decision.key))];
  if (input.plan?.malformedScopes) return { assignmentKeys: [], hold: "Paid search waits because the selected scope controls could not be read completely." };
  if (hunts.length && !matching.some(scope => scope.decision.budgetStartedAt)) {
    return { assignmentKeys: [], hold: "Paid search waits: this government has no resolved membership in a selected hunt. Free discovery continues." };
  }
  return { assignmentKeys, hold: null };
}
