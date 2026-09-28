import type { AssignmentListRow } from "../assignment-view.ts";
import type { RunningScout } from "../scheduler/research-policy.ts";

/** Null means the running snapshot predates exact Send marks; never present a
 * fleet-wide Scout count as if it were this hunt's current workers. */
export function currentScoutsForHunt(running: readonly RunningScout[], assignmentKey: string): number | null {
  return running.some(scout => scout.assignmentKeys === undefined)
    ? null
    : running.filter(scout => scout.assignmentKeys?.includes(assignmentKey)).length;
}

/** A bounded, exact-Send view of the published assignment rows. Counts are
 * rows with evidence at each stage, not a count of unique findings or all
 * obligations. The full completion denominator is reported separately. */
export function huntActivity(rows: readonly AssignmentListRow[], assignmentKey: string) {
  const linked = rows.filter(row => row.assignmentKeys?.includes(assignmentKey));
  const stages = {
    found: linked.filter(row => row.discovered !== null &&
      row.discovered.routes + row.discovered.records + row.discovered.pointers > 0).length,
    parsed: linked.filter(row => (row.parsed?.succeeded ?? 0) > 0).length,
    verified: linked.filter(row => (row.verification?.unit === "pipeline item" && row.verification.passed > 0) || row.promoted === "PROMOTED").length,
    promoted: linked.filter(row => row.promoted === "PROMOTED").length,
    live: linked.filter(row => row.publiclyAvailable === "CONFIRMED").length,
  };
  const roles = new Map<string, number>();
  for (const row of linked) for (const worker of row.workers ?? []) {
    const model = worker.model.kind === "MODEL" ? worker.model.id : worker.model.kind === "PLAIN_CODE" ? worker.model.tool : "model not recorded";
    const key = `${worker.role} · ${model}`;
    roles.set(key, (roles.get(key) ?? 0) + 1);
  }
  const recent = linked.filter(row => row.lastActivityAt !== null)
    .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""))
    .slice(0, 8);
  return { listed: linked.length, stages, roles: [...roles].sort((a, b) => b[1] - a[1]), recent };
}
