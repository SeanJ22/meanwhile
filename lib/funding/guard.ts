import type { FundingSnapshot } from "./types.ts";

/**
 * The thin-snapshot guard (session brief 2, wall clock 2026-08-14).
 *
 * The 0819 session caught an FEC 504 leaving Kelly at 5 contributor rows
 * BY EYE and reran by hand. The weekly refresh
 * (.github/workflows/refresh-fec-snapshot.yml) now runs with nobody
 * watching, so the eyeball becomes a mechanism: before writing, the fetch
 * script compares the new snapshot against the last committed one, and a
 * shrink FAILS the run — the old snapshot stays, the workflow log says
 * why. Failing loudly and shipping nothing is the designed outcome; a
 * thinner book must never publish silently.
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
 * A LEGITIMATE shrink (a committee amendment, a candidate withdrawal) is
 * overridden by a human rerunning with `--allow-shrink`, recorded in the
 * tracker. The guard never auto-approves: it cannot tell an amendment
 * from an outage, and guessing in the generous direction is how a thin
 * book ships.
 */

export interface ShrinkRegression {
  /** Which comparison failed, for the workflow log. */
  kind: "CANDIDATE_COUNT" | "CANDIDATE_MISSING" | "CONTRIBUTOR_ROWS";
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

  return regressions;
}
