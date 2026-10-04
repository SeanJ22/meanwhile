import { readPromotedEdgeFirst } from "../registry/runtime-edge.ts";
import type { BallotSet } from "./types.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";

/** Each state/election has its own data key; no software source list admits it. */
export interface GenericBallotProjection {
  readonly kind: "ballot-contests";
  readonly ballots: Readonly<Record<string, BallotSet>>;
}
export const GENERIC_BALLOT_SCOPE = "US:state-election-ballots";
export const ballotElectionKey = (ballot: BallotSet) => `${ballot.election.state.toUpperCase()}:${ballot.election.id}`;

export function genericBallotProblems(value: GenericBallotProjection): string[] {
  if (!value || value.kind !== "ballot-contests" || !value.ballots || Array.isArray(value.ballots)) return ["Generic ballot records are missing."];
  const problems: string[] = [];
  for (const [key, ballot] of Object.entries(value.ballots)) {
    if (!ballot?.election || key !== ballotElectionKey(ballot) || !/^[A-Z]{2}$/.test(ballot.election.state) ||
      !Array.isArray(ballot.contests) || !Array.isArray(ballot.candidacies) || !ballot.contests.length) {
      problems.push("A ballot lacks its exact state/election key or contests."); continue;
    }
    const ids = new Set(ballot.contests.map(row => row.id));
    if (ids.size !== ballot.contests.length || new Set(ballot.candidacies.map(row => row.id)).size !== ballot.candidacies.length) problems.push("A ballot repeats an identity.");
    if (ballot.contests.some(row => row.electionId !== ballot.election.id || !row.title || !row.ocdId.includes(`/state:${ballot.election.state.toLowerCase()}`) ||
      !row.provenance?.sourceUrl || (row.type === "CANDIDACY" && !ballot.candidacies.some(candidate => candidate.contestId === row.id)))) problems.push("A contest lacks its election, territory, source or candidates.");
    if (ballot.candidacies.some(row => !ids.has(row.contestId) || !row.familyName || !row.provenance?.sourceUrl)) problems.push("A candidacy lacks its exact contest, filed name or source.");
  }
  return problems;
}

export async function readGenericBallotProjection(options: PromotedCivicDataReadOptions = {}) {
  const read = (readOptions: PromotedCivicDataReadOptions) => readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", GENERIC_BALLOT_SCOPE, readOptions);
  const result = Object.keys(options).length ? await read(options)
    : await readPromotedEdgeFirst("BALLOT_CANDIDACY", GENERIC_BALLOT_SCOPE, read, "General ballot");
  if (result.kind === "PROMOTED") {
    const problems = genericBallotProblems(result.value);
    if (problems.length) throw new Error(`GENERIC_BALLOT_INVALID:${problems.join(" ")}`);
  }
  return result;
}
