import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { currentStateAuthorityProjection, readStateAuthorityProjection } from "../civic-data/state-reader.ts";
import { requireBallotState, stateBallotScope } from "../civic-data/state-scopes.ts";
import type { BallotSet } from "./types.ts";
import { measureRecordIssue } from "./measure-record-contract.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";


export interface GenericBallotProjection {
  readonly kind: "ballot-contests";
  readonly ballots: Readonly<Record<string, BallotSet>>;
}
export const ballotElectionKey = (ballot: BallotSet) => `${ballot.election.state.toUpperCase()}:${ballot.election.id}`;

export function genericBallotProblems(value: GenericBallotProjection, expectedState?: string): string[] {
  if (!value || value.kind !== "ballot-contests" || !value.ballots || typeof value.ballots !== "object" || Array.isArray(value.ballots)) return ["Generic ballot records are missing."];
  const problems: string[] = [];
  const states = new Set<string>();
  for (const [key, ballot] of Object.entries(value.ballots)) {
    if (!ballot?.election || key !== ballotElectionKey(ballot) || !/^[A-Z]{2}$/.test(ballot.election.state) ||
      !Array.isArray(ballot.contests) || !Array.isArray(ballot.candidacies) ||
      !ballot.contests.length && !ballot.heldContests?.length && !ballot.absences?.length) {
      problems.push("A ballot lacks its exact state/election key or contests."); continue;
    }
    states.add(ballot.election.state);
    if (expectedState && ballot.election.state !== expectedState.toUpperCase()) problems.push("A ballot belongs to another state.");
    const contestById = new Map(ballot.contests.map(row => [row.id, row]));
    const candidateIds = new Set(ballot.candidacies.map(row => row.id));
    const candidateContests = new Set(ballot.candidacies.map(row => row.contestId));
    const measures = Array.isArray(ballot.measures) ? ballot.measures : [];
    const measureContestIds = new Set(measures.map(row => row.contestId));
    const analyses = Array.isArray(ballot.measureAnalyses?.analyses) ? ballot.measureAnalyses.analyses : [];
    const analysisByContest = new Map(analyses.map(row => [row.contestId, row]));
    const unique = (rows: readonly unknown[], field: string) => rows.every(row => row && typeof row === "object" &&
      typeof (row as Record<string, unknown>)[field] === "string" && (row as Record<string, unknown>)[field]) &&
      new Set(rows.map(row => (row as Record<string, unknown>)[field])).size === rows.length;
    if (ballot.contacts !== undefined && (!Array.isArray(ballot.contacts) || !unique(ballot.contacts, "candidacyId") ||
        ballot.contacts.some(row => !candidateIds.has(row.candidacyId) || !row.sourceUrl || !row.collectedAt)))
      problems.push("A candidate contact lacks its current candidacy or source.");
    if (ballot.measureAnalyses !== undefined && (!Array.isArray(ballot.measureAnalyses?.analyses) ||
        !unique(ballot.measureAnalyses.analyses, "contestId"))) problems.push("Measure analyses repeat or lack their contest identity.");
    if (ballot.generalLineup !== undefined && (!Array.isArray(ballot.generalLineup?.contests) ||
        !unique(ballot.generalLineup.contests, "contestId") || !ballot.generalLineup.canvass?.url)) problems.push("A nominee lineup lacks its contest identity or canvass.");
    if (ballot.lineupReconciliation !== undefined && (!Array.isArray(ballot.lineupReconciliation?.rows) ||
        !unique(ballot.lineupReconciliation.rows, "cardKey"))) problems.push("A nominee reconciliation repeats or lacks a card identity.");
    const filings = Array.isArray(ballot.filingCandidacies) ? ballot.filingCandidacies : [];
    const filingContests = new Set([...contestById.keys(), ...(Array.isArray(ballot.heldContests) ? ballot.heldContests.map(row => row.id) : [])]);
    if (ballot.filingCandidacies !== undefined && (!Array.isArray(ballot.filingCandidacies) || !unique(filings, "id") ||
        filings.some(row => candidateIds.has(row.id) || !filingContests.has(row.contestId) || !row.familyName?.trim() || !row.provenance?.sourceUrl)))
      problems.push("A retained filing repeats a candidacy or lacks its exact contest, filed name or source.");
    const identities = [...ballot.contests, ...ballot.candidacies, ...filings].flatMap(row => row.identity !== undefined ? [row.identity] : []);
    if (!unique(identities, "identityId")) problems.push("An embedded ballot identity repeats or lacks its identity key.");
    const ids = new Set(contestById.keys());
    if (!Array.isArray(ballot.absences) || ballot.absences.some(row => !row.statement?.trim() ||
      jurisdictionFromOcdId(row.ocdId)?.usps !== ballot.election.state || !row.provenance?.sourceUrl))
      problems.push("A ballot absence lacks its exact territory, statement or source.");
    if (ballot.contests.some(row => row.retentionQuestion !== undefined && (row.type !== "RETENTION" ||
      !row.retentionQuestion?.questionText?.trim() || !row.retentionQuestion?.provenance?.sourceUrl)))
      problems.push("A retention question lacks its exact contest, official wording or source.");
    if (ballot.contests.some(row => row.voteForSources !== undefined &&
      (!Number.isInteger(row.voteFor) || (row.voteFor ?? 0) < 1 || !Array.isArray(row.voteForSources) ||
        !row.voteForSources.length || row.voteForSources.some(source => !source?.sourceUrl))))
      problems.push("Sourced voting instructions lack their positive count or source.");
    if (ballot.heldContests !== undefined && (!Array.isArray(ballot.heldContests) ||
      new Set(ballot.heldContests.map(row => row.id)).size !== ballot.heldContests.length ||
      ballot.heldContests.some(row => !row.id || ids.has(row.id) || row.electionId !== ballot.election.id ||
        !row.title?.trim() || !row.reason?.trim() || jurisdictionFromOcdId(row.ocdId)?.usps !== ballot.election.state ||
        !row.provenance?.sourceUrl))) problems.push("A held contest lacks its exact election, territory, source or reason.");
    if (ids.size !== ballot.contests.length || candidateIds.size !== ballot.candidacies.length) problems.push("A ballot repeats an identity.");
    if (ballot.contests.some(row => row.electionId !== ballot.election.id || !row.title || jurisdictionFromOcdId(row.ocdId)?.usps !== ballot.election.state ||
      !row.provenance?.sourceUrl || (row.type === "CANDIDACY" && !candidateContests.has(row.id)) ||
      row.measureTextUrl !== undefined && (row.type !== "MEASURE" || !/^https:\/\//.test(row.measureTextUrl)))) problems.push("A contest lacks its election, territory, source or candidates.");
    if (ballot.candidacies.some(row => !ids.has(row.contestId) || !row.familyName || !row.provenance?.sourceUrl)) problems.push("A candidacy lacks its exact contest, filed name or source.");
    if (new Set(measures.map(row => row.id)).size !== measures.length || measures.some(row => !row.id || !row.questionText?.trim() ||
        contestById.get(row.contestId)?.type !== "MEASURE" || !row.provenance?.sourceUrl ||
        row.officialNumber !== undefined && (typeof row.officialNumber !== "string" || !row.officialNumber.trim()))) problems.push("A measure lacks its exact contest, official wording or source.");
    if (ballot.measureRecords !== undefined && (!Array.isArray(ballot.measureRecords) ||
        new Set(ballot.measureRecords.map(row => row.contestId)).size !== ballot.measureRecords.length ||
        ballot.measureRecords.some(row => measureRecordIssue(row) || contestById.get(row.contestId)?.type !== "MEASURE" ||
          !measureContestIds.has(row.contestId) && (analysisByContest.get(row.contestId)?.analysisUrl !== row.sourceUrl || analysisByContest.get(row.contestId)?.contentHash !== row.sourceHash)))) problems.push("A measure record lacks its stable source-bound identity.");
  }
  if (expectedState && states.size > 1) problems.push("A ballot projection must contain at most one state.");
  return problems;
}

export function currentGenericBallotProjection(state: string): GenericBallotProjection {
  const read = currentStateAuthorityProjection<GenericBallotProjection>("ballot-contests", state)?.result;
  if (read?.kind === "PROMOTED" || read?.kind === "BOOTSTRAP") return read.value;
  throw new Error(`Ballot for ${state} is ${read?.kind ?? "UNREAD"}; read its authority before using the projection.`);
}

export async function readGenericBallotProjection(state: string, options: PromotedCivicDataReadOptions = {}) {
  const key = requireBallotState(state);
  return Object.keys(options).length
    ? readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", key), options)
    : (await readStateAuthorityProjection<GenericBallotProjection>("ballot-contests", key)).result;
}
