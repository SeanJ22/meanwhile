/** Keep a directed, total-budget hunt moving while its last cycle made
 * progress and left eligible member work behind. A cycle remains bounded; the
 * next one starts promptly rather than waiting for the ordinary hourly tick.
 * No reading, no exact Send receipt, or no scoped dispatch means no fast loop.
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
