import { createHash } from "node:crypto";

import { authorityFor } from "../civic-data/source-authority.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../civic-data/types.ts";
import { canonicalCivicDataHash, canonicalCivicDataJson } from "../civic-data/changes.ts";
import type { BillSummariesFile } from "./bill-summaries.ts";
import type { KeyVoteEntry } from "./key-votes.ts";
import { federalKeyVoteSelectionV1Issue } from "./key-vote-selection-v1.ts";
import type { VotePosition, VotesSnapshot } from "./types.ts";

export const FEDERAL_VOTES_SOURCE_ID = "federal-legislative-records" as const;
export const FEDERAL_ROLLCALL_SCOPE = "US:recent-federal-rollcalls" as const;
export const FEDERAL_KEY_VOTE_SCOPE = "US:reviewed-key-vote-selection:v1" as const;
export const FEDERAL_VOTES_PARSER_VERSION = "federal-votes/2" as const;

export interface OfficialAcquisition {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  /** Exact response bytes represented as a string before parsing. */
  readonly body: string;
}

export interface FederalRollCallsReadModel {
  readonly formatVersion: 1;
  readonly snapshot: VotesSnapshot;
  readonly billSummaries: BillSummariesFile;
}

export interface FederalKeyVotePositions {
  readonly formatVersion: 1;
  readonly fetchedAt: string;
  readonly note?: string;
  /** Historical rejected mapping evidence; retained in the payload but never served as a current position. */
  readonly retiredMappings?: Readonly<Record<string, Readonly<Record<string, VotePosition>>>>;
  readonly positions: Record<string, Record<string, VotePosition>>;
}

export interface FederalKeyVotesSnapshot {
  readonly formatVersion: 1;
  readonly fetchedAt: string;
  readonly criteria: string;
  readonly entries: KeyVoteEntry[];
  readonly misses: readonly { readonly id: string; readonly chamber: string; readonly reason: string }[];
  readonly lawMisses?: readonly { readonly id: string; readonly reason: string }[];
}

export interface FederalKeyVotesReadModel {
  readonly formatVersion: 1;
  readonly selectionVersion: "v1";
  readonly snapshot: FederalKeyVotesSnapshot;
  readonly positions: FederalKeyVotePositions;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function candidateId(scope: string, acquisitions: readonly OfficialAcquisition[], retrievedAt: string): string {
  const exact = acquisitions.map(({ requestedUrl, finalUrl, httpStatus, body }) => ({ requestedUrl, finalUrl, httpStatus, rawHash: sha256(body) }));
  return `cv-${sha256(`${FEDERAL_VOTES_SOURCE_ID}\u001f${scope}\u001f${canonicalCivicDataJson(exact)}\u001f${retrievedAt}`).slice(0, 32)}`;
}

function acquisitionIssues(recordClass: "FEDERAL_ROLL_CALL" | "FEDERAL_KEY_VOTE", acquisitions: readonly OfficialAcquisition[]): string[] {
  const issues: string[] = [];
  for (const acquisition of acquisitions) {
    const authority = authorityFor(FEDERAL_VOTES_SOURCE_ID, recordClass, acquisition.finalUrl);
    if (!authority.ok) issues.push(`${authority.code}:${acquisition.finalUrl}`);
    if (acquisition.httpStatus < 200 || acquisition.httpStatus >= 300) issues.push(`HTTP_${acquisition.httpStatus}:${acquisition.finalUrl}`);
    if (acquisition.body.length === 0) issues.push(`EMPTY_BODY:${acquisition.finalUrl}`);
  }
  return issues;
}

function acquisitionRawHash(acquisitions: readonly OfficialAcquisition[]): string {
  return sha256(canonicalCivicDataJson(acquisitions.map(({ requestedUrl, finalUrl, httpStatus, body }) => ({
    requestedUrl,
    finalUrl,
    httpStatus,
    rawHash: sha256(body),
    byteCount: Buffer.byteLength(body),
  }))));
}

function latestVoteInstant(snapshot: VotesSnapshot): string {
  return snapshot.votes
    .map((vote) => vote.retrievedAt || vote.date)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort()
    .at(-1) ?? snapshot.generatedAt;
}

function rollAcquisitionUrl(chamber: "house" | "senate", congress: number, session: number, rollNumber: number): string {
  if (chamber === "house") {
    const year = 1787 + (congress * 2) + session - 1;
    return `https://clerk.house.gov/evs/${year}/roll${String(rollNumber).padStart(3, "0")}.xml`;
  }
  return `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${String(rollNumber).padStart(5, "0")}.xml`;
}

function acquisitionNames(acquisition: OfficialAcquisition, url: string): boolean {
  return acquisition.requestedUrl === url || acquisition.finalUrl === url;
}

export function federalRollCallsCandidate(input: {
  readonly acquisitions: readonly OfficialAcquisition[];
  readonly retrievedAt: string;
  readonly expectedCongress: number;
  readonly expectedSession: number;
  readonly snapshot: VotesSnapshot;
  readonly billSummaries: BillSummariesFile;
}): RoutineCandidate {
  const { snapshot } = input;
  const voteIds = new Set(snapshot.votes.map((vote) => vote.id));
  const expectedVoteIds = new Set([
    ...snapshot.window.houseRolls.map((roll) => `house:${snapshot.congress}-${snapshot.session}:${roll}`),
    ...snapshot.window.senateRolls.map((roll) => `senate:${snapshot.congress}-${snapshot.session}:${roll}`),
  ]);
  const issues = acquisitionIssues("FEDERAL_ROLL_CALL", input.acquisitions);
  if (voteIds.size !== snapshot.votes.length) issues.push("DUPLICATE_ROLL_CALL_ID");
  if (voteIds.size !== expectedVoteIds.size || [...expectedVoteIds].some((id) => !voteIds.has(id))) issues.push("DECLARED_ROLL_WINDOW_NOT_RECONCILED");
  if (snapshot.positions.some((position) => !voteIds.has(position.voteId))) issues.push("POSITION_POINTS_OUTSIDE_ROLL_WINDOW");
  if (snapshot.votes.some((vote) => vote.congress !== snapshot.congress || vote.session !== snapshot.session)) issues.push("ROLL_PERIOD_MISMATCH");
  if (snapshot.votes.some((vote) => !vote.rollCallUrl || !vote.question || !vote.result || !vote.retrievedAt)) issues.push("ROLL_REQUIRED_FACT_MISSING");
  if (snapshot.votes.some((vote) => !input.acquisitions.some((acquisition) => acquisitionNames(
    acquisition,
    rollAcquisitionUrl(vote.chamber, vote.congress, vote.session, vote.rollNumber),
  )))) issues.push("ROLL_ACQUISITION_RECEIPT_MISSING");
  const readModel: FederalRollCallsReadModel = { formatVersion: 1, snapshot, billSummaries: input.billSummaries };
  const normalizedPayload = {
    acquisitions: input.acquisitions.map(({ requestedUrl, finalUrl, httpStatus, body }) => ({ requestedUrl, finalUrl, httpStatus, rawHash: sha256(body), byteCount: Buffer.byteLength(body) })),
    congress: snapshot.congress,
    session: snapshot.session,
  };
  const rawHash = acquisitionRawHash(input.acquisitions);
  return {
    id: candidateId(FEDERAL_ROLLCALL_SCOPE, input.acquisitions, input.retrievedAt),
    sourceId: FEDERAL_VOTES_SOURCE_ID,
    recordClass: "FEDERAL_ROLL_CALL",
    scope: FEDERAL_ROLLCALL_SCOPE,
    retrieval: {
      succeeded: input.acquisitions.length > 0 && issues.every((issue) => !/^(?:FINAL_|SOURCE_|HTTP_|EMPTY_BODY)/.test(issue)),
      requestedUrl: input.acquisitions[0]?.requestedUrl ?? "https://clerk.house.gov/",
      finalUrl: input.acquisitions[0]?.finalUrl ?? null,
      httpStatus: input.acquisitions[0]?.httpStatus ?? null,
      retrievedAt: input.retrievedAt,
      rawHash: input.acquisitions.length > 0 ? rawHash : null,
      failureDetail: input.acquisitions.length > 0 ? undefined : "No official chamber response was acquired.",
    },
    normalization: {
      succeeded: true,
      parserVersion: FEDERAL_VOTES_PARSER_VERSION,
      schemaVersion: `federal-rollcalls:${snapshot.congress}-${snapshot.session}`,
      normalizedHash: canonicalCivicDataHash(readModel),
      normalizedPayloadHash: canonicalCivicDataHash(normalizedPayload),
      inputRecords: snapshot.votes.length,
      outputRecords: snapshot.votes.length,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: snapshot.votes.map((vote) => ({
      subjectId: vote.id,
      jurisdiction: "US",
      identifiers: { roll_call_id: vote.id },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
      chamber: vote.chamber,
      term: String(vote.congress),
      session: String(vote.session),
    })),
    temporal: {
      version: `${snapshot.congress}-${snapshot.session}`,
      expectedVersion: `${input.expectedCongress}-${input.expectedSession}`,
      sourceThrough: latestVoteInstant(snapshot),
      staleAtRetrieval: false,
    },
    semantics: { factKind: "official federal chamber roll calls and recorded member positions", violations: issues },
    horizon: {
      kind: "BOUNDED",
      query: `${snapshot.window.houseRolls.length} declared House rolls plus ${snapshot.window.senateRolls.length} declared Senate rolls`,
      returnedRecords: snapshot.votes.length,
      declaredTotal: expectedVoteIds.size,
      paginationComplete: true,
      claimsComplete: true,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    sourceProjectionEvidence: sourceProjectionEvidence(FEDERAL_VOTES_SOURCE_ID, "FEDERAL_ROLL_CALL", FEDERAL_ROLLCALL_SCOPE),
    dependentChecks: [
      { consumer: "app/api/votes/route.ts", passed: snapshot.votes.length > 0 && snapshot.positions.length > 0, detail: `${snapshot.votes.length} roll calls and ${snapshot.positions.length} exact positions.` },
      { consumer: "app/api/reactions/route.ts", passed: voteIds.size > 0, detail: `${voteIds.size} exact reaction target ids.` },
    ],
    normalizedPayload,
    readModel,
  };
}

function physicalRef(entryId: string, chamber: "house" | "senate", ref: KeyVoteEntry["house"][number]): string {
  return `${entryId}|${chamber}|${ref.congress}-${ref.session}:${ref.rollNumber}`;
}

export function federalKeyVotesCandidate(input: {
  readonly acquisitions: readonly OfficialAcquisition[];
  readonly retrievedAt: string;
  readonly snapshot: FederalKeyVotesSnapshot;
  readonly positions: FederalKeyVotePositions;
}): RoutineCandidate {
  const refs = input.snapshot.entries.flatMap((entry) => ([
    ...entry.house.map((ref) => ({ entryId: entry.id, chamber: "house" as const, ref })),
    ...entry.senate.map((ref) => ({ entryId: entry.id, chamber: "senate" as const, ref })),
  ]));
  const refKeys = refs.map(({ entryId, chamber, ref }) => physicalRef(entryId, chamber, ref));
  const held = new Set(Object.keys(input.positions.positions));
  const issues = acquisitionIssues("FEDERAL_KEY_VOTE", input.acquisitions);
  const selectionIssue = federalKeyVoteSelectionV1Issue(input.snapshot);
  if (selectionIssue) issues.push(selectionIssue);
  if (new Set(input.snapshot.entries.map((entry) => entry.id)).size !== input.snapshot.entries.length) issues.push("DUPLICATE_KEY_QUESTION_ID");
  const selectionMissKeys = input.snapshot.misses.map((miss) => `${miss.id}:${miss.chamber}`);
  if (input.snapshot.misses.some((miss) => !miss.id || !["house", "senate"].includes(miss.chamber) || !miss.reason.trim())) {
    issues.push("KEY_VOTE_SELECTION_MISS_REQUIRED_FACT_MISSING");
  }
  if (new Set(selectionMissKeys).size !== selectionMissKeys.length) issues.push("DUPLICATE_KEY_VOTE_SELECTION_MISS");
  const lawMisses = input.snapshot.lawMisses ?? [];
  if (lawMisses.some((miss) => !miss.id || !miss.reason.trim())) issues.push("KEY_VOTE_LAW_MISS_REQUIRED_FACT_MISSING");
  if (new Set(lawMisses.map(({ id }) => id)).size !== lawMisses.length) issues.push("DUPLICATE_KEY_VOTE_LAW_MISS");
  if (new Set(refKeys).size !== refKeys.length) issues.push("DUPLICATE_KEY_VOTE_REFERENCE");
  if (refs.some(({ ref }) => !ref.url || !ref.question || !ref.tally || !ref.verifiedAt)) issues.push("OFFICIAL_KEY_VOTE_FACT_MISSING");
  if (refs.some(({ ref }) => !ref.url || !input.acquisitions.some((acquisition) => acquisitionNames(acquisition, ref.url!)))) {
    issues.push("SELECTED_ROLL_ACQUISITION_RECEIPT_MISSING");
  }
  if (refKeys.some((key) => !held.has(key))) issues.push("SELECTED_ROLL_NOT_ACQUIRED");
  if ([...held].some((key) => !refKeys.includes(key))) issues.push("POSITION_MAP_OUTSIDE_REVIEWED_SELECTION");
  const readModel: FederalKeyVotesReadModel = {
    formatVersion: 1,
    selectionVersion: "v1",
    snapshot: input.snapshot,
    positions: input.positions,
  };
  const normalizedPayload = {
    selectionVersion: "v1",
    acquisitions: input.acquisitions.map(({ requestedUrl, finalUrl, httpStatus, body }) => ({ requestedUrl, finalUrl, httpStatus, rawHash: sha256(body), byteCount: Buffer.byteLength(body) })),
  };
  const rawHash = acquisitionRawHash(input.acquisitions);
  return {
    id: candidateId(FEDERAL_KEY_VOTE_SCOPE, input.acquisitions, input.retrievedAt),
    sourceId: FEDERAL_VOTES_SOURCE_ID,
    recordClass: "FEDERAL_KEY_VOTE",
    scope: FEDERAL_KEY_VOTE_SCOPE,
    retrieval: {
      succeeded: input.acquisitions.length > 0 && issues.every((issue) => !/^(?:FINAL_|SOURCE_|HTTP_|EMPTY_BODY)/.test(issue)),
      requestedUrl: input.acquisitions[0]?.requestedUrl ?? "https://www.senate.gov/legislative/",
      finalUrl: input.acquisitions[0]?.finalUrl ?? null,
      httpStatus: input.acquisitions[0]?.httpStatus ?? null,
      retrievedAt: input.retrievedAt,
      rawHash: input.acquisitions.length > 0 ? rawHash : null,
      failureDetail: input.acquisitions.length > 0 ? undefined : "No selected official roll-call response was acquired.",
    },
    normalization: {
      succeeded: true,
      parserVersion: FEDERAL_VOTES_PARSER_VERSION,
      schemaVersion: "federal-key-votes:selection-v1",
      normalizedHash: canonicalCivicDataHash(readModel),
      normalizedPayloadHash: canonicalCivicDataHash(normalizedPayload),
      inputRecords: refs.length,
      outputRecords: refs.length,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: refs.map(({ entryId, chamber, ref }) => ({
      subjectId: physicalRef(entryId, chamber, ref),
      jurisdiction: "US",
      identifiers: { entry_id: entryId, roll_call_id: `${chamber}:${ref.congress}-${ref.session}:${ref.rollNumber}` },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
      chamber,
      term: String(ref.congress),
      session: String(ref.session),
    })),
    temporal: {
      version: "v1",
      expectedVersion: "v1",
      sourceThrough: input.retrievedAt,
      staleAtRetrieval: false,
    },
    semantics: { factKind: "official facts and exact member positions for the reviewed key-question selection v1", violations: issues },
    horizon: {
      kind: "BOUNDED",
      query: `every official chamber roll selected by key-question version v1`,
      returnedRecords: refs.length,
      declaredTotal: refs.length,
      paginationComplete: true,
      claimsComplete: true,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    sourceProjectionEvidence: sourceProjectionEvidence(FEDERAL_VOTES_SOURCE_ID, "FEDERAL_KEY_VOTE", FEDERAL_KEY_VOTE_SCOPE),
    dependentChecks: [
      { consumer: "lib/votes/key-votes-reader.ts", passed: input.snapshot.entries.length > 0 && refs.length > 0, detail: `${input.snapshot.entries.length} questions and ${refs.length} selected chamber rolls.` },
      { consumer: "lib/ask/key-votes.ts", passed: refKeys.every((key) => held.has(key)), detail: `${held.size}/${refKeys.length} selected rolls carry official position maps.` },
    ],
    normalizedPayload,
    readModel,
  };
}
