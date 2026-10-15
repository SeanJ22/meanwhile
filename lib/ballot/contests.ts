import type { BallotAbsence, BallotSet, Contest } from "./types.ts";

export function contestsForDivisions(
  set: BallotSet,
  divisionOcdIds: readonly string[],
): { contests: Contest[]; absences: BallotAbsence[] } {
  const present = new Set(divisionOcdIds);
  for (const id of divisionOcdIds) {
    const state = /^(ocd-division\/country:us\/state:[a-z]{2})\//.exec(id);
    if (state) present.add(state[1]);
  }
  return {
    contests: set.contests.filter(contest => present.has(contest.ocdId)),
    absences: set.absences.filter(absence => present.has(absence.ocdId)),
  };
}
