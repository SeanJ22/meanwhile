import { readMemberOfficeMembers, readMemberOfficeRows, memberOfficeStateScope, memberOfficeScopeState, memberOfficeRecordState, MEMBER_OFFICE_CURSOR, type MemberOfficeProgress, type MemberOfficeSlice } from "../officials/member-office-data.ts";
import { manualRecordSourceUrls } from "./manual-source-isolation.ts";
import { manualSourceUrls } from "./manual-source-urls.ts";
import { createHash } from "node:crypto";
import { repeatedFailureStreak } from "./failure-backoff.ts";
import { readRetirementProgress, retirementProofTarget } from "./state-retirement-progress.ts";
import type { Division, Registry } from "../registry/types.ts";
import { readKeyedRegistry, readKeyedRegistryDivisions, selectRegistryLookup, type RegistryLookup } from "./keyed-rows.ts";
import {readFederalMoneyPublicationBase,readFederalMoneyPartitionKeys,readFederalMoneyPriorPlaces,type FederalMoneyPartitionKeys} from "../federal-money/publication-base.ts";
import { requireRegistryState, stateRegistryRuntimeScope } from "./state-scopes.ts";
import { bindStatePublicationPrior, takeStatePublicationPrior } from "./state-publication.ts";
import { sourceCheckedAt } from "./source-check.ts";
import { isScopedManualContractScope } from "./scoped-manual-contracts.ts";
import { federalDirectoryStateOf } from "../officials/federal-directory-data-plane.ts";
import { decodeStateCandidate, durableStateHash, encodeStateCandidate, statePublicationScope } from "./state-publication.ts";

import { and, desc, eq, getTableColumns, inArray, like, or, sql } from "drizzle-orm";

import { getDb } from "../db/index.ts";
import { runtimeCivicReadCache } from "../db/civic-read-cache.ts";
import { civicDataCandidateEvents, civicDataCandidates, civicDataPromotions, civicDataPayloadParts } from "../db/schema.ts";
import { CivicPayloadParts, type CivicPayloadPartIO } from "./payload-parts.ts";
import { isCivicPayloadPart } from "./payload-codec.ts";
import { navigationCandidateIndex, type NavigationPublicationBase, type NavigationRecord } from "./navigation-publication-base.ts";
import { ballotNavigationState } from "./ballot-navigation-scope.ts";
import {
  type CandidateEvent,
  type CandidateState,
  type CandidateVersionRecord,
  type PromotedPointerIdentity,
  type PromotedProjection,
  type RoutineCandidate,
  type RoutineRecordClass,
  type ValidationReceipt,
} from "./types.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { canonicalCivicDataHash, durableCivicDataHash } from "./canonical-hash.ts";
import {
  UNCHANGED_CONFIRMATION_PREFIX,
  buildUnchangedConfirmation,
  latestUnchangedConfirmation,
  parseUnchangedConfirmation,
  serializeUnchangedConfirmation,
  serializeUnchangedConfirmationSources,
  type ConfirmUnchangedInput,
  type ConfirmUnchangedOutcome,
  type UnchangedConfirmation,
} from "./unchanged-confirmation.ts";
import { parseValidationReceipt } from "./receipt.ts";
import {
  isImportOrStateMoveCandidate,
} from "./trusted-lkg-import.ts";
import { assertWriteAllowed } from "../db/write-guard.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "./contracts.ts";
import { RUNTIME_ROUTINE_CONTRACTS } from "./runtime-routine-contracts.ts";
import { MEETING_HISTORY_SOURCE_ID, MEETING_PARTITION_CONTRACTS, meetingHistoryContract, meetingPartitionForHistoryScope } from "./meeting-partitions.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";
import {
  assertSanctionedRuntimeAuthority,
  runtimeAuthorityEnvelope,
  candidacyRegistryAuthority,
  RuntimeAuthorityRefused,
  type RuntimeAuthorityEnvelope,
} from "./runtime-authority.ts";
import { CIVIC_DATA_PROMOTION_OPERATION } from "./production-write.ts";
import {
  READER_PROJECTION_READBACK_PREFIX,
  parseReaderProjectionReadback,
  sourceScopedReaderReadbackProjectionId,
} from "./reader-readback.ts";
import { canonicalAgendaDocument, type AgendaDocument } from "../meetings/agenda-documents.ts";
import { freezeDurableJson } from "./durable-json.ts";
import { readLegiscanPublicationBase } from "../sources/legiscan/publication-base.ts";
import { LEGISCAN_BULK_SCOPE,LEGISCAN_BULK_PARSER,LEGISCAN_SPONSOR_MATCH,billScope,legiscanContinuationPending } from "../sources/legiscan/current-sessions.ts";
import { projectionKey } from "./projection-key.ts";
import { readPublishedSourceChecks, recordPublishedSourceCheck, validPublishedSourceCheck,
  type PublishedSourceCheck, type RecordPublishedSourceCheck } from "./source-checks.ts";
import { enqueueReaderPlaces, invalidateReaderCache, placePageConsumesPublication, readerCacheScopeForPublication, readerPublicationNeedsGeography, type ReaderCachePurger } from "../reader/cache.ts";
import { seedRuntimeBodyPageSubjects } from "../reader/page-subjects.ts";
import { stateCalendarsCovers } from "./state-calendars.ts";
export { projectionKey } from "./projection-key.ts";

export type CandidateVersionSummary = Omit<CandidateVersionRecord, "candidate" | "receipt"> & {
  readonly candidate: Pick<RoutineCandidate, "id" | "sourceId" | "recordClass" | "scope">;
  readonly receipt: Omit<ValidationReceipt, "excludedFacts"> | null;
};

const isNavigationCandidate = (candidate: Pick<RoutineCandidate, "recordClass" | "scope">) =>
  candidate.recordClass === "CURATED_READER_RECORD" && ballotNavigationState(candidate.scope) !== null;
const isPartedManualCandidate = (candidate: Pick<RoutineCandidate, "recordClass" | "scope">) =>
  isNavigationCandidate(candidate) || candidate.recordClass === "CURATED_READER_RECORD" && (candidate.scope === MEMBER_OFFICES_SCOPE || memberOfficeScopeState(candidate.scope) !== null);

export type PublishedCandidateMetadata = Omit<CandidateVersionRecord, "candidate"> & {
  readonly candidate: Pick<RoutineCandidate, "id" | "sourceId" | "recordClass" | "scope" | "retrieval" | "temporal"> & {
    readonly normalization: Pick<RoutineCandidate["normalization"], "succeeded" | "normalizedHash" | "normalizedPayloadHash" | "stateRecordHashes">;
  };
};

/** The source comparison reads no held record, receipt or event history. */
export interface SourceHead {
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly versionId: string;
  readonly lastKnownGoodVersionId: string;
  readonly rawHash: string | null;
  readonly rawHashBasis: RoutineCandidate["retrieval"]["rawHashBasis"] | null;
  readonly normalizedHash: string | null;
  readonly parserVersion: string;
  readonly promotedAt: string;
  readonly candidateState: CandidateState;
  readonly acquisitionSucceeded: boolean;
  readonly acquisitionComplete?: boolean | null;
  readonly sourceThrough?: string | null;
  readonly imported: boolean;
}

export function publishedCandidateMetadata(row: CandidateVersionRecord): PublishedCandidateMetadata {
  const { id, sourceId, recordClass, scope, retrieval, temporal, normalization } = row.candidate;
  const publishedRetrieval = { ...retrieval };
  delete publishedRetrieval.derived;
  return { ...row, candidate: { id, sourceId, recordClass, scope, retrieval: publishedRetrieval, temporal,
    normalization: { succeeded: normalization.succeeded, normalizedHash: normalization.normalizedHash,
      normalizedPayloadHash: normalization.normalizedPayloadHash,
      ...(normalization.stateRecordHashes ? { stateRecordHashes: normalization.stateRecordHashes } : {}) } } };
}

/** Preserve the SQL row identity even when its untrusted JSON body is corrupt. */
export interface CandidateVersionReadback {
  readonly candidateId: string;
  readonly record: CandidateVersionRecord;
}

export interface CandidateTransitionOptions {
  readonly candidate?: RoutineCandidate;
}

/** An already read exact merge base, reused by the existing source proof and promotion CAS. */
export interface RoutinePublicationBase {
  readonly current:PromotedProjection|null;
  readonly lkg:CandidateVersionRecord|null;
}
const publicationBaseOwners=new WeakMap<object,{readonly store:object;readonly recordClass:RoutineRecordClass;readonly scope:string}>();
function ownPublicationBase(store:object,recordClass:RoutineRecordClass,scope:string,base:RoutinePublicationBase):RoutinePublicationBase {
  const held=freezeDurableJson(base);publicationBaseOwners.set(held,{store,recordClass,scope});return held;
}
export function assertPublicationBaseOwner(store:object,base:RoutinePublicationBase,recordClass:RoutineRecordClass,scope:string):void {
  const owner=publicationBaseOwners.get(base);
  if(owner?.store!==store || owner.recordClass!==recordClass || owner.scope!==scope || base.current && (base.current.recordClass!==recordClass || base.current.scope!==scope))
    throw new Error(`PUBLICATION_BASE_READ_OWNER_MISMATCH:${recordClass}:${scope}`);
}

export interface RoutineDataStore {
  /** Reuse a proven read across runner passes until this scope's candidates, events or pointer change. */
  readonly readVersioned?: <T>(namespace: string, recordClass: RoutineRecordClass, scope: string, read: () => Promise<T>) => Promise<T>;
  readonly eventObservedAt?: (recordClass: RoutineRecordClass, scope: string, requestedAt: string) => Promise<string>;
  readonly create: (record: CandidateVersionRecord, firstEvent: CandidateEvent) => Promise<void>;
  readonly transition: (
    candidateId: string,
    state: CandidateState,
    at: string,
    detail: string,
    receipt?: ValidationReceipt,
    failure?: { code: string; detail: string },
    options?: CandidateTransitionOptions,
  ) => Promise<CandidateVersionRecord>;
  readonly readMemberOfficeMembers: (members: readonly string[]) => Promise<readonly import("../officials/member-offices.ts").MemberOfficeRecord[]>;
  readonly readMemberOfficeSlice: (state: string, members?: readonly string[]) => Promise<MemberOfficeSlice | null>;
  readonly readMemberOfficeProgress: () => Promise<MemberOfficeProgress>;
  readonly writeMemberOfficeProgress: (progress: MemberOfficeProgress) => Promise<void>;
  readonly readRegistrySlice: (state: string, bodyIds: readonly string[], divisionIds: readonly string[]) => Promise<RegistryLookup | null>;
  readonly readRegistryDivisions: (state: string, labels: readonly string[]) => Promise<readonly RegistryDivisionMatch[]>;
  readonly readCandidate: (candidateId: string) => Promise<CandidateVersionRecord | null>;
  /** Read only a named candidate field and its referenced parts. */
  readonly readCandidatePath: <T = unknown>(candidateId: string, path: readonly string[]) => Promise<T | null>;
  readonly readCandidateSummary: (candidateId: string) => Promise<CandidateVersionSummary | null>;
  readonly readStateRetirementBaseline?: (recordClass: RoutineRecordClass, scope: string) => Promise<RoutineCandidate["normalization"]["stateRecordHashes"] | null>;
  readonly hasStateRetirementProof?: (contractId: string, origin: NonNullable<RoutineCandidate["stateRetirement"]>["origin"]) => Promise<boolean>;
  readonly readStateRetirementOrigin?: (recordClass: string, scope: string) => Promise<{
    readonly versionId: string; readonly lastKnownGoodVersionId: string; readonly sourceId: string;
    readonly recordClass: string; readonly scope: string; readonly normalizedHash: string | null;
    readonly promoted: boolean; readonly sourceAuthenticity: string | null;
  } | null>;
  readonly readStatePublicationBase?: (recordClass: RoutineRecordClass, scope: string) => Promise<{ readonly current: PromotedProjection | null; readonly lkg: CandidateVersionRecord | null }>;
  readonly readPublicationBase?: (recordClass:RoutineRecordClass,scope:string)=>Promise<RoutinePublicationBase>;
  readonly readFederalMoneyPartitionKeys?: (scope:string,ids:readonly string[])=>Promise<FederalMoneyPartitionKeys|null>;
  readonly readFederalMoneyPriorPlaces?: (candidateId:string)=>Promise<readonly string[]>;
  readonly readPromotion: <T = unknown>(recordClass: RoutineRecordClass, scope: string) => Promise<PromotedProjection<T> | null>;
  readonly readCandidates: (candidateIds: readonly string[]) => Promise<readonly CandidateVersionReadback[]>;
  readonly readPublishedCandidateMetadata: (candidateId: string) => Promise<PublishedCandidateMetadata | null>;
  readonly readCandidateProof?: (candidateId: string) => Promise<CandidateVersionRecord | null>;
  readonly readCandidateProofs?: (candidateIds: readonly string[]) => Promise<readonly CandidateVersionReadback[]>;
  /** Potential bill matches only; callers still prove every selected version. */
  readonly historicalVoteBillVersions?: (candidateIds: readonly string[], bill: string) => Promise<readonly string[]>;
  readonly confirmUnchanged?: (input: ConfirmUnchangedInput, at: string) => Promise<ConfirmUnchangedOutcome>;
  readonly readPromotions: <T = unknown>(recordClass: RoutineRecordClass, scopes: readonly string[]) => Promise<readonly PromotedProjection<T>[]>;
  readonly readPromotionIdentity: (recordClass: RoutineRecordClass, scope: string) => Promise<PromotedPointerIdentity | null>;
  readonly readSourceHead: (recordClass: RoutineRecordClass, scope: string) => Promise<SourceHead | null>;
  readonly recordSourceCheck?: (input: RecordPublishedSourceCheck) => Promise<boolean>;
  readonly readSourceChecks?: (recordClass: RoutineRecordClass, scope: string, sourceKeys: readonly string[]) => Promise<readonly PublishedSourceCheck[]>;
  readonly readPromotionIdentities: (recordClass: RoutineRecordClass, scopes: readonly string[]) => Promise<readonly PromotedPointerIdentity[]>;
  /** The current portrait record's input versions and next due time, without the record itself. */
  readonly readPortraitRunState: (scope: string) => Promise<PortraitRunState | null>;
  /** Promoted rosters' people, slimmed to what a portrait list needs. */
  readonly readSlimRosters: (recordClass: RoutineRecordClass, scopes: readonly string[]) => Promise<readonly SlimRoster[]>;
  readonly readOfficeRoster: (scope: string) => Promise<SlimRoster | null>;
  /** Each promoted roster's people as a short digest of their ids, which moves only when someone joins or leaves. */
  readonly readRosterIdDigests: (recordClass: RoutineRecordClass, scopes: readonly string[]) => Promise<readonly { readonly scope: string; readonly digest: string }[]>;
  /** A stored candidate's saved captures whose address, or extracted archive member, is one of these. */
  readonly readCandidateCaptures: (candidateId: string, urls: readonly string[], members: readonly string[]) => Promise<readonly unknown[]>;
  /** Named top-level fields of a pointer's payload, without the rest of it. */
  readonly readPromotionPayloadFields: (recordClass: RoutineRecordClass, scope: string, keys: readonly string[]) => Promise<Readonly<Record<string, unknown>> | null>;
  /** One part of a stored candidate, by path, without the rest of it; undefined when the candidate or the path is absent. */
  readonly readCandidateField: (candidateId: string, path: readonly string[]) => Promise<unknown>;
  readonly listPromotionScopes?: (recordClasses: readonly RoutineRecordClass[]) => Promise<readonly { recordClass: RoutineRecordClass; scope: string }[]>;
  readonly promote: (candidateId: string, receipt: ValidationReceipt, at: string, options?: CandidateTransitionOptions) => Promise<PromotedProjection>;
  readonly appendEvidence: (candidateId: string, state: CandidateState, at: string, detail: string) => Promise<CandidateEvent>;
  readonly events: (candidateId: string) => Promise<readonly CandidateEvent[]>;
  readonly latestReaderReadbacks?: (candidateIds: readonly string[]) => Promise<readonly CandidateEvent[]>;
  readonly pointerMoveEvents?: (candidateId: string) => Promise<readonly CandidateEvent[]>;
  readonly pointerMoveChain?: (key: string, currentId: string) => Promise<readonly CandidateEvent[]>;
  readonly clock: (
    sourceId: string,
    recordClass: RoutineRecordClass,
    scope: string,
    parserVersion?: string,
  ) => Promise<RoutineStoreClock>;
}

/** The fact a portrait record carries to say when its next photo is due and which inputs its last list was built from. */
export const PORTRAIT_SCHEDULE_CODE = "PEOPLE_PORTRAIT_SCHEDULE";
/** The input versions and local roster fingerprint a state's people-without-portraits list was built from. */
export interface PortraitStamp {
  readonly versions: Readonly<Record<string, string>>;
  readonly local: string | null;
}
type PortraitAttemptFact = NonNullable<RoutineCandidate["excludedFacts"]>[number];
/** What the last portrait run saw, when a person without a portrait is next due, and each person's attempts. */
export interface PortraitRunState {
  readonly nextDueAt: string | null;
  readonly seen: PortraitStamp | null;
  readonly attempts: readonly PortraitAttemptFact[];
}
const portraitAttemptCode = (code: string) => code.startsWith("STATE_PORTRAIT_") || code.startsWith("CONGRESS_PORTRAIT_");
function portraitRunState(candidate: RoutineCandidate): PortraitRunState {
  const facts = candidate.excludedFacts ?? [];
  const schedule = facts.find(fact => fact.code === PORTRAIT_SCHEDULE_CODE)?.record as { nextDueAt?: string | null; seen?: PortraitStamp } | undefined;
  return { nextDueAt: schedule?.nextDueAt ?? null, seen: schedule?.seen ?? null,
    attempts: facts.filter(fact => portraitAttemptCode(fact.code)).map(fact => structuredClone(fact)) };
}
/** A person's fields a portrait list and its work need; offices, memberships' sources and most field receipts stay behind. */
const ROSTER_PERSON_HEAVY_FIELDS = ["offices", "fieldSources"] as const;
const OFFICE_PERSON_FIELDS = ["id", "name", "officeTitle", "personId", "nativeIds", "level", "state", "phone", "provenance", "offices"] as const;
function officeRosterPerson(person: Record<string, unknown>): Record<string, unknown> {
  const fields = person.fieldSources as Record<string, unknown> | undefined;
  return { ...Object.fromEntries(OFFICE_PERSON_FIELDS.flatMap(key => Object.hasOwn(person, key) ? [[key, person[key]]] : [])),
    provenance: { sourceOrg: (person.provenance as Record<string, unknown> | undefined)?.sourceOrg },
    ...(fields ? { fieldSources: Object.fromEntries(["phone", "offices"].flatMap(key => Object.hasOwn(fields, key) ? [[key, fields[key]]] : [])) } : {}) };
}

function slimRosterPerson(person: Record<string, unknown>): Record<string, unknown> {
  const fieldSources = person.fieldSources as Record<string, unknown> | undefined;
  const kept = Object.fromEntries(["name", "officeTitle", "photo"].flatMap(field => fieldSources?.[field] ? [[field, fieldSources[field]]] : []));
  const slim = Object.fromEntries(Object.entries(person).filter(([key]) => !(ROSTER_PERSON_HEAVY_FIELDS as readonly string[]).includes(key)));
  return { ...slim, fieldSources: kept };
}
/** One promoted roster's people without their offices and field receipts, and the identity its read model hash names. */
export interface SlimRoster {
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly versionId: string;
  readonly promotedAt: string;
  readonly readModelSha256: string | null;
  readonly roster: OfficeholderSet;
}

export interface RoutineStoreClock {
  readonly publishedScopeVersions?: readonly string[];
  readonly failureStreak?: number;
  readonly lastAttemptedAt?: string;
  readonly lastSucceededAt?: string;
  readonly lastSucceededObservedAt?: string;
  /** Returned for a parser-scoped clock; the prior GOOD keeps its original source timestamps. */
  readonly lastSucceededParserVersion?: string;
  readonly sittingStarts?: readonly string[];
  readonly continuationPending?: boolean;
}

/** Every pointer move's event detail begins with this (both stores' `promote`). */
export const POINTER_MOVE_DETAIL_PREFIX = "Atomic pointer ";

export function newestReaderReadback(events: readonly CandidateEvent[]): CandidateEvent | null {
  return events
    .filter((event) => event.detail.startsWith(READER_PROJECTION_READBACK_PREFIX))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at) || right.sequence - left.sequence)[0] ?? null;
}

export async function readLatestReaderReadbacks(
  store: Pick<RoutineDataStore, "events" | "latestReaderReadbacks">,
  candidateIds: readonly string[],
): Promise<readonly CandidateEvent[]> {
  if (typeof store.latestReaderReadbacks === "function") return store.latestReaderReadbacks(candidateIds);
  const latest: CandidateEvent[] = [];
  for (const candidateId of candidateIds) {
    const newest = newestReaderReadback(await store.events(candidateId));
    if (newest !== null) latest.push(newest);
  }
  return latest;
}

export async function readPointerMoveEvents(
  store: Pick<RoutineDataStore, "events" | "pointerMoveEvents">,
  candidateId: string,
): Promise<readonly CandidateEvent[]> {
  if (typeof store.pointerMoveEvents === "function") return store.pointerMoveEvents(candidateId);
  return (await store.events(candidateId)).filter(isPointerMoveEvent);
}

function isPointerMoveEvent(event: CandidateEvent): boolean {
  return event.state === "PROMOTED" && event.detail.startsWith(POINTER_MOVE_DETAIL_PREFIX);
}

type RegisteredMutationContract = {
  readonly id: string;
  readonly kind: "routine" | "manual";
  readonly readerProjectionId: string | null;
};

export type CandidateAuthorityIdentity = Pick<RoutineCandidate, "id" | "sourceId" | "recordClass" | "scope" | "bootstrapImport">;

function registeredMutationContract(
  candidate: Pick<RoutineCandidate, "sourceId" | "recordClass" | "scope">,
): RegisteredMutationContract | null {
  if (candidate.sourceId === MEETING_HISTORY_SOURCE_ID && candidate.recordClass === "MEETING") {
    const partition = meetingPartitionForHistoryScope(candidate.scope);
    return partition === null
      ? null
      : { id: partition.id, kind: "routine", readerProjectionId: meetingHistoryContract(partition).readerProjection!.id };
  }
  const routine = [...ROUTINE_SOURCE_CONTRACTS, ...RUNTIME_ROUTINE_CONTRACTS, ...MEETING_PARTITION_CONTRACTS]
    .filter((contract) =>
      contract.sourceId === candidate.sourceId &&
      contract.recordClass === candidate.recordClass &&
      (contract.scope === candidate.scope ||
        ("fanOut" in contract && contract.fanOut === true && candidate.scope.startsWith(`${contract.sourceId}:`)))
    )
    .map((contract) => ({
      id: contract.id,
      kind: "routine" as const,
      readerProjectionId: contract.readerProjection?.id ??
        sourceScopedReaderReadbackProjectionId(contract.id),
    }));
  const manual = MANUAL_PRODUCTION_SOURCE_CONTRACTS
    .filter((contract) =>
      contract.sourceId === candidate.sourceId &&
      contract.recordClass === candidate.recordClass &&
      (contract.scope === candidate.scope || isScopedManualContractScope(contract.id, candidate.scope))
    )
    .map((contract) => ({
      id: contract.id,
      kind: "manual" as const,
      readerProjectionId: contract.readerProjection.id,
    }));
  const matches = [...routine, ...manual];
  return matches.length === 1 ? matches[0] : null;
}

export function routineDataStoreCandidateAuthorityIssue(
  candidate: CandidateAuthorityIdentity,
  authority: RuntimeAuthorityEnvelope,
  operation: "candidate" | "reader-evidence",
): string | null {
  const contract = registeredMutationContract(candidate);
  if (contract === null) return "candidate does not identify exactly one registered production contract";
  const hasAuthorityTransferMarker = Object.prototype.hasOwnProperty.call(candidate, "bootstrapImport") &&
    candidate.bootstrapImport !== undefined;
  if (authority.capability === "ROUTINE_SUPERVISOR") {
    return operation === "reader-evidence"
      ? null
      : `routine supervisor cannot mutate source candidate ${contract.id}`;
  }
  // The one-time federal people split publishes place directories and member positions, and nothing else.
  if (authority.capability === "FEDERAL_PEOPLE_SPLIT") {
    return !hasAuthorityTransferMarker && (federalDirectoryStateOf(contract.id) !== null || contract.id === "congress-rollcalls")
      ? null : `the federal people split cannot mutate ${contract.id}`;
  }
  // A state's calendar program writes only its own state's boards and their history.
  if (authority.capability === "STATE_CALENDARS") {
    return !hasAuthorityTransferMarker && contract.kind === "routine" && stateCalendarsCovers(authority.contract, contract.id)
      ? null : `${authority.contract ?? "a state calendar program"} cannot mutate ${contract.id}`;
  }
  if (authority.capability === "MANUAL_CONTRACT" && authority.contract === "congress-bulk-roster") {
    return !hasAuthorityTransferMarker && contract.kind === "manual" && federalDirectoryStateOf(contract.id) !== null
      ? null : `the national Congress read cannot mutate ${contract.id}`;
  }
  if (!hasAuthorityTransferMarker && contract.kind === "manual" && candidacyRegistryAuthority(authority, contract.id)) return null;
  const expectedCapability = contract.kind === "manual" ? "MANUAL_CONTRACT" : "ROUTINE_CONTRACT";
  if (authority.capability !== expectedCapability) {
    return `contract ${contract.id} requires ${expectedCapability}, not ${authority.capability}`;
  }
  if (authority.contract !== contract.id) {
    return `authority for ${authority.contract ?? "no contract"} cannot mutate ${contract.id}`;
  }
  if (hasAuthorityTransferMarker) {
    return `ordinary ${expectedCapability} authority cannot write an authority-transfer marker`;
  }
  return null;
}

export function assertRoutineDataStoreMutationAuthority(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeAuthorityEnvelope {
  assertWriteAllowed(CIVIC_DATA_PROMOTION_OPERATION, env);
  const admitted = assertSanctionedRuntimeAuthority(CIVIC_DATA_PROMOTION_OPERATION, env);
  const authority = runtimeAuthorityEnvelope(env) ?? (env.WTP_RUNTIME_MODE === "staging" ? admitted : null);
  if (authority === null) throw new RuntimeAuthorityRefused("routine data store mutation authority is unreadable");
  return authority;
}

/** Another writer moved the pointer after this candidate validated against it; the stale candidate may not overwrite it. */
export class PromotionBaseChangedError extends Error {
  readonly candidateId: string;
  readonly expectedVersionId: string | null;
  readonly actualVersionId: string | null;

  constructor(
    candidateId: string,
    expectedVersionId: string | null,
    actualVersionId: string | null,
  ) {
    super(
      `PROMOTION_BASE_CHANGED:${candidateId}:expected=${expectedVersionId ?? "NO_POINTER"}:actual=${actualVersionId ?? "NO_POINTER"}`,
    );
    this.name = "PromotionBaseChangedError";
    this.candidateId = candidateId;
    this.expectedVersionId = expectedVersionId;
    this.actualVersionId = actualVersionId;
  }
}

type RoutineCandidateName = Pick<RoutineCandidate, "id" | "sourceId" | "recordClass" | "scope">;

function receiptNamesCandidate(receipt: ValidationReceipt, candidate: RoutineCandidateName): boolean {
  return receipt.candidateId === candidate.id &&
    receipt.sourceId === candidate.sourceId &&
    receipt.recordClass === candidate.recordClass &&
    receipt.scope === candidate.scope;
}

function receiptsEqual(left: ValidationReceipt, right: ValidationReceipt): boolean {
  return left === right || canonicalCivicDataHash(left, { durable: true }) === canonicalCivicDataHash(right, { durable: true });
}

function receiptIsGoodForCandidate(receipt: ValidationReceipt, candidate: RoutineCandidateName): boolean {
  const parsed = parseValidationReceipt(receipt);
  return parsed !== null && parsed.decision === "GOOD" && receiptNamesCandidate(parsed, candidate);
}

function persistedPromotionReceipt(
  record: CandidateVersionRecord | null | undefined,
  supplied: ValidationReceipt,
): ValidationReceipt | null {
  const persisted = record?.receipt;
  if (!record || record.state !== "VALIDATED" || !record.acquisitionSucceeded || !persisted) return null;
  if (!receiptIsGoodForCandidate(persisted, record.candidate) || !parseValidationReceipt(supplied)) return null;
  return receiptsEqual(persisted, supplied) ? persisted : null;
}

const TERMINAL_CANDIDATE_STATES = new Set<CandidateState>([
  "SOURCE_BLOCKED",
  "PARSE_INVALID",
  "IDENTITY_UNRESOLVED",
  "TEMPORAL_INVALID",
  "SEMANTIC_INVALID",
  "HORIZON_UNRESOLVED",
  "DEPENDENT_CONSUMER_INVALID",
  "CANNOT_TELL",
]);
const MAX_PROMOTION_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export interface PdcV2CanonicalMeetingFactEvidence {
  readonly sha256: string;
  readonly meetingRowCount: number;
  readonly agendaDocumentRowCount: number;
}

export function pdcV2CanonicalMeetingFactEvidence(
  payloads: readonly unknown[],
): PdcV2CanonicalMeetingFactEvidence {
  const meetings: Array<Readonly<Record<string, unknown>>> = [];
  const agendaDocuments: AgendaDocument[] = [];
  for (const payload of payloads) {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("PDC_V2_MEETING_FACT_PAYLOAD_INVALID");
    }
    const value = payload as { readonly meetings?: unknown; readonly agendaDocuments?: unknown };
    if (!Array.isArray(value.meetings) || !Array.isArray(value.agendaDocuments)) {
      throw new Error("PDC_V2_MEETING_FACT_PAYLOAD_INVALID");
    }
    for (const row of value.meetings) {
      if (
        row === null || typeof row !== "object" || Array.isArray(row) ||
        typeof (row as { readonly id?: unknown }).id !== "string" ||
        !(row as { readonly id: string }).id
      ) throw new Error("PDC_V2_MEETING_FACT_PAYLOAD_INVALID");
      meetings.push(row as Readonly<Record<string, unknown>>);
    }
    for (const row of value.agendaDocuments) {
      if (
        row === null || typeof row !== "object" || Array.isArray(row) ||
        typeof (row as { readonly id?: unknown }).id !== "string" ||
        !(row as { readonly id: string }).id
      ) throw new Error("PDC_V2_MEETING_FACT_PAYLOAD_INVALID");
      agendaDocuments.push(canonicalAgendaDocument(row as AgendaDocument));
    }
  }
  meetings.sort((left, right) =>
    (left.id as string).localeCompare(right.id as string) ||
    canonicalCivicDataJson(left).localeCompare(canonicalCivicDataJson(right))
  );
  agendaDocuments.sort((left, right) =>
    left.id.localeCompare(right.id) ||
    canonicalCivicDataJson(left).localeCompare(canonicalCivicDataJson(right))
  );
  if (
    new Set(meetings.map(({ id }) => id)).size !== meetings.length ||
    new Set(agendaDocuments.map(({ id }) => id)).size !== agendaDocuments.length
  ) throw new Error("PDC_V2_MEETING_FACT_IDENTITY_DUPLICATED");
  return {
    sha256: canonicalCivicDataHash({ meetings, agendaDocuments }),
    meetingRowCount: meetings.length,
    agendaDocumentRowCount: agendaDocuments.length,
  };
}

function validEventInput(event: CandidateEvent): boolean {
  return Number.isFinite(Date.parse(event.at)) && event.detail.trim() !== "";
}

function assertInitialRecord(record: CandidateVersionRecord, firstEvent: CandidateEvent): void {
  const candidateId = record.candidate.id;
  const retrievedAt = Date.parse(record.candidate.retrieval.retrievedAt);
  const firstEventAt = Date.parse(firstEvent.at);
  if (
    firstEvent.candidateId !== candidateId ||
    firstEvent.sequence !== 1 ||
    firstEvent.state !== record.state ||
    !validEventInput(firstEvent) ||
    !Number.isFinite(retrievedAt) ||
    firstEventAt > Date.now() + MAX_PROMOTION_CLOCK_SKEW_MS
  ) {
    throw new Error(`CANDIDATE_INITIAL_EVENT_INVALID:${candidateId}`);
  }
  if (record.candidate.retrieval.succeeded !== record.acquisitionSucceeded) {
    throw new Error(`CANDIDATE_ACQUISITION_PROOF_MISMATCH:${candidateId}`);
  }
  if (record.state === "FETCHED") {
    if (
      !record.acquisitionSucceeded ||
      record.receipt !== null ||
      record.failureCode !== null ||
      record.failureDetail !== null ||
      record.promotedVersion !== null
    ) {
      throw new Error(`CANDIDATE_INITIAL_STATE_INVALID:${candidateId}:FETCHED`);
    }
    return;
  }
  if (record.state === "SOURCE_BLOCKED") {
    const parsed = parseValidationReceipt(record.receipt);
    const firstFailure = parsed?.checks.find((check) => check.verdict !== "PASS");
    if (
      record.acquisitionSucceeded ||
      parsed === null ||
      parsed.decision === "GOOD" ||
      !receiptNamesCandidate(parsed, record.candidate) ||
      Date.parse(parsed.validatedAt) !== firstEventAt ||
      !firstFailure ||
      record.failureCode !== firstFailure.code ||
      record.failureDetail !== firstFailure.detail ||
      record.promotedVersion !== null
    ) {
      throw new Error(`CANDIDATE_INITIAL_STATE_INVALID:${candidateId}:SOURCE_BLOCKED`);
    }
    return;
  }
  throw new Error(`CANDIDATE_INITIAL_STATE_INVALID:${candidateId}:${record.state}`);
}

function allowedPriorStates(next: CandidateState): readonly CandidateState[] {
  if (next === "NORMALIZED") return ["FETCHED"];
  if (next === "VALIDATED") return ["NORMALIZED"];
  if (TERMINAL_CANDIDATE_STATES.has(next)) return ["FETCHED", "NORMALIZED", "VALIDATED"];
  return [];
}

interface TransitionSubject {
  readonly state: CandidateState;
  readonly candidate: RoutineCandidateName & { readonly retrieval: Pick<RoutineCandidate["retrieval"], "retrievedAt"> };
}

function assertTransitionInput(
  record: TransitionSubject,
  state: CandidateState,
  at: string,
  detail: string,
  receipt?: ValidationReceipt,
  failure?: { code: string; detail: string },
): void {
  const candidateId = record.candidate.id;
  if (!Number.isFinite(Date.parse(at)) || detail.trim() === "") {
    throw new Error(`CANDIDATE_TRANSITION_EVIDENCE_INVALID:${candidateId}:${state}`);
  }
  if (Date.parse(at) > Date.now() + MAX_PROMOTION_CLOCK_SKEW_MS) {
    throw new Error(`CANDIDATE_TRANSITION_EVIDENCE_INVALID:${candidateId}:${state}`);
  }
  if (!allowedPriorStates(state).includes(record.state)) {
    throw new Error(`CANDIDATE_TRANSITION_INVALID:${candidateId}:${record.state}:${state}`);
  }
  if (state === "NORMALIZED") {
    if (receipt !== undefined || failure !== undefined) {
      throw new Error(`CANDIDATE_TRANSITION_EVIDENCE_INVALID:${candidateId}:${state}`);
    }
    return;
  }
  const parsed = parseValidationReceipt(receipt);
  if (
    parsed === null ||
    !receiptNamesCandidate(parsed, record.candidate) ||
    Date.parse(parsed.validatedAt) !== Date.parse(at)
  ) {
    throw new Error(`CANDIDATE_TRANSITION_RECEIPT_INVALID:${candidateId}:${state}`);
  }
  if (state === "VALIDATED") {
    if (
      parsed.decision !== "GOOD" ||
      failure !== undefined ||
      Date.parse(parsed.validatedAt) < Date.parse(record.candidate.retrieval.retrievedAt)
    ) {
      throw new Error(`CANDIDATE_TRANSITION_RECEIPT_INVALID:${candidateId}:${state}`);
    }
    return;
  }
  const firstFailure = parsed.checks.find((check) => check.verdict !== "PASS");
  if (
    parsed.decision === "GOOD" ||
    !firstFailure ||
    !failure ||
    failure.code !== firstFailure.code ||
    failure.detail !== firstFailure.detail ||
    failure.code.trim() === "" ||
    failure.detail.trim() === ""
  ) {
    throw new Error(`CANDIDATE_TRANSITION_RECEIPT_INVALID:${candidateId}:${state}`);
  }
}

function assertPromotionTime(
  record: CandidateVersionRecord,
  receipt: ValidationReceipt,
  at: string,
  nowMs: number = Date.now(),
): void {
  const retrievedAt = Date.parse(record.candidate.retrieval.retrievedAt);
  const validatedAt = Date.parse(receipt.validatedAt);
  const promotedAt = Date.parse(at);
  if (
    ![retrievedAt, validatedAt, promotedAt].every(Number.isFinite) ||
    retrievedAt > validatedAt ||
    validatedAt > promotedAt ||
    promotedAt > nowMs + MAX_PROMOTION_CLOCK_SKEW_MS
  ) {
    throw new Error(`CANDIDATE_PROMOTION_TIME_INVALID:${record.candidate.id}`);
  }
}

function assertReaderEvidenceInput(
  record: { readonly state: CandidateState; readonly candidate: CandidateAuthorityIdentity },
  state: CandidateState,
  at: string,
  detail: string,
  authority?: RuntimeAuthorityEnvelope,
): void {
  const candidate = record.candidate;
  const receipt = parseReaderProjectionReadback(detail);
  const contract = registeredMutationContract(candidate);
  if (
    record.state !== "PROMOTED" ||
    state !== "PROMOTED" ||
    receipt === null ||
    contract === null ||
    contract.readerProjectionId === null ||
    receipt.contractId !== contract.id ||
    receipt.sourceId !== candidate.sourceId ||
    receipt.recordClass !== candidate.recordClass ||
    receipt.scope !== candidate.scope ||
    receipt.projectionId !== contract.readerProjectionId ||
    receipt.versionId !== candidate.id ||
    receipt.pointerKey !== projectionKey(candidate.recordClass, candidate.scope) ||
    isoTime(receipt.observedAt) !== isoTime(at) ||
    Date.parse(at) > Date.now() + MAX_PROMOTION_CLOCK_SKEW_MS ||
    (authority !== undefined && receipt.verifierCodeSha !== authority.sha)
  ) {
    throw new Error(`CANDIDATE_READER_EVIDENCE_INVALID:${candidate.id}`);
  }
}

function isoTime(value: string): string | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** Normalize Drizzle's timestamptz text to canonical UTC at the adapter boundary, failing closed, so hashes stay exact. */
export function canonicalPostgresRoutineTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`CIVIC_DATA_POSTGRES_TIMESTAMP_INVALID:${field}`);
  }
  const canonical = isoTime(value);
  if (canonical === null) {
    throw new Error(`CIVIC_DATA_POSTGRES_TIMESTAMP_INVALID:${field}`);
  }
  return canonical;
}

interface PromotionPointerProof {
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly versionId: string;
  readonly lastKnownGoodVersionId: string;
  readonly receipt: ValidationReceipt;
}

/** The only candidate fields the routine clock reads. It runs for every task on every pass, so widening it is a cost decision. */
export const ROUTINE_CLOCK_CANDIDATE_FIELDS = {
  top: ["id", "sourceId", "recordClass", "scope", "bootstrapImport", "stateRetirement"],
  retrieval: ["retrievedAt", "sourceCheck"],
  normalization: ["parserVersion"],
} as const;

type RoutineClockCandidate = Pick<RoutineCandidate, "id" | "sourceId" | "recordClass" | "scope" | "bootstrapImport" | "stateRetirement"> & {
  readonly retrieval: Pick<RoutineCandidate["retrieval"], "retrievedAt" | "sourceCheck">;
  readonly normalization: Pick<RoutineCandidate["normalization"], "parserVersion">;
};

export type RoutineClockRecord = Omit<CandidateVersionRecord, "candidate"> & {
  readonly candidate: RoutineClockCandidate;
};

/** Postgres `jsonb_strip_nulls`: object fields holding null go, recursively; array elements stay. */
function stripJsonNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripJsonNulls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, field]) => (field === null || field === undefined ? [] : [[key, stripJsonNulls(field)]])),
  );
}

/** The in-memory twin of the Postgres clock view: same fields, same null handling. */
export function routineClockCandidateView(candidate: RoutineCandidate): RoutineClockCandidate {
  const source = candidate as unknown as Readonly<Record<string, unknown>>;
  const retrieval = (candidate.retrieval ?? {}) as unknown as Readonly<Record<string, unknown>>;
  const normalization = (candidate.normalization ?? {}) as unknown as Readonly<Record<string, unknown>>;
  return stripJsonNulls({
    ...Object.fromEntries(ROUTINE_CLOCK_CANDIDATE_FIELDS.top.map((field) => [field, source[field] ?? null])),
    retrieval: Object.fromEntries(ROUTINE_CLOCK_CANDIDATE_FIELDS.retrieval.map((field) => [field, retrieval[field] ?? null])),
    normalization: Object.fromEntries(ROUTINE_CLOCK_CANDIDATE_FIELDS.normalization.map((field) => [field, normalization[field] ?? null])),
  }) as RoutineClockCandidate;
}

function proofConsistentPointedSuccess(
  record: RoutineClockRecord | null | undefined,
  pointer: PromotionPointerProof | null | undefined,
): record is RoutineClockRecord {
  const receipt = record?.receipt;
  if (!record || !pointer || record.state !== "PROMOTED" || !record.acquisitionSucceeded || !receipt) return false;
  if (pointer.versionId !== record.candidate.id || pointer.lastKnownGoodVersionId !== record.candidate.id) return false;
  if (record.promotedVersion !== record.candidate.id || record.lastKnownGoodVersion !== record.candidate.id) return false;
  if (pointer.sourceId !== record.candidate.sourceId || pointer.recordClass !== record.candidate.recordClass || pointer.scope !== record.candidate.scope) return false;
  if (!receiptIsGoodForCandidate(receipt, record.candidate)) return false;
  if (!receiptsEqual(pointer.receipt, receipt)) return false;
    // Imports and state moves retain facts without a publisher acquisition.
  return !isImportOrStateMoveCandidate(record.candidate);
}

export function proofConsistentSuccess(
  record: RoutineClockRecord | null | undefined,
  pointer: PromotionPointerProof | null | undefined,
): string | undefined {
  return proofConsistentPointedSuccess(record, pointer) ? record.candidate.retrieval.retrievedAt : undefined;
}

/** The claimed retrieval precedes the store-observed first event, so the attempt clock compares against this one. */
export function proofConsistentObservedSuccess(
  record: RoutineClockRecord | null | undefined,
  pointer: PromotionPointerProof | null | undefined,
  observedAt: string | null | undefined,
): string | undefined {
  if (!proofConsistentPointedSuccess(record, pointer)) return undefined;
  return sourceCheckedAt(record.candidate.retrieval, observedAt);
}

export function meetingPayloadSittingStarts(payload: unknown): readonly string[] {
  const meetings = payload && typeof payload === "object" ? (payload as { meetings?: unknown }).meetings : undefined;
  if (!Array.isArray(meetings)) return [];
  return meetings.flatMap((meeting) => {
    const start = meeting && typeof meeting === "object" ? (meeting as { startsAt?: unknown }).startsAt : undefined;
    return typeof start === "string" ? [start] : [];
  });
}

/** An import is neither an attempt nor a success; a live attempt made since the import's pointer move is an attempt. */
export function trustedLkgImportClock(
  lastAttemptedAt: string | undefined,
  importPromotedAt: string,
): { readonly lastAttemptedAt?: string } {
  const attempted = lastAttemptedAt === undefined ? Number.NaN : Date.parse(lastAttemptedAt);
  const imported = Date.parse(importPromotedAt);
  return Number.isFinite(attempted) && Number.isFinite(imported) && attempted > imported
    ? { lastAttemptedAt: lastAttemptedAt! }
    : {};
}

export function candidateVersionSummary(record: CandidateVersionRecord): CandidateVersionSummary {
  const { candidate, ...columns } = record;
  const { excludedFacts: _facts, ...receipt } = record.receipt ?? {};
  return {
    ...columns,
    receipt: record.receipt ? receipt as CandidateVersionSummary["receipt"] : null,
    candidate: { id: candidate.id, sourceId: candidate.sourceId, recordClass: candidate.recordClass, scope: candidate.scope },
  };
}

export function promotedPointerIdentity(pointer: PromotedPointerIdentity): PromotedPointerIdentity {
  return {
    key: pointer.key,
    sourceId: pointer.sourceId,
    recordClass: pointer.recordClass,
    scope: pointer.scope,
    versionId: pointer.versionId,
    lastKnownGoodVersionId: pointer.lastKnownGoodVersionId,
    promotedAt: pointer.promotedAt,
    ...(pointer.latestConfirmation ? { latestConfirmation: pointer.latestConfirmation } : {}),
  };
}

export async function routineEventObservedAt(
  store: RoutineDataStore,
  recordClass: RoutineRecordClass,
  scope: string,
  requestedAt: string,
): Promise<string> {
  return store.eventObservedAt ? store.eventObservedAt(recordClass, scope, requestedAt) : requestedAt;
}

/* A held candidate and read model are frozen JSON, so every row shares them; the small fields around them are copied. */
function heldRecord(row: CandidateVersionRecord): CandidateVersionRecord {
  return { ...structuredClone({ ...row, candidate: null }), candidate: freezeDurableJson(row.candidate) };
}
function heldProjection(row: PromotedProjection): PromotedProjection {
  return { ...structuredClone({ ...row, payload: null }), payload: freezeDurableJson(row.payload) };
}

export class MemoryRoutineDataStore implements RoutineDataStore {
  private readonly candidates = new Map<string, CandidateVersionRecord>();
  private readonly history = new Map<string, CandidateEvent[]>();
  private readonly promotions = new Map<string, PromotedProjection>();
  private readonly sourceChecks = new Map<string, RecordPublishedSourceCheck>();
  async readPortraitRunState(scope: string): Promise<PortraitRunState | null> {
    const pointer = this.promotions.get(projectionKey("STATE_LEGISLATOR", scope));
    const record = pointer ? this.candidates.get(pointer.versionId) : undefined;
    return record ? portraitRunState(record.candidate) : null;
  }

  async readSlimRosters(recordClass: RoutineRecordClass, scopes: readonly string[]): Promise<readonly SlimRoster[]> {
    return scopes.flatMap(scope => {
      const pointer = this.promotions.get(projectionKey(recordClass, scope));
      const record = pointer ? this.candidates.get(pointer.versionId) : undefined;
      const roster = (pointer?.payload as { roster?: OfficeholderSet } | undefined)?.roster;
      if (!pointer || !record || !roster || !Array.isArray(roster.officeholders)) return [];
      return [{ recordClass, scope, versionId: pointer.versionId, promotedAt: pointer.promotedAt,
        readModelSha256: record.candidate.normalization.normalizedHash ?? null,
        roster: structuredClone({ ...roster, officeholders: roster.officeholders.map(row => slimRosterPerson(row as unknown as Record<string, unknown>)) }) as unknown as OfficeholderSet }];
    });
  }

  async readOfficeRoster(scope: string): Promise<SlimRoster | null> {
    const pointer = this.promotions.get(projectionKey("STATE_LEGISLATOR", scope));
    const record = pointer ? this.candidates.get(pointer.versionId) : undefined;
    const roster = (pointer?.payload as { roster?: OfficeholderSet } | undefined)?.roster;
    if (!pointer || !record || !roster || !Array.isArray(roster.officeholders)) return null;
    return { recordClass: "STATE_LEGISLATOR", scope, versionId: pointer.versionId, promotedAt: pointer.promotedAt,
      readModelSha256: record.candidate.normalization.normalizedHash ?? null,
      roster: structuredClone({ scope: roster.scope, generatedAt: roster.generatedAt, divisions: [], unmatched: [],
        officeholders: roster.officeholders.map(person => officeRosterPerson(person as unknown as Record<string, unknown>)) }) as unknown as OfficeholderSet };
  }

  private memberOfficeProgress: MemberOfficeProgress | undefined;
  async readMemberOfficeProgress(): Promise<MemberOfficeProgress> {
    if (this.memberOfficeProgress) return structuredClone(this.memberOfficeProgress);
    const held = await this.readPromotionPayloadFields("CURATED_READER_RECORD", MEMBER_OFFICES_SCOPE, ["rosterDigests", "pending"]);
    return { rosterDigests: (held?.rosterDigests ?? {}) as Record<string,string>, pending: (held?.pending ?? []) as string[] };
  }
  async writeMemberOfficeProgress(progress: MemberOfficeProgress): Promise<void> { this.memberOfficeProgress = structuredClone(progress); }
  async readMemberOfficeMembers(members: readonly string[]): Promise<readonly import("../officials/member-offices.ts").MemberOfficeRecord[]> {
    const records=await Promise.all([...new Set([...this.promotions.values()].filter(pointer=>memberOfficeScopeState(pointer.scope)).map(pointer=>memberOfficeScopeState(pointer.scope)!))]
      .map(state=>this.readMemberOfficeSlice(state,members)));
    const overridden=new Set(records.filter(Boolean).map(slice=>memberOfficeScopeState(slice!.scope)));
    const legacy=this.promotions.get(projectionKey("CURATED_READER_RECORD",MEMBER_OFFICES_SCOPE));
    const old=((legacy?.payload as {records?:readonly import("../officials/member-offices.ts").MemberOfficeRecord[]})?.records??[])
      .filter(row=>members.includes(row.officeholderId)&&!overridden.has(memberOfficeRecordState(row,MEMBER_OFFICES_SCOPE)));
    return structuredClone([...records.flatMap(slice=>slice?.records??[]),...old]);
  }
  async readMemberOfficeSlice(state: string, members: readonly string[] = []): Promise<MemberOfficeSlice | null> {
    const scope = memberOfficeStateScope(state), postal = memberOfficeScopeState(scope)!;
    const pointer = this.promotions.get(projectionKey("CURATED_READER_RECORD", scope)) ?? this.promotions.get(projectionKey("CURATED_READER_RECORD", MEMBER_OFFICES_SCOPE));
    const record = pointer ? this.candidates.get(pointer.versionId) : null;
    if (!pointer || !record) return null;
    if (record.state !== "PROMOTED" || pointer.receipt.decision !== "GOOD") throw new Error(`MEMBER_OFFICE_POINTER_INVALID:${pointer.scope}`);
    const records = ((pointer.payload as { records?: readonly import("../officials/member-offices.ts").MemberOfficeRecord[] }).records ?? []).filter(row =>
      memberOfficeRecordState(row, pointer.scope) === postal && (!members.length || members.includes(row.officeholderId)));
    const urls = new Set(records.flatMap(manualRecordSourceUrls));
    const sources = (record.candidate.retrieval.manualSourceReceipt?.sources ?? []).filter(source => source.reviewOutcome !== "BLOCKED" && manualSourceUrls(source).some(url => urls.has(url)))
      .map(source => source.extractedMembers ? { ...source, extractedMembers: source.extractedMembers.filter(member => member.path.startsWith(`data/${postal.toLowerCase()}/`)) } : source);
    return structuredClone({ scope: pointer.scope, versionId: pointer.versionId, sourceId: pointer.sourceId, promotedAt: pointer.promotedAt,
      retrievedAt: record.candidate.retrieval.retrievedAt, sourceThrough: record.candidate.temporal.sourceThrough, version: record.candidate.temporal.version, staleAtRetrieval: record.candidate.temporal.staleAtRetrieval,
      receipt: { ...pointer.receipt, excludedFacts: [] }, ...(latestUnchangedConfirmation(this.history.get(pointer.versionId)??[],pointer.versionId) ? {latestConfirmation:latestUnchangedConfirmation(this.history.get(pointer.versionId)??[],pointer.versionId)!}: {}), records, sources,
      header: Object.fromEntries(Object.entries(pointer.payload as Record<string,unknown>).filter(([key]) => key !== "records")),
      normalization: { normalizedHash: record.candidate.normalization.normalizedHash, stateRecordHashes: record.candidate.normalization.stateRecordHashes } });
  }

  async readRosterIdDigests(recordClass: RoutineRecordClass, scopes: readonly string[]): Promise<readonly { readonly scope: string; readonly digest: string }[]> {
    return scopes.flatMap(scope => {
      const officeholders = (this.promotions.get(projectionKey(recordClass, scope))?.payload as { roster?: OfficeholderSet } | undefined)?.roster?.officeholders;
      if (!Array.isArray(officeholders)) return [];
      const ids = officeholders.map(row => row.id).sort();
      return [{ scope, digest: `${ids.length}:${createHash("md5").update(ids.join(",")).digest("hex")}` }];
    });
  }

  async readCandidateCaptures(candidateId: string, urls: readonly string[], members: readonly string[]): Promise<readonly unknown[]> {
    const captures = (this.candidates.get(candidateId)?.candidate.normalizedPayload as { captures?: unknown } | undefined)?.captures;
    const wanted = new Set(urls), paths = new Set(members);
    return Array.isArray(captures) ? structuredClone(captures.filter(row => {
      const capture = row as { finalUrl?: string; requestedUrl?: string; extractedFrom?: { member?: string } };
      return wanted.has(capture.finalUrl ?? "") || wanted.has(capture.requestedUrl ?? "") || paths.has(capture.extractedFrom?.member ?? "");
    })) : [];
  }

  async readPromotionPayloadFields(recordClass: RoutineRecordClass, scope: string, keys: readonly string[]): Promise<Readonly<Record<string, unknown>> | null> {
    const pointer = this.promotions.get(projectionKey(recordClass, scope));
    if (!pointer) return null;
    const payload = (pointer.payload ?? {}) as Record<string, unknown>;
    return Object.fromEntries(keys.flatMap(key => payload[key] === undefined ? [] : [[key, structuredClone(payload[key])]]));
  }

  async readCandidateField(candidateId: string, path: readonly string[]): Promise<unknown> {
    let value: unknown = this.candidates.get(candidateId)?.candidate;
    for (const key of path) value = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
    return value === undefined ? undefined : structuredClone(value);
  }

  async readRegistrySlice(state: string, bodyIds: readonly string[], divisionIds: readonly string[]): Promise<RegistryLookup | null> {
    const pointer = this.promotions.get(projectionKey("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope(state)));
    if (!pointer || pointer.receipt.decision !== "GOOD") return null;
    return selectRegistryLookup(pointer.versionId, (pointer.payload as { registry: Registry }).registry, bodyIds, divisionIds);
  }

  async readRegistryDivisions(state: string, labels: readonly string[]): Promise<readonly RegistryDivisionMatch[]> {
    const pointer = this.promotions.get(projectionKey("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope(state)));
    return pointer?.receipt.decision === "GOOD" ? registryDivisionMatches(pointer.payload, state, labels) : [];
  }

  async eventObservedAt(recordClass: RoutineRecordClass, scope: string, requestedAt: string): Promise<string> {
    let latest = Date.parse(requestedAt);
    for (const [id, record] of this.candidates) {
      if (record.candidate.recordClass !== recordClass || record.candidate.scope !== scope) continue;
      for (const event of this.history.get(id) ?? []) latest = Math.max(latest, Date.parse(event.at));
    }
    return new Date(latest).toISOString();
  }

  private nextEvent(
    candidateId: string,
    state: CandidateState,
    at: string,
    detail: string,
  ): { readonly history: CandidateEvent[]; readonly event: CandidateEvent } {
    const history = this.history.get(candidateId) ?? [];
    const prior = history[history.length - 1];
    if (prior && Date.parse(at) < Date.parse(prior.at)) {
      throw new Error(`CANDIDATE_EVENT_TIME_INVALID:${candidateId}:${state}`);
    }
    return {
      history,
      event: { candidateId, sequence: history.length + 1, state, at, detail },
    };
  }

  async create(record: CandidateVersionRecord, firstEvent: CandidateEvent): Promise<void> {
    assertInitialRecord(record, firstEvent);
    if (this.candidates.has(record.candidate.id)) throw new Error(`CANDIDATE_ALREADY_EXISTS:${record.candidate.id}`);
    this.candidates.set(record.candidate.id, heldRecord(record));
    this.history.set(record.candidate.id, [structuredClone(firstEvent)]);
  }

  async transition(candidateId: string, state: CandidateState, at: string, detail: string, receipt?: ValidationReceipt, failure?: { code: string; detail: string }, options: CandidateTransitionOptions = {}): Promise<CandidateVersionRecord> {
    const prior = this.candidates.get(candidateId);
    if (!prior) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
    if (options.candidate && !heldEnvelopeMatches({
      ...prior.candidate,
      rawHash: prior.candidate.retrieval.rawHash ?? null,
      normalizedHash: prior.candidate.normalization.normalizedHash ?? null,
      retrievedAt: prior.candidate.retrieval.retrievedAt,
    }, options.candidate)) {
      throw new Error(`CANDIDATE_TRANSITION_ENVELOPE_MISMATCH:${candidateId}`);
    }
    assertTransitionInput(prior, state, at, detail, receipt, failure);
    const { history, event } = this.nextEvent(candidateId, state, at, detail);
    const next: CandidateVersionRecord = {
      ...prior,
      state,
      receipt: receipt ?? prior.receipt,
      failureCode: failure?.code ?? prior.failureCode,
      failureDetail: failure?.detail ?? prior.failureDetail,
    };
    this.candidates.set(candidateId, heldRecord(next));
    history.push(event);
    this.history.set(candidateId, history);
    return heldRecord(next);
  }

  async readCandidate(candidateId: string): Promise<CandidateVersionRecord | null> {
    const row = this.candidates.get(candidateId);
    return row ? heldRecord(row) : null;
  }

  async readCandidatePath<T = unknown>(candidateId: string, path: readonly string[]): Promise<T | null> {
    let value: unknown = this.candidates.get(candidateId)?.candidate;
    for (const key of path) value = (value as Record<string, unknown> | null)?.[key];
    return value === undefined ? null : structuredClone(value) as T;
  }

  async readCandidateSummary(candidateId: string): Promise<CandidateVersionSummary | null> {
    const row = this.candidates.get(candidateId);
    return row ? structuredClone(candidateVersionSummary(row)) : null;
  }

  private pointerRead(recordClass: RoutineRecordClass, scope: string): PromotedProjection | null {
    const row = this.promotions.get(projectionKey(recordClass, scope));
    if (!row) return null;
    const confirmation = latestUnchangedConfirmation(this.history.get(row.versionId) ?? [], row.versionId);
    return confirmation === null ? row : { ...row, latestConfirmation: confirmation };
  }

  async readPromotion<T = unknown>(recordClass: RoutineRecordClass, scope: string): Promise<PromotedProjection<T> | null> {
    const row = this.pointerRead(recordClass, scope);
    return row ? heldProjection(row) as PromotedProjection<T> : null;
  }

  async readPublicationBase(recordClass:RoutineRecordClass,scope:string):Promise<RoutinePublicationBase> {
    const pointer=this.pointerRead(recordClass,scope),row=pointer?this.candidates.get(pointer.lastKnownGoodVersionId):null;
    return ownPublicationBase(this,recordClass,scope,{current:pointer?heldProjection(pointer):null,
      lkg:row?{...heldRecord(row),candidate:candidateProofView(row.candidate)}:null});
  }

  async readFederalMoneyPriorPlaces(candidateId:string):Promise<readonly string[]> {
    const row=this.candidates.get(candidateId);if(row?.candidate.recordClass!=="FEDERAL_MONEY")return [];
    const model=row.candidate.readModel as import("../federal-money/model.ts").FederalMoneyProjection;
    return [...new Set((model.records??[]).flatMap(fact=>[...fact.bodyIds.map(id=>`body:${id}`),...fact.divisionIds.map(id=>`division:${id}`)]))].sort();
  }

  async readFederalMoneyPartitionKeys(scope:string,ids:readonly string[]):Promise<FederalMoneyPartitionKeys|null> {
    const held=this.pointerRead("FEDERAL_MONEY",scope);if(!held)return null;
    const projection=held.payload as import("../federal-money/model.ts").FederalMoneyProjection;
    return {versionId:held.versionId,sourceId:held.sourceId,state:projection.state,children:[...projection.children??[]],
      records:(projection.records??[]).filter(row=>ids.includes(row.id)).map(({id,sourceId})=>({id,sourceId}))};
  }

  async readPromotions<T = unknown>(
    recordClass: RoutineRecordClass,
    scopes: readonly string[],
  ): Promise<readonly PromotedProjection<T>[]> {
    return scopes.flatMap((scope) => {
      const row = this.pointerRead(recordClass, scope);
      return row ? [heldProjection(row) as PromotedProjection<T>] : [];
    });
  }

  async listPromotionScopes(recordClasses: readonly RoutineRecordClass[]) {
    return [...this.promotions.values()].filter(row => recordClasses.includes(row.recordClass))
      .map(({ recordClass, scope }) => ({ recordClass, scope }));
  }

  async readStateRetirementBaseline(recordClass: RoutineRecordClass, scope: string) {
    const candidates = [...this.candidates.values()].filter(row => row.state === "PROMOTED" && row.receipt?.decision === "GOOD" &&
      row.candidate.recordClass === recordClass && row.candidate.scope === scope &&
      this.history.get(row.candidate.id)?.some(event => event.sequence === 1 && event.detail.startsWith("STATE_BUCKET_RESTORE_V1 ")));
    candidates.sort((left, right) => (this.history.get(right.candidate.id)?.[0]?.at ?? "").localeCompare(this.history.get(left.candidate.id)?.[0]?.at ?? ""));
    const selected = candidates[0]?.candidate;
    return selected?.normalization.stateRecordHashes?.readModelHash === selected?.normalization.normalizedHash
      ? selected?.normalization.stateRecordHashes ?? null : null;
  }

  async hasStateRetirementProof(contractId: string, origin: NonNullable<RoutineCandidate["stateRetirement"]>["origin"]): Promise<boolean> {
    const target = retirementProofTarget(contractId, origin);
    const current = await this.readStateRetirementOrigin(target.record_class, target.scope);
    if (!current?.promoted) return false;
    return [...this.candidates.values()].some(row => {
      const proof = row.candidate.stateRetirement;
      return row.state === "PROMOTED" && row.acquisitionSucceeded && row.receipt?.decision === "GOOD" &&
        row.promotedVersion === row.candidate.id && row.lastKnownGoodVersion === row.candidate.id &&
        row.candidate.recordClass === target.record_class && row.candidate.scope === target.scope && row.candidate.sourceId === target.source_id &&
        proof?.kind === "STATE_AUTHORITY_RETIREMENT" && proof.contractId === contractId && proof.state === target.state &&
        proof.readModelHash === row.candidate.normalization.normalizedHash && proof.origin.versionId === origin.versionId &&
        proof.origin.recordClass === origin.recordClass && proof.origin.scope === origin.scope && proof.origin.readModelHash === origin.readModelHash;
    });
  }

  async readStateRetirementOrigin(recordClass: string, scope: string) {
    const pointer = this.promotions.get(`${recordClass}:${scope}`);
    const row = pointer ? this.candidates.get(pointer.versionId) : null;
    if (!pointer || !row) return null;
    const candidate = row.candidate;
    return { versionId: pointer.versionId, lastKnownGoodVersionId: pointer.lastKnownGoodVersionId,
      sourceId: candidate.sourceId, recordClass: candidate.recordClass, scope: candidate.scope,
      normalizedHash: candidate.normalization.normalizedHash,
      promoted: row.state === "PROMOTED" && row.acquisitionSucceeded && row.promotedVersion === candidate.id &&
        row.lastKnownGoodVersion === candidate.id && pointer.sourceId === candidate.sourceId && row.receipt?.decision === "GOOD" &&
        canonicalCivicDataJson(pointer.receipt) === canonicalCivicDataJson(row.receipt),
      sourceAuthenticity: row.receipt?.checks.find(check => check.check === "SOURCE_AUTHENTICITY" && check.verdict === "PASS")?.code ?? null };
  }

  async readPromotionIdentity(recordClass: RoutineRecordClass, scope: string): Promise<PromotedPointerIdentity | null> {
    const row = this.pointerRead(recordClass, scope);
    return row ? promotedPointerIdentity(row) : null;
  }

  async readSourceHead(recordClass: RoutineRecordClass, scope: string): Promise<SourceHead | null> {
    const pointer = this.promotions.get(projectionKey(recordClass, scope));
    const row = pointer ? this.candidates.get(pointer.versionId) : null;
    if (!pointer || !row) return null;
    return { sourceId: row.candidate.sourceId, recordClass: row.candidate.recordClass, scope: row.candidate.scope,
      versionId: pointer.versionId, lastKnownGoodVersionId: pointer.lastKnownGoodVersionId,
      rawHash: row.candidate.retrieval.rawHash, rawHashBasis: row.candidate.retrieval.rawHashBasis ?? null,
      normalizedHash: row.candidate.normalization.normalizedHash, parserVersion: row.candidate.normalization.parserVersion,
      promotedAt: pointer.promotedAt, candidateState: row.state, acquisitionSucceeded: row.acquisitionSucceeded,
      acquisitionComplete: row.candidate.retrieval.complete ?? null,
      sourceThrough: row.candidate.temporal.sourceThrough,
      imported: isImportOrStateMoveCandidate(row.candidate) || pointer.sourceId !== row.candidate.sourceId };
  }

  async recordSourceCheck(input: RecordPublishedSourceCheck): Promise<boolean> {
    if (!validPublishedSourceCheck(input)) throw new Error("SOURCE_CHECK_INVALID");
    const head = await this.readSourceHead(input.recordClass, input.scope);
    const pointer = this.promotions.get(projectionKey(input.recordClass, input.scope));
    const payload = pointer?.payload as { sourceManifestVersion?: number; sourceHashes?: Readonly<Record<string, string | null>> } | undefined;
    if (!head || !pointer || pointer.versionId !== input.pointerVersionId || head.imported || head.sourceId !== input.sourceId || head.versionId !== input.pointerVersionId ||
      head.lastKnownGoodVersionId !== head.versionId || head.candidateState !== "PROMOTED" || !head.acquisitionSucceeded ||
      head.parserVersion !== input.parserVersion || head.rawHashBasis !== "SOURCE_CONTENT_V1" ||
      (input.sourceHash !== undefined ? head.rawHash !== input.sourceHash
        : payload?.sourceManifestVersion !== 1 || payload.sourceHashes?.[input.sourceKey] !== input.rawHash)) return false;
    const key = `${projectionKey(input.recordClass, input.scope)}:${input.sourceKey}`;
    const prior = this.sourceChecks.get(key);
    const checkedAt = prior?.rawHash === input.rawHash && prior.parserVersion === input.parserVersion && Date.parse(prior.checkedAt) > Date.parse(input.checkedAt)
      ? prior.checkedAt : input.checkedAt;
    this.sourceChecks.set(key, structuredClone({ ...input, checkedAt }));
    return true;
  }

  async readSourceChecks(recordClass: RoutineRecordClass, scope: string, sourceKeys: readonly string[]): Promise<readonly PublishedSourceCheck[]> {
    const head = await this.readSourceHead(recordClass, scope);
    const pointer = this.promotions.get(projectionKey(recordClass, scope));
    const payload = pointer?.payload as { sourceManifestVersion?: number; sourceHashes?: Readonly<Record<string, string | null>> } | undefined;
    if (!head || pointer?.versionId !== head.versionId || head.imported || head.versionId !== head.lastKnownGoodVersionId ||
      head.candidateState !== "PROMOTED" || !head.acquisitionSucceeded || head.rawHashBasis !== "SOURCE_CONTENT_V1") return [];
    return [...new Set(sourceKeys)].flatMap(key => {
      const check = this.sourceChecks.get(`${projectionKey(recordClass, scope)}:${key}`);
      return check && check.sourceId === head.sourceId && check.parserVersion === head.parserVersion &&
        (check.sourceHash !== undefined ? check.sourceHash === head.rawHash : payload?.sourceManifestVersion === 1 && payload.sourceHashes?.[key] === check.rawHash)
        ? [structuredClone(check)] : [];
    });
  }

  async readPromotionIdentities(
    recordClass: RoutineRecordClass,
    scopes: readonly string[],
  ): Promise<readonly PromotedPointerIdentity[]> {
    return scopes.flatMap((scope) => {
      const row = this.pointerRead(recordClass, scope);
      return row ? [promotedPointerIdentity(row)] : [];
    });
  }

  async readCandidates(candidateIds: readonly string[]): Promise<readonly CandidateVersionReadback[]> {
    return candidateIds.flatMap((candidateId) => {
      const row = this.candidates.get(candidateId);
      return row ? [{ candidateId, record: heldRecord(row) }] : [];
    });
  }

  async readPublishedCandidateMetadata(candidateId: string): Promise<PublishedCandidateMetadata | null> {
    const row = this.candidates.get(candidateId);
    if (!row) return null;
    return structuredClone(publishedCandidateMetadata(row));
  }

  async readCandidateProof(candidateId: string): Promise<CandidateVersionRecord | null> {
    const row = this.candidates.get(candidateId);
    return row ? { ...heldRecord(row), candidate: candidateProofView(row.candidate) } : null;
  }

  async readCandidateProofs(candidateIds: readonly string[]): Promise<readonly CandidateVersionReadback[]> {
    return candidateIds.flatMap((candidateId) => {
      const row = this.candidates.get(candidateId);
      return row ? [{ candidateId, record: { ...heldRecord(row), candidate: candidateProofView(row.candidate) } }] : [];
    });
  }

  async appendEvidence(candidateId: string, state: CandidateState, at: string, detail: string): Promise<CandidateEvent> {
    const prior = this.candidates.get(candidateId);
    if (!prior) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
    assertReaderEvidenceInput(prior, state, at, detail);
    const pointer = this.promotions.get(projectionKey(prior.candidate.recordClass, prior.candidate.scope));
    if (
      pointer?.sourceId !== prior.candidate.sourceId ||
      pointer.versionId !== candidateId ||
      pointer.lastKnownGoodVersionId !== candidateId
    ) {
      throw new Error(`CANDIDATE_READER_EVIDENCE_INVALID:${candidateId}`);
    }
    const { history, event } = this.nextEvent(candidateId, state, at, detail);
    history.push(structuredClone(event));
    this.history.set(candidateId, history);
    return structuredClone(event);
  }

  async confirmUnchanged(input: ConfirmUnchangedInput, at: string): Promise<ConfirmUnchangedOutcome> {
    const key = projectionKey(input.recordClass, input.scope);
    const built = buildUnchangedConfirmation(input, key, at);
    if (!built.ok) return { kind: "EVIDENCE_INVALID", detail: built.detail };
    const pointer = this.promotions.get(key);
    const row = this.candidates.get(input.pointerVersionId);
    if (
      !pointer || !row ||
      pointer.sourceId !== input.sourceId ||
      pointer.versionId !== input.pointerVersionId ||
      pointer.lastKnownGoodVersionId !== input.pointerVersionId ||
      row.state !== "PROMOTED"
    ) {
      return { kind: "POINTER_MOVED", detail: `The pointer ${key} no longer names ${input.pointerVersionId}.` };
    }
    if (isImportOrStateMoveCandidate(row.candidate)) {
      return { kind: "POINTER_IS_IMPORT", detail: `${input.pointerVersionId} retains published facts without a source read; a live read of it promotes.` };
    }
    if (row.candidate.normalization.normalizedHash !== input.readModelHash) {
      return { kind: "HASH_DIFFERS", detail: `${input.pointerVersionId}'s read model is not ${input.readModelHash}.` };
    }
    if (input.basis === "RAW_HASH_UNCHANGED" &&
      (row.candidate.retrieval.rawHash !== input.retrieval.rawHash || row.candidate.normalization.parserVersion !== input.parserVersion)) {
      return { kind: "HASH_DIFFERS", detail: `${input.pointerVersionId}'s source bytes or parser changed.` };
    }
    const priorConfirmation = latestUnchangedConfirmation(this.history.get(input.pointerVersionId) ?? [], input.pointerVersionId);
    if (priorConfirmation && Date.parse(sourceCheckedAt(priorConfirmation.retrieval, priorConfirmation.observedAt) ?? "") >
      Date.parse(sourceCheckedAt(built.confirmation.retrieval, built.confirmation.observedAt) ?? "")) {
      return { kind: "CONFIRMED", versionId: input.pointerVersionId, at: priorConfirmation.observedAt };
    }
    const { history, event } = this.nextEvent(input.pointerVersionId, "PROMOTED", at, serializeUnchangedConfirmation(built.confirmation));
    history.push(structuredClone(event));
    if (input.retainedSourceResponses?.length) {
      history.push({
        candidateId: input.pointerVersionId,
        sequence: event.sequence + 1,
        state: "PROMOTED",
        at,
        detail: serializeUnchangedConfirmationSources(built.confirmation, input.retainedSourceResponses),
      });
    }
    this.history.set(input.pointerVersionId, history);
    return { kind: "CONFIRMED", versionId: input.pointerVersionId, at };
  }

  async promote(candidateId: string, receipt: ValidationReceipt, at: string): Promise<PromotedProjection> {
    const record = this.candidates.get(candidateId);
    const persistedReceipt = persistedPromotionReceipt(record, receipt);
    if (!record || !persistedReceipt) {
      throw new Error(`CANDIDATE_NOT_PROMOTABLE:${candidateId}`);
    }
    assertPromotionTime(record, persistedReceipt, at);
    const key = projectionKey(record.candidate.recordClass, record.candidate.scope);
    const previous = this.promotions.get(key);
    const expectedVersionId = record.lastKnownGoodVersion;
    const actualVersionId = previous?.versionId ?? null;
    if (actualVersionId !== expectedVersionId) {
      throw new PromotionBaseChangedError(candidateId, expectedVersionId, actualVersionId);
    }
    const projection: PromotedProjection = {
      key,
      sourceId: record.candidate.sourceId,
      recordClass: record.candidate.recordClass,
      scope: record.candidate.scope,
      versionId: candidateId,
      lastKnownGoodVersionId: candidateId,
      promotedAt: at,
      payload: record.candidate.readModel,
      receipt: structuredClone(persistedReceipt),
    };
    const { history, event } = this.nextEvent(
      candidateId,
      "PROMOTED",
      at,
      `${POINTER_MOVE_DETAIL_PREFIX}${key} moved from ${previous?.versionId ?? "bootstrap/no-version"} to ${candidateId}.`,
    );
    this.promotions.set(key, projection);
    history.push(event);
    this.history.set(candidateId, history);
    this.candidates.set(candidateId, {
      ...record,
      state: "PROMOTED",
      receipt: persistedReceipt,
      promotedVersion: candidateId,
      lastKnownGoodVersion: candidateId,
    });
    return heldProjection(projection);
  }

  async events(candidateId: string): Promise<readonly CandidateEvent[]> {
    return structuredClone(this.history.get(candidateId) ?? []);
  }

  async latestReaderReadbacks(candidateIds: readonly string[]): Promise<readonly CandidateEvent[]> {
    return candidateIds
      .map((candidateId) => newestReaderReadback(this.history.get(candidateId) ?? []))
      .filter((event): event is CandidateEvent => event !== null)
      .map((event) => structuredClone(event));
  }

  async pointerMoveEvents(candidateId: string): Promise<readonly CandidateEvent[]> {
    return structuredClone((this.history.get(candidateId) ?? []).filter(isPointerMoveEvent));
  }

  async clock(sourceId: string, recordClass: RoutineRecordClass, scope: string, parserVersion?: string): Promise<RoutineStoreClock> {
    const clock = await this.publishedClock(sourceId, recordClass, scope, parserVersion);
    if (recordClass !== "CURATED_READER_RECORD" || scope !== MEMBER_OFFICES_SCOPE) return clock;
    const progress = await this.readMemberOfficeProgress();
    if (!progress.checkedAt) return { ...clock, ...(progress.attemptedAt ? {lastAttemptedAt:laterInstant(clock.lastAttemptedAt,progress.attemptedAt)} : {}), continuationPending: progress.pending.length > 0 };
    const at = laterInstant(clock.lastSucceededObservedAt, progress.checkedAt);
    return { ...clock, lastAttemptedAt: laterInstant(clock.lastAttemptedAt, progress.attemptedAt??progress.checkedAt), lastSucceededAt: at,
      lastSucceededObservedAt: at, ...(parserVersion ? { lastSucceededParserVersion: parserVersion } : {}), continuationPending: progress.pending.length > 0 };
  }

  private async publishedClock(sourceId: string, recordClass: RoutineRecordClass, scope: string, parserVersion?: string): Promise<RoutineStoreClock> {
    const attempts = [...this.candidates.values()]
      .filter((row) =>
        row.candidate.sourceId === sourceId &&
        row.candidate.recordClass === recordClass &&
        row.candidate.scope === scope &&
        (parserVersion === undefined || row.candidate.normalization.parserVersion === parserVersion) &&
        !isImportOrStateMoveCandidate(row.candidate)
      )
      .flatMap((row) => (this.history.get(row.candidate.id) ?? [])
        .filter(event => event.sequence === 1 || event.detail.startsWith("RECHECKED_UNCHANGED:"))
        .flatMap(event => {
          const at = event.sequence === 1 && row.state === "PROMOTED" && row.acquisitionSucceeded
            ? sourceCheckedAt(row.candidate.retrieval, event.at) : event.at;
          return at && Number.isFinite(Date.parse(at)) ? [{ at, failureCode: row.failureCode, failureDetail: row.failureDetail }] : [];
        }))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
        // The retry scheduler runs on the locally observed first event, so a far-future publisher timestamp cannot postpone it.
    const lastAttemptedAt = attempts[0]?.at;
    const pointer = this.promotions.get(projectionKey(recordClass, scope));
    const pointedRow = pointer?.sourceId === sourceId ? this.candidates.get(pointer.versionId) : null;
    const pointedRecord: RoutineClockRecord | null = pointedRow
      ? { ...pointedRow, candidate: routineClockCandidateView(pointedRow.candidate) }
      : null;
    const sittings = recordClass === "MEETING" && pointer ? { sittingStarts: meetingPayloadSittingStarts(pointer.payload) } : {};
    if (pointer && pointedRecord && isImportOrStateMoveCandidate(pointedRecord.candidate)) {
      return { ...trustedLkgImportClock(lastAttemptedAt, pointer.promotedAt), ...sittings };
    }
    const pointedHistory = pointedRow ? this.history.get(pointedRow.candidate.id) ?? [] : [];
    const pointedObservedAt = pointedHistory.find((event) => event.sequence === 1)?.at;
    const confirmation = pointedRow ? latestUnchangedConfirmation(pointedHistory, pointedRow.candidate.id) : null;
    return confirmedClock({
      lastAttemptedAt,
      ...(recordClass === "CENSUS_GEOGRAPHY" ? { publishedScopeVersions: ((pointer?.payload as { scopes?: { version: string; versionMeta?: { retrievalComplete?: boolean } }[] } | undefined)?.scopes ?? [])
        .filter(scope => scope.versionMeta?.retrievalComplete !== false).map(scope => scope.version) } : {}),
      ...(repeatedFailureStreak(attempts) ? { failureStreak: repeatedFailureStreak(attempts) } : {}),
      lastSucceededAt: proofConsistentSuccess(pointedRecord, pointer),
      lastSucceededObservedAt: proofConsistentObservedSuccess(pointedRecord, pointer, pointedObservedAt),
      ...(recordClass === "FEDERAL_MONEY" && scope === `${sourceId}:US` && pointer?.sourceId === sourceId
        ? { continuationPending: federalMoneyContinuationPending(pointer.payload, sourceId) } : {}),
      ...(recordClass === "CURATED_READER_RECORD" && scope === MEMBER_OFFICES_SCOPE
        ? { continuationPending: memberOfficesContinuationPending(pointer?.payload) } : {}),
      ...(recordClass === "STATE_BILL" && scope === LEGISCAN_BULK_SCOPE && sourceId === "legiscan-bills"
        ? { continuationPending: legiscanContinuationPending(pointer?.payload,id=>this.promotions.get(projectionKey("STATE_BILL",billScope(id)))) } : {}),
      ...(parserVersion !== undefined && proofConsistentPointedSuccess(pointedRecord, pointer)
        ? { lastSucceededParserVersion: pointedRecord.candidate.normalization.parserVersion } : {}),
    }, confirmation, sittings, parserVersion);
  }
}

function rowToCandidate(row: typeof civicDataCandidates.$inferSelect): CandidateVersionRecord {
  return {
    candidate: row.candidate as RoutineCandidate,
    state: row.state as CandidateState,
    acquisitionSucceeded: row.acquisitionSucceeded,
    receipt: row.validationReceipt as ValidationReceipt | null,
    promotedVersion: row.promotedVersionId,
    lastKnownGoodVersion: row.lastKnownGoodVersionId,
    failureCode: row.failureCode,
    failureDetail: row.failureDetail,
  };
}

/** The clock checks the receipt's decision and names, never its held facts. */
function clockReceipt<T extends { readonly validationReceipt: unknown }>(row: T): T {
  const receipt = row.validationReceipt as { readonly excludedFacts?: unknown } | null;
  return receipt && isCivicPayloadPart(receipt.excludedFacts) ? { ...row, validationReceipt: { ...receipt, excludedFacts: [] } } : row;
}

const CLOCK_FIELD_NAME = /^[A-Za-z]+$/;
for (const field of [...ROUTINE_CLOCK_CANDIDATE_FIELDS.top, ...ROUTINE_CLOCK_CANDIDATE_FIELDS.retrieval, ...ROUTINE_CLOCK_CANDIDATE_FIELDS.normalization]) {
  // The names are spliced into SQL as literals, so they stay plain identifiers.
  if (!CLOCK_FIELD_NAME.test(field)) throw new Error(`ROUTINE_CLOCK_FIELD_INVALID:${field}`);
}

function routineClockCandidateStub() {
  const column = civicDataCandidates.candidate;
  const top = ROUTINE_CLOCK_CANDIDATE_FIELDS.top.map((field) =>
    sql`${sql.raw(`'${field}'`)}, ${column}->${sql.raw(`'${field}'`)}`);
  const retrieval = ROUTINE_CLOCK_CANDIDATE_FIELDS.retrieval.map((field) =>
    sql`${sql.raw(`'${field}'`)}, ${column}#>${sql.raw(`'{retrieval,${field}}'`)}`);
  const normalization = ROUTINE_CLOCK_CANDIDATE_FIELDS.normalization.map((field) =>
    sql`${sql.raw(`'${field}'`)}, ${column}#>${sql.raw(`'{normalization,${field}}'`)}`);
  return sql`jsonb_strip_nulls(jsonb_build_object(${sql.join(
    [...top, sql`'retrieval', jsonb_build_object(${sql.join(retrieval, sql`, `)})`,
      sql`'normalization', jsonb_build_object(${sql.join(normalization, sql`, `)})`],
    sql`, `,
  )}))`.mapWith(civicDataCandidates.candidate);
}

type RoutineClockDb = Pick<ReturnType<typeof getDb>, "select">;

export function routineClockPointerRead(db: RoutineClockDb, recordClass: RoutineRecordClass, scope: string) {
  return db
    .select({
      sourceId: civicDataPromotions.sourceId,
      recordClass: civicDataPromotions.recordClass,
      scope: civicDataPromotions.scope,
      currentVersionId: civicDataPromotions.currentVersionId,
      lastKnownGoodVersionId: civicDataPromotions.lastKnownGoodVersionId,
      promotedAt: civicDataPromotions.promotedAt,
      validationReceipt: civicDataPromotions.validationReceipt,
      ...(recordClass === "CENSUS_GEOGRAPHY" ? { publishedScopeVersions: sql<readonly string[]>`
        coalesce((select jsonb_agg(s->>'version') from jsonb_array_elements(${civicDataPromotions.payload}->'scopes') s
          where coalesce(s#>>'{versionMeta,retrievalComplete}', 'true') <> 'false'), '[]'::jsonb)` } : {}),
      ...(recordClass === "FEDERAL_MONEY" && scope.endsWith(":US") ? { continuationPending: sql<boolean>`
        coalesce(${civicDataPromotions.payload}->>'state', '') = 'US'
        and ${civicDataPromotions.payload}->>'source' = ${civicDataPromotions.sourceId}
        and exists (
          select 1 from jsonb_array_elements(case when jsonb_typeof(${civicDataPromotions.payload}->'states') = 'array'
            then ${civicDataPromotions.payload}->'states' else '[]'::jsonb end) as state_progress
          where state_progress->>'status' = 'BACKFILL'
            or state_progress->'cursor' is not null and state_progress->'cursor' <> 'null'::jsonb
        )` } : {}),
      // A member-office run its deadline cut short names the states it still owes.
      ...(recordClass === "CURATED_READER_RECORD" && scope === MEMBER_OFFICES_SCOPE ? { continuationPending: sql<boolean>`
        (select case when jsonb_typeof(member_progress.pending) = 'array' then jsonb_array_length(member_progress.pending) > 0 else false end
         from (select reader_payload_value(reader_payload_node(${civicDataPromotions.payload})->'pending') as pending) member_progress)` } : {}),
      ...(recordClass === "STATE_BILL" && scope === LEGISCAN_BULK_SCOPE ? { continuationPending: sql<boolean>`(
        with catalog as (
          select d, (d->>'state_id')::int state_id, (d->>'year_start')::int year_start,
            (d->>'year_end')::int year_end, extract(year from current_date)::int this_year
          from jsonb_array_elements(case when jsonb_typeof(${civicDataPromotions.payload}->'datasets') = 'array'
            then ${civicDataPromotions.payload}->'datasets' else '[]'::jsonb end) d
        ), current_sessions as (
          select c.d from catalog c where c.year_start <= c.this_year and (
            c.year_end >= c.this_year or (
              not exists (select 1 from catalog other where other.state_id=c.state_id
                and other.year_start<=other.this_year and other.year_end>=other.this_year)
              and c.year_start=(select max(other.year_start) from catalog other
                where other.state_id=c.state_id and other.year_start<=other.this_year)
            )
          ) or (
            not exists (select 1 from catalog other where other.state_id=c.state_id and other.year_start<=other.this_year)
            and c.d->>'session_id'=(select other.d->>'session_id' from catalog other
              where other.state_id=c.state_id order by (other.d->>'session_id')::int desc limit 1)
          )
        )
        select not exists(select 1 from catalog)
          or exists(select 1 from catalog where year_start is null or year_end is null)
          or exists (
            select 1 from current_sessions current_session
            left join civic_data_promotions held_session on held_session.record_class='STATE_BILL'
              and held_session.scope='legiscan-bills:session:'||(current_session.d->>'session_id')
            where held_session.current_version_id is null or held_session.source_id<>'legiscan-bills'
              or held_session.current_version_id<>held_session.last_known_good_version_id
              or held_session.validation_receipt->>'decision' is distinct from 'GOOD'
              or held_session.payload->>'kind' is distinct from 'SESSION'
              or held_session.payload->>'parserVersion' is distinct from ${LEGISCAN_BULK_PARSER}
              or held_session.payload->>'sponsorMatchVersion' is distinct from ${LEGISCAN_SPONSOR_MATCH}
              or held_session.payload#>>'{dataset,dataset_hash}' is distinct from current_session.d->>'dataset_hash'
              or held_session.payload#>>'{dataset,dataset_date}' is distinct from current_session.d->>'dataset_date'
          )
        )` } : {}),
    })
    .from(civicDataPromotions)
    .where(and(eq(civicDataPromotions.recordClass, recordClass), eq(civicDataPromotions.scope, scope)))
    .limit(1);
}

function unchangedConfirmationRefusedByEventRule(error: unknown): boolean {
  const chain: unknown[] = [];
  for (let value: unknown = error; value !== null && value !== undefined && chain.length < 4; value = (value as { cause?: unknown }).cause) {
    chain.push(value);
  }
  return chain.some((value) => {
    const row = value as { code?: unknown; message?: unknown };
    return typeof value === "object" && row.code === "23514" &&
      typeof row.message === "string" && row.message.includes("repeated PROMOTED event is not typed Reader evidence");
  });
}

function laterInstant(left: string | undefined, right: string | undefined): string | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function confirmedClock(
  clock: RoutineStoreClock,
  confirmation: UnchangedConfirmation | null,
  sittings: { readonly sittingStarts?: readonly string[] },
  parserVersion?: string,
): RoutineStoreClock {
  const confirmedAt = confirmation ? sourceCheckedAt(confirmation.retrieval, confirmation.observedAt) : undefined;
  const lastAttemptedAt = laterInstant(clock.lastAttemptedAt,
    parserVersion === undefined || clock.lastSucceededParserVersion === parserVersion ? confirmedAt : undefined);
  const lastSucceededAt = clock.lastSucceededAt === undefined
    ? undefined
    : laterInstant(clock.lastSucceededAt, confirmation?.retrieval.retrievedAt);
  const lastSucceededObservedAt = clock.lastSucceededObservedAt === undefined
    ? undefined
    : laterInstant(clock.lastSucceededObservedAt, confirmedAt);
  return {
    ...(lastAttemptedAt ? { lastAttemptedAt } : {}),
    ...(clock.failureStreak && (!lastSucceededObservedAt || Date.parse(lastSucceededObservedAt) < Date.parse(lastAttemptedAt ?? ""))
      ? { failureStreak: clock.failureStreak } : {}),
    ...(lastSucceededAt ? { lastSucceededAt } : {}),
    ...(lastSucceededObservedAt ? { lastSucceededObservedAt } : {}),
    ...(clock.lastSucceededParserVersion ? { lastSucceededParserVersion: clock.lastSucceededParserVersion } : {}),
    ...(clock.continuationPending !== undefined ? { continuationPending: clock.continuationPending } : {}),
    ...(clock.publishedScopeVersions !== undefined ? { publishedScopeVersions: clock.publishedScopeVersions } : {}),
    ...sittings,
  };
}

/** Only the source's promoted national marker owns the unfinished acquisition pages. */
/** The member-office package; its payload names the states a cut-off run still owes. */
export const MEMBER_OFFICES_SCOPE = "US:state-legislator-member-offices";
function memberOfficesContinuationPending(payload: unknown): boolean {
  const pending = payload && typeof payload === "object" ? (payload as { readonly pending?: unknown }).pending : undefined;
  return Array.isArray(pending) && pending.length > 0;
}

function federalMoneyContinuationPending(payload: unknown, sourceId: string): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const marker = payload as { readonly state?: unknown; readonly source?: unknown; readonly states?: unknown };
  if (marker.state !== "US" || marker.source !== sourceId || !Array.isArray(marker.states)) return false;
  return marker.states.some(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const progress = value as { readonly status?: unknown; readonly cursor?: unknown };
    return progress.status === "BACKFILL" || progress.cursor !== undefined && progress.cursor !== null;
  });
}

export function routineClockConfirmationRead(db: RoutineClockDb, recordClass: RoutineRecordClass, scope: string) {
  return db
    .select({ detail: civicDataCandidateEvents.detail })
    .from(civicDataPromotions)
    .innerJoin(civicDataCandidateEvents, eq(civicDataCandidateEvents.candidateId, civicDataPromotions.currentVersionId))
    .where(and(
      eq(civicDataPromotions.recordClass, recordClass),
      eq(civicDataPromotions.scope, scope),
      // `_` is a LIKE wildcard; the prefix is matched literally.
      like(civicDataCandidateEvents.detail, `${UNCHANGED_CONFIRMATION_PREFIX.replaceAll("_", "\\_")}%`),
    ))
    .orderBy(desc(civicDataCandidateEvents.sequence))
    .limit(1);
}

export function routineClockPointedObservedRead(db: RoutineClockDb, recordClass: RoutineRecordClass, scope: string) {
  return db
    .select({ observedAt: civicDataCandidateEvents.at })
    .from(civicDataPromotions)
    .innerJoin(civicDataCandidateEvents, and(
      eq(civicDataCandidateEvents.candidateId, civicDataPromotions.currentVersionId),
      eq(civicDataCandidateEvents.sequence, 1),
    ))
    .where(and(eq(civicDataPromotions.recordClass, recordClass), eq(civicDataPromotions.scope, scope)))
    .limit(1);
}

export function sittingStartsRead(db: RoutineClockDb, scope: string) {
  const payload = civicDataPromotions.payload;
  return db
    .select({
      starts: sql<unknown>`coalesce((
        select jsonb_agg(m->'startsAt')
        from jsonb_array_elements(case when jsonb_typeof(${payload}->'meetings') = 'array' then ${payload}->'meetings' else '[]'::jsonb end) as m
        where jsonb_typeof(m->'startsAt') = 'string'
      ), '[]'::jsonb)`,
    })
    .from(civicDataPromotions)
    .where(and(eq(civicDataPromotions.recordClass, "MEETING"), eq(civicDataPromotions.scope, scope)))
    .limit(1);
}

function sittingStartsFromRow(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) ? value.filter((start): start is string => typeof start === "string") : undefined;
}

export const CANDIDATE_PROOF_OMITTED = {
  unlessImported: ["changeSet", "civicRecords", "identities"],
} as const;

for (const field of CANDIDATE_PROOF_OMITTED.unlessImported) {
  // The names are spliced into SQL as literals, so they stay plain identifiers.
  if (!/^[A-Za-z]+$/.test(field)) throw new Error(`CANDIDATE_PROOF_FIELD_INVALID:${field}`);
}

export function candidateProofView(candidate: RoutineCandidate): RoutineCandidate {
  if (Object.hasOwn(candidate, "bootstrapImport")) return candidate;
  const omitted = new Set<string>(CANDIDATE_PROOF_OMITTED.unlessImported);
  return Object.fromEntries(
    Object.entries(candidate).filter(([key]) => !omitted.has(key)),
  ) as unknown as RoutineCandidate;
}

export function candidateProofRead(db: RoutineClockDb, candidateIds: readonly string[]) {
  const column = civicDataCandidates.candidate;
  const unlessImported = CANDIDATE_PROOF_OMITTED.unlessImported.map((field) => sql.raw(` - '${field}'`));
  return db
    .select({
      id: civicDataCandidates.id,
      candidate: sql`case when ${column} ? 'bootstrapImport'
        then ${column}
        else ${column}${sql.join(unlessImported, sql``)} end`.mapWith(civicDataCandidates.candidate),
      state: civicDataCandidates.state,
      acquisitionSucceeded: civicDataCandidates.acquisitionSucceeded,
      validationReceipt: civicDataCandidates.validationReceipt,
      promotedVersionId: civicDataCandidates.promotedVersionId,
      lastKnownGoodVersionId: civicDataCandidates.lastKnownGoodVersionId,
      failureCode: civicDataCandidates.failureCode,
      failureDetail: civicDataCandidates.failureDetail,
    })
    .from(civicDataCandidates)
    .where(inArray(civicDataCandidates.id, [...candidateIds]));
}

function candidateProofRowToRecord(row: Awaited<ReturnType<typeof candidateProofRead>>[number]): CandidateVersionRecord {
  return {
    candidate: row.candidate as RoutineCandidate,
    state: row.state as CandidateState,
    acquisitionSucceeded: row.acquisitionSucceeded,
    receipt: row.validationReceipt as ValidationReceipt | null,
    promotedVersion: row.promotedVersionId,
    lastKnownGoodVersion: row.lastKnownGoodVersionId,
    failureCode: row.failureCode,
    failureDetail: row.failureDetail,
  };
}

export function routineClockCandidateRead(db: RoutineClockDb, versionId: string) {
  return db
    .select({
      candidate: routineClockCandidateStub(),
      state: civicDataCandidates.state,
      acquisitionSucceeded: civicDataCandidates.acquisitionSucceeded,
      validationReceipt: civicDataCandidates.validationReceipt,
      promotedVersionId: civicDataCandidates.promotedVersionId,
      lastKnownGoodVersionId: civicDataCandidates.lastKnownGoodVersionId,
      failureCode: civicDataCandidates.failureCode,
      failureDetail: civicDataCandidates.failureDetail,
    })
    .from(civicDataCandidates)
    .where(eq(civicDataCandidates.id, versionId))
    .limit(1);
}

function routineClockRowToRecord(row: Awaited<ReturnType<typeof routineClockCandidateRead>>[number]): RoutineClockRecord {
  return {
    candidate: row.candidate as RoutineClockCandidate,
    state: row.state as CandidateState,
    acquisitionSucceeded: row.acquisitionSucceeded,
    receipt: row.validationReceipt as ValidationReceipt | null,
    promotedVersion: row.promotedVersionId,
    lastKnownGoodVersion: row.lastKnownGoodVersionId,
    failureCode: row.failureCode,
    failureDetail: row.failureDetail,
  };
}

const PROMOTED_POINTER_IDENTITY_COLUMNS = {
  key: civicDataPromotions.key,
  sourceId: civicDataPromotions.sourceId,
  recordClass: civicDataPromotions.recordClass,
  scope: civicDataPromotions.scope,
  currentVersionId: civicDataPromotions.currentVersionId,
  lastKnownGoodVersionId: civicDataPromotions.lastKnownGoodVersionId,
  promotedAt: civicDataPromotions.promotedAt,
} as const;

function promotedPointerIdentityRead(
  db: RoutineClockDb,
  recordClass: RoutineRecordClass,
  scopes: readonly string[],
) {
  return db
    .select(promotedPointerReadColumns())
    .from(civicDataPromotions)
    .where(and(eq(civicDataPromotions.recordClass, recordClass), inArray(civicDataPromotions.scope, [...scopes])));
}

export const PROMOTED_POINTER_COLUMNS = {
  ...PROMOTED_POINTER_IDENTITY_COLUMNS,
  validationReceipt: civicDataPromotions.validationReceipt,
} as const;

type PostgresPromotedPointerIdentityRow = Pick<
  typeof civicDataPromotions.$inferSelect,
  keyof typeof PROMOTED_POINTER_IDENTITY_COLUMNS
> & { readonly latestConfirmation?: string | null };

function latestConfirmationDetail() {
  return sql<string | null>`(
  select confirmation.detail from civic_data_candidate_events as confirmation
  where confirmation.candidate_id = "civic_data_promotions"."current_version_id"
    and left(confirmation.detail, ${UNCHANGED_CONFIRMATION_PREFIX.length}) = ${UNCHANGED_CONFIRMATION_PREFIX}
  order by confirmation.sequence desc
  limit 1
)`;
}

/* Names the latest confirmation without carrying its text, so a held identity is re-read only when it moved. */
function latestConfirmationSequence() {
  return sql<number | null>`(
  select confirmation.sequence from civic_data_candidate_events as confirmation
  where confirmation.candidate_id = "civic_data_promotions"."current_version_id"
    and left(confirmation.detail, ${UNCHANGED_CONFIRMATION_PREFIX.length}) = ${UNCHANGED_CONFIRMATION_PREFIX}
  order by confirmation.sequence desc
  limit 1
)`;
}

function promotedPointerReadColumns() {
  return {
    ...PROMOTED_POINTER_IDENTITY_COLUMNS,
    latestConfirmation: latestConfirmationDetail(),
  } as const;
}

function postgresPromotedPointerIdentity(row: PostgresPromotedPointerIdentityRow): PromotedPointerIdentity {
  const confirmation = typeof row.latestConfirmation === "string" ? parseUnchangedConfirmation(row.latestConfirmation) : null;
  return {
    key: row.key,
    sourceId: row.sourceId,
    recordClass: row.recordClass as RoutineRecordClass,
    scope: row.scope,
    versionId: row.currentVersionId,
    lastKnownGoodVersionId: row.lastKnownGoodVersionId,
    promotedAt: canonicalPostgresRoutineTimestamp(row.promotedAt, "promotion.promotedAt"),
    ...(confirmation !== null && confirmation.versionId === row.currentVersionId ? { latestConfirmation: confirmation } : {}),
  };
}

function postgresPromotionRowToProjection<T = unknown>(
  row: typeof civicDataPromotions.$inferSelect & { readonly latestConfirmation?: string | null },
): PromotedProjection<T> {
  return {
    ...postgresPromotedPointerIdentity(row),
    payload: row.payload as T,
    receipt: row.validationReceipt as ValidationReceipt,
  };
}

const CANDIDATE_SUMMARY_COLUMNS = {
  id: civicDataCandidates.id,
  sourceId: civicDataCandidates.sourceId,
  recordClass: civicDataCandidates.recordClass,
  scope: civicDataCandidates.scope,
  state: civicDataCandidates.state,
  acquisitionSucceeded: civicDataCandidates.acquisitionSucceeded,
  validationReceipt: civicDataCandidates.validationReceipt,
  promotedVersionId: civicDataCandidates.promotedVersionId,
  lastKnownGoodVersionId: civicDataCandidates.lastKnownGoodVersionId,
  failureCode: civicDataCandidates.failureCode,
  failureDetail: civicDataCandidates.failureDetail,
} as const;

export function candidateSummaryRead(db: RoutineClockDb, candidateId: string) {
  return db.select({ ...CANDIDATE_SUMMARY_COLUMNS,
    validationReceipt: sql<unknown>`${civicDataCandidates.validationReceipt} - 'excludedFacts'`,
  }).from(civicDataCandidates).where(eq(civicDataCandidates.id, candidateId)).limit(1);
}

type PostgresCandidateSummaryRow = Pick<typeof civicDataCandidates.$inferSelect, keyof typeof CANDIDATE_SUMMARY_COLUMNS>;

function postgresCandidateSummary(row: PostgresCandidateSummaryRow): CandidateVersionSummary {
  return {
    candidate: { id: row.id, sourceId: row.sourceId, recordClass: row.recordClass as RoutineRecordClass, scope: row.scope },
    state: row.state as CandidateState,
    acquisitionSucceeded: row.acquisitionSucceeded,
    receipt: row.validationReceipt as CandidateVersionSummary["receipt"],
    promotedVersion: row.promotedVersionId,
    lastKnownGoodVersion: row.lastKnownGoodVersionId,
    failureCode: row.failureCode,
    failureDetail: row.failureDetail,
  };
}

const READER_EVIDENCE_CANDIDATE_COLUMNS = {
  id: civicDataCandidates.id,
  sourceId: civicDataCandidates.sourceId,
  recordClass: civicDataCandidates.recordClass,
  scope: civicDataCandidates.scope,
  state: civicDataCandidates.state,
    // A present-but-null marker is still a marker, as the envelope's own-property check decides.
  hasBootstrapImport: sql<boolean>`${civicDataCandidates.candidate} ? 'bootstrapImport'`,
  bootstrapImport: sql<unknown>`${civicDataCandidates.candidate}->'bootstrapImport'`,
};

export function readerEvidenceCandidateRead(db: RoutineClockDb, candidateId: string) {
  return db
    .select(READER_EVIDENCE_CANDIDATE_COLUMNS)
    .from(civicDataCandidates)
    .where(eq(civicDataCandidates.id, candidateId))
    .limit(1);
}

export function candidateTransitionRead(db: RoutineClockDb, candidateId: string) {
  return db
    .select({
      ...READER_EVIDENCE_CANDIDATE_COLUMNS,
      retrievedAt: civicDataCandidates.retrievedAt,
      rawHash: civicDataCandidates.rawHash,
      normalizedHash: civicDataCandidates.normalizedHash,
    })
    .from(civicDataCandidates)
    .where(eq(civicDataCandidates.id, candidateId))
    .limit(1);
}

function heldEnvelopeMatches(
  row: {
    readonly id: string;
    readonly sourceId: string;
    readonly recordClass: string;
    readonly scope: string;
    readonly retrievedAt: string;
    readonly rawHash: string | null;
    readonly normalizedHash: string | null;
  },
  held: RoutineCandidate,
): boolean {
  return held.id === row.id &&
    held.sourceId === row.sourceId &&
    held.recordClass === row.recordClass &&
    held.scope === row.scope &&
    Date.parse(held.retrieval.retrievedAt) === Date.parse(row.retrievedAt) &&
    (held.retrieval.rawHash ?? null) === row.rawHash &&
    (held.normalization.normalizedHash ?? null) === row.normalizedHash;
}

export function readerEvidenceRowToRecord(
  row: Awaited<ReturnType<typeof readerEvidenceCandidateRead>>[number],
): { readonly state: CandidateState; readonly candidate: CandidateAuthorityIdentity } {
  return {
    state: row.state as CandidateState,
    candidate: {
      id: row.id,
      sourceId: row.sourceId,
      recordClass: row.recordClass as RoutineRecordClass,
      scope: row.scope,
      ...(row.hasBootstrapImport ? { bootstrapImport: row.bootstrapImport as RoutineCandidate["bootstrapImport"] } : {}),
    },
  };
}

type PostgresCandidateEventRow = Pick<
  typeof civicDataCandidateEvents.$inferSelect,
  "candidateId" | "sequence" | "state" | "at" | "detail"
>;

const CANDIDATE_EVENT_COLUMNS = {
  candidateId: civicDataCandidateEvents.candidateId,
  sequence: civicDataCandidateEvents.sequence,
  state: civicDataCandidateEvents.state,
  at: civicDataCandidateEvents.at,
  detail: civicDataCandidateEvents.detail,
} as const;

export function latestReaderReadbacksRead(db: Pick<ReturnType<typeof getDb>, "selectDistinctOn">, candidateIds: readonly string[]) {
  return db
    .selectDistinctOn([civicDataCandidateEvents.candidateId], CANDIDATE_EVENT_COLUMNS)
    .from(civicDataCandidateEvents)
    .where(and(
      inArray(civicDataCandidateEvents.candidateId, [...candidateIds]),
      sql`left(${civicDataCandidateEvents.detail}, ${READER_PROJECTION_READBACK_PREFIX.length}) = ${READER_PROJECTION_READBACK_PREFIX}`,
    ))
    .orderBy(civicDataCandidateEvents.candidateId, desc(civicDataCandidateEvents.at), desc(civicDataCandidateEvents.sequence));
}

export function pointerMoveEventsRead(db: RoutineClockDb, candidateId: string) {
  return db
    .select(CANDIDATE_EVENT_COLUMNS)
    .from(civicDataCandidateEvents)
    .where(and(
      eq(civicDataCandidateEvents.candidateId, candidateId),
      eq(civicDataCandidateEvents.state, "PROMOTED"),
      sql`left(${civicDataCandidateEvents.detail}, ${POINTER_MOVE_DETAIL_PREFIX.length}) = ${POINTER_MOVE_DETAIL_PREFIX}`,
    ))
    .orderBy(civicDataCandidateEvents.sequence);
}

/** Follow only this pointer's anchored links in one round trip, including
 * conflicting links so the existing history reader can reject ambiguity. */
export function pointerMoveChainRead(db: Pick<ReturnType<typeof getDb>, "execute">, key: string, currentId: string) {
  const prefix = `Atomic pointer ${key} moved from `;
  return db.execute<PostgresCandidateEventRow>(sql`WITH RECURSIVE chain(id, path) AS (
    SELECT ${currentId}::text, ARRAY[${currentId}]::text[]
    UNION ALL
    SELECT link.previous, chain.path || link.previous
    FROM chain JOIN civic_data_candidate_events e ON e.candidate_id = chain.id
    CROSS JOIN LATERAL (SELECT substring(e.detail FROM ${prefix.length + 1}
      FOR greatest(0, length(e.detail) - ${prefix.length} - length(' to ' || chain.id || '.'))) AS previous) link
    WHERE e.state = 'PROMOTED' AND left(e.detail, ${prefix.length}) = ${prefix}
      AND right(e.detail, length(' to ' || chain.id || '.')) = ' to ' || chain.id || '.'
      AND link.previous <> 'bootstrap/no-version' AND link.previous <> ''
      AND link.previous !~ '\\s' AND NOT link.previous = ANY(chain.path)
  )
  SELECT DISTINCT e.candidate_id AS "candidateId", e.sequence, e.state, e.at, e.detail
  FROM chain JOIN civic_data_candidate_events e ON e.candidate_id = chain.id
  WHERE e.state = 'PROMOTED' AND left(e.detail, ${prefix.length}) = ${prefix}`);
}

/** Filter only the already anchored history, without transferring unrelated
 * roll calls. Encoded payloads remain candidates for the normal full reader. */
export function historicalVoteBillVersionsRead(db: Pick<ReturnType<typeof getDb>, "execute">, ids: readonly string[], bill: string) {
  const parsed = /^(hr|s|hres|hconres|sres|sconres)([0-9]+)$/.exec(bill);
  if (!parsed) throw new Error("HISTORICAL_VOTE_BILL_INVALID");
  const titlePattern = `\\m${parsed[1].split("").join("[[:space:].]*")}[[:space:].]*${parsed[2]}\\M`;
  return db.execute<{ id: string }>(sql`SELECT requested.id FROM unnest(${sql.param([...ids])}::text[]) requested(id)
    LEFT JOIN civic_data_candidates USING(id) WHERE candidate IS NULL OR (
      jsonb_path_exists(candidate->'readModel', 'strict $.**."$civicPayloadPart"', '{}'::jsonb, true)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(candidate#>'{readModel,votes}', candidate#>'{readModel,snapshot,votes}', '[]'::jsonb)) vote
        WHERE regexp_replace(lower(coalesce(vote->>'legisNum','')), '[^a-z0-9]', '', 'g') = ${bill}
          OR lower(coalesce(vote->>'title','')) ~ ${titlePattern}))`);
}

function postgresCandidateEventRowToEvent(row: PostgresCandidateEventRow): CandidateEvent {
  return {
    candidateId: row.candidateId,
    sequence: row.sequence,
    state: row.state as CandidateState,
    at: canonicalPostgresRoutineTimestamp(row.at, "candidateEvent.at"),
    detail: row.detail,
  };
}

export class PostgresRoutineDataStore implements RoutineDataStore {
  private readonly cacheOptions: { readonly purge?: ReaderCachePurger };
  constructor(cacheOptions: { readonly purge?: ReaderCachePurger } = {}) { this.cacheOptions = cacheOptions; }
  private readonly db = getDb();
  private readonly readCache = runtimeCivicReadCache();
  private async scopeVersion(recordClass: RoutineRecordClass, scope: string): Promise<string> {
    const result = await this.db.execute(sql`select coalesce((select version::text
      from civic_data_clock_versions where record_class = ${recordClass} and scope = ${scope}), '0') as etag`);
    return String((result.rows[0] as { etag: string }).etag);
  }

  async readVersioned<T>(namespace: string, recordClass: RoutineRecordClass, scope: string, read: () => Promise<T>): Promise<T> {
    const key = projectionKey(recordClass, scope);
    const [held] = await this.readCache.rows({ namespace, keys: [key], keyOf: row => row.key,
      versions: async () => [{ key, etag: await this.scopeVersion(recordClass, scope) }],
      values: async () => [{ key, value: await read() }],
    });
    return held!.value;
  }
  private async readerRows(text: string, params: readonly unknown[] = []): Promise<readonly Record<string, unknown>[]> {
    const statement = sql.join(text.split(/(\$\d+)/).map(part => /^\$\d+$/.test(part)
      ? sql`${sql.param(params[Number(part.slice(1)) - 1])}` : sql.raw(part)), sql``);
    return (await this.db.execute(statement)).rows as Record<string, unknown>[];
  }
  private async readPayloadParts(hashes: readonly string[]) {
    return this.db.select().from(civicDataPayloadParts).where(inArray(civicDataPayloadParts.hash, [...hashes]));
  }
  private readonly payloadPartIO: CivicPayloadPartIO = {
    existing: async hashes => (await this.db.select({ hash: civicDataPayloadParts.hash }).from(civicDataPayloadParts)
      .where(inArray(civicDataPayloadParts.hash, [...hashes]))).map(row => row.hash),
    write: async parts => { await this.db.insert(civicDataPayloadParts).values([...parts]).onConflictDoNothing(); },
    read: async hashes => {
      const values = (keys: readonly string[]) => this.readPayloadParts(keys);
      return this.readCache.rows({ namespace: "payload-part", keys: hashes,
        versions: async keys => this.db.select({ key: civicDataPayloadParts.hash,
          etag: sql<string>`concat(${civicDataPayloadParts}.xmin::text, '/', ${civicDataPayloadParts}.ctid::text)`,
        }).from(civicDataPayloadParts).where(inArray(civicDataPayloadParts.hash, [...keys])),
        values, keyOf: row => row.hash,
      });
    },
  };
  private readonly payloadParts = new CivicPayloadParts(this.payloadPartIO);
  private readonly ownedPayloadParts = new CivicPayloadParts(this.payloadPartIO);
  private readonly storedHeldFacts = new WeakMap<object, unknown>();
  private async loadPayload(value: unknown, scope: string): Promise<unknown> {
    if (statePublicationScope(scope)) return decodeStateCandidate(await this.ownedPayloadParts.loadOwned(value));
    return this.payloadParts.load(value);
  }

  /** A navigation proof never needs the losing values, which are a part of their own. */
  private async loadProofCandidate(encoded: unknown): Promise<RoutineCandidate> {
    const candidate = encoded as RoutineCandidate;
    const proof = isNavigationCandidate(candidate) && isCivicPayloadPart((candidate as { excludedFacts?: unknown }).excludedFacts)
      ? { ...candidate, excludedFacts: [] } : candidate;
    return await this.loadPayload(proof, candidate.scope) as RoutineCandidate;
  }

  private async loadMetadataCandidate(encoded: unknown, candidateId: string): Promise<PublishedCandidateMetadata["candidate"]> {
    const loaded = await this.payloadParts.load(encoded);
    const resolve = async (value: unknown): Promise<unknown> => {
      if (value === null || typeof value !== "object") return value;
      if (Array.isArray(value)) return Promise.all(value.map(resolve));
      const row = value as Record<string, unknown>;
      if (Object.keys(row).length === 1 && Array.isArray(row.$civicCandidatePath)) {
        const path = row.$civicCandidatePath;
        if (!path.every(key => typeof key === "string")) throw new Error("CIVIC_CANDIDATE_PATH_INVALID");
        const target = await this.readCandidatePath(candidateId, ["readModel", ...path]);
        if (target === null) throw new Error("CIVIC_CANDIDATE_PATH_INVALID");
        return target;
      }
      return Object.fromEntries(await Promise.all(Object.entries(row).map(async ([key, child]) => [key, await resolve(child)])));
    };
    return await resolve(loaded) as PublishedCandidateMetadata["candidate"];
  }

  /** Large manual receipts share immutable held facts; full candidate reads hydrate them and reader proofs omit them. */
  private async storeReceipt(candidate: Pick<RoutineCandidate, "recordClass" | "scope">, receipt: ValidationReceipt | null): Promise<unknown> {
    if (receipt === null || !isPartedManualCandidate(candidate)) return receipt;
    const { excludedFacts, ...rest } = receipt;
    return { ...await this.payloadParts.store(rest, Object.keys(rest)) as object, excludedFacts: await this.heldFactParts(excludedFacts) };
  }

  /** The candidate and each of its receipts carry the same held facts, so they are encoded once. */
  private async heldFactParts(facts: unknown): Promise<unknown> {
    if (facts === null || typeof facts !== "object") return this.payloadParts.store(facts);
    if (!this.storedHeldFacts.has(facts)) this.storedHeldFacts.set(facts, await this.payloadParts.store(facts));
    return this.storedHeldFacts.get(facts);
  }

  private async withReceiptParts<T extends { readonly validationReceipt: unknown }>(row: T, heldFacts = true): Promise<T> {
    const receipt = row.validationReceipt as { readonly excludedFacts?: unknown } | null;
    if (!receipt || !isCivicPayloadPart(receipt.excludedFacts)) return row;
    return { ...row, validationReceipt: heldFacts ? await this.payloadParts.load(receipt) : { ...receipt, excludedFacts: [] } };
  }

  private async readStatePromotion<T>(recordClass: RoutineRecordClass, scope: string): Promise<PromotedProjection<T> | null> {
    const result = await this.readCache.rows({ namespace: "state-promotion", keys: [projectionKey(recordClass, scope)],
      keyOf: row => projectionKey(recordClass, scope),
      versions: async () => this.db.select({ key: civicDataPromotions.key,
        etag: sql<string>`concat(${civicDataPromotions}.xmin::text, '/', ${civicDataPromotions}.ctid::text, '/',
          ${civicDataCandidates}.xmin::text, '/', ${civicDataCandidates}.ctid::text)`,
        confirmation: latestConfirmationDetail(),
      }).from(civicDataPromotions).leftJoin(civicDataCandidates, eq(civicDataCandidates.id, civicDataPromotions.currentVersionId))
        .where(eq(civicDataPromotions.key, projectionKey(recordClass, scope))),
      values: async () => { const value = await this.readStatePromotionBody<T>(recordClass, scope); return value ? [value] : []; },
      freshen: (row, version) => {
        const confirmation = version.confirmation ? parseUnchangedConfirmation(version.confirmation) : null;
        const { latestConfirmation, ...projection } = row;
        return confirmation?.versionId === row.versionId ? { ...projection, latestConfirmation: confirmation } : projection;
      },
    });
    return result[0] ?? null;
  }

  private async readStatePromotionBody<T>(recordClass: RoutineRecordClass, scope: string): Promise<PromotedProjection<T> | null> {
    const result = await this.db.execute(sql`WITH state_promotion AS MATERIALIZED (
      SELECT p.*,
        (p.payload = c.candidate->'readModel' AND p.validation_receipt = c.validation_receipt) AS coupled,
        (SELECT e.detail FROM civic_data_candidate_events e WHERE e.candidate_id = p.current_version_id
          AND left(e.detail, ${UNCHANGED_CONFIRMATION_PREFIX.length}) = ${UNCHANGED_CONFIRMATION_PREFIX}
          ORDER BY e.sequence DESC LIMIT 1) AS confirmation
      FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id = p.current_version_id
      WHERE p.key = ${projectionKey(recordClass, scope)}
    ) SELECT jsonb_build_object('key', key, 'recordClass', record_class, 'scope', scope,
        'sourceId', source_id, 'versionId', current_version_id, 'lastKnownGoodVersionId', last_known_good_version_id,
        'promotedAt', promoted_at, 'receipt', validation_receipt, 'payload', payload) AS projection,
      coupled, confirmation FROM state_promotion`);
    const row = result.rows[0] as { projection: PromotedProjection<T>; coupled: boolean; confirmation: string | null } | undefined;
    if (!row) return null;
    if (!row.coupled) throw new Error(`STATE_PUBLICATION_POINTER_PROOF_INVALID:${recordClass}:${scope}`);
    const decoded = await this.ownedPayloadParts.loadOwned(row.projection) as PromotedProjection<T>;
    const projection = { ...decoded, promotedAt: canonicalPostgresRoutineTimestamp(decoded.promotedAt, "promotion.promotedAt") };
    const confirmation = row.confirmation ? parseUnchangedConfirmation(row.confirmation) : null;
    if (confirmation?.versionId === projection.versionId) Object.assign(projection, { latestConfirmation: confirmation });
    return projection;
  }

  async readRegistrySlice(state: string, bodyIds: readonly string[], divisionIds: readonly string[]): Promise<RegistryLookup | null> {
    return readKeyedRegistry((text, params) => this.readerRows(text, params), state, bodyIds, divisionIds);
  }

  async readRegistryDivisions(state: string, labels: readonly string[]): Promise<readonly RegistryDivisionMatch[]> {
    return readKeyedRegistryDivisions((text, params) => this.readerRows(text, params),state,labels.map(registryDivisionLabel));
  }

  private async candidateRows<T extends { readonly id: string }>(
    ids: readonly string[], namespace: string, values: (keys: readonly string[]) => Promise<readonly T[]>,
  ): Promise<readonly T[]> {
    if (ids.length === 0) return [];
    return this.readCache.rows({ namespace, keys: ids, values, keyOf: row => row.id,
      versions: async keys => this.db.select({ key: civicDataCandidates.id,
        etag: sql<string>`concat(${civicDataCandidates}.xmin::text, '/', ${civicDataCandidates}.ctid::text)`,
      }).from(civicDataCandidates).where(inArray(civicDataCandidates.id, [...keys])),
    });
  }

  private async candidateValue<T>(namespace: string, candidateId: string, read: () => Promise<T>): Promise<T | null> {
    const [row] = await this.candidateRows([candidateId], namespace, async () => [{ id: candidateId, value: await read() }]);
    return row?.value ?? null;
  }

  private async eventValue<T>(namespace: string, candidateId: string, read: () => Promise<T>): Promise<T> {
    const [row] = await this.readCache.rows({ namespace, keys: [candidateId], keyOf: row => row.id,
      versions: async () => {
        const rows = await this.db.select({ etag: sql<string>`coalesce(md5(string_agg(concat(
          ${civicDataCandidateEvents.sequence}::text, '/', ${civicDataCandidateEvents}.xmin::text, '/',
          ${civicDataCandidateEvents}.ctid::text), ',' order by ${civicDataCandidateEvents.sequence})), 'empty')` })
          .from(civicDataCandidateEvents).where(eq(civicDataCandidateEvents.candidateId, candidateId));
        return [{ key: candidateId, etag: rows[0]!.etag }];
      }, values: async () => [{ id: candidateId, value: await read() }],
    });
    return row!.value;
  }

  private promotionVersions(recordClass: RoutineRecordClass, scopes: readonly string[]) {
    return this.db.select({ key: civicDataPromotions.scope,
      etag: sql<string>`concat(${civicDataPromotions}.xmin::text, '/', ${civicDataPromotions}.ctid::text, '/',
        ${civicDataCandidates}.xmin::text, '/', ${civicDataCandidates}.ctid::text)`,
    }).from(civicDataPromotions).leftJoin(civicDataCandidates, eq(civicDataCandidates.id, civicDataPromotions.currentVersionId))
      .where(and(eq(civicDataPromotions.recordClass, recordClass), inArray(civicDataPromotions.scope, [...scopes])));
  }

  private async promotionRows(recordClass: RoutineRecordClass, scopes: readonly string[]) {
    const values = async (keys: readonly string[]) => this.db
      .select({ ...getTableColumns(civicDataPromotions), latestConfirmation: latestConfirmationDetail() })
      .from(civicDataPromotions).where(and(eq(civicDataPromotions.recordClass, recordClass),
        inArray(civicDataPromotions.scope, keys.map(key => key.slice(recordClass.length + 1)))));
    const keys = scopes.map(scope => projectionKey(recordClass, scope));
    if (keys.length === 0) return [];
    return this.readCache.rows({ namespace: "promotion", keys, values, keyOf: row => row.key,
      versions: async selected => this.db.select({ key: civicDataPromotions.key,
        etag: sql<string>`concat(${civicDataPromotions}.xmin::text, '/', ${civicDataPromotions}.ctid::text)`,
        latestConfirmation: latestConfirmationDetail(),
      }).from(civicDataPromotions).where(and(eq(civicDataPromotions.recordClass, recordClass),
        inArray(civicDataPromotions.key, [...selected]))),
      freshen: (row, version) => ({ ...row, latestConfirmation: version.latestConfirmation }),
    });
  }
  private writeAuthority: RuntimeAuthorityEnvelope | null = null;

  async eventObservedAt(recordClass: RoutineRecordClass, scope: string, _requestedAt: string): Promise<string> {
    const [row] = await this.db.select({ at: sql<string | null>`max(${civicDataCandidateEvents.at})` })
      .from(civicDataCandidateEvents)
      .innerJoin(civicDataCandidates, eq(civicDataCandidates.id, civicDataCandidateEvents.candidateId))
      .where(and(eq(civicDataCandidates.recordClass, recordClass), eq(civicDataCandidates.scope, scope)));
    return new Date(Math.max(Date.now(), row?.at == null ? 0 : Date.parse(row.at))).toISOString();
  }

  private assertMutationAuthority(): RuntimeAuthorityEnvelope {
    if (this.writeAuthority !== null) return this.writeAuthority;
    this.writeAuthority = assertRoutineDataStoreMutationAuthority();
    return this.writeAuthority;
  }

  private assertCandidateMutationAuthority(
    candidate: CandidateAuthorityIdentity,
    operation: "candidate" | "reader-evidence" = "candidate",
  ): void {
    const issue = routineDataStoreCandidateAuthorityIssue(
      candidate,
      this.assertMutationAuthority(),
      operation,
    );
    if (issue !== null) throw new RuntimeAuthorityRefused(issue);
  }


  private candidateEventLock(candidateId: string) {
    return this.db.execute(sql`
      select pg_advisory_xact_lock(hashtextextended(${candidateId}, 0))
    `);
  }

  private nextCandidateEventSequence(candidateId: string) {
    return sql`(
      select coalesce(max(${civicDataCandidateEvents.sequence}), 0) + 1
      from ${civicDataCandidateEvents}
      where ${civicDataCandidateEvents.candidateId} = ${candidateId}
    )`;
  }

  /** Each large section is encoded, written and released before the next, so the whole candidate is never encoded at once. */
  private async storeSectionedCandidate(candidate: RoutineCandidate, navigationIndex?: unknown): Promise<RoutineCandidate> {
    const { readModel, normalizedPayload, civicRecords, identities, changeSet, excludedFacts, ...rest } = candidate;
    const stored: Record<string, unknown> = await this.payloadParts.store(navigationIndex ? { ...rest, navigationIndex } : rest,
      ["id", "sourceId", "recordClass", "scope", "retrieval", "normalization", "temporal", "bootstrapImport", "navigationIndex"]) as Record<string, unknown>;
    stored.readModel = await this.payloadParts.store(readModel);
    stored.normalizedPayload = normalizedPayload === readModel ? stored.readModel : await this.payloadParts.store(normalizedPayload);
    for (const [key, value] of Object.entries({ civicRecords, identities, changeSet })) {
      if (value !== undefined) stored[key] = await this.payloadParts.store(value);
    }
    if (excludedFacts !== undefined) stored.excludedFacts = await this.heldFactParts(excludedFacts);
    return stored as unknown as RoutineCandidate;
  }

  async create(record: CandidateVersionRecord, firstEvent: CandidateEvent): Promise<void> {
    this.assertCandidateMutationAuthority(record.candidate);
    assertInitialRecord(record, firstEvent);
    const stateAuthority = statePublicationScope(record.candidate.scope);
    const meetingDoors = record.candidate.sourceId === "meeting-doors";
    const meeting = record.candidate.recordClass === "MEETING";
    const memberOffices = record.candidate.recordClass === "CURATED_READER_RECORD" && (record.candidate.scope === MEMBER_OFFICES_SCOPE || memberOfficeScopeState(record.candidate.scope) !== null);
    const candidate = stateAuthority || meetingDoors || meeting || memberOffices ? { ...(stateAuthority ? encodeStateCandidate(record.candidate) : record.candidate),
      retrieval: await this.payloadParts.store(record.candidate.retrieval,
        ["succeeded", "requestedUrl", "finalUrl", "httpStatus", "retrievedAt", "rawHash", "rawHashBasis", "complete", "sourceCheck", "failureDetail"]),
    } : record.candidate;
    const navigationIndex = navigationCandidateIndex(record.candidate);
    const stored = stateAuthority || meetingDoors || meeting || ["REGISTRY_RUNTIME_BINDING", "STATE_ROLL_CALL", "CENSUS_REFERENCE"].includes(record.candidate.recordClass)
      ? await this.payloadParts.store(candidate,
        ["id", "sourceId", "recordClass", "scope", "retrieval", "normalization", "temporal", "bootstrapImport"],
        meetingDoors || meeting ? ["readModel", "normalizedPayload", "changeSet", "identities"] : stateAuthority ? ["readModel"] : undefined) as RoutineCandidate
      : navigationIndex || memberOffices ? await this.storeSectionedCandidate(candidate as RoutineCandidate, navigationIndex) : record.candidate;
    await this.db.batch([
      this.db.insert(civicDataCandidates).values({
        id: record.candidate.id,
        sourceId: record.candidate.sourceId,
        recordClass: record.candidate.recordClass,
        scope: record.candidate.scope,
        state: record.state,
        acquisitionSucceeded: record.acquisitionSucceeded,
        rawHash: record.candidate.retrieval.rawHash,
        normalizedHash: record.candidate.normalization.normalizedHash,
        retrievedAt: record.candidate.retrieval.retrievedAt,
        sourceThrough: record.candidate.temporal.sourceThrough,
        parserVersion: record.candidate.normalization.parserVersion,
        identity: stored.identities,
        candidate: stored,
        validationReceipt: await this.storeReceipt(record.candidate, record.receipt),
        promotedVersionId: record.promotedVersion,
        lastKnownGoodVersionId: record.lastKnownGoodVersion,
        failureCode: record.failureCode,
        failureDetail: record.failureDetail,
      }),
      this.db.insert(civicDataCandidateEvents).values(firstEvent),
    ]);
  }

  async transition(candidateId: string, state: CandidateState, at: string, detail: string, receipt?: ValidationReceipt, failure?: { code: string; detail: string }, options: CandidateTransitionOptions = {}): Promise<CandidateVersionRecord> {
    this.assertMutationAuthority();
    const [priorRow] = await candidateTransitionRead(this.db, candidateId);
    if (!priorRow) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
    const authority = readerEvidenceRowToRecord(priorRow);
    this.assertCandidateMutationAuthority(authority.candidate);
    if (options.candidate && !heldEnvelopeMatches(priorRow, options.candidate)) {
      throw new Error(`CANDIDATE_TRANSITION_ENVELOPE_MISMATCH:${candidateId}`);
    }
    assertTransitionInput(
      { state: authority.state, candidate: { ...authority.candidate, retrieval: { retrievedAt: priorRow.retrievedAt } } },
      state, at, detail, receipt, failure,
    );
    const allowed = allowedPriorStates(state);
    const storedReceipt = receipt ? await this.storeReceipt(authority.candidate, receipt) : undefined;
    const priorStateEligible = and(
      eq(civicDataCandidates.id, candidateId),
      inArray(civicDataCandidates.state, [...allowed]),
    )!;
    const nextSequence = this.nextCandidateEventSequence(candidateId);
        /* The compare-and-set and its event are one data-modifying CTE: neither can commit without the other. */
    const updatedCandidate = this.db.$with("updated_candidate").as(
      this.db.update(civicDataCandidates).set({
        state,
        ...(receipt ? { validationReceipt: storedReceipt } : {}),
        ...(failure ? { failureCode: failure.code, failureDetail: failure.detail } : {}),
      }).where(priorStateEligible).returning({ candidateId: civicDataCandidates.id }),
    );
    const transitionWrite = this.db.with(updatedCandidate)
      .insert(civicDataCandidateEvents)
      .select(sql`
        select gen_random_uuid(), ${updatedCandidate.candidateId}, ${nextSequence}, ${state}, ${at}::timestamptz, ${detail}
        from ${updatedCandidate}
      `)
      .returning();
    const updatedCandidateRead = candidateSummaryRead(this.db, candidateId);
    const [, eventRows, updatedRows] = await this.db.batch([
      this.candidateEventLock(candidateId),
      transitionWrite,
      updatedCandidateRead,
    ]);
    if (!eventRows[0] || !updatedRows[0]) {
      const [current] = await this.db.select({ state: civicDataCandidates.state })
        .from(civicDataCandidates)
        .where(eq(civicDataCandidates.id, candidateId))
        .limit(1);
      if (!current) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
      throw new Error(`CANDIDATE_TRANSITION_INVALID:${candidateId}:${current.state}:${state}`);
    }
    const { candidate: _sameRow, ...columns } = postgresCandidateSummary(updatedRows[0]);
    return { ...columns, receipt: receipt ?? columns.receipt as ValidationReceipt | null,
      candidate: options.candidate ?? await this.readCandidateEnvelope(candidateId) };
  }

  private async readCandidateEnvelope(candidateId: string): Promise<RoutineCandidate> {
    return (await this.candidateValue("candidate-envelope", candidateId, async () => {
      const [row] = await this.db.select({ candidate: civicDataCandidates.candidate })
      .from(civicDataCandidates)
      .where(eq(civicDataCandidates.id, candidateId))
      .limit(1);
      if (!row) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
      return await this.loadPayload(row.candidate, (row.candidate as RoutineCandidate).scope) as RoutineCandidate;

    })) ?? Promise.reject(new Error(`CANDIDATE_NOT_FOUND:${candidateId}`));
  }

  async readCandidate(candidateId: string): Promise<CandidateVersionRecord | null> {
    const [row] = await this.candidateRows([candidateId], "candidate", async ids =>
      this.db.select().from(civicDataCandidates).where(inArray(civicDataCandidates.id, [...ids])));
    return row ? { ...rowToCandidate(await this.withReceiptParts(row)), candidate: await this.loadPayload(row.candidate, (row.candidate as RoutineCandidate).scope) as RoutineCandidate } : null;
  }

  async readCandidatePath<T = unknown>(candidateId: string, path: readonly string[]): Promise<T | null> {
    if (!path.length) throw new Error("CANDIDATE_FIELD_PATH_REQUIRED");
    // Walk inline fields inside Postgres; stop at the first immutable part reference.
    // Returning the parent field would still ship a whole inline roster for its captures.
    const keys = sql`ARRAY[${sql.join(path.map(key => sql`${key}`), sql`, `)}]::text[]`;
    const [selected] = await this.candidateRows([candidateId], `candidate-path:${JSON.stringify(path)}`, async () => {
      const result = await this.db.execute(sql`WITH RECURSIVE candidate_path(value,depth) AS (
        SELECT ${civicDataCandidates.candidate},0 FROM ${civicDataCandidates} WHERE ${civicDataCandidates.id}=${candidateId}
        UNION ALL
        SELECT value -> (${keys})[depth+1],depth+1 FROM candidate_path
        WHERE depth < ${path.length} AND NOT coalesce(value ? '$civicPayloadPart',false)
      ) SELECT value,depth FROM candidate_path ORDER BY depth DESC LIMIT 1`);
      const row = result.rows[0] as { value: unknown; depth: number } | undefined;
      if (!row) return [];
      const value = await this.payloadParts.load(await this.payloadParts.path(row.value, path.slice(Number(row.depth))));
      return [{ id: candidateId, value: value === undefined ? null : value as T }];
    });
    return selected?.value ?? null;
  }

  async readNavigationPublicationBase(scope: string): Promise<NavigationPublicationBase | null> {
    const [row] = await this.readVersioned("readNavigationPublicationBase", "CURATED_READER_RECORD", scope, async () => this.db.select({
      ...PROMOTED_POINTER_IDENTITY_COLUMNS,
      candidate: sql<unknown>`(${civicDataCandidates.candidate} - array['readModel','normalizedPayload','civicRecords','identities','changeSet','excludedFacts','retrieval']) ||
        jsonb_build_object('retrieval', ${civicDataCandidates.candidate}->'retrieval' #- '{manualSourceReceipt,sources}')`,
      receipt: sql<unknown>`jsonb_set(${civicDataCandidates.validationReceipt}, '{excludedFacts}', '[]'::jsonb)`,
      state: civicDataCandidates.state,
      acquired: civicDataCandidates.acquisitionSucceeded,
      promotedVersion: civicDataCandidates.promotedVersionId,
      lkgVersion: civicDataCandidates.lastKnownGoodVersionId,
      exact: sql<boolean>`${civicDataCandidates.sourceId} = ${civicDataPromotions.sourceId}
        and ${civicDataCandidates.recordClass} = ${civicDataPromotions.recordClass}
        and ${civicDataCandidates.scope} = ${civicDataPromotions.scope}
        and ${civicDataCandidates.normalizedHash} = ${civicDataCandidates.candidate} #>> '{normalization,normalizedHash}'
        and ${civicDataCandidates.candidate}->'readModel' = ${civicDataPromotions.payload}
        and ${civicDataCandidates.candidate}->'normalizedPayload' = ${civicDataCandidates.candidate}->'readModel'
        and ${civicDataCandidates.validationReceipt} = ${civicDataPromotions.validationReceipt}`,
    }).from(civicDataPromotions).leftJoin(civicDataCandidates, eq(civicDataCandidates.id, civicDataPromotions.currentVersionId))
      .where(and(eq(civicDataPromotions.recordClass, "CURATED_READER_RECORD"), eq(civicDataPromotions.scope, scope))).limit(1));
    if (!row) return null;
    const candidate = row.candidate as RoutineCandidate & { navigationIndex?: { reviewFactsHash: string; reviewHeldKeysHash: string } };
    const receipt = parseValidationReceipt(row.receipt);
    const pointer = postgresPromotedPointerIdentity(row);
    const times = [candidate?.retrieval?.retrievedAt, receipt?.validatedAt, pointer.promotedAt].map(value => Date.parse(value ?? ""));
    if (!row.exact || pointer.key !== projectionKey("CURATED_READER_RECORD", scope) || row.state !== "PROMOTED" || !row.acquired || row.promotedVersion !== pointer.versionId ||
        row.lkgVersion !== pointer.versionId || pointer.lastKnownGoodVersionId !== pointer.versionId ||
        candidate?.id !== pointer.versionId || candidate.sourceId !== pointer.sourceId || candidate.scope !== scope ||
        candidate.recordClass !== "CURATED_READER_RECORD" || !receipt || receipt.decision !== "GOOD" ||
        receipt.candidateId !== candidate.id || receipt.sourceId !== candidate.sourceId || receipt.scope !== scope ||
        !/^[a-f0-9]{64}$/.test(candidate.normalization?.normalizedHash ?? "") ||
        candidate.normalization.normalizedPayloadHash !== candidate.normalization.normalizedHash ||
        receipt.recordClass !== candidate.recordClass || !times.every(Number.isFinite) || times[0] > times[1] || times[1] > times[2]) {
      throw new Error("MANUAL_PROMOTION_BASE_PROOF_INVALID:ballot-navigation");
    }
    const metadata: CandidateVersionRecord = { candidate, receipt, state: "PROMOTED", acquisitionSucceeded: true,
      promotedVersion: pointer.versionId, lastKnownGoodVersion: pointer.versionId, failureCode: null, failureDetail: null };
    const parts = this.payloadParts;
    const field = async (key: string) => {
      const [encoded] = await this.db.select({ value: sql<unknown>`${civicDataCandidates.candidate}->${key}` })
        .from(civicDataCandidates).where(eq(civicDataCandidates.id, pointer.versionId)).limit(1);
      if (!encoded) throw new Error("MANUAL_SUCCESSOR_EXACT_BASE_UNAVAILABLE");
      return encoded.value;
    };
    const records = async function* () {
      yield* parts.rows(await parts.path(await field("readModel"), ["records"])) as AsyncGenerator<NavigationRecord>;
    };
    return { pointer, record: metadata, reviewFactsHash: candidate.navigationIndex?.reviewFactsHash ?? null,
      reviewHeldKeysHash: candidate.navigationIndex?.reviewHeldKeysHash ?? null,
      hasSourceReceipt: candidate.retrieval.manualSourceReceipt !== undefined, records,
      sourceReceipt: async () => {
        const [source] = await this.db.select({ receipt: sql<unknown>`${civicDataCandidates.candidate} #> '{retrieval,manualSourceReceipt}'` })
          .from(civicDataCandidates).where(eq(civicDataCandidates.id, pointer.versionId)).limit(1);
        return source?.receipt as import("./types.ts").ManualSourceSetReceipt | undefined;
      },
      identities: async function* () { yield* parts.rows(await field("identities")) as AsyncIterable<import("./types.ts").IdentityEvidence>; },
    };
  }

  async readCandidateSummary(candidateId: string): Promise<CandidateVersionSummary | null> {
    return this.candidateValue("candidate-summary", candidateId, async () => {
      const [row] = await candidateSummaryRead(this.db, candidateId);
      return row ? postgresCandidateSummary(row) : null;

    });
  }

  async readStateRetirementBaseline(recordClass: RoutineRecordClass, scope: string) {
    return this.readVersioned("state-retirement-baseline", recordClass, scope, async () => {
      if (!statePublicationScope(scope)) throw new Error("STATE_RETIREMENT_BASELINE_SCOPE_INVALID");
      const c = civicDataCandidates, e = civicDataCandidateEvents;
      const [row] = await this.db.select({ normalizedHash: c.normalizedHash,
      hashes: sql<unknown>`${c.candidate}#>'{normalization,stateRecordHashes}'`,
      }).from(c).innerJoin(e, and(eq(e.candidateId, c.id), eq(e.sequence, 1)))
      .where(and(eq(c.recordClass, recordClass), eq(c.scope, scope), eq(c.state, "PROMOTED"),
        sql`${c.validationReceipt}->>'decision'='GOOD'`, like(e.detail, "STATE_BUCKET_RESTORE_V1 %")))
      .orderBy(desc(e.at)).limit(1);
      if (!row) return null;
      const hashes = await this.loadPayload(row.hashes, scope) as RoutineCandidate["normalization"]["stateRecordHashes"];
      if (hashes?.readModelHash !== row.normalizedHash) throw new Error("STATE_RETIREMENT_BASELINE_HASH_MISMATCH");
      return hashes ?? null;

    });
  }

  async hasStateRetirementProof(contractId: string, origin: NonNullable<RoutineCandidate["stateRetirement"]>["origin"]): Promise<boolean> {
    const target = retirementProofTarget(contractId, origin);
    const progress = await readRetirementProgress((text, params) => this.readerRows(text, params), [target]);
    return progress.get(origin.versionId)?.has(target.state) === true;
  }

  async readStateRetirementOrigin(recordClass: string, scope: string) {
    return this.readVersioned("state-retirement-origin", recordClass as RoutineRecordClass, scope, async () => {
      const p = civicDataPromotions, c = civicDataCandidates;
      const [row] = await this.db.select({ versionId: p.currentVersionId, lastKnownGoodVersionId: p.lastKnownGoodVersionId,
      sourceId: c.sourceId, recordClass: c.recordClass, scope: c.scope, normalizedHash: c.normalizedHash,
      promoted: sql<boolean>`${c.state}='PROMOTED' AND ${c.acquisitionSucceeded}=true
        AND ${c.promotedVersionId}=${c.id} AND ${c.lastKnownGoodVersionId}=${c.id} AND ${p.sourceId}=${c.sourceId}
        AND ${c.validationReceipt}->>'decision'='GOOD' AND ${p.validationReceipt}=${c.validationReceipt}`,
      sourceAuthenticity: sql<string | null>`(SELECT entry->>'code' FROM jsonb_array_elements(${c.validationReceipt}->'checks') entry
        WHERE entry->>'check'='SOURCE_AUTHENTICITY' AND entry->>'verdict'='PASS' LIMIT 1)`,
      }).from(p).innerJoin(c, eq(c.id, p.currentVersionId)).where(eq(p.key, `${recordClass}:${scope}`)).limit(1);
      return row ?? null;

    });
  }

  async readStatePublicationBase(recordClass: RoutineRecordClass, scope: string): Promise<{ current: PromotedProjection | null; lkg: CandidateVersionRecord | null }> {
    if (!statePublicationScope(scope)) throw new Error(`STATE_PUBLICATION_SCOPE_INVALID:${scope}`);
    const prior = takeStatePublicationPrior(this, recordClass, scope);
    const column = civicDataCandidates.candidate;
    const candidateColumns = prior ? { ...getTableColumns(civicDataCandidates),
      identity: sql<unknown>`'[]'::jsonb`,
      validationReceipt: sql<unknown>`null::jsonb`,
      candidate: sql<unknown>`jsonb_build_object(
        'id', ${column}->'id', 'sourceId', ${column}->'sourceId', 'recordClass', ${column}->'recordClass',
        'scope', ${column}->'scope', 'normalization', (${column}->'normalization') - 'stateRecordHashes', 'temporal', ${column}->'temporal',
        'retrieval', (${column}->'retrieval') - 'derived', 'readModel', ${column}->'readModel')`,
    } : getTableColumns(civicDataCandidates);
    const [row] = await this.readVersioned("readStatePublicationBase"+(prior ? ":prior" : ":full"), recordClass, scope, async () => this.db.select({ promotion: civicDataPromotions, candidate: candidateColumns,
      ...(prior ? { receiptsCoupled: sql<boolean>`${civicDataPromotions.validationReceipt} = ${civicDataCandidates.validationReceipt}` } : {}) })
      .from(civicDataPromotions).leftJoin(civicDataCandidates, eq(civicDataCandidates.id, civicDataPromotions.lastKnownGoodVersionId))
      .where(eq(civicDataPromotions.key, projectionKey(recordClass, scope))).limit(1));
    if (!row) return { current: null, lkg: null };
    if (!row.candidate) return { current: { ...postgresPromotionRowToProjection(row.promotion), payload: null }, lkg: null };
    if (prior && row.receiptsCoupled !== true) throw new Error(`STATE_PUBLICATION_POINTER_RECEIPT_MISMATCH:${row.promotion.key}`);
    const candidateRow = prior ? { ...row.candidate, validationReceipt: clockReceipt(row.promotion).validationReceipt } : row.candidate;
    const encoded = candidateRow.candidate as RoutineCandidate;
    const encodedHash = durableStateHash(row.promotion.payload);
    if (encodedHash !== durableStateHash(encoded.readModel))
      throw new Error(`STATE_PUBLICATION_POINTER_PAYLOAD_MISMATCH:${row.promotion.key}`);
    const indexed = prior?.versionId === row.promotion.currentVersionId && prior.payloadHash === candidateRow.normalizedHash;
    if (prior && !indexed) throw new Error(`STATE_PUBLICATION_BASE_CHANGED:${row.promotion.key}`);
    const metadata = { id: encoded.id, sourceId: encoded.sourceId, recordClass: encoded.recordClass, scope: encoded.scope,
      normalization: encoded.normalization, temporal: encoded.temporal, readModel: null, normalizedPayload: null, civicRecords: [], identities: [],
      excludedFacts: (candidateRow.validationReceipt as ValidationReceipt | null)?.excludedFacts ?? [],
      retrieval: { ...encoded.retrieval, derived: undefined } };
    const loaded = await this.loadPayload(prior ? metadata : encoded, scope) as RoutineCandidate;
    const candidate = indexed ? { ...loaded, normalization: { ...loaded.normalization, stateRecordHashes: prior.recordHashes } } : loaded;
    if (indexed) bindStatePublicationPrior(candidate, prior);
    const current = { ...postgresPromotionRowToProjection(prior ? clockReceipt(row.promotion) : row.promotion), payload: candidate.readModel };
    return { current, lkg: { ...rowToCandidate(candidateRow), candidate } };
  }

  async readPublicationBase(recordClass:RoutineRecordClass,scope:string):Promise<RoutinePublicationBase> {
    if(statePublicationScope(scope))return ownPublicationBase(this,recordClass,scope,await this.readStatePublicationBase(recordClass,scope));
    if(recordClass==="STATE_BILL" && (scope===LEGISCAN_BULK_SCOPE || /^legiscan-bills:session:[1-9]\d*(?::|$)/.test(scope)))
      return ownPublicationBase(this,recordClass,scope,await readLegiscanPublicationBase((text,params)=>this.readerRows(text,params),scope,value=>this.loadPayload(value,scope)));
    if(recordClass!=="FEDERAL_MONEY")throw new Error(`PUBLICATION_BASE_SCOPE_UNSUPPORTED:${recordClass}:${scope}`);
    return ownPublicationBase(this,recordClass,scope,await readFederalMoneyPublicationBase((text,params)=>this.readerRows(text,params),this.readCache,scope,
      value=>this.loadPayload(value,scope)));
  }

  async readFederalMoneyPriorPlaces(candidateId:string):Promise<readonly string[]> {
    return readFederalMoneyPriorPlaces((text,params)=>this.readerRows(text,params),candidateId);
  }

  async readFederalMoneyPartitionKeys(scope:string,ids:readonly string[]):Promise<FederalMoneyPartitionKeys|null> {
    return readFederalMoneyPartitionKeys((text,params)=>this.readerRows(text,params),scope,ids);
  }

  async readPromotion<T = unknown>(recordClass: RoutineRecordClass, scope: string): Promise<PromotedProjection<T> | null> {
    if (statePublicationScope(scope)) return this.readStatePromotion<T>(recordClass, scope);
    const [row] = await this.promotionRows(recordClass, [scope]);
    if (!row) return null;
    const projection = { ...postgresPromotionRowToProjection<T>(await this.withReceiptParts(row, false)), payload: await this.loadPayload(row.payload, row.scope) as T };
    return projection;
  }

  async readPromotions<T = unknown>(
    recordClass: RoutineRecordClass,
    scopes: readonly string[],
  ): Promise<readonly PromotedProjection<T>[]> {
    if (scopes.length === 0) return [];
    const rows = await this.promotionRows(recordClass, scopes);
    return Promise.all(rows.map(async row => ({ ...postgresPromotionRowToProjection<T>(await this.withReceiptParts(row, false)), payload: await this.loadPayload(row.payload, row.scope) as T })));
  }

  async listPromotionScopes(recordClasses: readonly RoutineRecordClass[]) {
    const rows = await this.db.select({ recordClass: civicDataPromotions.recordClass, scope: civicDataPromotions.scope })
      .from(civicDataPromotions).where(inArray(civicDataPromotions.recordClass, [...recordClasses]));
    return rows as { recordClass: RoutineRecordClass; scope: string }[];
  }

  async readPortraitRunState(scope: string): Promise<PortraitRunState | null> {
    return this.readVersioned("portrait-run-state", "STATE_LEGISLATOR", scope, async () => {
      // The record itself is about 1 MB; only its schedule fact and its people's attempt facts leave the database.
      const [row] = (await this.db.execute(sql`select
        (select f->'record' from jsonb_array_elements(case when jsonb_typeof(c.candidate->'excludedFacts') = 'array'
            then c.candidate->'excludedFacts' else '[]'::jsonb end) f where f->>'code' = ${PORTRAIT_SCHEDULE_CODE} limit 1) as schedule,
        (select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(c.candidate->'excludedFacts') = 'array'
            then c.candidate->'excludedFacts' else '[]'::jsonb end) f where f->>'code' like 'STATE\_PORTRAIT\_%' or f->>'code' like 'CONGRESS\_PORTRAIT\_%') as attempts
      from civic_data_promotions p join civic_data_candidates c on c.id = p.current_version_id
      where p.record_class = 'STATE_LEGISLATOR' and p.scope = ${scope}`)).rows as { schedule: { nextDueAt?: string | null; seen?: PortraitStamp } | null; attempts: PortraitAttemptFact[] }[];
      return row ? { nextDueAt: row.schedule?.nextDueAt ?? null, seen: row.schedule?.seen ?? null, attempts: row.attempts } : null;

    });
  }

  async readSlimRosters(recordClass: RoutineRecordClass, scopes: readonly string[]): Promise<readonly SlimRoster[]> {
    if (!scopes.length) return [];
    type RosterRow = { scope: string; version_id: string; promoted_at: string | Date; normalized_hash: string | null; roster: OfficeholderSet };
    const rows = await this.readCache.rows<RosterRow, { key: string; etag: string }>({ namespace: `slim-roster:${recordClass}`, keys: scopes,
      keyOf: row => row.scope, versions: async selected => this.promotionVersions(recordClass, selected),
      values: async selected => {
      const rows = (await this.db.execute(sql`select p.scope, p.current_version_id as version_id, p.promoted_at, c.normalized_hash,
        (p.payload->'roster') - 'officeholders' - 'endedMemberships' || jsonb_build_object('officeholders',
          (select coalesce(jsonb_agg(o - 'offices' - 'fieldSources' || jsonb_build_object('fieldSources', coalesce(jsonb_strip_nulls(jsonb_build_object(
              'name', o#>'{fieldSources,name}', 'officeTitle', o#>'{fieldSources,officeTitle}', 'photo', o#>'{fieldSources,photo}')), '{}'::jsonb))), '[]'::jsonb)
            from jsonb_array_elements(p.payload#>'{roster,officeholders}') o)) as roster
      from civic_data_promotions p join civic_data_candidates c on c.id = p.current_version_id
      where p.record_class = ${recordClass} and p.scope in (${sql.join(selected.map(scope => sql`${scope}`), sql`, `)})
        and jsonb_typeof(p.payload#>'{roster,officeholders}') = 'array'`)).rows as RosterRow[];
        return rows;
      },
    });
    return rows.map(row => ({ recordClass, scope: row.scope, versionId: row.version_id,
      promotedAt: new Date(row.promoted_at).toISOString(), readModelSha256: row.normalized_hash, roster: row.roster }));
  }

  async readOfficeRoster(scope: string): Promise<SlimRoster | null> {
    const [row] = (await this.db.execute(sql`SELECT p.current_version_id AS version_id, p.promoted_at, c.normalized_hash,
      jsonb_build_object('scope', r->'scope', 'generatedAt', r->'generatedAt', 'divisions', '[]'::jsonb, 'unmatched', '[]'::jsonb,
        'officeholders', (SELECT coalesce(jsonb_agg((SELECT coalesce(jsonb_object_agg(f.key,
          CASE WHEN f.key = 'provenance' THEN jsonb_build_object('sourceOrg', reader_payload_node(f.value)->'sourceOrg')
            ELSE reader_payload_value(f.value) END), '{}'::jsonb)
          FROM jsonb_each(reader_payload_node(member.item)) f WHERE f.key = ANY(${sql.param([...OFFICE_PERSON_FIELDS])}::text[])) ||
          jsonb_build_object('fieldSources', jsonb_strip_nulls(jsonb_build_object(
            'phone', reader_payload_value(reader_payload_node(reader_payload_node(member.item)->'fieldSources')->'phone'),
            'offices', reader_payload_value(reader_payload_node(reader_payload_node(member.item)->'fieldSources')->'offices'))))
          ORDER BY member.ordinal_index), '[]'::jsonb) FROM reader_payload_members(r->'officeholders') member)) AS roster
      FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id = p.current_version_id
      CROSS JOIN LATERAL (SELECT reader_payload_node(reader_payload_node(p.payload)->'roster') AS r) roster
      WHERE p.record_class = 'STATE_LEGISLATOR' AND p.scope = ${scope} AND r IS NOT NULL`)).rows as {
        version_id: string; promoted_at: string | Date; normalized_hash: string | null; roster: OfficeholderSet }[];
    return row ? { recordClass: "STATE_LEGISLATOR", scope, versionId: row.version_id,
      promotedAt: new Date(row.promoted_at).toISOString(), readModelSha256: row.normalized_hash, roster: row.roster } : null;
  }

  async readMemberOfficeMembers(members: readonly string[]): Promise<readonly import("../officials/member-offices.ts").MemberOfficeRecord[]> {
    return readMemberOfficeMembers((text,params)=>this.readerRows(text,params),members);
  }
  async readMemberOfficeSlice(state: string, members: readonly string[] = []): Promise<MemberOfficeSlice | null> {
    return readMemberOfficeRows((text, params) => this.readerRows(text, params), state, members);
  }
  async readMemberOfficeProgress(): Promise<MemberOfficeProgress> {
    const [row] = (await this.db.execute(sql`SELECT position FROM pass_cursor WHERE name=${MEMBER_OFFICE_CURSOR}`)).rows as { position: string }[];
    if (row) return JSON.parse(row.position) as MemberOfficeProgress;
    const held = await this.readPromotionPayloadFields("CURATED_READER_RECORD", MEMBER_OFFICES_SCOPE, ["rosterDigests", "pending"]);
    return { rosterDigests: (held?.rosterDigests ?? {}) as Record<string,string>, pending: (held?.pending ?? []) as string[] };
  }
  async writeMemberOfficeProgress(progress: MemberOfficeProgress): Promise<void> {
    this.assertCandidateMutationAuthority({ id: MEMBER_OFFICE_CURSOR, sourceId: "curated-reader-primary-sources", recordClass: "CURATED_READER_RECORD", scope: MEMBER_OFFICES_SCOPE });
    await this.db.execute(sql`INSERT INTO pass_cursor(name,position) VALUES(${MEMBER_OFFICE_CURSOR},${JSON.stringify(progress)})
      ON CONFLICT(name) DO UPDATE SET position=EXCLUDED.position`);
  }

  async readRosterIdDigests(recordClass: RoutineRecordClass, scopes: readonly string[]): Promise<readonly { readonly scope: string; readonly digest: string }[]> {
    if (!scopes.length) return [];
    const rows = (await this.db.execute(sql`select p.scope, count(o)::text || ':' || md5(coalesce(string_agg(o->>'id', ',' order by o->>'id' collate "C"), '')) as digest
      from civic_data_promotions p cross join lateral jsonb_array_elements(p.payload#>'{roster,officeholders}') o
      where p.record_class = ${recordClass} and p.scope in (${sql.join(scopes.map(scope => sql`${scope}`), sql`, `)})
        and jsonb_typeof(p.payload#>'{roster,officeholders}') = 'array' group by p.scope`)).rows as { scope: string; digest: string }[];
    return rows.map(row => ({ scope: row.scope, digest: row.digest }));
  }

  async readCandidateCaptures(candidateId: string, urls: readonly string[], members: readonly string[]): Promise<readonly unknown[]> {
    return (await this.candidateValue(`candidate-captures:${JSON.stringify([urls,members])}`, candidateId, async () => {
      const list = (values: readonly string[]) => `{${values.map(value => `"${value.replace(/["\\]/g, "\\$&")}"`).join(",")}}`;
      const [row] = (await this.db.execute(sql`select coalesce((select jsonb_agg(x) from jsonb_array_elements(case when jsonb_typeof(c.candidate#>'{normalizedPayload,captures}') = 'array'
        then c.candidate#>'{normalizedPayload,captures}' else '[]'::jsonb end) x
        where x->>'finalUrl' = any(${list(urls)}::text[]) or x->>'requestedUrl' = any(${list(urls)}::text[])
          or x#>>'{extractedFrom,member}' = any(${list(members)}::text[])), '[]'::jsonb) as captures
      from civic_data_candidates c where c.id = ${candidateId}`)).rows as { captures: unknown[] }[];
      return row?.captures ?? [];

    })) ?? [];
  }

  async readPromotionPayloadFields(recordClass: RoutineRecordClass, scope: string, keys: readonly string[]): Promise<Readonly<Record<string, unknown>> | null> {
    return this.readVersioned(`promotion-fields:${JSON.stringify(keys)}`, recordClass, scope, async () => {
      const [row] = (await this.db.execute(sql`select coalesce((select jsonb_object_agg(k, reader_payload_value(reader_payload_node(p.payload)->k)) from unnest(${`{${keys.map(key => `"${key}"`).join(",")}}`}::text[]) k
        where jsonb_exists(reader_payload_node(p.payload), k)), '{}'::jsonb) as fields
      from civic_data_promotions p where p.record_class = ${recordClass} and p.scope = ${scope}`)).rows as { fields: Record<string, unknown> }[];
      return row ? row.fields : null;

    });
  }

  async readCandidateField(candidateId: string, path: readonly string[]): Promise<unknown> {
    return (await this.candidateValue(`candidate-field:${JSON.stringify(path)}`, candidateId, async () => {
      const [row] = (await this.db.execute(sql`select candidate #> ${`{${path.map(key => `"${key}"`).join(",")}}`}::text[] as value
      from civic_data_candidates where id = ${candidateId}`)).rows as { value: unknown }[];
      return row?.value ?? undefined;

    })) ?? undefined;
  }

  async readPromotionIdentity(recordClass: RoutineRecordClass, scope: string): Promise<PromotedPointerIdentity | null> {
    // (record_class, scope) is unique, so this names at most one pointer.
    const [identity] = await this.readPromotionIdentities(recordClass, [scope]);
    return identity ?? null;
  }

  async readSourceHead(recordClass: RoutineRecordClass, scope: string): Promise<SourceHead | null> {
    const [head] = await this.db.select({
      sourceId: civicDataCandidates.sourceId, recordClass: civicDataCandidates.recordClass, scope: civicDataCandidates.scope,
      versionId: civicDataPromotions.currentVersionId, lastKnownGoodVersionId: civicDataPromotions.lastKnownGoodVersionId,
      rawHash: civicDataCandidates.rawHash, normalizedHash: civicDataCandidates.normalizedHash,
      rawHashBasis: sql<SourceHead["rawHashBasis"]>`${civicDataCandidates.candidate}#>>'{retrieval,rawHashBasis}'`.as("raw_hash_basis"),
      parserVersion: civicDataCandidates.parserVersion, promotedAt: civicDataPromotions.promotedAt,
      candidateState: civicDataCandidates.state, acquisitionSucceeded: civicDataCandidates.acquisitionSucceeded,
      acquisitionComplete: sql<boolean | null>`case when jsonb_typeof(${civicDataCandidates.candidate}#>'{retrieval,complete}')='boolean'
        then (${civicDataCandidates.candidate}#>>'{retrieval,complete}')::boolean else null end`.as("acquisition_complete"),
      sourceThrough: sql<string | null>`${civicDataCandidates.candidate}#>>'{temporal,sourceThrough}'`.as("source_through"),
      imported: sql<boolean>`(${civicDataCandidates.candidate} ? 'bootstrapImport')
        OR coalesce(${civicDataCandidates.candidate}#>>'{stateRetirement,kind}', '') = 'STATE_AUTHORITY_RETIREMENT'
        OR ${civicDataPromotions.sourceId} <> ${civicDataCandidates.sourceId}`.as("imported"),
    }).from(civicDataPromotions).innerJoin(civicDataCandidates, eq(civicDataCandidates.id, civicDataPromotions.currentVersionId))
      .where(and(eq(civicDataPromotions.recordClass, recordClass), eq(civicDataPromotions.scope, scope))).limit(1);
    return head ? { ...head, recordClass: head.recordClass as RoutineRecordClass,
      candidateState: head.candidateState as CandidateState, promotedAt: canonicalPostgresRoutineTimestamp(head.promotedAt, "sourceHead.promotedAt") } : null;
  }

  async recordSourceCheck(input: RecordPublishedSourceCheck): Promise<boolean> {
    this.assertCandidateMutationAuthority({ id: input.pointerVersionId, sourceId: input.sourceId, recordClass: input.recordClass, scope: input.scope });
    return recordPublishedSourceCheck((text, params) => this.readerRows(text, params), input);
  }

  async readSourceChecks(recordClass: RoutineRecordClass, scope: string, sourceKeys: readonly string[]): Promise<readonly PublishedSourceCheck[]> {
    return readPublishedSourceChecks((text, params) => this.readerRows(text, params), recordClass, scope, sourceKeys);
  }

  async readPromotionIdentities(
    recordClass: RoutineRecordClass,
    scopes: readonly string[],
  ): Promise<readonly PromotedPointerIdentity[]> {
    if (scopes.length === 0) return [];
    const values = async (keys: readonly string[]) => promotedPointerIdentityRead(this.db, recordClass, keys.map(key => key.slice(recordClass.length + 1)));
    const keys = scopes.map(scope => projectionKey(recordClass, scope));
    const rows = await this.readCache.rows({ namespace: "promotion-identity", keys, values, keyOf: row => row.key,
      versions: async selected => this.db.select({ key: civicDataPromotions.key,
        etag: sql<string>`concat(${civicDataPromotions}.xmin::text, '/', ${civicDataPromotions}.ctid::text, '/', coalesce(${latestConfirmationSequence()}, 0))`,
      }).from(civicDataPromotions).where(and(eq(civicDataPromotions.recordClass, recordClass), inArray(civicDataPromotions.key, [...selected]))),
    });
    return rows.map(postgresPromotedPointerIdentity);
  }

  async readCandidates(candidateIds: readonly string[]): Promise<readonly CandidateVersionReadback[]> {
    if (candidateIds.length === 0) return [];
    const rows = await this.candidateRows(candidateIds, "candidate", async ids =>
      this.db.select().from(civicDataCandidates).where(inArray(civicDataCandidates.id, [...ids])));
    return Promise.all(rows.map(async row => ({ candidateId: row.id, record: { ...rowToCandidate(await this.withReceiptParts(row)), candidate: await this.loadProofCandidate(row.candidate) } })));
  }

  async readPublishedCandidateMetadata(candidateId: string): Promise<PublishedCandidateMetadata | null> {
    const column = civicDataCandidates.candidate;
    const [row] = await this.candidateRows([candidateId], "published-candidate-metadata", async ids => {
      const rows = await this.db.select({
      id: civicDataCandidates.id,
      candidate: sql<PublishedCandidateMetadata["candidate"]>`jsonb_build_object(
        'id', ${column}->'id', 'sourceId', ${column}->'sourceId', 'recordClass', ${column}->'recordClass',
        'scope', ${column}->'scope', 'retrieval', (${column}->'retrieval') - 'derived', 'temporal', ${column}->'temporal',
        'normalization', case when ${column}->'normalization' ? '$civicPayloadPart' then ${column}->'normalization'
          else jsonb_build_object('succeeded', ${column}->'normalization'->'succeeded',
            'normalizedHash', ${column}->'normalization'->'normalizedHash',
            'normalizedPayloadHash', ${column}->'normalization'->'normalizedPayloadHash',
            'stateRecordHashes', ${column}->'normalization'->'stateRecordHashes') end)`,
      state: civicDataCandidates.state,
      acquisitionSucceeded: civicDataCandidates.acquisitionSucceeded,
      receipt: civicDataCandidates.validationReceipt,
      promotedVersion: civicDataCandidates.promotedVersionId,
      lastKnownGoodVersion: civicDataCandidates.lastKnownGoodVersionId,
      failureCode: civicDataCandidates.failureCode,
      failureDetail: civicDataCandidates.failureDetail,
    }).from(civicDataCandidates).where(inArray(civicDataCandidates.id, [...ids]));
      return Promise.all(rows.map(async row => ({ ...row, candidate: await this.loadMetadataCandidate(row.candidate, row.id) })));
    });
    const receipt = row?.receipt as ValidationReceipt | null | undefined;
    const proofReceipt = receipt && isCivicPayloadPart(receipt.excludedFacts) ? { ...receipt, excludedFacts: [] } : receipt;
    return row ? { candidate: row.candidate,
      state: row.state as CandidateState, acquisitionSucceeded: row.acquisitionSucceeded,
      receipt: proofReceipt as ValidationReceipt | null, promotedVersion: row.promotedVersion,
      lastKnownGoodVersion: row.lastKnownGoodVersion, failureCode: row.failureCode, failureDetail: row.failureDetail } : null;
  }

  async readCandidateProof(candidateId: string): Promise<CandidateVersionRecord | null> {
    const [row] = await this.candidateRows([candidateId], "candidate-proof", async ids => candidateProofRead(this.db, ids));
    return row ? { ...candidateProofRowToRecord(await this.withReceiptParts(row, false)), candidate: await this.loadProofCandidate(row.candidate) } : null;
  }

  async readCandidateProofs(candidateIds: readonly string[]): Promise<readonly CandidateVersionReadback[]> {
    if (candidateIds.length === 0) return [];
    const rows = await this.candidateRows(candidateIds, "candidate-proof", async ids => candidateProofRead(this.db, ids));
    return Promise.all(rows.map(async row => ({ candidateId: row.id, record: { ...candidateProofRowToRecord(await this.withReceiptParts(row, false)), candidate: await this.loadPayload(row.candidate, (row.candidate as RoutineCandidate).scope) as RoutineCandidate } })));
  }

  async appendEvidence(candidateId: string, state: CandidateState, at: string, detail: string): Promise<CandidateEvent> {
    const authority = this.assertMutationAuthority();
    const [candidateRow] = await readerEvidenceCandidateRead(this.db, candidateId);
    if (!candidateRow) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
    const record = readerEvidenceRowToRecord(candidateRow);
    this.assertCandidateMutationAuthority(record.candidate, "reader-evidence");
    assertReaderEvidenceInput(record, state, at, detail, authority);
    const nextSequence = this.nextCandidateEventSequence(candidateId);
    const [, eventRows] = await this.db.batch([
      this.candidateEventLock(candidateId),
      this.db.insert(civicDataCandidateEvents).select(sql`
        select gen_random_uuid(), ${candidateId}, ${nextSequence}, ${state}, ${at}::timestamptz, ${detail}
        from ${civicDataCandidates}
        where ${civicDataCandidates.id} = ${candidateId}
          and ${civicDataCandidates.state} = ${state}
          and exists (
            select 1 from ${civicDataPromotions}
            where ${civicDataPromotions.recordClass} = ${civicDataCandidates.recordClass}
              and ${civicDataPromotions.scope} = ${civicDataCandidates.scope}
              and ${civicDataPromotions.sourceId} = ${civicDataCandidates.sourceId}
              and ${civicDataPromotions.currentVersionId} = ${candidateId}
              and ${civicDataPromotions.lastKnownGoodVersionId} = ${candidateId}
          )
      `).returning(),
    ]);
    const event = eventRows[0];
    if (!event) {
      const [prior] = await this.db.select({ state: civicDataCandidates.state })
        .from(civicDataCandidates)
        .where(eq(civicDataCandidates.id, candidateId))
        .limit(1);
      if (!prior) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
      if (prior.state === state) {
        throw new Error(`CANDIDATE_READER_EVIDENCE_INVALID:${candidateId}`);
      }
      throw new Error(`CANDIDATE_EVIDENCE_STATE_MISMATCH:${candidateId}:${prior.state}:${state}`);
    }
    return postgresCandidateEventRowToEvent(event);
  }

  async confirmUnchanged(input: ConfirmUnchangedInput, at: string): Promise<ConfirmUnchangedOutcome> {
    const key = projectionKey(input.recordClass, input.scope);
    const built = buildUnchangedConfirmation(input, key, at);
    if (!built.ok) return { kind: "EVIDENCE_INVALID", detail: built.detail };
    const id = input.pointerVersionId;
    this.assertCandidateMutationAuthority({ id, sourceId: input.sourceId, recordClass: input.recordClass, scope: input.scope });
    const detail = serializeUnchangedConfirmation(built.confirmation);
    const nextSequence = this.nextCandidateEventSequence(id);
    const checkedAt = sourceCheckedAt(built.confirmation.retrieval, built.confirmation.observedAt)!;
    // This receipt shares the existing candidate lock. A delayed parser replay cannot replace a newer real check.
    const priorCheckedAt = sql`case when left(prior_confirmation.detail, ${UNCHANGED_CONFIRMATION_PREFIX.length}) = ${UNCHANGED_CONFIRMATION_PREFIX}
      then coalesce(
        (substring(prior_confirmation.detail from ${UNCHANGED_CONFIRMATION_PREFIX.length + 1})::jsonb #>> '{retrieval,sourceCheck,checkedAt}')::timestamptz,
        (substring(prior_confirmation.detail from ${UNCHANGED_CONFIRMATION_PREFIX.length + 1})::jsonb ->> 'observedAt')::timestamptz
      ) end`;
    let eventRows: readonly { readonly sequence: number }[];
    try {
    [, eventRows] = await this.db.batch([
      this.candidateEventLock(id),
      this.db.insert(civicDataCandidateEvents).select(sql`
        select gen_random_uuid(), ${id}, ${nextSequence}, ${"PROMOTED"}, ${at}::timestamptz, ${detail}
        from ${civicDataCandidates}
        where ${civicDataCandidates.id} = ${id}
          and ${civicDataCandidates.state} = ${"PROMOTED"}
          and ${civicDataCandidates.sourceId} = ${input.sourceId}
          and ${civicDataCandidates.recordClass} = ${input.recordClass}
          and ${civicDataCandidates.scope} = ${input.scope}
          and ${civicDataCandidates.normalizedHash} = ${input.readModelHash}
          and (${input.basis} <> 'RAW_HASH_UNCHANGED' OR
            (${civicDataCandidates.rawHash} = ${input.retrieval.rawHash} AND ${civicDataCandidates.parserVersion} = ${input.parserVersion}))
          and not (${civicDataCandidates.candidate} ? 'bootstrapImport')
          and coalesce(${civicDataCandidates.candidate}#>>'{stateRetirement,kind}', '') <> 'STATE_AUTHORITY_RETIREMENT'
          and exists (
            select 1 from ${civicDataPromotions}
            where ${civicDataPromotions.recordClass} = ${civicDataCandidates.recordClass}
              and ${civicDataPromotions.scope} = ${civicDataCandidates.scope}
              and ${civicDataPromotions.sourceId} = ${civicDataCandidates.sourceId}
              and ${civicDataPromotions.currentVersionId} = ${id}
              and ${civicDataPromotions.lastKnownGoodVersionId} = ${id}
          )
          and not exists (
            select 1 from ${civicDataCandidateEvents}
            where ${civicDataCandidateEvents.candidateId} = ${id}
              and ${civicDataCandidateEvents.at} > ${at}::timestamptz
          )
          and not exists (
            select 1 from civic_data_candidate_events as prior_confirmation
            where prior_confirmation.candidate_id = ${id}
              and ${priorCheckedAt} > ${checkedAt}::timestamptz
          )
      `).returning({ sequence: civicDataCandidateEvents.sequence }),
      ...(input.retainedSourceResponses?.length
        ? [this.db.insert(civicDataCandidateEvents).select(sql`
            select gen_random_uuid(), ${id}, ${this.nextCandidateEventSequence(id)}, ${"PROMOTED"}, ${at}::timestamptz,
              ${serializeUnchangedConfirmationSources(built.confirmation, input.retainedSourceResponses)}
            where exists (
              select 1 from ${civicDataCandidateEvents}
              where ${civicDataCandidateEvents.candidateId} = ${id}
                and ${civicDataCandidateEvents.detail} = ${detail}
            )
          `)]
        : []),
    ]);
    } catch (error) {
            // Until the event rule's migration is applied, a refusal here is a no-confirmation and the caller promotes.
      if (unchangedConfirmationRefusedByEventRule(error)) {
        return { kind: "STORE_REFUSED", detail: "The database's event rule does not admit unchanged confirmations yet." };
      }
      throw error;
    }
    if (eventRows[0]) {
      if (input.recordClass === "MEETING") await enqueueReaderPlaces(readerCacheScopeForPublication(input.scope, { recordClass: input.recordClass }),
        (text, params) => this.readerRows(text, params));
      return { kind: "CONFIRMED", versionId: id, at };
    }
    const [pointerRows, candidateRows] = await this.db.batch([
      this.db.select({
        sourceId: civicDataPromotions.sourceId,
        currentVersionId: civicDataPromotions.currentVersionId,
        lastKnownGoodVersionId: civicDataPromotions.lastKnownGoodVersionId,
        latestConfirmation: latestConfirmationDetail(),
      }).from(civicDataPromotions)
        .where(and(eq(civicDataPromotions.recordClass, input.recordClass), eq(civicDataPromotions.scope, input.scope)))
        .limit(1),
      this.db.select({
        state: civicDataCandidates.state,
        normalizedHash: civicDataCandidates.normalizedHash,
        rawHash: civicDataCandidates.rawHash,
        parserVersion: civicDataCandidates.parserVersion,
        imported: sql<boolean>`(${civicDataCandidates.candidate} ? 'bootstrapImport')
          OR coalesce(${civicDataCandidates.candidate}#>>'{stateRetirement,kind}', '') = 'STATE_AUTHORITY_RETIREMENT'`,
      }).from(civicDataCandidates).where(eq(civicDataCandidates.id, id)).limit(1),
    ]);
    const pointer = pointerRows[0];
    const candidate = candidateRows[0];
    if (
      !pointer || !candidate || candidate.state !== "PROMOTED" ||
      pointer.sourceId !== input.sourceId || pointer.currentVersionId !== id || pointer.lastKnownGoodVersionId !== id
    ) {
      return { kind: "POINTER_MOVED", detail: `The pointer ${key} no longer names ${id}.` };
    }
    if (candidate.imported) return { kind: "POINTER_IS_IMPORT", detail: `${id} retains published facts without a source read; a live read of it promotes.` };
    if (candidate.normalizedHash !== input.readModelHash) return { kind: "HASH_DIFFERS", detail: `${id}'s read model is not ${input.readModelHash}.` };
    if (input.basis === "RAW_HASH_UNCHANGED" && (candidate.rawHash !== input.retrieval.rawHash || candidate.parserVersion !== input.parserVersion))
      return { kind: "HASH_DIFFERS", detail: `${id}'s source bytes or parser changed.` };
    const priorConfirmation = pointer.latestConfirmation ? parseUnchangedConfirmation(pointer.latestConfirmation) : null;
    if (priorConfirmation?.versionId === id && Date.parse(sourceCheckedAt(priorConfirmation.retrieval, priorConfirmation.observedAt) ?? "") > Date.parse(checkedAt)) {
      return { kind: "CONFIRMED", versionId: id, at: priorConfirmation.observedAt };
    }
    throw new Error(`CANDIDATE_EVENT_TIME_INVALID:${id}:PROMOTED`);
  }

  async promote(candidateId: string, receipt: ValidationReceipt, at: string, options: CandidateTransitionOptions = {}): Promise<PromotedProjection> {
    this.assertMutationAuthority();
    const held = options.candidate;
    const partedManual = held !== undefined && isPartedManualCandidate(held);
    let record: CandidateVersionRecord | null;
    if (held && (partedManual || statePublicationScope(held.scope) || held.recordClass === "MEETING" || held.recordClass === "CENSUS_GEOGRAPHY" || held.recordClass === "FEDERAL_MONEY" || held.recordClass === "STATE_BILL")) {
      const hash = partedManual || statePublicationScope(held.scope) ? durableStateHash : durableCivicDataHash;
      const [row] = await this.db.select({ ...CANDIDATE_SUMMARY_COLUMNS,
        retrievedAt: civicDataCandidates.retrievedAt, rawHash: civicDataCandidates.rawHash, normalizedHash: civicDataCandidates.normalizedHash,
        normalizedPayloadHash: sql<string | null>`${civicDataCandidates.candidate}#>>'{normalization,normalizedPayloadHash}'`,
      }).from(civicDataCandidates).where(eq(civicDataCandidates.id, candidateId)).limit(1);
      if (!row || !heldEnvelopeMatches(row, held) || hash(held.readModel) !== row.normalizedHash ||
          held.normalization.normalizedPayloadHash !== row.normalizedPayloadHash || hash(held.normalizedPayload) !== row.normalizedPayloadHash) throw new Error(`CANDIDATE_PROMOTION_ENVELOPE_MISMATCH:${candidateId}`);
      record = { ...postgresCandidateSummary(row), ...(partedManual ? { receipt } : {}), candidate: held } as CandidateVersionRecord;
    } else {
      const [row] = await this.db.select().from(civicDataCandidates).where(eq(civicDataCandidates.id, candidateId)).limit(1);
      record = row ? { ...rowToCandidate(await this.withReceiptParts(row)), candidate: await this.loadPayload(row.candidate, (row.candidate as RoutineCandidate).scope) as RoutineCandidate } : null;
    }
    const persistedReceipt = persistedPromotionReceipt(record, receipt);
    if (!record || !persistedReceipt) throw new Error(`CANDIDATE_NOT_PROMOTABLE:${candidateId}`);
    assertPromotionTime(record, persistedReceipt, at);
    this.assertCandidateMutationAuthority(record.candidate);
    const candidate = record.candidate;
    const key = projectionKey(candidate.recordClass, candidate.scope);
    const needsGeography = readerPublicationNeedsGeography(candidate.scope, candidate.recordClass);
    const [prior] = await this.db.select({ currentVersionId: civicDataPromotions.currentVersionId,
      ...(needsGeography ? { payload: civicDataPromotions.payload } : {}), })
      .from(civicDataPromotions)
      .where(eq(civicDataPromotions.key, key))
      .limit(1);
    const expectedVersionId = record.lastKnownGoodVersion;
    const manualParts = isPartedManualCandidate(candidate);
    const storedReceipt = manualParts ? await this.storeReceipt(candidate, persistedReceipt) : persistedReceipt;
    const receiptJson = JSON.stringify(storedReceipt);
    const eligibility = sql`
      ${civicDataCandidates.id} = ${candidateId}
      and ${civicDataCandidates.state} = 'VALIDATED'
      and ${civicDataCandidates.sourceId} = ${candidate.sourceId}
      and ${civicDataCandidates.recordClass} = ${candidate.recordClass}
      and ${civicDataCandidates.scope} = ${candidate.scope}
      and ${civicDataCandidates.validationReceipt} = ${receiptJson}::jsonb
    `;
    const detail = `${POINTER_MOVE_DETAIL_PREFIX}${key} moved from ${prior?.currentVersionId ?? "bootstrap/no-version"} to ${candidateId}.`;
    const nextSequence = this.nextCandidateEventSequence(candidateId);

        /* One server-side transaction: a concurrent transition makes every statement a zero-row write. */
    const promotionWrite = this.db.insert(civicDataPromotions).select(sql`
      select
        ${key},
        ${civicDataCandidates.sourceId},
        ${civicDataCandidates.recordClass},
        ${civicDataCandidates.scope},
        ${civicDataCandidates.id},
        ${civicDataCandidates.id},
        ${at}::timestamptz,
        ${civicDataCandidates.candidate}->'readModel',
        ${civicDataCandidates.validationReceipt}
      from ${civicDataCandidates}
      where ${eligibility}
    `).onConflictDoUpdate({
        target: civicDataPromotions.key,
        set: {
          sourceId: sql`excluded.source_id`,
          recordClass: sql`excluded.record_class`,
          scope: sql`excluded.scope`,
          currentVersionId: sql`excluded.current_version_id`,
          lastKnownGoodVersionId: sql`excluded.last_known_good_version_id`,
          promotedAt: sql`excluded.promoted_at`,
          payload: sql`excluded.payload`,
          validationReceipt: sql`excluded.validation_receipt`,
        },
        // A candidate may replace only the exact pointer it used as LKG while
        // validating. A first seed expects there to be no pointer at all.
        setWhere: expectedVersionId === null
          ? sql`false`
          : eq(civicDataPromotions.currentVersionId, expectedVersionId),
      }).returning(PROMOTED_POINTER_COLUMNS);
    const pointerOwnsCandidate = sql`exists (
      select 1 from ${civicDataPromotions}
      where ${civicDataPromotions.key} = ${key}
        and ${civicDataPromotions.currentVersionId} = ${candidateId}
        and ${civicDataPromotions.lastKnownGoodVersionId} = ${candidateId}
    )`;
    const eventWrite = this.db.insert(civicDataCandidateEvents).select(sql`
      select gen_random_uuid(), ${candidateId}, ${nextSequence}, 'PROMOTED', ${at}::timestamptz, ${detail}
      from ${civicDataCandidates}
      where ${eligibility} and ${pointerOwnsCandidate}
    `);
    const candidateWrite = this.db.update(civicDataCandidates).set({
      state: "PROMOTED",
      validationReceipt: storedReceipt,
      promotedVersionId: candidateId,
      lastKnownGoodVersionId: candidateId,
    }).where(sql`${eligibility} and ${pointerOwnsCandidate}`).returning({ candidateId: civicDataCandidates.id });
    const [, promotedRows, , updatedRows] = await this.db.batch([
      this.candidateEventLock(candidateId),
      promotionWrite,
      eventWrite,
      candidateWrite,
    ]);
    if (!promotedRows[0] || !updatedRows[0]) {
      const [actual] = await this.db.select({ versionId: civicDataPromotions.currentVersionId })
        .from(civicDataPromotions)
        .where(eq(civicDataPromotions.key, key))
        .limit(1);
      if ((actual?.versionId ?? null) !== expectedVersionId) {
        throw new PromotionBaseChangedError(candidateId, expectedVersionId, actual?.versionId ?? null);
      }
      throw new Error(`CANDIDATE_NOT_PROMOTABLE:${candidateId}`);
    }
    const previousModel = needsGeography && prior?.payload ? await this.loadPayload(prior.payload, candidate.scope) : null;
    const publicationScope = readerCacheScopeForPublication(candidate.scope, {
      recordClass: candidate.recordClass, readModels: [candidate.readModel, previousModel],
    });
    if (candidate.recordClass === "REGISTRY_RUNTIME_BINDING") await seedRuntimeBodyPageSubjects(
      (text, params) => this.readerRows(text, params), publicationScope.states ?? []);
    await invalidateReaderCache(publicationScope, this.cacheOptions.purge, placePageConsumesPublication(candidate.scope, candidate.recordClass)
      ? (text, params) => this.readerRows(text, params) : null);
    return {
      ...postgresPromotedPointerIdentity(promotedRows[0]),
      payload: candidate.readModel,
      receipt: manualParts ? persistedReceipt : promotedRows[0].validationReceipt as ValidationReceipt,
    };
  }

  async events(candidateId: string): Promise<readonly CandidateEvent[]> {
    return this.eventValue("candidate-events", candidateId, async () => {
      const rows = await this.db.select().from(civicDataCandidateEvents).where(eq(civicDataCandidateEvents.candidateId, candidateId));
      return rows.sort((a, b) => a.sequence - b.sequence).map(postgresCandidateEventRowToEvent);

    });
  }

  async latestReaderReadbacks(candidateIds: readonly string[]): Promise<readonly CandidateEvent[]> {
    return (await Promise.all(candidateIds.map(id => this.eventValue("reader-readbacks", id, async () =>
      (await latestReaderReadbacksRead(this.db, [id])).map(postgresCandidateEventRowToEvent))))).flat();
  }

  async pointerMoveEvents(candidateId: string): Promise<readonly CandidateEvent[]> {
    return this.eventValue("pointer-move-events", candidateId, async () => {
      const rows = await pointerMoveEventsRead(this.db, candidateId);
      return rows.map(postgresCandidateEventRowToEvent);

    });
  }

  async pointerMoveChain(key: string, currentId: string): Promise<readonly CandidateEvent[]> {
    return this.readVersioned(`pointer-chain:${currentId}`, key.slice(0, key.indexOf(":")) as RoutineRecordClass, key.slice(key.indexOf(":")+1), async () => {
      const result = await pointerMoveChainRead(this.db, key, currentId);
      return result.rows.map(postgresCandidateEventRowToEvent);

    });
  }

  async historicalVoteBillVersions(ids: readonly string[], bill: string): Promise<readonly string[]> {
    if (!ids.length) return [];
    return (await historicalVoteBillVersionsRead(this.db, ids, bill)).rows.map(row => row.id);
  }

  /** Every input to a clock is a candidate row or event of its record class and scope, or that scope's pointer, so their versions decide a held clock's use. */
  async clock(sourceId: string, recordClass: RoutineRecordClass, scope: string, parserVersion?: string): Promise<RoutineStoreClock> {
    const clock = await this.publishedClock(sourceId, recordClass, scope, parserVersion);
    if (recordClass !== "CURATED_READER_RECORD" || scope !== MEMBER_OFFICES_SCOPE) return clock;
    const progress = await this.readMemberOfficeProgress();
    if (!progress.checkedAt) return { ...clock, ...(progress.attemptedAt ? {lastAttemptedAt:laterInstant(clock.lastAttemptedAt,progress.attemptedAt)} : {}), continuationPending: progress.pending.length > 0 };
    const at = laterInstant(clock.lastSucceededObservedAt, progress.checkedAt);
    return { ...clock, lastAttemptedAt: laterInstant(clock.lastAttemptedAt, progress.attemptedAt??progress.checkedAt), lastSucceededAt: at,
      lastSucceededObservedAt: at, ...(parserVersion ? { lastSucceededParserVersion: parserVersion } : {}), continuationPending: progress.pending.length > 0 };
  }

  private async publishedClock(sourceId: string, recordClass: RoutineRecordClass, scope: string, parserVersion?: string): Promise<RoutineStoreClock> {
    const key = [sourceId, recordClass, scope, parserVersion ?? ""].join("\u0000");
    const [held] = await this.readCache.rows({ namespace: "routine-clock-v2", keys: [key], keyOf: row => row.key,
      values: async () => [{ key, clock: await this.readClock(sourceId, recordClass, scope, parserVersion) }],
      versions: async () => [{ key, etag: await this.scopeVersion(recordClass, scope) }],
    });
    return held!.clock;
  }

  private async readClock(sourceId: string, recordClass: RoutineRecordClass, scope: string, parserVersion?: string): Promise<RoutineStoreClock> {
    // Successful retained-byte replay records processing, but no newer provider attempt.
    // These fields occur only on validated promotions; failures keep their local retry clock.
    const attemptAt = sql`CASE WHEN ${civicDataCandidates.state} = 'PROMOTED'
      AND ${civicDataCandidates.acquisitionSucceeded} = true
      AND ${civicDataCandidates.candidate}#>>'{retrieval,sourceCheck,checkedAt}' IS NOT NULL
      THEN LEAST((${civicDataCandidates.candidate}#>>'{retrieval,sourceCheck,checkedAt}')::timestamptz, ${civicDataCandidateEvents.at})
      ELSE ${civicDataCandidateEvents.at} END`;
    const attemptQuery = this.db
      .select({ attemptedAt: attemptAt, failureCode: civicDataCandidates.failureCode, failureDetail: civicDataCandidates.failureDetail })
      .from(civicDataCandidates)
      .innerJoin(civicDataCandidateEvents, and(
        eq(civicDataCandidateEvents.candidateId, civicDataCandidates.id),
        or(eq(civicDataCandidateEvents.sequence, 1), sql`left(${civicDataCandidateEvents.detail}, 20) = 'RECHECKED_UNCHANGED:'`),
      ))
      .where(and(
        eq(civicDataCandidates.sourceId, sourceId),
        eq(civicDataCandidates.recordClass, recordClass),
        eq(civicDataCandidates.scope, scope),
        parserVersion === undefined ? undefined : eq(civicDataCandidates.parserVersion, parserVersion),
                // Transfers retain the reader record without advancing the source clock.
        sql`coalesce(${civicDataCandidates.candidate}#>>'{bootstrapImport,kind}', '') not in ('TRUSTED_LKG_IMPORT', 'TRUSTED_LKG_REATTESTATION')
          AND coalesce(${civicDataCandidates.candidate}#>>'{stateRetirement,kind}', '') <> 'STATE_AUTHORITY_RETIREMENT'`,
      ))
      .orderBy(desc(attemptAt), desc(civicDataCandidates.id))
      .limit(16);
    const pointerQuery = routineClockPointerRead(this.db, recordClass, scope);
    const observedQuery = routineClockPointedObservedRead(this.db, recordClass, scope);
    const confirmationQuery = routineClockConfirmationRead(this.db, recordClass, scope);
    const [rows, pointerRows, observedRows, confirmationRows, sittingRows] = recordClass === "MEETING"
      ? await this.db.batch([attemptQuery, pointerQuery, observedQuery, confirmationQuery, sittingStartsRead(this.db, scope)])
      : [...await this.db.batch([attemptQuery, pointerQuery, observedQuery, confirmationQuery]), null] as const;
    // The first event is the store-observed attempt clock. A refused
    // candidate's claimed retrievedAt is evidence, never scheduler authority.
    const lastAttemptedAt = rows[0]?.attemptedAt === undefined
      ? undefined
      : canonicalPostgresRoutineTimestamp(rows[0].attemptedAt, "clock.lastAttemptedAt");
    const pointer = pointerRows[0];
    const [pointedRow] = pointer && pointer.sourceId === sourceId
      ? await routineClockCandidateRead(this.db, pointer.currentVersionId)
      : [];
    const pointedRecord = pointedRow ? routineClockRowToRecord(clockReceipt(pointedRow)) : null;
    const sittings = pointer && sittingRows !== null
      ? { sittingStarts: sittingStartsFromRow(sittingRows[0]?.starts) }
      : {};
    if (pointer && pointedRecord && isImportOrStateMoveCandidate(pointedRecord.candidate)) {
      return {
        ...trustedLkgImportClock(
          lastAttemptedAt,
          canonicalPostgresRoutineTimestamp(pointer.promotedAt, "clock.importPromotedAt"),
        ),
        ...sittings,
      };
    }
    const pointerProof: PromotionPointerProof | null = pointer ? {
      sourceId: pointer.sourceId,
      recordClass: pointer.recordClass as RoutineRecordClass,
      scope: pointer.scope,
      versionId: pointer.currentVersionId,
      lastKnownGoodVersionId: pointer.lastKnownGoodVersionId,
      receipt: clockReceipt(pointer).validationReceipt as ValidationReceipt,
    } : null;
    const lastSucceededAt = proofConsistentSuccess(pointedRecord, pointerProof);
    const canonicalLastSucceededAt = lastSucceededAt === undefined
      ? undefined
      : canonicalPostgresRoutineTimestamp(lastSucceededAt, "clock.lastSucceededAt");
    const observed = observedRows[0]?.observedAt;
    const lastSucceededObservedAt = proofConsistentObservedSuccess(
      pointedRecord,
      pointerProof,
      observed === undefined ? undefined : canonicalPostgresRoutineTimestamp(observed, "clock.lastSucceededObservedAt"),
    );
    const confirmationRow = confirmationRows[0];
    const confirmation = pointer && confirmationRow ? parseUnchangedConfirmation(confirmationRow.detail) : null;
    return confirmedClock({
      lastAttemptedAt,
      ...(repeatedFailureStreak(rows) ? { failureStreak: repeatedFailureStreak(rows) } : {}),
      lastSucceededAt: canonicalLastSucceededAt,
      lastSucceededObservedAt,
      ...(recordClass === "CENSUS_GEOGRAPHY" ? { publishedScopeVersions: pointer?.publishedScopeVersions ?? [] } : {}),
      ...(recordClass === "FEDERAL_MONEY" && scope === `${sourceId}:US` && pointer?.sourceId === sourceId
        ? { continuationPending: pointer.continuationPending === true } : {}),
      ...(recordClass === "CURATED_READER_RECORD" && scope === MEMBER_OFFICES_SCOPE
        ? { continuationPending: pointer?.continuationPending === true } : {}),
      ...(recordClass === "STATE_BILL" && scope === LEGISCAN_BULK_SCOPE && sourceId === "legiscan-bills"
        ? { continuationPending: pointer?.continuationPending !== false } : {}),
      ...(parserVersion !== undefined && proofConsistentPointedSuccess(pointedRecord, pointerProof)
        ? { lastSucceededParserVersion: pointedRecord.candidate.normalization.parserVersion } : {}),
    }, confirmation !== null && pointer !== undefined && confirmation.versionId === pointer.currentVersionId ? confirmation : null, sittings, parserVersion);
  }
}


export type RegistryDivisionMatch = Pick<Division, "ocdId" | "label" | "state" | "sourceDataset">;
const registryDivisionLabel = (label: string) => label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function registryDivisionMatches(payload: unknown, state: string, labels: readonly string[]): readonly RegistryDivisionMatch[] {
  const wanted = new Set(labels.map(registryDivisionLabel)), jurisdiction = requireRegistryState(state);
  return ((payload as { registry?: { divisions?: readonly RegistryDivisionMatch[] } } | null)?.registry?.divisions ?? [])
    .filter(row => row.state.toUpperCase() === jurisdiction && wanted.has(registryDivisionLabel(row.label)))
    .map(({ ocdId, label, state, sourceDataset }) => ({ ocdId, label, state, sourceDataset }));
}
