import type { BallotSet } from "../ballot/types.ts";
import type { CodeSlice, Slice } from "../control-plane/admin-view/promoted-slices.ts";
import { stateBase } from "../ocd/divisions.ts";
import { addressDivisions, addressStateFips, type AddressGeographies } from "./address-geographies.ts";

/** Only an exact, date-qualified, completely mapped district may rule out a contest. */
export function ballotScopeAtAddress(geographies: AddressGeographies, held: Slice<CodeSlice>, ballots: readonly BallotSet[], asOf: string) {
  const included = new Set<string>(), excluded = new Set<string>();
  const stateFips = addressStateFips(geographies);
  const state = stateFips ? stateBase(stateFips) : null;
  if (!state || !stateFips) return { contestIds: [], excludedContestIds: [] };
  for (const ballot of ballots) {
    const selection = { purpose: "election" as const, asOf, electionDate: ballot.election.date, stateFips };
    const divisions = addressDivisions(geographies, held, selection);
    for (const contest of ballot.contests) {
      if (!contest.ocdId.startsWith(`${state.base}/`)) continue;
      const level = /\/(cd|sldu|sldl):[^/]+$/.exec(contest.ocdId)?.[1];
      if (!level) continue;
      const answers = divisions.filter(row => row.divisionType === level);
      if (!answers.length) continue;
      (answers.some(row => row.ocdId === contest.ocdId) ? included : excluded).add(contest.id);
    }
  }
  return { contestIds: [...included], excludedContestIds: [...excluded].filter(id => !included.has(id)) };
}
