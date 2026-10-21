import type { BallotSet } from "./types.ts";

/** Retain the earlier filing for sources, but exclude a documented withdrawal
 * from current choices. A later reinstated filing takes precedence. */
export function withCurrentCandidacies(set: BallotSet): BallotSet {
  if (!set.removals?.length) return set;
  const changes = new Map(set.removals.map(row => [row.id, row]));
  const withdrawn = set.candidacies.filter(row => {
    const change = changes.get(row.id);
    if (!change || change.contestId !== row.contestId || change.status !== "REMOVED_FROM_FILING" ||
        !change.absentFrom.sourceUrl) return false;
    const changedAt = Date.parse(change.absentFrom.collectedAt), filedAt = Date.parse(row.provenance.collectedAt);
    return Number.isFinite(changedAt) && Number.isFinite(filedAt) && changedAt >= filedAt;
  });
  if (!withdrawn.length) return set;
  const ids = new Set(withdrawn.map(row => row.id));
  return { ...set, candidacies: set.candidacies.filter(row => !ids.has(row.id)),
    filingCandidacies: [...set.filingCandidacies ?? [], ...withdrawn.filter(row => !set.filingCandidacies?.some(filed => filed.id === row.id))] };
}
