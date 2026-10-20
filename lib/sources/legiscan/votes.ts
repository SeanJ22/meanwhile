import { votePagesIssue, type VoteMemberPage } from "../../state-rollcalls/vote-page-model.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../../civic-data/types.ts";
import type { RoutineDataStore } from "../../civic-data/store.ts";
import type { OfficialStateLegislatorReadModel } from "../../civic-data/candidate-builders.ts";
import type { PluralVoteFact } from "../plural/votes.ts";
import type { LegiscanDatasetRecord } from "./types.ts";
import { digest, LEGISCAN_VOTES_PARSER, LEGISCAN_VOTES_SOURCE, legiscanState, nativePersonId, profileUrl, sourcePersonIds, validDay,
  type LegiscanDatasetEvidence, type LegiscanIdentityAuthority } from "./dataset.ts";

export const legiscanVotesScope = (state: string) => `US-${legiscanState(state)}:legiscan-votes:v1`;
export const legiscanVotesContract = (state: string) => `legiscan-votes-${legiscanState(state).toLowerCase()}`;
export interface LegiscanVotesProjection {
  formatVersion: 1 | 2; memberPages?: VoteMemberPage[]; state: string; rollCalls: PluralVoteFact[]; datasets: LegiscanDatasetRecord[];
  identityAuthority: LegiscanIdentityAuthority;
}
export function mergeLegiscanVoteMetadata(prior: Pick<LegiscanVotesProjection, "state" | "datasets" | "identityAuthority"> | null,
  input: { state: string; datasets: readonly LegiscanDatasetRecord[]; identityAuthority: LegiscanIdentityAuthority }) {
  const state = legiscanState(input.state);
  if (prior && prior.state !== state) throw new Error("LEGISCAN_VOTE_PREDECESSOR_STATE_INVALID");
  const datasets = new Map(prior?.datasets.map(dataset => [dataset.sessionId, dataset]) ?? []);
  for (const dataset of input.datasets) datasets.set(dataset.sessionId, dataset);
  const joins = new Map(prior?.identityAuthority.joins.map(join => [join.legiscanPeopleId, join]) ?? []);
  for (const join of input.identityAuthority.joins) {
    const old = joins.get(join.legiscanPeopleId);
    if (old && old.personId !== join.personId) throw new Error("LEGISCAN_PERSON_IDENTITY_CONFLICT");
    joins.set(join.legiscanPeopleId, { ...join, sourceRosterVersionId: input.identityAuthority.versionId });
  }
  const orderedJoins = [...joins.values()].sort((a, b) => a.legiscanPeopleId - b.legiscanPeopleId);
  return { state,
    datasets: [...datasets.values()].sort((a, b) => a.sessionId - b.sessionId),
    identityAuthority: { ...input.identityAuthority, joins: orderedJoins, crosswalkSha256: digest(orderedJoins) } };
}
export function legiscanVotesProjectionIssue(value: LegiscanVotesProjection): string | null {
  let state: string;
  try { state = legiscanState(value?.state); } catch { return "LEGISCAN_VOTE_STATE_INVALID"; }
  if (![1, 2].includes(value.formatVersion) || value.state !== state || !Array.isArray(value.rollCalls) || !Array.isArray(value.datasets) || !value.identityAuthority) return "LEGISCAN_VOTE_PROJECTION_INVALID";
  if (value.formatVersion === 2) { const issue = votePagesIssue(value); if (issue) return issue; }
  const authority = value.identityAuthority;
  if (authority.sourceId !== "plural-openstates" || authority.scope !== `US-${state}:openstates-people:v1` || !authority.versionId || !Array.isArray(authority.joins) ||
    authority.crosswalkSha256 !== digest(authority.joins) || new Set(authority.joins.map(join => join.legiscanPeopleId)).size !== authority.joins.length ||
    new Set(authority.joins.map(join => join.personId)).size !== authority.joins.length || authority.joins.some(join => !Number.isSafeInteger(join.legiscanPeopleId) || join.legiscanPeopleId <= 0 ||
      !nativePersonId(join.personId) || !join.sourceRosterVersionId || !profileUrl(join.sourceUrl) || !["NATIVE_ID", "EXACT_MEMBER_PROFILE_URL"].includes(join.basis) ||
      (join.basis === "EXACT_MEMBER_PROFILE_URL" && (!profileUrl(join.matchedUrl) || profileUrl(join.openStatesProfileUrl) !== join.matchedUrl || profileUrl(join.legiscanProfileUrl) !== join.matchedUrl)) ||
      (join.basis === "NATIVE_ID" && (join.matchedUrl !== null || join.openStatesProfileUrl !== null || join.legiscanProfileUrl !== null)))) return "LEGISCAN_IDENTITY_AUTHORITY_INVALID";
  if (new Set(value.datasets.map(dataset => dataset.sessionId)).size !== value.datasets.length || value.datasets.some(dataset => dataset.state !== state ||
    !Number.isSafeInteger(dataset.sessionId) || dataset.sessionId <= 0 || !dataset.sessionName || !validDay(dataset.datasetDate) || !/^[a-f0-9]{32,64}$/.test(dataset.datasetHash) ||
    !dataset.downloadedAt || !Number.isFinite(Date.parse(dataset.downloadedAt)))) return "LEGISCAN_DATASET_IDENTITY_INVALID";
  if (new Set(value.rollCalls.map(vote => vote.id)).size !== value.rollCalls.length) return "LEGISCAN_VOTE_DUPLICATE";
  const people = new Set(authority.joins.map(join => join.personId));
  if (value.formatVersion === 2 && (value.memberPages!.some(page => !people.has(page.personId)) || value.rollCalls.some(vote => !people.has(vote.firstPersonId!)))) return "LEGISCAN_VOTE_NATIVE_FACT_INVALID";
  for (const vote of value.rollCalls) {
    if (!/^legiscan:roll_call:[1-9]\d*$/.test(vote.id) || !/^legiscan:bill:[1-9]\d*$/.test(vote.billId) || !new RegExp(`^legiscan:chamber:${state}:[1-9]\\d*$`).test(vote.organizationId) ||
      !vote.billNumber || !vote.billTitle || !vote.session || !vote.motion || !["Passed", "Failed"].includes(vote.result) || !(state === "NE" ? ["upper", "lower", "legislature"] : ["upper", "lower"]).includes(vote.chamber) ||
      !validDay(vote.date) || !Number.isFinite(Date.parse(vote.retrievedAt)) || vote.date > vote.retrievedAt.slice(0, 10) ||
      !/^https:\/\/api\.legiscan\.com\/\?op=getDataset&id=[1-9]\d*&dataset_hash=[a-f0-9]{32,64}$/.test(vote.sourceApiUrl) ||
      !Number.isSafeInteger(vote.unresolvedPositions) || vote.unresolvedPositions < 0 || !Array.isArray(vote.sourceUrls) || !vote.sourceUrls.length || vote.sourceUrls.some(url => !profileUrl(url)) ||
      !Array.isArray(vote.counts) || vote.counts.length !== 4 || vote.counts.some(row => !["yea", "nay", "nv", "absent"].includes(row.option) || !Number.isSafeInteger(row.value) || row.value < 0) ||
      new Set(vote.counts.map(row => row.option)).size !== 4 || !Array.isArray(vote.positions) || value.formatVersion === 1 && !vote.positions.length || vote.positions.some(position =>
        !nativePersonId(position.personId) || !people.has(position.personId) || !position.option || !Number.isFinite(Date.parse(position.retrievedAt)) || position.retrievedAt > vote.retrievedAt) ||
      new Set(vote.positions.map(position => position.personId)).size !== vote.positions.length) return "LEGISCAN_VOTE_NATIVE_FACT_INVALID";
  }
  return null;
}
/** Joins cite immutable promoted roster versions so departed members retain their verified history. */
export async function legiscanVoteIdentityAuthorityIssue(store: Pick<RoutineDataStore, "readPromotion" | "readCandidate">, candidate: RoutineCandidate): Promise<string | null> {
  const projection = candidate.readModel as LegiscanVotesProjection, issue = legiscanVotesProjectionIssue(projection);
  if (issue) return issue;
  const authority = projection.identityAuthority;
  const pointer = await store.readPromotion<OfficialStateLegislatorReadModel>("STATE_LEGISLATOR", authority.scope);
  if (!pointer || pointer.sourceId !== "plural-openstates" || pointer.versionId !== authority.versionId || pointer.lastKnownGoodVersionId !== authority.versionId) return "The vote crosswalk does not cite the canonical held OpenStates roster.";
  const byVersion = new Map<string, OfficialStateLegislatorReadModel>([[pointer.versionId, pointer.payload]]);
  for (const join of authority.joins) {
    const versionId = join.sourceRosterVersionId!;
    if (!byVersion.has(versionId)) {
      const captured = await store.readCandidate(versionId);
      if (!captured || captured.state !== "PROMOTED" || captured.receipt?.decision !== "GOOD" || captured.candidate.sourceId !== "plural-openstates" ||
        captured.candidate.recordClass !== "STATE_LEGISLATOR" || captured.candidate.scope !== authority.scope ||
        captured.candidate.normalization.normalizedHash !== digest(captured.candidate.readModel)) return "The vote crosswalk's historical OpenStates roster is not a verified held source version.";
      byVersion.set(versionId, captured.candidate.readModel as OfficialStateLegislatorReadModel);
    }
    const roster = byVersion.get(versionId)!;
    if (roster.sourceId !== "plural-openstates" || roster.jurisdiction !== `US-${projection.state}` || !Array.isArray(roster.roster?.officeholders)) return "The vote crosswalk cites a roster for another state or publisher.";
    const candidates = roster.roster.officeholders.filter(holder => {
      if (holder.level !== "STATE" || !sourcePersonIds(holder).includes(join.personId)) return false;
      if (join.basis === "NATIVE_ID") return Object.entries(holder.nativeIds ?? {}).filter(([scheme]) => /^legiscan$/i.test(scheme)).flatMap(([, ids]) => ids).includes(String(join.legiscanPeopleId));
      return [holder.websiteUrl, ...(holder.profileUrls ?? [])].map(profileUrl).includes(join.matchedUrl);
    });
    const sharing = join.basis === "EXACT_MEMBER_PROFILE_URL" ? roster.roster.officeholders.filter(holder => [holder.websiteUrl, ...(holder.profileUrls ?? [])].map(profileUrl).includes(join.matchedUrl)) : candidates;
    if (candidates.length !== 1 || sharing.length !== 1 || candidates[0].provenance.sourceUrl !== join.sourceUrl) return "The vote crosswalk is not a unique exact identity in its independently held OpenStates roster.";
  }
  return null;
}
export function legiscanVotesCandidate(input: { projection: LegiscanVotesProjection; acquired: readonly LegiscanDatasetEvidence[];
  held: readonly { key: string; detail: string }[]; checkedAt: string }): RoutineCandidate {
  const projection = input.projection, scope = legiscanVotesScope(projection.state), jurisdiction = `US-${projection.state}`, issue = legiscanVotesProjectionIssue(projection);
  const acquisition = [...input.acquired].sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt))[0];
  const sourceThrough = [...input.acquired.map(row => row.retrievedAt), ...projection.datasets.flatMap(dataset => dataset.downloadedAt ? [dataset.downloadedAt] : []),
    ...projection.rollCalls.map(vote => vote.retrievedAt)].sort().at(-1) ?? input.checkedAt;
  const sourceCheck = input.acquired.flatMap(row => row.sourceCheck ? [row.sourceCheck] : []).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
  const payload = { acquisitions: input.acquired.map(({ members, sourceCheck: _sourceCheck, ...row }) => ({ ...row,
    ...(members ? { members: members.map(({ name, sha256 }) => ({ name, sha256 })) } : {}) })), held: input.held };
  return { id: `cv-${digest([LEGISCAN_VOTES_SOURCE, scope, digest(projection), digest(payload), sourceCheck ?? null]).slice(0, 32)}`,
    sourceId: LEGISCAN_VOTES_SOURCE, recordClass: "STATE_ROLL_CALL", scope,
    sourceProjectionEvidence: sourceProjectionEvidence(LEGISCAN_VOTES_SOURCE, "STATE_ROLL_CALL", scope),
    retrieval: { succeeded: input.acquired.length > 0, requestedUrl: acquisition?.requestedUrl ?? `https://api.legiscan.com/?op=getDatasetList&state=${projection.state}`,
      finalUrl: acquisition?.finalUrl ?? null, httpStatus: 200, retrievedAt: sourceThrough, rawHash: digest(input.acquired.map(row => row.sha256).sort()), ...(sourceCheck ? { sourceCheck } : {}) },
    normalization: { succeeded: !issue, parserVersion: LEGISCAN_VOTES_PARSER, schemaVersion: projection.formatVersion === 2 ? "legiscan-person-votes/2" : "legiscan-person-votes/1", normalizedHash: digest(projection), normalizedPayloadHash: digest(payload),
      inputRecords: projection.rollCalls.length, outputRecords: projection.rollCalls.length, droppedRecords: 0, missingRequiredFields: [] },
    identities: projection.rollCalls.map(vote => ({ subjectId: vote.id, jurisdiction, chamber: vote.chamber, term: vote.session, session: vote.session,
      identifiers: { rollCallId: vote.id, eventId: vote.id, roll_call_id: vote.id, session_id: vote.session, people_id: vote.positions[0]?.personId ?? vote.firstPersonId ?? "" }, matchBasis: "EXACT_SCOPED_ID" as const, ambiguous: false })),
    temporal: { version: sourceThrough, expectedVersion: sourceThrough, sourceThrough, staleAtRetrieval: false },
    semantics: { factKind: "LegiScan attributed native roll calls and exact OpenStates person positions", violations: issue ? [issue] : [] },
    horizon: { kind: "OPEN_FACT_SET", query: `${jurisdiction} weekly vendor datasets; independently joined member positions`, returnedRecords: projection.rollCalls.length,
      declaredTotal: null, paginationComplete: false, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "state native person vote reader", passed: !issue, detail: "Unique exact publisher ids or shared native member profile URLs bind positions; unresolved people remain held." }],
    excludedFacts: input.held.map(row => ({ ...row, code: "LEGISCAN_VOTE_UNRESOLVED" })), normalizedPayload: payload, readModel: projection };
}
export async function readLegiscanVotesProjection(state: string, options: PromotedCivicDataReadOptions = {}) {
  const read = await readPromotedCivicData<LegiscanVotesProjection>("STATE_ROLL_CALL", legiscanVotesScope(state), options);
  if (read.kind === "PROMOTED" && (read.metadata.sourceId !== LEGISCAN_VOTES_SOURCE || read.value.state !== legiscanState(state) || legiscanVotesProjectionIssue(read.value))) throw new Error("LEGISCAN_VOTES_READER_INVALID");
  return read;
}
