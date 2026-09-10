import type { FundingSnapshot } from "./types.ts";

/**
 * The thin-snapshot guard (session brief 2, wall clock 2026-08-14).
 *
 * The 0819 session caught an FEC 504 leaving Kelly at 5 contributor rows by
 * eye. The Git-writing weekly refresh that existed then is retired. This pure
 * comparator remains as immutable regression evidence for the thin-response
 * class; the permanent `fec-funding` contract acquires and validates a source
 * candidate in the standing data plane, durably refuses a shrink, and leaves
 * its prior GOOD version live. No Git commit or software workflow reports the
 * source outcome.
 *
 * What counts as a shrink:
 *  - the candidate count falling below the prior snapshot's;
 *  - a prior candidate missing from the new snapshot (flagged with
 *    whether the new run at least recorded an absence for it — a recorded
 *    FEC-side reason is stated in the failure, but a human still confirms
 *    it, because "the FEC stopped returning this candidate" is exactly
 *    what an outage looks like);
 *  - a retained candidate's contributor rows falling below the prior
 *    count — the Kelly-504 shape verbatim.
 *
 * The comparator never auto-approves a legitimate shrink: it cannot tell a
 * committee amendment from an outage, and guessing in the generous direction
 * is how a thin book ships. Any acceptance belongs to the canonical
 * source-scoped promotion evidence, never a direct CLI bypass.
 */

export interface ShrinkRegression {
  /** Which source-scoped comparison failed, for the durable outcome receipt. */
  kind:
    | "CANDIDATE_COUNT"
    | "CANDIDATE_MISSING"
    | "CONTRIBUTOR_ROWS"
    | "SECOND_HOP_ROWS";
  detail: string;
}

export function findShrinkRegressions(
  prior: FundingSnapshot,
  next: FundingSnapshot,
): ShrinkRegression[] {
  const regressions: ShrinkRegression[] = [];

  if (next.candidates.length < prior.candidates.length) {
    regressions.push({
      kind: "CANDIDATE_COUNT",
      detail: `candidate count fell ${prior.candidates.length} → ${next.candidates.length}`,
    });
  }

  const nextById = new Map(next.candidates.map((c) => [c.fecCandidateId, c]));
  const nextAbsenceKeys = new Set(next.absences.map((a) => a.targetKey));

  for (const prev of prior.candidates) {
    const kept = nextById.get(prev.fecCandidateId);
    if (!kept) {
      const recordedAbsences = prev.targetKeys.filter((k) =>
        nextAbsenceKeys.has(k),
      );
      regressions.push({
        kind: "CANDIDATE_MISSING",
        detail:
          `${prev.fecCandidateId} (${prev.name}) present in the prior snapshot is missing from this run` +
          (recordedAbsences.length > 0
            ? ` — the run recorded an absence for ${recordedAbsences.join(", ")}, which may be the FEC-side reason; a human confirms it`
            : " — and no absence was recorded for any of its target keys"),
      });
      continue;
    }
    if (kept.topContributions.length < prev.topContributions.length) {
      regressions.push({
        kind: "CONTRIBUTOR_ROWS",
        detail: `${prev.fecCandidateId} (${prev.name}) contributor rows fell ${prev.topContributions.length} → ${kept.topContributions.length} — the Kelly-504 shape; a partial FEC answer must not publish`,
      });
    }
  }

  // The second hop under the same rule (item 3, 2026-08-15). A committee
  // whose own books thinned between runs is the Kelly-504 shape one level
  // down, and it would render as a shorter list of donors with nothing
  // saying so.
  //
  // But the second-hop set is DERIVED, not fixed: scripts/fetch-fec.mts
  // builds it fresh each run by scanning every first-hop
  // `contributorCommitteeId` (fetch-fec.mts ~L730 — `hopIds`), so a
  // committee is fetched ONLY while it is still a top-N contributor to a
  // tracked candidate THIS run. That set churns as new contributions arrive
  // and the top-N list shifts, and a committee dropping OUT of it is not a
  // data outage — it simply is no longer among anyone's largest donors this
  // week. Treating that churn as a shrink once falsely refused every aggregate
  // refresh
  // (C00422774, the ADVANCING DEMOCRACY AND MOBILIZATION PAC, was the case
  // that surfaced it: absent from the run's derived set, never fetched, never
  // "stopped answering").
  //
  // So a VANISHED prior committee is a regression only in the genuine
  // "still asked, answered nothing" shape — still derived from this run's
  // first hop (still in `currentHopIds`) yet missing from `next.secondHop`.
  // A committee no longer in the derived set at all is expected churn and is
  // NOT a regression. THINNING is unchanged: a committee present in BOTH runs
  // whose rows fell is still the Kelly-504 shape and still fails — a
  // still-derived committee that returns fewer/zero rows must never pass.
  const priorHop = prior.secondHop ?? [];
  const nextHopById = new Map((next.secondHop ?? []).map((c) => [c.committeeId, c]));
  // Re-derive THIS run's hop-id set with the same rule fetch-fec.mts uses.
  const currentHopIds = new Set<string>();
  for (const candidate of next.candidates) {
    for (const row of candidate.topContributions) {
      if (row.contributorCommitteeId) currentHopIds.add(row.contributorCommitteeId);
    }
  }
  for (const before of priorHop) {
    const after = nextHopById.get(before.committeeId);
    if (!after) {
      // A committee that is no longer derived from any first-hop row this
      // run dropped out of the top-N set = expected churn, not an outage.
      // Only a committee STILL derived (still a top-N contributor this run)
      // yet absent from the fetched hop is the "still asked, answered
      // nothing" regression — and only if the hop was worth something before,
      // since a committee that was empty and is now absent tells us nothing.
      if (currentHopIds.has(before.committeeId) && before.topContributions.length > 0) {
        regressions.push({
          kind: "SECOND_HOP_ROWS",
          detail: `second-hop committee ${before.committeeId} (${before.name}) held ${before.topContributions.length} rows, is still a top contributor this run, and is missing from this run`,
        });
      }
      continue;
    }
    if (after.topContributions.length < before.topContributions.length) {
      regressions.push({
        kind: "SECOND_HOP_ROWS",
        detail: `second-hop committee ${before.committeeId} (${before.name}) rows fell ${before.topContributions.length} → ${after.topContributions.length}`,
      });
    }
  }

  return regressions;
}
