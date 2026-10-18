import type { ExpansionScopeDecision } from "./expansion/scopes.ts";
import type { StandingObligation } from "./scheduler/durable.ts";

export function exactScopeMembers(scopes: readonly ExpansionScopeDecision[],
  obligations: Iterable<Pick<StandingObligation, "subjectId" | "assignments">>): ReadonlyMap<string, ReadonlySet<string>> {
  const all = [...obligations];
  return new Map(scopes.map(scope => [scope.key, new Set(all.filter(obligation =>
    obligation.assignments?.some(a => a.assignmentKey === scope.key && a.ref === scope.receiptId))
    .map(obligation => obligation.subjectId))]));
}
