import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { readPromotedEdgeFirst } from "../registry/runtime-edge.ts";
import type { BallotSet } from "./types.ts";
import { measureRecordIssue } from "./measure-record-contract.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";

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
    if (ballot.contests.some(row => row.electionId !== ballot.election.id || !row.title || jurisdictionFromOcdId(row.ocdId)?.usps !== ballot.election.state ||
      !row.provenance?.sourceUrl || (row.type === "CANDIDACY" && !ballot.candidacies.some(candidate => candidate.contestId === row.id)) ||
      row.measureTextUrl !== undefined && (row.type !== "MEASURE" || !/^https:\/\//.test(row.measureTextUrl)))) problems.push("A contest lacks its election, territory, source or candidates.");
    if (ballot.candidacies.some(row => !ids.has(row.contestId) || !row.familyName || !row.provenance?.sourceUrl)) problems.push("A candidacy lacks its exact contest, filed name or source.");
    const measures = Array.isArray(ballot.measures) ? ballot.measures : [];
    if (new Set(measures.map(row => row.id)).size !== measures.length || measures.some(row => !row.id || !row.questionText?.trim() ||
        !ballot.contests.some(contest => contest.id === row.contestId && contest.type === "MEASURE") || !row.provenance?.sourceUrl ||
        row.officialNumber !== undefined && (typeof row.officialNumber !== "string" || !row.officialNumber.trim()))) problems.push("A measure lacks its exact contest, official wording or source.");
    if (ballot.measureRecords !== undefined && (!Array.isArray(ballot.measureRecords) ||
        new Set(ballot.measureRecords.map(row => row.contestId)).size !== ballot.measureRecords.length ||
        ballot.measureRecords.some(row => measureRecordIssue(row) || !measures.some(measure => measure.contestId === row.contestId)))) problems.push("A measure record lacks its stable source-bound identity.");
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
