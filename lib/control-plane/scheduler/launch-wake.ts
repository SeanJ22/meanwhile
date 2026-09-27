/** Decide whether an owner request needs the standing runner's next cycle. */
import type { ExpansionScopeDecision } from "../expansion/scopes.ts";
import type { AssignmentCycleReading } from "../expansion/assignment-budget.ts";
import type { ResearchIntent, ResearchIntentRequest } from "./research-policy.ts";

export function unacknowledgedResearchResume(log: readonly ResearchIntent[]): string | null {
  const requests = log.filter((row): row is ResearchIntentRequest => row.kind === "INTENT" && (row.action === "PAUSE" || row.action === "RESUME"))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const latest = requests.at(-1);
  if (!latest || latest.action !== "RESUME") return null;
  return log.some((row) => row.kind === "HONORED" && row.honors === latest.intentId) ? null : latest.intentId;
}

/** The assignment reading names the exact Send receipt consumed by a completed cycle. */
export function unacknowledgedScope(
  scopes: readonly ExpansionScopeDecision[],
  reading: AssignmentCycleReading | null,
): ExpansionScopeDecision | null {
  return scopes.find((scope) => !reading?.assignments.some((assignment) =>
    assignment.key === scope.key && assignment.ref === scope.receiptId)) ?? null;
}
