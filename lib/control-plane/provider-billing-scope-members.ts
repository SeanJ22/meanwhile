import type { AssignmentSources } from "./assignment-view.ts";
import type { ExpansionScopeDecision } from "./expansion/scopes.ts";

/** The subjects each exact billing scope's receipt assigned, for provider-billing attribution. */
export function exactScopeMembers(scopes: readonly ExpansionScopeDecision[], sources: Pick<AssignmentSources, "obligations">): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map(scopes.map(scope => [scope.key, new Set(sources.obligations.filter(obligation =>
    obligation.assignments?.some(a => a.assignmentKey === scope.key && a.ref === scope.receiptId))
    .map(obligation => obligation.subjectId))]));
}
