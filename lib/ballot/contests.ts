import type { BallotAbsence, BallotSet, Contest, HeldBallotContest } from "./types.ts";

export function contestsForDivisions(
  set: BallotSet,
  divisionOcdIds: readonly string[],
): { contests: Contest[]; absences: BallotAbsence[]; heldContests?: HeldBallotContest[] } {
  const present = new Set(divisionOcdIds);
  for (const id of divisionOcdIds) {
    const state = /^(ocd-division\/country:us\/state:[a-z]{2})\//.exec(id);
    if (state) present.add(state[1]);
  }
  return {
    contests: set.contests.filter(contest => present.has(contest.ocdId)),
    absences: set.absences.filter(absence => present.has(absence.ocdId)),
    ...(set.heldContests !== undefined ? { heldContests: set.heldContests.filter(contest => present.has(contest.ocdId)) } : {}),
  };
}

export function ballotForDivisions(set: BallotSet, divisions: readonly string[]): BallotSet {
  const matched = contestsForDivisions(set, divisions);
  const contests = new Set(matched.contests.map(row => row.id));
  const candidacies = set.candidacies.filter(row => contests.has(row.contestId));
  const candidates = new Set(candidacies.map(row => row.id));
  return {
    ...set, ...matched, candidacies,
    ...(set.filingCandidacies ? { filingCandidacies: set.filingCandidacies.filter(row => contests.has(row.contestId)) } : {}),
    measures: set.measures.filter(row => contests.has(row.contestId)),
    ...(set.contacts ? { contacts: set.contacts.filter(row => candidates.has(row.candidacyId)) } : {}),
    ...(set.measureRecords ? { measureRecords: set.measureRecords.filter(row => contests.has(row.contestId)) } : {}),
    ...(set.removals ? { removals: set.removals.filter(row => contests.has(row.contestId)) } : {}),
    ...(set.generalLineup ? { generalLineup: { ...set.generalLineup, contests: set.generalLineup.contests.filter(row => contests.has(row.contestId)) } } : {}),
    ...(set.measureAnalyses ? { measureAnalyses: { ...set.measureAnalyses, analyses: set.measureAnalyses.analyses.filter(row => contests.has(row.contestId)) } } : {}),
    ...(set.lineupReconciliation ? { lineupReconciliation: { ...set.lineupReconciliation, rows: set.lineupReconciliation.rows.filter(row => contests.has(row.contestId)) } } : {}),
  };
}
