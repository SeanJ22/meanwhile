import type { BallotSet } from "../ballot/types.ts";
import type { CodeSlice, Slice } from "../control-plane/admin-view/promoted-slices.ts";
import { selectGeographyVersion } from "../census-geography/selection.ts";
import { addressDivisions, type AddressGeographies } from "./address-geographies.ts";

/** Only an exact, date-qualified, completely mapped district may rule out a contest. */
export function ballotScopeAtAddress(geographies: AddressGeographies, held: Slice<CodeSlice>, ballots: readonly BallotSet[], asOf: string) {
  const included = new Set<string>(), excluded = new Set<string>();
  for (const ballot of ballots) {
    const selection = { purpose: "election" as const, asOf, electionDate: ballot.election.date };
    const divisions = addressDivisions(geographies, held, selection);
    for (const contest of ballot.contests) {
      const level = /\/(cd|sldu|sldl):[^/]+$/.exec(contest.ocdId)?.[1];
      const type = level === "cd" ? "congressional_district" : level === "sldu" ? "state_leg_upper" : level === "sldl" ? "state_leg_lower" : null;
      if (!type || held.kind !== "HELD") continue;
      const version = selectGeographyVersion(held.value.scopes.map(scope => ({ ...scope, key: scope.version })), type, selection);
      // A bare year has no purpose; keep the contest visible until its source identifies its actual plan.
      if (!version || contest.divisionVintage !== version.key) continue;
      const answers = divisions.filter(row => row.divisionType === level);
      if (!answers.length) continue;
      (answers.some(row => row.ocdId === contest.ocdId) ? included : excluded).add(contest.id);
    }
  }
  return { contestIds: [...included], excludedContestIds: [...excluded].filter(id => !included.has(id)) };
}
