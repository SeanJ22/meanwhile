import { DOTGOV_SCOPE, DOTGOV_PARSER_VERSION, dotGovSnapshotIssues, type DotGovSnapshot } from "./dotgov.ts";
import { mergeStatePeople } from "../state-rollcalls/legislators.ts";
import { createHash } from "node:crypto";

import type { FundingSnapshot } from "../funding/types.ts";
import type { AcsNationalLoad, AcsLoadCounts } from "../sources/census-acs-population/national.ts";
import { acsPayloadHash } from "../sources/census-acs-population/hash.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { AcsFetch, AcsPopulationRow } from "../sources/census-acs-population/index.ts";
import { BASE as CENSUS_ACS_BASE, VINTAGE_YEAR, normalize as normalizeAcs } from "../sources/census-acs-population/index.ts";
import type { MembersExtraction } from "../../scripts/nh-gencourt-members.mts";
import type {
  StateLegislatorVotePosition,
  StateLegislatorVotes,
  StateLegislatorVotesSessionMarker,
  StateMemberVote,
  StateRollCall,
  StateVotesSnapshot,
} from "../sources/legiscan/types.ts";
import type { NhCurrentMemberIdentityCrosswalk } from "../sources/nh-general-court/official-data.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import {
  officialStateLegislatorTargetByScope,
  officialStateOfficeholderId,
  type OfficialStateRollCallSourceId,
  type OfficialStateVoteScope,
} from "../state-rollcalls/authority.ts";
import {
  sourceProjectionEvidence,
  type IdentityEvidence,
  type RoutineCandidate,
  type RoutineRecordClass,
} from "./types.ts";

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function normalizedHash(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("NORMALIZED_VALUE_NOT_DURABLE_JSON");
  return sha256(canonical(JSON.parse(encoded) as unknown));
}

function candidateId(sourceId: string, scope: string, rawHash: string, retrievedAt: string): string {
  return `cv-${sha256(`${sourceId}\u001f${scope}\u001f${rawHash}\u001f${retrievedAt}`).slice(0, 32)}`;
}

export function failedAcquisitionCandidate(input: {
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly requestedUrl: string;
  readonly attemptedAt: string;
  readonly failureDetail: string;
  readonly parserVersion: string;
}): RoutineCandidate {
  const attemptKey = sha256(`${input.requestedUrl}\u001f${input.failureDetail}`);
  return {
    id: candidateId(input.sourceId, input.scope, `blocked-${attemptKey}`, input.attemptedAt),
    sourceId: input.sourceId,
    recordClass: input.recordClass,
    scope: input.scope,
    sourceProjectionEvidence: sourceProjectionEvidence(input.sourceId, input.recordClass, input.scope),
    retrieval: {
      succeeded: false,
      requestedUrl: input.requestedUrl,
      finalUrl: null,
      httpStatus: null,
      retrievedAt: input.attemptedAt,
      rawHash: null,
      failureDetail: input.failureDetail,
    },
    normalization: {
      succeeded: false,
      parserVersion: input.parserVersion,
      schemaVersion: "unread",
      normalizedHash: null,
      inputRecords: 0,
      outputRecords: 0,
      droppedRecords: 0,
      missingRequiredFields: [],
      failureDetail: "No authoritative bytes reached the normalizer.",
    },
    identities: [],
    temporal: {
      version: "UNKNOWN",
      expectedVersion: "UNKNOWN",
      sourceThrough: input.attemptedAt,
      staleAtRetrieval: false,
    },
    semantics: { factKind: "source acquisition attempt", violations: [] },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: input.requestedUrl,
      returnedRecords: 0,
      declaredTotal: null,
      paginationComplete: false,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{
      consumer: "Reader last-known-good projection",
      passed: true,
      detail: "The failed acquisition cannot replace or clear the promoted pointer.",
    }],
    normalizedPayload: null,
    readModel: null,
  };
}

export interface PromotedAcsPopulation {
  readonly formatVersion: 1;
  readonly vintage: number;
  readonly zcta: readonly AcsPopulationRow[];
  readonly state: readonly AcsPopulationRow[];
  readonly geographies?: readonly AcsPopulationRow[];
  readonly counts?: readonly AcsLoadCounts[];
}

export function censusAcsCandidate(zctaFetch: AcsFetch, stateFetch: AcsFetch, national?: AcsNationalLoad): RoutineCandidate {
  const vintage = national?.release.vintage ?? zctaFetch.vintage ?? VINTAGE_YEAR;
  const product = `ACSDT5Y${vintage}`;
  const rows = national?.rows ?? [...normalizeAcs(zctaFetch), ...normalizeAcs(stateFetch)];
  const zcta = national ? rows.filter(row => row.geography === "zcta") : normalizeAcs(zctaFetch);
  const state = national ? rows.filter(row => row.geography === "state") : normalizeAcs(stateFetch);
  const readModel: PromotedAcsPopulation = { formatVersion: 1, vintage, zcta, state,
    ...(national ? { geographies: rows.filter(row => !["zcta", "state"].includes(row.geography!)), counts: national.counts } : {}) };
  const normalizedPayload = { product, table: "B01003", ...readModel };
  const captures = national?.captures ?? [zctaFetch, stateFetch];
  const rawHash = sha256(captures.map(capture => sha256(capture.rawText ?? JSON.stringify(capture.rows))).join("\n"));
  const retrievedAt = captures.map(capture => capture.fetchedAt).sort().at(-1)!;
  const violations: string[] = [];
  const expectedStates = Object.entries(FIPS_TO_STATE).filter(([, value]) => value.prefix === "state" || ["DC", "PR"].includes(value.postal)).map(([fips]) => fips);
  if (expectedStates.some(fips => !state.some(row => row.code === fips))) violations.push("The ACS state table is missing a state, DC or Puerto Rico.");
  if (new Set(rows.map(row => `${row.geography ?? (row.code.length === 2 ? "state" : "zcta")}:${row.code}`)).size !== rows.length) violations.push("Census geography identifiers repeat within a scope.");
  const count = rows.length;
  return {
    id: candidateId("census-data-api", "acs-population", rawHash, retrievedAt),
    sourceId: "census-data-api", recordClass: "CENSUS_REFERENCE", scope: "acs-population",
    sourceProjectionEvidence: sourceProjectionEvidence("census-data-api", "CENSUS_REFERENCE", "acs-population"),
    retrieval: { succeeded: true, requestedUrl: zctaFetch.url, finalUrl: zctaFetch.finalUrl ?? CENSUS_ACS_BASE,
      httpStatus: captures.every(capture => capture.status === 200 || capture.status === 204) ? 200 : null, retrievedAt, rawHash },
    normalization: { succeeded: true, parserVersion: "census-data-api/3", schemaVersion: `${product}:B01003_001E+B01003_001M`,
      normalizedHash: acsPayloadHash(readModel), normalizedPayloadHash: acsPayloadHash(normalizedPayload),
      inputRecords: count, outputRecords: count, droppedRecords: 0, missingRequiredFields: [] },
    identities: rows.map(row => ({ subjectId: `${row.geography ?? (row.code.length === 2 ? "state-fips" : "zcta")}:${row.code}`,
      jurisdiction: "US", identifiers: { product, vintage: String(vintage), geography: row.code }, matchBasis: "OFFICIAL_ID" as const, ambiguous: false })),
    temporal: { version: String(vintage), expectedVersion: String(vintage), sourceThrough: String(vintage), staleAtRetrieval: false },
    semantics: { factKind: "ACS five-year population estimate and 90% margin for the exact Census geography", violations },
    horizon: { kind: "BOUNDED", query: `Complete wildcard ACS5 ${vintage} geography tables; all returned rows retained`, returnedRecords: count,
      declaredTotal: count, paginationComplete: true, claimsComplete: true },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "lib/reference/acs-population.ts", passed: zcta.length >= 30_000 && state.length >= 50 && violations.length === 0,
      detail: `${count} rows; ${national?.counts.reduce((sum, row) => sum + row.unjoined, 0) ?? "unmeasured"} unjoined rows retained.` }],
    normalizedPayload, readModel,
  };
}

export interface NhMemberReadModel {
  readonly memberSourceDates?: Readonly<Record<string,string>>;
  readonly formatVersion: 1;
  readonly jurisdiction: "US-NH";
  readonly term: string;
  readonly members: MembersExtraction["members"];
  readonly identities: readonly {
    readonly officeholderId: string;
    readonly officialPersonId: string;
    readonly chamber: string;
    readonly district: string;
    readonly seatNo: string;
  }[];
  readonly officialIdentityAuthority?: {
    readonly sourceUrl: string;
    readonly sourceVersion: string;
    readonly observedIdentityRows: number;
    readonly ordinaryMatches: number;
    readonly reviewedExceptionMatches: number;
  };
}

export interface OfficialStateLegislatorReadModel {
  readonly formatVersion: 1;
  readonly sourceId: string;
  readonly jurisdiction: `US-${string}`;
  readonly term: string;
  readonly generatedAt: string;
  readonly roster: OfficeholderSet;
  readonly sourceAudit?: {
    readonly observedRecords: number;
    readonly excludedRecords: readonly {
      readonly officialPersonId: string;
      readonly chamber: "lower" | "upper";
      readonly disposition: string;
      readonly sourceUrl: string;
    }[];
    readonly legislature: number;
    readonly session: number | null;
  };
}

const NH_MEMBERS_SUPPORTED_TERM = "2025-2026";
const NH_MEMBERS_SUPPORTED_UNTIL = Date.parse("2026-12-01T00:00:00.000Z");
export const NH_MEMBER_CHAMBER_FLOORS = { H: 350, S: 20 } as const;


export function expectedNhMembersTerm(retrievedAt: string): string {
  const instant = Date.parse(retrievedAt);
  if (!Number.isFinite(instant)) return "INVALID_RETRIEVAL_DATE";
  if (instant < NH_MEMBERS_SUPPORTED_UNTIL) return NH_MEMBERS_SUPPORTED_TERM;
  const year = new Date(instant).getUTCFullYear();
  const start = year % 2 === 1 ? year : year + 1;
  return `${start}-${start + 1}`;
}


export function nhMemberOfficialPersonId(member: MembersExtraction["members"][number]): string {
  return sha256(canonical({
    chamber: member.chamber,
    seatNo: member.seatNo,
    district: member.district,
    familyName: member.familyName,
    givenName: member.givenName,
    middleName: member.middleName,
  })).slice(0, 24);
}

export function nhMemberOfficeholderId(member: MembersExtraction["members"][number]): string {
  return officialStateOfficeholderId("nh-general-court", nhMemberOfficialPersonId(member));
}

export function trustedNhMembersImportReadModel(
  members: MembersExtraction["members"],
  term: string,
): NhMemberReadModel {
  const current = members.filter((member) =>
    member.electedStatus === "INCUMBENT" || member.electedStatus === "NEW"
  );
  const identities = current.map((member) => ({
    officeholderId: nhMemberOfficeholderId(member),
    officialPersonId: nhMemberOfficialPersonId(member),
    chamber: member.chamber,
    district: member.district,
    seatNo: member.seatNo,
  }));
  const unique = (values: readonly string[]) => new Set(values).size === values.length;
  if (
    !unique(identities.map(({ officeholderId }) => officeholderId)) ||
    !unique(identities.map(({ officialPersonId }) => officialPersonId)) ||
    !unique(identities.map(({ chamber, seatNo, district }) => `${chamber}\u0000${seatNo}\u0000${district}`))
  ) {
    throw new Error("NH_TRUSTED_IMPORT_IDENTITY_NOT_ONE_TO_ONE");
  }
  return {
    formatVersion: 1,
    jurisdiction: "US-NH",
    term,
    members: current,
    identities,
  };
}

export function trustedNhMembersImportIdentityEvidence(
  members: MembersExtraction["members"],
  term: string,
): readonly IdentityEvidence[] {
  const readModel = trustedNhMembersImportReadModel(members, term);
  return readModel.members.map((member, index) => {
    const identity = readModel.identities[index];
    if (
      !identity ||
      identity.chamber !== member.chamber ||
      identity.seatNo !== member.seatNo ||
      identity.district !== member.district
    ) throw new Error("NH_TRUSTED_IMPORT_IDENTITY_MEMBER_MISMATCH");
    return {
      subjectId: identity.officeholderId,
      jurisdiction: "US-NH",
      identifiers: {
        seatNo: member.seatNo,
        officialPersonId: identity.officialPersonId,
        chamber: member.chamber,
        district: member.district,
        ...(member.email ? { officialEmail: member.email } : {}),
      },
      matchBasis: "EXACT_SCOPED_ID" as const,
      ambiguous: false,
      chamber: member.chamber,
      office: member.title ?? (member.chamber === "S" ? "Senator" : "Representative"),
      term,
      district: member.district,
    };
  });
}

export interface OfficialStateIdentityAuthorityInputs {
  readonly contractId: string;
  readonly versionId: string;
  readonly currentOfficeholderIds: readonly string[];
  readonly sessionParticipantIds: readonly string[];
  readonly sessionParticipantSourceVersion: string;
  readonly sessionParticipantAudit?: {
    readonly historyParticipantCount: number;
    readonly legislatorsIdentityCount: number;
    readonly enrichedParticipantCount: number;
    readonly historyOnlyParticipantCount: number;
    readonly historyOnlyPersonIds: readonly string[];
  };
}

export function officialStateIdentityAuthorityEvidence(input: {
  readonly sourceId: OfficialStateRollCallSourceId;
  readonly jurisdiction: OfficialStateVoteScope;
  readonly term: string;
  readonly session: string;
  readonly identityAuthority: OfficialStateIdentityAuthorityInputs;
}): NonNullable<StateVotesSnapshot["officialIdentityAuthority"]> {
  const rosterIdsSorted = [...new Set(input.identityAuthority.currentOfficeholderIds)].sort();
  const participantIdsSorted = [...new Set(input.identityAuthority.sessionParticipantIds)].sort();
  return {
    contractId: input.identityAuthority.contractId,
    sourceId: input.sourceId,
    scope: input.jurisdiction,
    versionId: input.identityAuthority.versionId,
    currentOfficeholderIdsSha256: sha256(canonical(rosterIdsSorted)),
    sessionParticipantSet: {
      term: input.term,
      session: input.session,
      sourceVersion: input.identityAuthority.sessionParticipantSourceVersion,
      count: participantIdsSorted.length,
      officeholderIdsSha256: sha256(canonical(participantIdsSorted)),
      ...(input.identityAuthority.sessionParticipantAudit
        ? { audit: input.identityAuthority.sessionParticipantAudit }
        : {}),
    },
  };
}


export function officialStateRollCallsCandidate(input: {
  readonly sourceId: OfficialStateRollCallSourceId;
  readonly jurisdiction: OfficialStateVoteScope;
  readonly rawBodies: readonly string[];
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly retrievedAt: string;
  readonly term: string;
  readonly expectedTerm: string;
  readonly session: string;
  readonly rolls: readonly (StateRollCall & {
    readonly sourceId: OfficialStateRollCallSourceId;
    readonly officialRollCallId: string;
    readonly eventId: string;
    readonly chamber: "House" | "Senate" | "Assembly";
    readonly term: string;
    readonly session: string;
    readonly actionStage: string;
    readonly expectedActionStage: string;
  })[];
  readonly positions: readonly (Omit<StateMemberVote, "legiscanPeopleId" | "officialPersonId" | "publisherPosition"> & {
    readonly officialPersonId: string;
    /** Exact publisher value; an empty string is valid evidence, not absence. */
    readonly publisherPosition: string;
  })[];
  readonly declaredRollTotal: number;
  readonly sourceReconciliation?: NonNullable<StateVotesSnapshot["officialSourceReconciliation"]>;
  readonly horizonAudit?: StateVotesSnapshot["officialHorizonAudit"];
  readonly identityAuthority: {
    readonly contractId: string;
    readonly versionId: string;
    readonly currentOfficeholderIds: readonly string[];
    readonly sessionParticipantIds: readonly string[];
    readonly sessionParticipantSourceVersion: string;
    readonly sessionParticipantAudit?: {
      readonly historyParticipantCount: number;
      readonly legislatorsIdentityCount: number;
      readonly enrichedParticipantCount: number;
      readonly historyOnlyParticipantCount: number;
      readonly historyOnlyPersonIds: readonly string[];
    };
  };
}): RoutineCandidate {
  const rosterTarget = officialStateLegislatorTargetByScope(input.jurisdiction);
  const rawHash = sha256(input.rawBodies.map((body) => sha256(body)).join("\n"));
  const rollIds = new Set(input.rolls.map((roll) => roll.id));
  const people = new Set(input.positions.map((position) => position.officialPersonId));
  const rosterIds = new Set(input.identityAuthority.currentOfficeholderIds);
  const participantIds = new Set(input.identityAuthority.sessionParticipantIds);
  const participantIdsSorted = [...participantIds].sort();
  const violations: string[] = [];
  if (input.sourceReconciliation && (
    input.sourceReconciliation.rollCount !== input.rolls.length ||
    input.sourceReconciliation.positionCount !== input.positions.length ||
    input.sourceReconciliation.exactPublisherCategoryMatches + input.sourceReconciliation.publisherCategoryDrift.length !== input.rolls.length ||
    new Set(input.sourceReconciliation.publisherCategoryDrift.map((row) => row.officialRollCallId)).size !== input.sourceReconciliation.publisherCategoryDrift.length ||
    input.sourceReconciliation.publisherCategoryDrift.some((row) => !input.rolls.some((roll) => roll.officialRollCallId === row.officialRollCallId))
  )) {
    violations.push("The official source reconciliation audit does not account for every roll and member position.");
  }
  if (
    !rosterTarget ||
    rosterTarget.sourceId !== input.sourceId ||
    rosterTarget.contractId !== input.identityAuthority.contractId
  ) {
    violations.push("The roll-call member join cites the wrong official roster authority.");
  }
  if (input.identityAuthority.versionId.trim() === "") {
    violations.push("The roll-call member join does not cite an exact promoted roster version.");
  }
  if (rosterIds.size !== input.identityAuthority.currentOfficeholderIds.length) {
    violations.push("The cited official roster repeats an officeholder identifier.");
  }
  if ([...rosterIds].some((id) => !id.startsWith(`${input.sourceId}:`))) {
    violations.push("The cited official roster includes an identifier from another authority.");
  }
  if (input.identityAuthority.sessionParticipantSourceVersion.trim() === "") {
    violations.push("The term/session participant authority has no exact source version.");
  }
  if (participantIds.size !== input.identityAuthority.sessionParticipantIds.length) {
    violations.push("The official term/session participant authority repeats an identifier.");
  }
  if (participantIds.size === 0 || [...participantIds].some((id) => !id.startsWith(`${input.sourceId}:`))) {
    violations.push("The official term/session participant authority is empty or includes another authority.");
  }
  const participantAudit = input.identityAuthority.sessionParticipantAudit;
  if (participantAudit && (
    participantAudit.historyParticipantCount !== participantIds.size ||
    participantAudit.historyOnlyParticipantCount !== participantAudit.historyOnlyPersonIds.length ||
    participantAudit.enrichedParticipantCount + participantAudit.historyOnlyParticipantCount !== participantAudit.historyParticipantCount ||
    new Set(participantAudit.historyOnlyPersonIds).size !== participantAudit.historyOnlyPersonIds.length ||
    participantAudit.historyOnlyPersonIds.some((personId) => !participantIds.has(officialStateOfficeholderId(input.sourceId, personId)))
  )) {
    violations.push("The official term/session participant enrichment audit does not reconcile to the exact participant set.");
  }
  if (input.rolls.some((roll) => roll.sourceId !== input.sourceId)) violations.push("A roll call inherits identity from a different publisher.");
  if (input.rolls.some((roll) => roll.actionStage !== roll.expectedActionStage)) violations.push("A roll call is attached to the wrong legislative action stage.");
  if (input.positions.some((position) => !rollIds.has(position.rollCallId))) violations.push("A member position points at a roll outside the official horizon.");
  if (input.rolls.some((roll) => roll.term !== input.term || roll.session !== input.session)) violations.push("A roll call belongs to a different term/session.");
  if (input.positions.some((position) =>
    position.officeholderId !== officialStateOfficeholderId(input.sourceId, position.officialPersonId)
  )) {
    violations.push("A member position is not keyed by the exact source-namespaced official person identifier.");
  }
  if (input.positions.some((position) => !participantIds.has(position.officeholderId))) {
    violations.push("A member position is not present in the exact official term/session participant set cited by this acquisition.");
  }
  if (input.positions.some((position) => position.publisherPosition === undefined)) {
    violations.push("A member position omits the exact publisher label.");
  }
  if (input.positions.some((position) => position.publisherPosition === "" && position.position !== "UNKNOWN")) {
    violations.push("A blank publisher label was coerced into a substantive voting disposition.");
  }
  if (input.sourceId === "nj-legislature" && !input.horizonAudit) {
    violations.push("The New Jersey roll candidate lacks the official API/archive exact-horizon audit.");
  }
  if (input.horizonAudit && (
    input.horizonAudit.authorityMode !== "API_ARCHIVE_EXACT_RECONCILIATION" ||
    input.horizonAudit.expectedParticipantRequests !== input.horizonAudit.completedParticipantRequests ||
    input.horizonAudit.apiRollCalls !== input.rolls.length ||
    input.horizonAudit.apiPositions !== input.positions.length ||
    input.horizonAudit.reconciledArchivePositions !== input.positions.length ||
    input.horizonAudit.archives.length === 0 ||
    new Set(input.horizonAudit.archives.map((row) => row.kind)).size !== input.horizonAudit.archives.length ||
    input.horizonAudit.archives.reduce((sum, row) => sum + row.rollCalls, 0) !== input.rolls.length ||
    input.horizonAudit.archives.reduce((sum, row) => sum + row.positions, 0) !== input.positions.length
  )) {
    violations.push("The official API/archive horizon audit does not reconcile to every roll and member position.");
  }
  if (input.sourceId === "nj-legislature" && input.horizonAudit) {
    const njKinds = [
      "ASSEMBLY_FLOOR",
      "SENATE_FLOOR",
      "ASSEMBLY_COMMITTEE",
      "SENATE_COMMITTEE",
    ] as const;
    const njLabels = ["Yes", "No", "Abstain", "No Vote", "Not Voting"] as const;
    const normalizedNjPosition = {
      Yes: "YES",
      No: "NO",
      Abstain: "ABSTAIN",
      "No Vote": "NOT_VOTING",
      "Not Voting": "NOT_VOTING",
    } as const;
    const archiveByKind = new Map(input.horizonAudit.archives.map((row) => [row.kind, row]));
    const assemblyFloor = archiveByKind.get("ASSEMBLY_FLOOR");
    const senateFloor = archiveByKind.get("SENATE_FLOOR");
    const assemblyCommittee = archiveByKind.get("ASSEMBLY_COMMITTEE");
    const senateCommittee = archiveByKind.get("SENATE_COMMITTEE");
    const termMatch = /^(\d{4})-(\d{4})$/.exec(input.term);
    const sessionYear = Number(termMatch?.[1]);
    const exactArchiveUrl = new Map<string, string>([
      ["ASSEMBLY_FLOOR", `https://pub.njleg.gov/votes/A${sessionYear}.zip`],
      ["SENATE_FLOOR", `https://pub.njleg.gov/votes/S${sessionYear}.zip`],
      ["ASSEMBLY_COMMITTEE", `https://pub.njleg.gov/votes/CA${sessionYear}-${sessionYear + 1}.zip`],
      ["SENATE_COMMITTEE", `https://pub.njleg.gov/votes/CS${sessionYear}-${sessionYear + 1}.zip`],
    ]);
    const positionsByRoll = new Map<string, typeof input.positions[number][]>();
    for (const position of input.positions) {
      positionsByRoll.set(position.rollCallId, [...(positionsByRoll.get(position.rollCallId) ?? []), position]);
    }
    const duplicatePositionKeys = input.positions.length - new Set(input.positions.map((position) =>
      `${position.rollCallId}\u0000${position.officeholderId}`
    )).size;
    const rollCountByKind = new Map<string, number>();
    const positionCountByKind = new Map<string, number>();
    let tallyOrVocabularyInvalid = duplicatePositionKeys !== 0 || input.positions.some((position) => {
      const expected = normalizedNjPosition[position.publisherPosition as keyof typeof normalizedNjPosition];
      return expected === undefined || position.position !== expected;
    });
    for (const roll of input.rolls) {
      const kind = roll.officialEventKind;
      const memberPositions = positionsByRoll.get(roll.id) ?? [];
      if (!kind || !(njKinds as readonly string[]).includes(kind)) {
        tallyOrVocabularyInvalid = true;
        continue;
      }
      rollCountByKind.set(kind, (rollCountByKind.get(kind) ?? 0) + 1);
      positionCountByKind.set(kind, (positionCountByKind.get(kind) ?? 0) + memberPositions.length);
      const publisherTally = roll.publisherTally;
      const tallyKeys = publisherTally ? Object.keys(publisherTally).sort() : [];
      const exactTallyKeys = [...njLabels].sort();
      const counted = Object.fromEntries(njLabels.map((label) => [
        label,
        memberPositions.filter((position) => position.publisherPosition === label).length,
      ])) as Record<(typeof njLabels)[number], number>;
      const assemblyKind = kind.startsWith("ASSEMBLY_");
      const floorSeats = kind === "ASSEMBLY_FLOOR" ? 80 : kind === "SENATE_FLOOR" ? 40 : null;
      if (
        roll.chamber !== (assemblyKind ? "Assembly" : "Senate") ||
        roll.rollCallUrl !== exactArchiveUrl.get(kind) ||
        (floorSeats !== null && memberPositions.length !== floorSeats) ||
        (floorSeats === null && memberPositions.length === 0) ||
        canonical(tallyKeys) !== canonical(exactTallyKeys) ||
        njLabels.some((label) => !Number.isSafeInteger(publisherTally?.[label]) || publisherTally?.[label] !== counted[label]) ||
        roll.yea !== counted.Yes ||
        roll.nay !== counted.No ||
        roll.absent !== counted["Not Voting"] ||
        roll.nv !== counted.Abstain + counted["No Vote"]
      ) {
        tallyOrVocabularyInvalid = true;
      }
    }
    const auditDoesNotBindRolls = njKinds.some((kind) => {
      const audit = archiveByKind.get(kind);
      return !audit ||
        audit.url !== exactArchiveUrl.get(kind) ||
        audit.rollCalls !== (rollCountByKind.get(kind) ?? 0) ||
        audit.positions !== (positionCountByKind.get(kind) ?? 0);
    });
    if (
      input.requestedUrl !== "https://www.njleg.state.nj.us/api/votingRecords" ||
      input.finalUrl !== "https://www.njleg.state.nj.us/api/votingRecords" ||
      input.httpStatus !== 200 ||
      !termMatch ||
      sessionYear % 2 !== 0 ||
      Number(termMatch?.[2]) !== sessionYear + 1 ||
      input.session !== `${input.term} Session` ||
      input.rawBodies.length !== 125 ||
      input.rawBodies.some((body) => body.trim() === "") ||
      input.horizonAudit.sessionIndexUrl !== "https://www.njleg.state.nj.us/api/votingRecords" ||
      input.horizonAudit.sessionDisplay !== input.session ||
      input.horizonAudit.expectedParticipantRequests !== 120 ||
      participantIds.size !== input.horizonAudit.expectedParticipantRequests ||
      archiveByKind.size !== 4 ||
      [assemblyFloor, senateFloor, assemblyCommittee, senateCommittee].some((row) =>
        !row || !/^https:\/\/pub\.njleg\.gov\/votes\/[A-Z0-9-]+\.zip$/.test(row.url) ||
        !/^[a-f0-9]{64}$/.test(row.sha256) || row.rollCalls <= 0 || row.positions <= 0
      ) ||
      assemblyFloor?.positions !== (assemblyFloor?.rollCalls ?? 0) * 80 ||
      senateFloor?.positions !== (senateFloor?.rollCalls ?? 0) * 40 ||
      (assemblyCommittee?.positions ?? 0) < (assemblyCommittee?.rollCalls ?? 0) ||
      (senateCommittee?.positions ?? 0) < (senateCommittee?.rollCalls ?? 0) ||
      auditDoesNotBindRolls ||
      tallyOrVocabularyInvalid
    ) {
      violations.push("The New Jersey source evidence does not prove the exact index, biennial session, four archive families, event classifications, publisher vocabulary, and reconciled per-roll tallies.");
    }
  }
  const readModel: StateVotesSnapshot = {
    generatedAt: input.retrievedAt,
    ...(input.sourceReconciliation ? { officialSourceReconciliation: input.sourceReconciliation } : {}),
    ...(input.horizonAudit ? { officialHorizonAudit: input.horizonAudit } : {}),
    officialIdentityAuthority: officialStateIdentityAuthorityEvidence({
      sourceId: input.sourceId,
      jurisdiction: input.jurisdiction,
      term: input.term,
      session: input.session,
      identityAuthority: input.identityAuthority,
    }),
    datasets: [{ state: input.jurisdiction.slice(-2), sessionId: 0, sessionName: `${input.term} ${input.session}`, datasetHash: rawHash, datasetDate: input.retrievedAt.slice(0, 10), downloadedAt: input.retrievedAt }],
    identifierMatch: {
      peopleSeen: people.size,
      peopleMatched: people.size,
      distinctOfficeholders: new Set(input.positions.map((position) => position.officeholderId)).size,
      byState: { [input.jurisdiction.slice(-2)]: { peopleSeen: people.size, peopleMatched: people.size, rollCalls: input.rolls.length } },
    },
    rollCalls: [...input.rolls],
    positions: input.positions.map((position) => ({ ...position, legiscanPeopleId: 0 })),
  };
  const normalizedPayload = {
    sourceId: input.sourceId,
    jurisdiction: input.jurisdiction,
    term: input.term,
    session: input.session,
    identityAuthority: readModel.officialIdentityAuthority,
    ...(input.sourceReconciliation ? { sourceReconciliation: input.sourceReconciliation } : {}),
    ...(input.horizonAudit ? { horizonAudit: input.horizonAudit } : {}),
    sessionParticipantIds: participantIdsSorted,
    rolls: input.rolls,
    positions: input.positions,
  };
  return {
    id: candidateId(input.sourceId, `${input.jurisdiction}:${input.term}:${input.session}`, rawHash, input.retrievedAt),
    sourceId: input.sourceId,
    recordClass: "STATE_ROLL_CALL",
    scope: input.jurisdiction,
    sourceProjectionEvidence: sourceProjectionEvidence(input.sourceId, "STATE_ROLL_CALL", input.jurisdiction),
    retrieval: { succeeded: input.rawBodies.length > 0 && input.httpStatus >= 200 && input.httpStatus < 300, requestedUrl: input.requestedUrl, finalUrl: input.finalUrl, httpStatus: input.httpStatus, retrievedAt: input.retrievedAt, rawHash: input.rawBodies.length > 0 ? rawHash : null, failureDetail: input.rawBodies.length > 0 ? undefined : "No official roll-call bytes were acquired." },
    normalization: { succeeded: true, parserVersion: input.sourceId === "nh-general-court" ? "nh-general-court/3" : `${input.sourceId}/2`, schemaVersion: `official-roll-call:${input.term}:${input.session}:participant-authority-v2`, normalizedHash: normalizedHash(readModel), normalizedPayloadHash: normalizedHash(normalizedPayload), inputRecords: input.rolls.length + input.positions.length, outputRecords: input.rolls.length + input.positions.length, droppedRecords: 0, missingRequiredFields: input.rolls.some((roll) => !roll.officialRollCallId || !roll.eventId || !roll.chamber || !roll.term || !roll.session) ? ["roll/event/chamber/term/session"] : [] },
    identities: input.rolls.map((roll) => ({
      subjectId: roll.id,
      jurisdiction: input.jurisdiction,
      identifiers: { rollCallId: roll.officialRollCallId, eventId: roll.eventId },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
      chamber: roll.chamber,
      term: roll.term,
      session: roll.session,
    })),
    temporal: { version: input.term, expectedVersion: input.expectedTerm, sourceThrough: input.rolls.map((roll) => roll.date).sort().at(-1) ?? input.retrievedAt, staleAtRetrieval: input.term !== input.expectedTerm },
    semantics: { factKind: "official state-legislature roll-call decision", actionStage: input.rolls[0]?.actionStage, expectedActionStage: input.rolls[0]?.expectedActionStage, violations },
    horizon: { kind: "BOUNDED", query: `${input.sourceId} ${[...new Set(input.rolls.map((roll) => roll.chamber))].join("+") || "all chambers"} ${input.term} ${input.session} official rolls plus exact member-position horizon`, returnedRecords: input.rolls.length + input.positions.length, declaredTotal: input.declaredRollTotal + input.positions.length, paginationComplete: true, claimsComplete: true },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      { consumer: "lib/sources/legiscan/snapshot.ts compatibility projection", passed: input.rolls.length > 0 && input.positions.every((position) => rollIds.has(position.rollCallId)), detail: `${input.rolls.length} rolls and ${input.positions.length} exact member positions.` },
      { consumer: "official state-legislator identity authority", passed: violations.length === 0, detail: `Current roster cites ${input.identityAuthority.contractId} at exact promoted version ${input.identityAuthority.versionId}; ${participantIds.size} exact ${input.term} ${input.session} participants authorize historical positions.` },
      {
        consumer: "grounded Ask state-vote records",
        passed: input.rolls.every((roll) => Boolean(roll.motion && roll.rollCallUrl)),
        detail: "Every roll retains the publisher's exact motion and an official roll-record source; procedural non-bill rolls are not discarded.",
      },
    ],
    normalizedPayload,
    readModel,
  };
}

export function officialStateLegislatorVotesCandidate(input: {
  readonly sourceId: OfficialStateRollCallSourceId;
  readonly jurisdiction: OfficialStateVoteScope;
  readonly officeholderId: string;
  readonly chamber: StateRollCall["chamber"] | null;
  readonly term: string;
  readonly session: string;
  readonly positions: readonly StateLegislatorVotePosition[];
  readonly rollCalls?: readonly StateRollCall[];
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly retrievedAt: string;
  readonly identityAuthority: NonNullable<StateVotesSnapshot["officialIdentityAuthority"]>;
}): RoutineCandidate {
  const scope = input.officeholderId;
  const positions = [...input.positions].sort((left, right) => left.rollCallId.localeCompare(right.rollCallId));
  const parserVersion = input.sourceId === "nh-general-court" ? "nh-general-court/3" : `${input.sourceId}/2`;
  // The candidate id is a content address over this member's own sorted votes,
  // so an unchanged member yields the same id and never re-promotes.
  const rawHash = sha256(canonical({ officeholderId: input.officeholderId, positions, rollCalls: input.rollCalls }));
  const readModel: StateLegislatorVotes = {
    generatedAt: input.retrievedAt,
    officeholderId: input.officeholderId,
    sourceId: input.sourceId,
    jurisdiction: input.jurisdiction,
    chamber: input.chamber,
    term: input.term,
    session: input.session,
    positions,
    ...(input.rollCalls ? { rollCalls: input.rollCalls } : {}),
    officialIdentityAuthority: input.identityAuthority,
  };
  const normalizedPayload = { officeholderId: input.officeholderId, term: input.term, session: input.session, positionCount: positions.length };
  const throughDate = positions.map((position) => position.date).filter(Boolean).sort().at(-1) ?? input.retrievedAt.slice(0, 10);
  const violations: string[] = [];
  if (!input.officeholderId.startsWith(`${input.sourceId}:`)) violations.push("The member id is not source-namespaced to its publisher authority.");
  if (new Set(positions.map((position) => position.rollCallId)).size !== positions.length) violations.push("A member records two positions on the same roll call.");
  if (input.rollCalls && (input.rollCalls.length !== positions.length ||
    new Set(input.rollCalls.map(roll => roll.id)).size !== input.rollCalls.length ||
    input.rollCalls.some(roll => roll.sourceId !== input.sourceId || roll.term !== input.term || roll.session !== input.session ||
      !positions.some(position => position.rollCallId === roll.id && position.date === roll.date)))) {
    violations.push("A member's roll metadata does not match the same native source, session and dated positions.");
  }
  const succeeded = positions.length > 0 && input.httpStatus >= 200 && input.httpStatus < 300;
  return {
    id: candidateId(input.sourceId, scope, rawHash, input.retrievedAt),
    sourceId: input.sourceId,
    recordClass: "STATE_LEGISLATOR_VOTES",
    scope,
    sourceProjectionEvidence: sourceProjectionEvidence(input.sourceId, "STATE_LEGISLATOR_VOTES", scope),
    retrieval: {
      succeeded,
      requestedUrl: input.requestedUrl,
      finalUrl: input.finalUrl,
      httpStatus: input.httpStatus,
      retrievedAt: input.retrievedAt,
      rawHash: succeeded ? rawHash : null,
      failureDetail: succeeded ? undefined : "No official positions were acquired for this member.",
    },
    normalization: {
      succeeded: true,
      parserVersion,
      schemaVersion: `state-legislator-votes:${input.term}:${input.session}:v1`,
      normalizedHash: normalizedHash(readModel),
      normalizedPayloadHash: normalizedHash(normalizedPayload),
      inputRecords: positions.length,
      outputRecords: positions.length,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: [{
      subjectId: input.officeholderId,
      jurisdiction: input.jurisdiction,
      identifiers: { officeholderId: input.officeholderId },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
    }],
    temporal: { version: input.term, expectedVersion: input.term, sourceThrough: throughDate, staleAtRetrieval: false },
    semantics: { factKind: "one state legislator's recorded roll-call positions across a term", violations },
    horizon: {
      kind: "BOUNDED",
      query: `${input.sourceId} ${input.officeholderId} ${input.term} ${input.session} recorded positions`,
      returnedRecords: positions.length,
      declaredTotal: positions.length,
      paginationComplete: true,
      claimsComplete: true,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{
      consumer: "app/api/votes/route.ts per-member record",
      passed: violations.length === 0,
      detail: `${positions.length} recorded positions for ${input.officeholderId}.`,
    }],
    normalizedPayload,
    readModel,
  };
}

export function officialStateLegislatorVotesSessionMarker(input: {
  readonly sourceId: OfficialStateRollCallSourceId;
  readonly jurisdiction: OfficialStateVoteScope;
  readonly term: string;
  readonly session: string;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly retrievedAt: string;
  readonly throughRollId: string | null;
  readonly throughDate: string | null;
  readonly rollCount: number;
  readonly legislatorCount: number;
  readonly positionCount: number;
  readonly sourceDocumentsSha256: string;
  readonly identityAuthority: NonNullable<StateVotesSnapshot["officialIdentityAuthority"]>;
}): RoutineCandidate {
  const scope = input.jurisdiction;
  const parserVersion = input.sourceId === "nh-general-court" ? "nh-general-court/3" : `${input.sourceId}/2`;
  const readModel: StateLegislatorVotesSessionMarker = {
    generatedAt: input.retrievedAt,
    jurisdiction: input.jurisdiction,
    sourceId: input.sourceId,
    term: input.term,
    session: input.session,
    throughRollId: input.throughRollId,
    throughDate: input.throughDate,
    rollCount: input.rollCount,
    legislatorCount: input.legislatorCount,
    positionCount: input.positionCount,
    sourceDocumentsSha256: input.sourceDocumentsSha256,
    officialIdentityAuthority: input.identityAuthority,
  };
  const rawHash = sha256(canonical(readModel));
  return {
    id: candidateId(input.sourceId, `${scope}:session-marker`, rawHash, input.retrievedAt),
    sourceId: input.sourceId,
    recordClass: "STATE_LEGISLATOR_VOTES",
    scope,
    sourceProjectionEvidence: sourceProjectionEvidence(input.sourceId, "STATE_LEGISLATOR_VOTES", scope),
    retrieval: {
      succeeded: true,
      requestedUrl: input.requestedUrl,
      finalUrl: input.finalUrl,
      httpStatus: input.httpStatus,
      retrievedAt: input.retrievedAt,
      rawHash,
    },
    normalization: {
      succeeded: true,
      parserVersion,
      schemaVersion: `state-legislator-votes-marker:${input.term}:${input.session}:v1`,
      normalizedHash: normalizedHash(readModel),
      normalizedPayloadHash: normalizedHash(readModel),
      inputRecords: 1,
      outputRecords: 1,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: [{
      subjectId: `${input.sourceId}:${input.jurisdiction}:${input.term}:${input.session}`,
      jurisdiction: input.jurisdiction,
      identifiers: { jurisdiction: input.jurisdiction },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
    }],
    temporal: { version: input.term, expectedVersion: input.term, sourceThrough: input.throughDate ?? input.retrievedAt.slice(0, 10), staleAtRetrieval: false },
    semantics: { factKind: "per-state fan-out acquisition marker for one term's state legislator votes", violations: [] },
    horizon: {
      kind: "BOUNDED",
      query: `${input.sourceId} ${input.jurisdiction} ${input.term} ${input.session} acquisition watermark`,
      returnedRecords: 1,
      declaredTotal: 1,
      paginationComplete: true,
      claimsComplete: true,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{
      consumer: "standing runner per-state clock",
      passed: true,
      detail: `Watermark through ${input.throughRollId ?? "no rolls"}; ${input.legislatorCount} member(s) carry ${input.positionCount} position(s).`,
    }],
    normalizedPayload: readModel,
    readModel,
  };
}

export function officialStateLegislatorsCandidate(input: {
  readonly sourceId: OfficialStateRollCallSourceId;
  readonly jurisdiction: OfficialStateVoteScope;
  readonly rawBodies: readonly string[];
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly retrievedAt: string;
  readonly term: string;
  readonly expectedTerm: string;
  readonly declaredTotal: number;
  readonly roster: OfficeholderSet;
  readonly priorRoster?: OfficeholderSet | null;
  readonly sourceAudit?: OfficialStateLegislatorReadModel["sourceAudit"];
}): RoutineCandidate {
  const target = officialStateLegislatorTargetByScope(input.jurisdiction);
  const rawHash = sha256(input.rawBodies.map((body) => sha256(body)).join("\n"));
  const removed = new Set((input.sourceAudit?.excludedRecords ?? []).map(row=>`${input.sourceId}:${row.officialPersonId}`));
  const prior = input.priorRoster ? {...input.priorRoster,officeholders:input.priorRoster.officeholders.filter(row=>!removed.has(row.id)),divisions:input.priorRoster.divisions.filter(row=>!removed.has(row.officeholderId)),unmatched:input.priorRoster.unmatched.filter(row=>!removed.has(row.officeholderId))} : null;
  const roster = mergeStatePeople(prior,input.roster);
  const personIds = new Set(roster.officeholders.map((row) => row.id));
  const violations: string[] = [];
  if (!target || target.sourceId !== input.sourceId) violations.push("Roster scope and publisher authority disagree.");
  if (roster.officeholders.some((row) => !row.id.startsWith(`${input.sourceId}:`) || row.id.length <= input.sourceId.length + 1)) {
    violations.push("A roster member lacks an exact source-namespaced official identifier.");
  }
  if (roster.divisions.some((link) => !personIds.has(link.officeholderId))) {
    violations.push("A roster division link names a person outside this source horizon.");
  }
  if (new Set(roster.officeholders.map((row) => row.id)).size !== roster.officeholders.length) {
    violations.push("The official roster repeats a person identifier.");
  }
  if (input.sourceAudit && (
    input.sourceAudit.observedRecords < input.roster.officeholders.length + input.sourceAudit.excludedRecords.length ||
    new Set(input.sourceAudit.excludedRecords.map((row) => row.officialPersonId)).size !== input.sourceAudit.excludedRecords.length
  )) {
    violations.push("The publisher row audit does not reconcile active and explicitly excluded identities.");
  }
  const readModel: OfficialStateLegislatorReadModel = {
    formatVersion: 1,
    sourceId: input.sourceId,
    jurisdiction: input.jurisdiction,
    term: input.term,
    generatedAt: input.retrievedAt,
    roster: roster,
    ...(input.sourceAudit ? { sourceAudit: input.sourceAudit } : {}),
  };
  const identifierKey = input.sourceId === "nj-legislature" ? "roster_id" : "legislator";
  return {
    id: candidateId(input.sourceId, `${input.jurisdiction}:roster:${input.term}`, rawHash, input.retrievedAt),
    sourceId: input.sourceId,
    recordClass: "STATE_LEGISLATOR",
    scope: input.jurisdiction,
    sourceProjectionEvidence: sourceProjectionEvidence(input.sourceId, "STATE_LEGISLATOR", input.jurisdiction),
    retrieval: {
      succeeded: input.rawBodies.length > 0 && input.httpStatus >= 200 && input.httpStatus < 300,
      requestedUrl: input.requestedUrl,
      finalUrl: input.finalUrl,
      httpStatus: input.httpStatus,
      retrievedAt: input.retrievedAt,
      rawHash: input.rawBodies.length > 0 ? rawHash : null,
      failureDetail: input.rawBodies.length > 0 ? undefined : "No official roster bytes were acquired.",
    },
    normalization: {
      succeeded: true,
      parserVersion: `${input.sourceId}/2`,
      schemaVersion: `official-state-legislators:${input.term}`,
      normalizedHash: normalizedHash(readModel),
      normalizedPayloadHash: normalizedHash(roster),
      inputRecords: roster.officeholders.length + (input.sourceAudit?.excludedRecords.length ?? 0),
      outputRecords: roster.officeholders.length,
      droppedRecords: input.sourceAudit?.excludedRecords.length ?? 0,
      missingRequiredFields: roster.officeholders.some((row) =>
        !row.id || !row.name || !row.officeTitle || !row.provenance?.sourceUrl
      ) ? ["id/name/office/provenance"] : [],
    },
    identities: roster.officeholders.map((row) => ({
      subjectId: row.id,
      jurisdiction: input.jurisdiction,
      identifiers: { [identifierKey]: row.id.slice(input.sourceId.length + 1) },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
      chamber: row.chamber,
      office: row.officeTitle,
      term: input.term,
      district: roster.divisions.find((link) => link.officeholderId === row.id)?.ocdId ?? "UNMATCHED",
    })),
    temporal: {
      version: input.term,
      expectedVersion: input.expectedTerm,
      sourceThrough: input.retrievedAt,
      staleAtRetrieval: input.term !== input.expectedTerm,
    },
    semantics: { factKind: "current official state-legislator identity and seat", violations },
    horizon: {
      kind: removed.size ? "BOUNDED" : "OPEN_FACT_SET",
      query: `${target?.publisher ?? input.sourceId} individually sourced current members`,
      returnedRecords: roster.officeholders.length,
      declaredTotal: removed.size ? roster.officeholders.length : null,
      paginationComplete: true,
      claimsComplete: removed.size > 0,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      {
        consumer: "official state-legislator Reader identity",
        passed: roster.officeholders.length > 0,
        detail: `${roster.officeholders.length} official people; ${roster.unmatched.length} unmatched rows.`,
      },
    ],
    normalizedPayload: roster,
    readModel,
  };
}

export function officialStateLegislatorHorizonRefusalCandidate(input: {
  readonly sourceId: OfficialStateRollCallSourceId;
  readonly jurisdiction: OfficialStateVoteScope;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly retrievedAt: string;
  readonly rawBody: string;
  readonly detail: string;
}): RoutineCandidate {
  const rawHash = sha256(input.rawBody);
  const normalizedPayload = {
    sourceId: input.sourceId,
    jurisdiction: input.jurisdiction,
    outcome: "OFFICIAL_ROSTER_HORIZON_NOT_ESTABLISHED",
    detail: input.detail,
  };
  return {
    id: candidateId(input.sourceId, `${input.jurisdiction}:roster-probe`, rawHash, input.retrievedAt),
    sourceId: input.sourceId,
    recordClass: "STATE_LEGISLATOR",
    scope: input.jurisdiction,
    sourceProjectionEvidence: sourceProjectionEvidence(input.sourceId, "STATE_LEGISLATOR", input.jurisdiction),
    retrieval: { succeeded: true, requestedUrl: input.requestedUrl, finalUrl: input.finalUrl, httpStatus: input.httpStatus, retrievedAt: input.retrievedAt, rawHash },
    normalization: { succeeded: true, parserVersion: `${input.sourceId}/2`, schemaVersion: "official-state-legislator-horizon-probe/1", normalizedHash: normalizedHash(normalizedPayload), normalizedPayloadHash: normalizedHash(normalizedPayload), inputRecords: 0, outputRecords: 0, droppedRecords: 0, missingRequiredFields: [] },
    identities: [],
    temporal: { version: "UNKNOWN", expectedVersion: "UNKNOWN", sourceThrough: input.retrievedAt, staleAtRetrieval: false },
    semantics: { factKind: "official state-legislator completeness-horizon probe", violations: [] },
    horizon: { kind: "OPEN_FACT_SET", query: input.requestedUrl, returnedRecords: 0, declaredTotal: null, paginationComplete: false, claimsComplete: true },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "official state-legislator Reader", passed: true, detail: "No Reader mutation is requested until the complete official roster horizon is proved." }],
    normalizedPayload,
    readModel: normalizedPayload,
  };
}

export function officialStateRollCallHorizonRefusalCandidate(input: {
  readonly sourceId: OfficialStateRollCallSourceId;
  readonly jurisdiction: OfficialStateVoteScope;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly retrievedAt: string;
  readonly rawBody: string;
  readonly detail: string;
}): RoutineCandidate {
  const state = input.jurisdiction.slice(-2);
  const rawHash = sha256(input.rawBody);
  const readModel: StateVotesSnapshot = {
    generatedAt: input.retrievedAt,
    datasets: [],
    identifierMatch: {
      peopleSeen: 0,
      peopleMatched: 0,
      distinctOfficeholders: 0,
      byState: { [state]: { peopleSeen: 0, peopleMatched: 0, rollCalls: 0 } },
    },
    rollCalls: [],
    positions: [],
  };
  const normalizedPayload = {
    sourceId: input.sourceId,
    jurisdiction: input.jurisdiction,
    outcome: "OFFICIAL_HORIZON_NOT_ESTABLISHED",
    detail: input.detail,
  };
  return {
    id: candidateId(input.sourceId, input.jurisdiction, rawHash, input.retrievedAt),
    sourceId: input.sourceId,
    recordClass: "STATE_ROLL_CALL",
    scope: input.jurisdiction,
    sourceProjectionEvidence: sourceProjectionEvidence(input.sourceId, "STATE_ROLL_CALL", input.jurisdiction),
    retrieval: {
      succeeded: true,
      requestedUrl: input.requestedUrl,
      finalUrl: input.finalUrl,
      httpStatus: input.httpStatus,
      retrievedAt: input.retrievedAt,
      rawHash,
    },
    normalization: {
      succeeded: true,
      parserVersion: `${input.sourceId}/2`,
      schemaVersion: "official-roll-call-horizon-probe/1",
      normalizedHash: normalizedHash(readModel),
      normalizedPayloadHash: normalizedHash(normalizedPayload),
      inputRecords: 0,
      outputRecords: 0,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: [],
    temporal: {
      version: "UNKNOWN",
      expectedVersion: "UNKNOWN",
      sourceThrough: input.retrievedAt,
      staleAtRetrieval: false,
    },
    semantics: {
      factKind: "official state roll-call completeness-horizon probe",
      violations: [],
    },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: input.requestedUrl,
      returnedRecords: 0,
      declaredTotal: null,
      paginationComplete: false,
      // This must be true so validation refuses COMPLETE_UNIVERSE_UNBOUNDED.
      // False would permit an empty individual-fact candidate to promote.
      claimsComplete: true,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{
      consumer: "official state roll-call Reader",
      passed: true,
      detail: "No Reader mutation is requested until the official horizon is complete.",
    }],
    normalizedPayload,
    readModel,
  };
}

export function nhMembersCandidate(input: {
  readonly rawText: string;
  readonly rawIdentityText: string;
  readonly finalUrl: string;
  readonly identityFinalUrl: string;
  readonly httpStatus: number;
  readonly identityHttpStatus: number;
  readonly retrievedAt: string;
  readonly extraction: MembersExtraction;
  readonly identityCrosswalk: NhCurrentMemberIdentityCrosswalk;
  readonly prior?: NhMemberReadModel | null;
  readonly priorRetrievedAt?: string;
  readonly sourceCheck?:import("./types.ts").SourceCheckEvidence;
}): RoutineCandidate {
  const rawHash = sha256(`${sha256(input.rawText)}\n${sha256(input.rawIdentityText)}`);
  const expectedTerm = expectedNhMembersTerm(input.sourceCheck?.checkedAt ?? input.retrievedAt);
  const current = input.identityCrosswalk.matches.map(match=>match.member);
  let rosterIdentities = input.identityCrosswalk.matches.map((match) => ({
    officeholderId: match.officeholderId,
    officialPersonId: match.officialPersonId,
    chamber: match.member.chamber,
    district: match.member.district,
    seatNo: match.member.seatNo,
  }));
  const currentIds = new Set(rosterIdentities.map(row=>row.officeholderId));
  const retainedIdentities = (input.prior?.identities ?? []).filter(row=>!currentIds.has(row.officeholderId));
  const key = (row:{chamber:string;seatNo:string;district:string})=>`${row.chamber}|${row.seatNo}|${row.district}`;
  const retainedKeys = new Set(retainedIdentities.map(key));
  const retainedMembers = (input.prior?.members ?? []).filter(row=>retainedKeys.has(key(row)));
  rosterIdentities = [...retainedIdentities,...rosterIdentities];
  const readModel: NhMemberReadModel = {
    formatVersion: 1,
    jurisdiction: "US-NH",
    term: NH_MEMBERS_SUPPORTED_TERM,
    members: [...retainedMembers,...current],
    memberSourceDates: {...Object.fromEntries(retainedIdentities.map(row=>[row.officeholderId,input.prior?.memberSourceDates?.[row.officeholderId] ?? input.priorRetrievedAt ?? input.retrievedAt])),...Object.fromEntries(input.identityCrosswalk.matches.map(row=>[row.officeholderId,input.retrievedAt]))},
    identities: rosterIdentities,
    officialIdentityAuthority: {
      sourceUrl: input.identityFinalUrl,
      sourceVersion: input.identityCrosswalk.sourceVersion,
      observedIdentityRows: input.identityCrosswalk.observedIdentityRows,
      ordinaryMatches: input.identityCrosswalk.ordinaryMatches,
      reviewedExceptionMatches: input.identityCrosswalk.reviewedExceptionMatches,
    },
  };
  const identities = input.identityCrosswalk.matches.map((match) => {
    const member = match.member;
    return {
      subjectId: match.officeholderId,
      jurisdiction: "US-NH",
      identifiers: { seatNo: member.seatNo, officialPersonId: match.officialPersonId, chamber: member.chamber, district: member.district, ...(member.email ? { officialEmail: member.email } : {}) },
      matchBasis: "OFFICIAL_ID_CROSSWALK" as const,
      ambiguous: false,
      chamber: member.chamber,
      office: member.title ?? (member.chamber === "S" ? "Senator" : "Representative"),
      term: NH_MEMBERS_SUPPORTED_TERM,
      district: member.district,
    };
  });
  const duplicateKeys = identities.length - new Set(identities.map((identity) => identity.subjectId)).size;
  const missingRequiredFields = [
    ...(current.some((member) => !member.chamber || !member.district || !member.seatNo) ? ["LegislativeBody/District/seatno"] : []),

  ];
  const violations = [
    ...(duplicateKeys > 0 ? [`${duplicateKeys} official PersonID identities are duplicated.`] : []),

  ];
  const normalizedPayload = {
    extraction: input.extraction,
    unresolved: input.identityCrosswalk.unresolved ?? [],
    officialIdentityAuthority: readModel.officialIdentityAuthority,
  };
  return {
    id: candidateId("nh-general-court", "US-NH", rawHash, input.sourceCheck?.checkedAt ?? input.retrievedAt),
    sourceId: "nh-general-court",
    recordClass: "STATE_LEGISLATOR",
    scope: "US-NH",
    sourceProjectionEvidence: sourceProjectionEvidence("nh-general-court", "STATE_LEGISLATOR", "US-NH"),
    retrieval: { succeeded: input.httpStatus === 200 && input.identityHttpStatus === 200, requestedUrl: "https://gc.nh.gov/downloads/Members.txt", finalUrl: input.finalUrl, httpStatus: input.httpStatus === 200 && input.identityHttpStatus === 200 ? 200 : null, retrievedAt: input.retrievedAt, rawHash,...(input.sourceCheck ? {sourceCheck:input.sourceCheck} : {}) },
    normalization: { succeeded: true, parserVersion: "nh-general-court/3", schemaVersion: `Members.txt+legislators.txt+RollCallHistory.txt:${NH_MEMBERS_SUPPORTED_TERM}:official-person-id`, normalizedHash: normalizedHash(readModel), normalizedPayloadHash: normalizedHash(normalizedPayload), inputRecords: input.extraction.counts.logicalInput, outputRecords: input.extraction.counts.produced, droppedRecords: input.extraction.counts.dropped, missingRequiredFields },
    identities,
    temporal: { version: NH_MEMBERS_SUPPORTED_TERM, expectedVersion: expectedTerm, sourceThrough: input.retrievedAt, staleAtRetrieval: expectedTerm !== NH_MEMBERS_SUPPORTED_TERM },
    semantics: { factKind: "current legislative membership as stated by electedStatus", violations },
    horizon: { kind: "OPEN_FACT_SET", query: "exact matched current member identities; unresolved rows remain work", returnedRecords: current.length, declaredTotal: null, paginationComplete: false, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      { consumer: "lib/civic-data/state-members.ts", passed: current.length > 0, detail: `${current.length} rows marked INCUMBENT or NEW.` },
      {
        consumer: "official legislators.txt PersonID crosswalk",
        passed: current.length > 0 && duplicateKeys === 0,
        detail: `${input.identityCrosswalk.ordinaryMatches} ordinary exact matches + ${input.identityCrosswalk.reviewedExceptionMatches} reviewed exact official exceptions across ${input.identityCrosswalk.observedIdentityRows} identity rows.`,
      },
    ],
    normalizedPayload,
    readModel,
  };
}

export function fecFundingCandidate(input: {
  readonly snapshot: FundingSnapshot;
  readonly rawBodies: readonly string[];
  /** Exact byte hashes already stored by the shared evidence vault. */
  readonly rawHashes?: readonly string[];
  readonly finalUrl: string;
  readonly retrievedAt: string;
  readonly sourceCheck?: RoutineCandidate["retrieval"]["sourceCheck"];
  readonly excludedFacts: readonly { code: string; detail: string }[];
}): RoutineCandidate {
  const hashes = input.rawHashes ?? input.rawBodies.map(body => sha256(body));
  if (hashes.some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw new Error("FEC_SOURCE_HASH_INVALID");
  const rawHash = sha256(hashes.join("\n"));
  const snapshot: FundingSnapshot = { ...input.snapshot, absences: [] };
  const missing: string[] = [];
  const violations: string[] = [];
  for (const row of snapshot.candidates) {
    if (!/^(?:[HS]\d[A-Z]{2}\d{5}|P\d{8})$/.test(row.fecCandidateId)) missing.push(`${row.name}:candidate_id`);
    if (row.principalCommitteeId && !/^C\d{8}$/.test(row.principalCommitteeId)) missing.push(`${row.name}:committee_id`);
    if (!Number.isSafeInteger(row.cycle) || row.cycle < 1900 || row.cycle % 2) violations.push(`${row.fecCandidateId} has an invalid filing period.`);
    if (row.totals.coverageEndDate && !/^\d{4}-\d{2}-\d{2}$/.test(row.totals.coverageEndDate)) violations.push(`${row.fecCandidateId} has an invalid coverage_end_date.`);
  }
  const sourceThrough = snapshot.candidates.map((row) => row.totals.coverageEndDate ?? "").sort().at(-1) || String(snapshot.cycle);
  const versionHash = input.sourceCheck ? sha256(`${rawHash}\n${normalizedHash(snapshot)}\nfec-funding/4`) : rawHash;
  return {
    id: candidateId("fec-open-api", "federal-supported", versionHash, input.sourceCheck?.checkedAt ?? input.retrievedAt),
    sourceId: "fec-open-api",
    recordClass: "FEC_FUNDING",
    scope: "federal-supported",
    sourceProjectionEvidence: sourceProjectionEvidence("fec-open-api", "FEC_FUNDING", "federal-supported"),
    retrieval: { succeeded: hashes.length > 0, requestedUrl: "https://api.open.fec.gov/v1/", finalUrl: input.finalUrl, httpStatus: hashes.length > 0 ? 200 : null, retrievedAt: input.retrievedAt, rawHash: hashes.length > 0 ? rawHash : null, failureDetail: hashes.length > 0 ? undefined : "No FEC response bytes were acquired.", ...(input.sourceCheck ? { sourceCheck: input.sourceCheck } : {}) },
    normalization: { succeeded: true, parserVersion: "fec-funding/4", schemaVersion: `FundingSnapshot:1:cycle-${snapshot.cycle}`, normalizedHash: normalizedHash(snapshot), normalizedPayloadHash: normalizedHash(snapshot), inputRecords: snapshot.candidates.length, outputRecords: snapshot.candidates.length, droppedRecords: 0, missingRequiredFields: missing },
    identities: snapshot.candidates.map((row) => ({ subjectId: row.fecCandidateId, jurisdiction: "US", identifiers: { candidate_id: row.fecCandidateId, ...(row.principalCommitteeId ? { committee_id: row.principalCommitteeId } : {}) }, matchBasis: row.matchRoutes.every((route) => route === "bioguide-bridge" || route === "roster-person-reuse") ? "OFFICIAL_ID_CROSSWALK" as const : "EXACT_SCOPED_ID" as const, ambiguous: false, office: row.office, district: row.district ?? undefined })),
    temporal: { version: String(snapshot.cycle), expectedVersion: String(snapshot.cycle), sourceThrough, staleAtRetrieval: false },
    semantics: { factKind: "FEC-filed candidate/committee totals and itemized receipts", violations },
    horizon: { kind: "OPEN_FACT_SET", query: `FEC House and Senate registrations for election ${snapshot.cycle}; optional receipt classes remain standing work`, returnedRecords: snapshot.candidates.length, declaredTotal: null, paginationComplete: false, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      { consumer: "lib/funding/snapshot.ts", passed: snapshot.candidates.length > 0 && new Set(snapshot.candidates.map((row) => row.fecCandidateId)).size === snapshot.candidates.length, detail: `${snapshot.candidates.length} unique FEC candidate projections.` },
      { consumer: "lib/funding/display.ts + grounded Ask", passed: snapshot.candidates.every((row) => row.targetKeys.length > 0 && (Boolean(row.registration) || [row.totals.receipts, row.totals.disbursements, row.totals.cashOnHand].some(value => typeof value === "number" && Number.isFinite(value)))), detail: "Every candidate has exact target bindings and a source registration or filed amount; unknown amounts remain null." },
    ],
    normalizedPayload: snapshot,
    readModel: snapshot,
    excludedFacts: input.excludedFacts,
  };
}

type MeetingCandidateSnapshot = {
  readonly formatVersion: number;
  readonly generatedAt: string;
  readonly counts: { readonly fresh: number; readonly carried: number; readonly total: number };
  readonly sources: readonly {
    readonly source: string;
    readonly ok: boolean;
    readonly error?: string;
    readonly fetched: number;
    readonly normalized: number;
    readonly carriedForward?: number;
    readonly acquisitions?: readonly {
      readonly source: string;
      readonly requestedUrl: string;
      readonly finalUrl: string;
      readonly httpStatus: number;
      readonly rawHash: string;
      readonly byteCount: number;
    }[];
  }[];
  readonly meetings: readonly {
    readonly id: string;
    readonly bodyId?: string | null;
    readonly ocdId?: string | null;
    readonly startsAt?: string;
    readonly provenance?: { readonly sourceUrl?: string | null; readonly collectedAt?: string };
    readonly carried?: {
      readonly source: string;
      readonly lastFreshAt: string;
      readonly reason?: "SOURCE_UNAVAILABLE" | "PARTIAL_SCOPE_UNAVAILABLE" | "UNEXPLAINED_DISAPPEARANCE" | "OUTSIDE_FETCH_WINDOW";
    };
  }[];
  readonly agendaDocuments: readonly { readonly id: string; readonly meetingId: string }[];
};

export function meetingsCandidate(input: {
  readonly snapshot: MeetingCandidateSnapshot;
  readonly partition: {
    readonly sourceName: string;
    readonly bodyId: string;
    readonly scope: string;
  };
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly retrievedAt: string;
  readonly acquisitionRawHash?: string;
  readonly additionalViolations?: readonly string[];
  readonly removalEvidence?: RoutineCandidate["removalEvidence"];
}): RoutineCandidate {
  const snapshot = input.snapshot;
  const rawHash = input.acquisitionRawHash ?? normalizedHash({ sources: snapshot.sources, meetings: snapshot.meetings, agendaDocuments: snapshot.agendaDocuments });
  const successful = snapshot.sources.filter((source) => source.ok);
  const authenticatedAcquisition = input.acquisitionRawHash === undefined
    ? successful.length > 0
    : successful.length > 0 && /^[a-f0-9]{64}$/.test(input.acquisitionRawHash) && Boolean(input.requestedUrl && input.finalUrl);
  const violations: string[] = [];
  if (successful.length === 0) violations.push("No configured meeting source succeeded.");
  if (snapshot.counts.total !== snapshot.meetings.length || snapshot.counts.fresh + snapshot.counts.carried !== snapshot.counts.total) {
    violations.push("Meeting fresh/carried/total accounting does not reconcile to the projection.");
  }
  if (snapshot.meetings.some((meeting) => !meeting.id || !meeting.bodyId || !meeting.provenance?.sourceUrl)) {
    violations.push("A meeting lacks an exact meeting id, body id, or authoritative source URL.");
  }
  if (new Set(snapshot.meetings.map((meeting) => meeting.id)).size !== snapshot.meetings.length) {
    violations.push("Meeting identifiers are duplicated.");
  }
  if (new Set(snapshot.agendaDocuments.map((document) => document.id)).size !== snapshot.agendaDocuments.length) {
    violations.push("Agenda-document identifiers are duplicated.");
  }
  if (snapshot.sources.length !== 1 || snapshot.sources[0]?.source !== input.partition.sourceName) {
    violations.push("A meeting partition must account for exactly its registered source route.");
  }
  if (snapshot.meetings.some((meeting) => meeting.bodyId !== input.partition.bodyId || !meeting.id.startsWith(`${input.partition.sourceName}:`))) {
    violations.push("A meeting partition contains a row owned by another source/body scope.");
  }
  violations.push(...(input.additionalViolations ?? []));
  const sourceThrough = snapshot.meetings
    .map((meeting) => meeting.carried?.lastFreshAt ?? meeting.provenance?.collectedAt ?? "")
    .filter(Boolean)
    .sort()
    .at(-1) ?? input.retrievedAt;
  const failed = snapshot.sources.filter((source) => !source.ok);
  return {
    id: candidateId("meetings-public-bodies", input.partition.scope, rawHash, input.retrievedAt),
    sourceId: "meetings-public-bodies",
    recordClass: "MEETING",
    scope: input.partition.scope,
    sourceProjectionEvidence: sourceProjectionEvidence("meetings-public-bodies", "MEETING", input.partition.scope),
    retrieval: {
      succeeded: authenticatedAcquisition,
      requestedUrl: input.requestedUrl,
      finalUrl: input.finalUrl,
      httpStatus: authenticatedAcquisition ? 200 : null,
      retrievedAt: input.retrievedAt,
      rawHash: authenticatedAcquisition ? rawHash : null,
      failureDetail: authenticatedAcquisition ? undefined : "No configured meeting source produced authenticated exact-byte evidence.",
    },
    normalization: {
      succeeded: true,
      parserVersion: "meetings-composite/2",
      schemaVersion: `MeetingsSnapshot:${snapshot.formatVersion}`,
      normalizedHash: normalizedHash(snapshot),
      normalizedPayloadHash: normalizedHash(snapshot),
      inputRecords: snapshot.meetings.length,
      outputRecords: snapshot.meetings.length,
      droppedRecords: 0,
      missingRequiredFields: snapshot.meetings.some((meeting) => !meeting.id || !meeting.bodyId) ? ["meeting.id/bodyId"] : [],
    },
    identities: snapshot.meetings.map((meeting) => ({
      subjectId: meeting.id,
      jurisdiction: /\/state:([a-z]{2})/.exec(meeting.ocdId ?? "")?.[1]
        ? `US-${/\/state:([a-z]{2})/.exec(meeting.ocdId ?? "")![1]!.toUpperCase()}`
        : "SUPPORTED-BODY-WITHOUT-CENSUS-DIVISION",
      identifiers: { meeting_id: meeting.id, body_id: meeting.bodyId ?? "missing", source_route: meeting.provenance?.sourceUrl ?? "missing" },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
    })),
    temporal: { version: snapshot.generatedAt, expectedVersion: snapshot.generatedAt, sourceThrough, staleAtRetrieval: false },
    semantics: { factKind: "public-body meeting and agenda publication", violations },
    horizon: {
      kind: "BOUNDED",
      query: `registered source/body partition ${input.partition.sourceName}/${input.partition.bodyId}`,
      returnedRecords: snapshot.meetings.length,
      declaredTotal: snapshot.counts.total,
      paginationComplete: true,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      { consumer: "lib/meetings/snapshot.ts", passed: snapshot.counts.total === snapshot.meetings.length, detail: `${snapshot.meetings.length} exact meeting rows.` },
      { consumer: "agenda and Ask", passed: snapshot.agendaDocuments.every((doc) => snapshot.meetings.some((meeting) => meeting.id === doc.meetingId)), detail: `${snapshot.agendaDocuments.length} agenda versions reference a retained meeting.` },
    ],
    normalizedPayload: snapshot,
    readModel: snapshot,
    removalEvidence: input.removalEvidence,
    excludedFacts: [
      ...failed.map((source) => ({
        key: source.source,
        code: "MEETING_SOURCE_HELD_LKG",
        detail: `${source.source}: ${source.error ?? "source failed"}; ${source.carriedForward ?? 0} prior meeting rows retained.`,
        record: source,
      })),
      ...snapshot.meetings
        .filter((meeting) => meeting.carried?.reason === "UNEXPLAINED_DISAPPEARANCE")
        .map((meeting) => ({
          key: `meeting:${meeting.id}`,
          code: "MEETING_UNEXPLAINED_DISAPPEARANCE_RETAINED",
          detail: `${meeting.id} was absent from an authenticated but incomplete source response and remains on its prior exact fact/LKG evidence.`,
          record: meeting,
        })),
    ],
  };
}

export function dotGovCandidate(input: {
  readonly snapshot: DotGovSnapshot;
  readonly rawText: string;
  readonly finalUrl: string;
  readonly retrievedAt: string;
}): RoutineCandidate {
  const rows = input.snapshot.domains;
  const duplicates = rows.length - new Set(rows.map((row) => row.domain)).size;
  const violations = [
    ...(duplicates ? [`${duplicates} duplicate domain identifiers.`] : []),
    ...dotGovSnapshotIssues(input.snapshot),
  ];
  return {
    id: candidateId("cisa-dotgov-registry", DOTGOV_SCOPE, sha256(input.rawText), input.retrievedAt),
    sourceId: "cisa-dotgov-registry",
    recordClass: "DOTGOV_REFERENCE",
    scope: DOTGOV_SCOPE,
    sourceProjectionEvidence: sourceProjectionEvidence("cisa-dotgov-registry", "DOTGOV_REFERENCE", DOTGOV_SCOPE),
    retrieval: { succeeded: input.rawText.length > 0, requestedUrl: "https://api.github.com/repos/cisagov/dotgov-data/commits?path=current-full.csv&per_page=1", finalUrl: input.finalUrl, httpStatus: input.rawText.length > 0 ? 200 : null, retrievedAt: input.retrievedAt, rawHash: input.rawText.length > 0 ? sha256(input.rawText) : null },
    normalization: { succeeded: true, parserVersion: DOTGOV_PARSER_VERSION, schemaVersion: `current-full.csv:${input.snapshot.source.sha}`, normalizedHash: normalizedHash(input.snapshot), normalizedPayloadHash: normalizedHash(input.snapshot), inputRecords: input.snapshot.counts.domains, outputRecords: rows.length, droppedRecords: input.snapshot.counts.domains - rows.length, missingRequiredFields: rows.some((row) => !row.domain || !row.type) ? ["domain/type"] : [] },
    identities: rows.map((row) => ({ subjectId: row.domain, jurisdiction: "US", identifiers: { domain: row.domain, source_sha: input.snapshot.source.sha }, matchBasis: "OFFICIAL_ID" as const, ambiguous: false })),
    temporal: { version: input.snapshot.source.sha, expectedVersion: input.snapshot.source.sha, sourceThrough: input.retrievedAt, staleAtRetrieval: false },
    semantics: { factKind: "CISA registered .gov domain and registrant contact reference; never a government denominator", violations },
    horizon: { kind: "BOUNDED", query: "every domain and registrant in the SHA-pinned CISA current-full.csv", returnedRecords: rows.length, declaredTotal: rows.length, paginationComplete: true, claimsComplete: true },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "government domain Reader and registered dotgov discovery operation", passed: input.snapshot.counts.domains >= 15_000 && input.snapshot.counts.electionDomains >= 500, detail: `${input.snapshot.counts.domains} total domains and ${input.snapshot.counts.electionDomains} election-typed domains retained in the full registry.` }],
    normalizedPayload: input.snapshot,
    readModel: input.snapshot,
  };
}
