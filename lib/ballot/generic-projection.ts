import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { readPromotedEdgeFirst } from "../registry/runtime-edge.ts";
import type { BallotSet } from "./types.ts";
import { measureRecordIssue } from "./measure-record-contract.ts";
import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";

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
    const unique = (rows: readonly unknown[], field: string) => rows.every(row => row && typeof row === "object" &&
      typeof (row as Record<string, unknown>)[field] === "string" && (row as Record<string, unknown>)[field]) &&
      new Set(rows.map(row => (row as Record<string, unknown>)[field])).size === rows.length;
    if (ballot.contacts !== undefined && (!Array.isArray(ballot.contacts) || !unique(ballot.contacts, "candidacyId") ||
        ballot.contacts.some(row => !ballot.candidacies.some(candidate => candidate.id === row.candidacyId) || !row.sourceUrl || !row.collectedAt)))
      problems.push("A candidate contact lacks its current candidacy or source.");
    if (ballot.measureAnalyses !== undefined && (!Array.isArray(ballot.measureAnalyses?.analyses) ||
        !unique(ballot.measureAnalyses.analyses, "contestId"))) problems.push("Measure analyses repeat or lack their contest identity.");
    if (ballot.generalLineup !== undefined && (!Array.isArray(ballot.generalLineup?.contests) ||
        !unique(ballot.generalLineup.contests, "contestId") || !ballot.generalLineup.canvass?.url)) problems.push("A nominee lineup lacks its contest identity or canvass.");
    if (ballot.identityRegistry !== undefined && (!Array.isArray(ballot.identityRegistry?.contests) || !Array.isArray(ballot.identityRegistry.candidates) ||
        !unique(ballot.identityRegistry.contests, "identityId") || !unique(ballot.identityRegistry.candidates, "identityId")))
      problems.push("A candidate identity registry repeats or lacks an identity.");
    if (ballot.lineupReconciliation !== undefined && (!Array.isArray(ballot.lineupReconciliation?.rows) ||
        !unique(ballot.lineupReconciliation.rows, "cardKey"))) problems.push("A nominee reconciliation repeats or lacks a card identity.");
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
        ballot.measureRecords.some(row => measureRecordIssue(row) || !ballot.contests.some(contest => contest.id === row.contestId && contest.type === "MEASURE") ||
          !measures.some(measure => measure.contestId === row.contestId) && !ballot.measureAnalyses?.analyses.some(analysis =>
            analysis.contestId === row.contestId && analysis.analysisUrl === row.sourceUrl && analysis.contentHash === row.sourceHash)))) problems.push("A measure record lacks its stable source-bound identity.");
  }
  return problems;
}

let readState: CivicDataReadResult<GenericBallotProjection> | null = null;

export function currentGenericBallotProjection(): GenericBallotProjection {
  if (readState?.kind === "PROMOTED" || readState?.kind === "BOOTSTRAP") return readState.value;
  throw new Error(`National ballot projection is ${readState?.kind ?? "UNREAD"}; read its authority before using the projection.`);
}

export async function readGenericBallotProjection(options: PromotedCivicDataReadOptions = {}) {
  const read = (readOptions: PromotedCivicDataReadOptions) => readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", GENERIC_BALLOT_SCOPE, readOptions);
  try {
    const result = Object.keys(options).length ? await read(options)
      : await readPromotedEdgeFirst("BALLOT_CANDIDACY", GENERIC_BALLOT_SCOPE, read, "General ballot");
    if (result.kind === "PROMOTED") {
      const problems = genericBallotProblems(result.value);
      if (problems.length) throw new Error(`GENERIC_BALLOT_INVALID:${problems.join(" ")}`);
    }
    readState = result;
    return result;
  } catch (error) {
    readState = null;
    throw error;
  }
}
