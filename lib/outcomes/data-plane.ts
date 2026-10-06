import { createHash } from "node:crypto";

import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import {
  reconcileSourceScopedMembers,
  type SourceScopedMember,
} from "../civic-data/manual-source-isolation.ts";
import { readPromotedCivicData, type CivicDataReadStore } from "../civic-data/read-model.ts";
import { manualSourceReceiptStructureIssue } from "../civic-data/source-authority.ts";
import { sourceProjectionEvidence, type CivicRecordMember, type ManualSourceSetReceipt, type RoutineCandidate } from "../civic-data/types.ts";
import type { SourceAcquisitionEvidence } from "../sources/acquisition-trace.ts";
import type { ExecutiveActionStore } from "../officials/executive-actions.ts";
import type { OutcomeSnapshot, PersistedSittingOutcomes } from "./types.ts";

export const AZ_OFFICIAL_ACTIONS_CONTRACT = {
  contractId: "az-official-actions",
  sourceId: "az-official-actions",
  recordClass: "STATE_EXECUTIVE_ACTION",
  scope: "US-AZ:governor:official-actions",
  parserVersion: "az-official-actions/2",
} as const;

export const PIMA_LEGISTAR_OUTCOMES_CONTRACT = {
  contractId: "pima-legistar-outcomes",
  sourceId: "pima-legistar-outcomes",
  recordClass: "MEETING_OUTCOME",
  scope: "US-AZ:county:pima:legistar-outcomes",
  parserVersion: "pima-legistar-outcomes/2",
} as const;

/**
 * Mesa City Council decisions read off the council's own minutes on the
 * permitted portal host (NH332, 2026-09-25). Its own scope and pointer: a
 * Mesa refusal never touches Pima's outcomes, and the Reader combines the two
 * pointers (lib/outcomes/store.ts) with each tenant's provenance intact.
 */
export const MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT = {
  contractId: "mesa-legistar-minutes-outcomes",
  sourceId: "mesa-legistar-minutes-outcomes",
  recordClass: "MEETING_OUTCOME",
  scope: "US-AZ:place:mesa:legistar-minutes-outcomes",
  parserVersion: "mesa-legistar-minutes-outcomes/1",
  slug: "mesa",
  calendarUrl: "https://mesa.legistar.com/Calendar.aspx",
} as const;

/**
 * One Legistar body's outcome tenant (DB-22): the facts a candidate builder needs that differ between bodies. The
 * defaults below are Pima's and Mesa's own contracts, so their candidates are built exactly as before; a body added
 * as a door builds the same candidate from the tenant `lib/civic-data/outcome-partitions.ts` makes for it.
 */
export interface OutcomeTenant {
  readonly contractId: string;
  readonly sourceId: string;
  readonly recordClass: "MEETING_OUTCOME";
  readonly scope: string;
  readonly parserVersion: string;
  /** The `{client}` segment at webapi.legistar.com, and the tenant name every sitting carries. */
  readonly slug: string;
  /** A name for the body's government in a sentence ("Pima", "Mesa"). */
  readonly label: string;
  /** The state jurisdiction a sitting's identity is filed under, e.g. `US-AZ`. */
  readonly jurisdiction: string;
  /** The first route the run reads; named when no response was acquired. */
  readonly requestedUrl: string;
  /** The portal host the minutes route reads (`mesa.legistar.com`); the API route has none. */
  readonly portalHost: string | null;
}

export const PIMA_OUTCOME_TENANT: OutcomeTenant = {
  ...PIMA_LEGISTAR_OUTCOMES_CONTRACT,
  slug: "pima",
  label: "Pima",
  jurisdiction: "US-AZ",
  requestedUrl: "https://webapi.legistar.com/v1/pima/events",
  portalHost: null,
};

export const MESA_OUTCOME_TENANT: OutcomeTenant = {
  ...MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT,
  label: "Mesa",
  jurisdiction: "US-AZ",
  requestedUrl: MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT.calendarUrl,
  portalHost: "mesa.legistar.com",
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceReceiptHash(receipt: ManualSourceSetReceipt): string {
  return sha256(canonicalCivicDataJson(receipt.sources.map((source) => ({
    requestedUrl: source.requestedUrl,
    finalUrl: source.finalUrl,
    httpStatus: source.httpStatus,
    rawHash: source.rawHash,
    reviewOutcome: source.reviewOutcome ?? "SUPPORTED",
    failureDetail: source.failureDetail ?? null,
  })).sort((left, right) => `${left.finalUrl}:${left.rawHash}`.localeCompare(`${right.finalUrl}:${right.rawHash}`))));
}

export interface AzOfficialActionsPrior {
  readonly versionId: string;
  readonly store: ExecutiveActionStore;
  readonly sourceReceipt: ManualSourceSetReceipt;
}

type AzActionIsolationRecord =
  | { readonly kind: "EXECUTIVE_AUTHORITY"; readonly value: Pick<ExecutiveActionStore, "note" | "source" | "denominator"> }
  | { readonly kind: "LEGISLATIVE_AUTHORITY"; readonly value: NonNullable<ExecutiveActionStore["legislative"]> }
  | { readonly kind: "ACTION"; readonly value: ExecutiveActionStore["actions"][number] };

function actionIsolationMembers(store: ExecutiveActionStore): readonly SourceScopedMember<AzActionIsolationRecord>[] {
  return [
    {
      key: "projection:authority:executive",
      record: {
        kind: "EXECUTIVE_AUTHORITY",
        value: { note: store.note, source: store.source, denominator: store.denominator },
      },
    },
    ...(store.legislative ? [{
      key: "projection:authority:legislative",
      record: { kind: "LEGISLATIVE_AUTHORITY" as const, value: store.legislative },
    }] : []),
    ...store.actions.map((action) => ({
      key: `action:${action.id}`,
      record: { kind: "ACTION" as const, value: action },
    })),
  ];
}

function actionIsolationUrls(member: SourceScopedMember<AzActionIsolationRecord>): readonly string[] {
  if (member.record.kind === "ACTION") {
    return [member.record.value.documentUrl ?? member.record.value.sourceUrl];
  }
  if (member.record.kind === "EXECUTIVE_AUTHORITY") return [member.record.value.source.index];
  return [member.record.value.index.chapters, member.record.value.index.letters];
}

function actionIsolationIssue(member: SourceScopedMember<AzActionIsolationRecord>): string | null {
  if (member.record.kind === "EXECUTIVE_AUTHORITY") {
    const { source, denominator } = member.record.value;
    if (!/^https:\/\//.test(source.index) || !source.publisher || !source.collectedAt ||
        denominator.detailPagesRead > denominator.indexedAcrossPagesWalked ||
        [denominator.detailPagesRead, denominator.indexedAcrossPagesWalked, denominator.indexPagesWalked].some((count) => !Number.isInteger(count) || count < 0)) {
      return "The executive publication index/denominator lacks exact provenance or has an impossible count.";
    }
    return null;
  }
  if (member.record.kind === "LEGISLATIVE_AUTHORITY") {
    const legislative = member.record.value;
    if (!/^https:\/\//.test(legislative.index.chapters) || !/^https:\/\//.test(legislative.index.letters) ||
        legislative.chaptersRead > legislative.chaptersIndexed || legislative.lettersRetrieved > legislative.lettersIndexed) {
      return "The legislative publication indexes/denominator lack exact provenance or have an impossible count.";
    }
    return null;
  }
  const action = member.record.value;
  if (!action.id || !action.officeholderId || !action.designation || !action.sourceUrl || !action.sourceOrg || !action.collectedAt) {
    return `${action.id || "unnamed action"} lacks identity or provenance.`;
  }
  if (action.occurredAtState === "PUBLISHED" && action.occurredAt === null) {
    return `${action.id} claims a published date but carries none.`;
  }
  if ((action.kind === "BILL_SIGNED" || action.kind === "VETO") && action.occurredAt === null) {
    return `${action.id} asserts a signed/vetoed disposition without a date read from its document.`;
  }
  return null;
}

function rebuildActionStore(
  input: ExecutiveActionStore,
  prior: ExecutiveActionStore | null,
  members: readonly SourceScopedMember<AzActionIsolationRecord>[],
): ExecutiveActionStore {
  const executive = members.find((member) => member.record.kind === "EXECUTIVE_AUTHORITY")?.record;
  const legislative = members.find((member) => member.record.kind === "LEGISLATIVE_AUTHORITY")?.record;
  const fallbackExecutive = {
    note: prior?.note ?? input.note,
    source: prior?.source ?? input.source,
    denominator: prior?.denominator ?? input.denominator,
  };
  return {
    note: executive?.kind === "EXECUTIVE_AUTHORITY" ? executive.value.note : fallbackExecutive.note,
    source: executive?.kind === "EXECUTIVE_AUTHORITY" ? executive.value.source : fallbackExecutive.source,
    denominator: executive?.kind === "EXECUTIVE_AUTHORITY" ? executive.value.denominator : fallbackExecutive.denominator,
    legislative: legislative?.kind === "LEGISLATIVE_AUTHORITY" ? legislative.value : null,
    actions: members
      .filter((member): member is SourceScopedMember<Extract<AzActionIsolationRecord, { kind: "ACTION" }>> => member.record.kind === "ACTION")
      .map((member) => member.record.value)
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export async function readAzOfficialActionsPrior(
  store: CivicDataReadStore,
  now: string,
): Promise<AzOfficialActionsPrior | null> {
  const read = await readPromotedCivicData<ExecutiveActionStore>(
    AZ_OFFICIAL_ACTIONS_CONTRACT.recordClass,
    AZ_OFFICIAL_ACTIONS_CONTRACT.scope,
    { store, now, bypassCache: true },
  );
  if (read.kind === "NOT_RECORDED") return null;
  if (read.kind !== "PROMOTED") {
    const code = read.kind === "STORE_UNREACHABLE" ? read.code : "BOOTSTRAP_NOT_PERMITTED";
    throw new Error(`AZ_OFFICIAL_ACTIONS_BASE_UNAVAILABLE:${code}:${read.detail}`);
  }
  const candidate = await store.readCandidate(read.projection.versionId);
  const sourceReceipt = candidate?.candidate.retrieval.manualSourceReceipt;
  const issue = manualSourceReceiptStructureIssue(sourceReceipt);
  if (!candidate || !sourceReceipt || issue || sourceReceipt.sources.some((source) => source.reviewOutcome === "BLOCKED")) {
    throw new Error(`AZ_OFFICIAL_ACTIONS_BASE_PROOF_INVALID:${issue?.code ?? "SOURCE_RECEIPT_NOT_GOOD"}`);
  }
  return { versionId: read.projection.versionId, store: read.value, sourceReceipt };
}

function actionMembers(store: ExecutiveActionStore): readonly CivicRecordMember[] {
  return [
    { key: "projection:note", record: store.note },
    { key: "projection:source", record: store.source },
    { key: "projection:denominator:executive", record: store.denominator },
    { key: "projection:denominator:legislative", record: store.legislative },
    ...store.actions.map((record) => ({ key: `action:${record.id}`, record })),
  ].sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * Candidate for a reviewed set of Arizona Governor/Legislature publications.
 * The receipt is an exact-byte source set: a tracked projection is never
 * accepted as publisher evidence and cannot move this pointer on its own.
 */
export function azOfficialActionsCandidate(input: {
  readonly store: ExecutiveActionStore;
  readonly sourceReceipt: ManualSourceSetReceipt;
  readonly retrievedAt: string;
  readonly sourceThrough: string;
  readonly prior?: AzOfficialActionsPrior | null;
}): RoutineCandidate {
  const attemptedStore = input.store;
  const sourceReceipt = input.sourceReceipt;
  const reconciled = reconcileSourceScopedMembers({
    current: actionIsolationMembers(attemptedStore),
    currentReceipt: sourceReceipt,
    prior: input.prior ? {
      members: actionIsolationMembers(input.prior.store),
      sourceReceipt: input.prior.sourceReceipt,
    } : null,
    memberIssue: actionIsolationIssue,
    sourceUrls: actionIsolationUrls,
  });
  const store = rebuildActionStore(attemptedStore, input.prior?.store ?? null, reconciled.members);
  const promotionReceipt = reconciled.promotionReceipt;
  const members = actionMembers(store);
  const violations: string[] = [];
  const hasExecutiveAuthority = reconciled.members.some((member) => member.record.kind === "EXECUTIVE_AUTHORITY");
  const ids = store.actions.map((action) => action.id);
  const receiptedUrls = new Set(promotionReceipt.sources.flatMap((source) => [source.requestedUrl, source.finalUrl]));
  if (store.actions.length === 0) violations.push("The reviewed official-action projection has no action records.");
  if (!hasExecutiveAuthority) {
    violations.push("The official-action projection has no supported current or prior executive index/denominator authority.");
  }
  if (reconciled.supportedCurrentSources > 0 && reconciled.acceptedCurrentMembers === 0) {
    violations.push("The current review supplied no valid source-scoped action or denominator member; retained LKG alone cannot count as a successful refresh.");
  }
  if (new Set(ids).size !== ids.length) violations.push("Official-action ids are duplicated.");
  if (store.denominator.detailPagesRead > store.denominator.indexedAcrossPagesWalked) {
    violations.push("The executive-order denominator reads more detail pages than its indexed horizon.");
  }
  if (store.legislative && (store.legislative.chaptersRead > store.legislative.chaptersIndexed || store.legislative.lettersRetrieved > store.legislative.lettersIndexed)) {
    violations.push("The legislative denominator reads more documents than its named indexes contain.");
  }
  for (const action of store.actions) {
    if (!action.id || !action.officeholderId || !action.designation || !action.sourceUrl || !action.sourceOrg || !action.collectedAt) {
      violations.push(`${action.id || "unnamed action"} lacks identity or provenance.`);
    }
    if (action.occurredAtState === "PUBLISHED" && action.occurredAt === null) {
      violations.push(`${action.id} claims a published date but carries none.`);
    }
    if ((action.kind === "BILL_SIGNED" || action.kind === "VETO") && action.occurredAt === null) {
      violations.push(`${action.id} asserts a signed/vetoed disposition without a date read from its document.`);
    }
    const primaryUrl = action.documentUrl ?? action.sourceUrl;
    if (!receiptedUrls.has(primaryUrl)) {
      violations.push(`${action.id} lacks exact-byte evidence for ${primaryUrl}.`);
    }
  }
  const rawHash = sourceReceiptHash(sourceReceipt);
  const normalizedHash = sha256(canonicalCivicDataJson(store));
  const primary = promotionReceipt.sources[0];
  const acquired = reconciled.supportedCurrentSources > 0 && Boolean(primary);
  return {
    id: `cv-${sha256(`${AZ_OFFICIAL_ACTIONS_CONTRACT.sourceId}\u001f${AZ_OFFICIAL_ACTIONS_CONTRACT.scope}\u001f${rawHash}\u001f${normalizedHash}\u001f${input.retrievedAt}`).slice(0, 32)}`,
    sourceId: AZ_OFFICIAL_ACTIONS_CONTRACT.sourceId,
    recordClass: AZ_OFFICIAL_ACTIONS_CONTRACT.recordClass,
    scope: AZ_OFFICIAL_ACTIONS_CONTRACT.scope,
    sourceProjectionEvidence: sourceProjectionEvidence(
      AZ_OFFICIAL_ACTIONS_CONTRACT.sourceId,
      AZ_OFFICIAL_ACTIONS_CONTRACT.recordClass,
      AZ_OFFICIAL_ACTIONS_CONTRACT.scope,
    ),
    retrieval: {
      succeeded: acquired,
      requestedUrl: primary?.requestedUrl ?? "",
      finalUrl: primary?.finalUrl ?? null,
      httpStatus: primary?.httpStatus ?? null,
      retrievedAt: input.retrievedAt,
      rawHash: acquired ? rawHash : null,
      manualSourceReceipt: promotionReceipt,
      failureDetail: acquired
        ? undefined
        : sourceReceipt.sources.some((source) => source.reviewOutcome === "BLOCKED")
          ? `Every current Arizona official-publication source was blocked: ${sourceReceipt.sources.filter((source) => source.reviewOutcome === "BLOCKED").map((source) => `${source.requestedUrl} (${source.failureDetail})`).join("; ")}`
          : "No reviewed Arizona official-publication bytes were supplied.",
    },
    normalization: {
      succeeded: true,
      parserVersion: AZ_OFFICIAL_ACTIONS_CONTRACT.parserVersion,
      schemaVersion: "az-official-actions/2",
      normalizedHash,
      normalizedPayloadHash: normalizedHash,
      inputRecords: members.length + reconciled.rejectedCurrentMembers,
      outputRecords: members.length,
      droppedRecords: reconciled.rejectedCurrentMembers,
      missingRequiredFields: [],
    },
    identities: store.actions.map((action) => ({
      subjectId: action.id,
      jurisdiction: "US-AZ",
      identifiers: { action_id: action.id, officeholder_id: action.officeholderId },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
      office: action.officeTitle,
      session: action.sessionId ?? undefined,
    })),
    temporal: {
      version: input.sourceThrough,
      expectedVersion: input.sourceThrough,
      sourceThrough: input.sourceThrough,
      staleAtRetrieval: false,
    },
    semantics: { factKind: "official Arizona executive orders, enactments, signatures, and veto letters", violations },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: "The exact Governor and Legislature publication URLs named by the owner-reviewed source-set receipt",
      returnedRecords: members.length,
      declaredTotal: null,
      paginationComplete: store.denominator.reachedEndOfIndex,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      {
        consumer: "lib/officials/executive-actions.ts",
        passed: store.actions.every((action) => action.officeholderId === "statewide:az/governor"),
        detail: "Every promoted action is selected by the exact Arizona governor seat id; no name-only inheritance is admitted.",
      },
      {
        consumer: "Ask and /api/official-actions",
        passed: store.actions.every((action) => Boolean(action.documentUrl ?? action.sourceUrl)),
        detail: "Each Reader action retains a primary publication URL and collection stamp.",
      },
    ],
    normalizedPayload: store,
    readModel: store,
    civicRecords: members,
    excludedFacts: [
      ...sourceReceipt.sources
        .filter((source) => source.reviewOutcome === "BLOCKED")
        .map((source) => ({
          key: `source:${source.requestedUrl}`,
          code: "MANUAL_SOURCE_BLOCKED",
          detail: `${source.requestedUrl} was blocked and could not authorize any current action member: ${source.failureDetail}.`,
          record: source,
        })),
      ...reconciled.excludedFacts,
    ],
  };
}

function sittingMembers(sitting: PersistedSittingOutcomes): CivicRecordMember[] {
  return [
    {
      key: `sitting:${sitting.meetingId}`,
      record: {
        meetingId: sitting.meetingId,
        bodyId: sitting.bodyId,
        eventId: sitting.eventId,
        startsAt: sitting.startsAt,
        extraction: sitting.extraction,
        extractionNote: sitting.extractionNote,
        publication: sitting.publication,
        minutesPointer: sitting.minutesPointer,
        routesWalked: sitting.routesWalked,
        publicationObservations: sitting.publicationObservations,
        // Minutes-route sittings only (NH332); absent, and so unchanged, on Pima's.
        ...(sitting.minutesDocument ? { minutesDocument: sitting.minutesDocument } : {}),
        // A held failed minutes extraction and the bytes it failed on (2026-09-25); absent elsewhere.
        ...(sitting.failedMinutesRead ? { failedMinutesRead: sitting.failedMinutesRead } : {}),
      },
    },
    ...sitting.agenda.map((record) => ({ key: `agenda:${sitting.meetingId}:${record.eventItemId}`, record })),
    ...sitting.outcomes.map((record) => ({ key: `outcome:${sitting.meetingId}:${record.eventItemId}`, record })),
    ...sitting.rollCalls.map((record) => ({ key: `roll-call:${sitting.meetingId}:${record.eventItemId}`, record })),
  ];
}

function acquisitionHash(evidence: readonly SourceAcquisitionEvidence[]): string {
  return sha256(canonicalCivicDataJson(evidence.map(({ source: _source, ...row }) => row)));
}

/** A Legistar candidate for one tenant (Pima unless told otherwise), built only from exact HTTP-response receipts. */
export function legistarOutcomesCandidate(input: {
  readonly snapshot: OutcomeSnapshot;
  readonly acquisitions: readonly SourceAcquisitionEvidence[];
  readonly retrievedAt: string;
  readonly sourceThrough: string;
  readonly failureDetail?: string;
}, tenant: OutcomeTenant = PIMA_OUTCOME_TENANT): RoutineCandidate {
  const { snapshot, acquisitions } = input;
  const members = snapshot.sittings.flatMap(sittingMembers).sort((left, right) => left.key.localeCompare(right.key));
  const ids = snapshot.sittings.map((sitting) => sitting.meetingId);
  const violations: string[] = [];
  if (new Set(ids).size !== ids.length) violations.push("Legistar sitting ids are duplicated.");
  if (snapshot.tenants.some((name) => name !== tenant.slug) || snapshot.sittings.some((sitting) => sitting.slug !== tenant.slug)) {
    violations.push(`The ${tenant.label} outcome contract contains a different tenant.`);
  }
  const failedSittings = snapshot.sittings.filter((sitting) => sitting.extraction !== "RETRIEVED");
  if (failedSittings.length > 0) {
    violations.push(`${failedSittings.length} sitting acquisition(s) failed; their failure candidates remain durable but may not replace LKG.`);
  }
  const voteFailures = snapshot.sittings.flatMap((sitting) => sitting.voteRequestFailures.map((failure) => ({ sitting, failure })));
  if (voteFailures.length > 0) {
    violations.push(`${voteFailures.length} expected per-item vote request(s) failed; the prior GOOD projection remains live.`);
  }
  if (snapshot.sittings.some((sitting) => !sitting.meetingId.startsWith(`legistar:${tenant.slug}:`) || !sitting.sourceOrg || !sitting.publication.observedAt)) {
    violations.push("A sitting lacks its exact tenant identity, publisher, or observation time.");
  }
  if (new Set(members.map((member) => member.key)).size !== members.length) {
    violations.push("Outcome projection members do not have unique stable identities.");
  }
  const rawHash = acquisitions.length > 0 ? acquisitionHash(acquisitions) : null;
  const normalizedPayload = { acquisitions, snapshot };
  const projectionHash = sha256(canonicalCivicDataJson(snapshot));
  const normalizedPayloadHash = sha256(canonicalCivicDataJson(normalizedPayload));
  const primary = acquisitions[0];
  return {
    id: `cv-${sha256(`${tenant.sourceId}\u001f${tenant.scope}\u001f${rawHash ?? "failed"}\u001f${projectionHash}\u001f${input.failureDetail ?? "ok"}\u001f${input.retrievedAt}`).slice(0, 32)}`,
    sourceId: tenant.sourceId,
    recordClass: tenant.recordClass,
    scope: tenant.scope,
    sourceProjectionEvidence: sourceProjectionEvidence(
      tenant.sourceId,
      tenant.recordClass,
      tenant.scope,
    ),
    retrieval: {
      succeeded: acquisitions.length > 0 && input.failureDetail === undefined,
      requestedUrl: primary?.requestedUrl ?? tenant.requestedUrl,
      finalUrl: primary?.finalUrl ?? null,
      httpStatus: primary?.httpStatus ?? null,
      retrievedAt: input.retrievedAt,
      rawHash,
      failureDetail: input.failureDetail ?? (acquisitions.length > 0 ? undefined : `No ${tenant.label} Legistar response bytes were acquired.`),
    },
    normalization: {
      succeeded: true,
      parserVersion: tenant.parserVersion,
      schemaVersion: "legistar-outcomes/2",
      normalizedHash: projectionHash,
      normalizedPayloadHash,
      inputRecords: members.length,
      outputRecords: members.length,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: snapshot.sittings.map((sitting) => ({
      subjectId: sitting.meetingId,
      jurisdiction: tenant.jurisdiction,
      identifiers: { meeting_id: sitting.meetingId, event_id: String(sitting.eventId) },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
    })),
    temporal: {
      version: input.sourceThrough,
      expectedVersion: input.sourceThrough,
      sourceThrough: input.sourceThrough,
      staleAtRetrieval: false,
    },
    semantics: { factKind: `${tenant.label} Legistar agenda actions and exact per-person roll calls`, violations },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: `${tenant.label} Legistar events and each changed sitting's event-items and item-votes routes`,
      returnedRecords: members.length,
      declaredTotal: null,
      paginationComplete: true,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      {
        consumer: "lib/outcomes/store.ts",
        passed: snapshot.sittings.every((sitting) => sitting.meetingId === `legistar:${tenant.slug}:${sitting.eventId}`),
        detail: "Every outcome joins to its sitting by the adapter's exact source-namespaced meeting id.",
      },
      {
        consumer: "Ask meeting outcomes and meeting Reader records",
        passed: snapshot.sittings.every((sitting) => sitting.agenda.every((record) => record.recordClass === "AGENDA") && sitting.outcomes.every((record) => record.recordClass === "ACTION_SUMMARY") && sitting.rollCalls.every((record) => record.recordClass === "ROLL_CALL")),
        detail: "Agenda, action, and per-person roll records retain distinct record classes before promotion.",
      },
    ],
    normalizedPayload,
    readModel: snapshot,
    civicRecords: members,
    excludedFacts: [
      ...snapshot.sittings.flatMap((sitting) => sitting.failedRollCallExtractions.map((eventItemId) => ({
        key: `${sitting.meetingId}:item:${eventItemId}`,
        code: "ROLL_CALL_EXTRACTION_HELD",
        detail: "The publisher marked a roll call and the votes route returned zero rows; no empty per-person roll was invented.",
      }))),
      ...voteFailures.map(({ sitting, failure }) => ({
        key: `${sitting.meetingId}:item:${failure.eventItemId}`,
        code: "VOTE_REQUEST_FAILED",
        detail: failure.reason,
      })),
    ],
  };
}

/** Pima's candidate, as it has always been built. */
export function pimaLegistarOutcomesCandidate(input: Parameters<typeof legistarOutcomesCandidate>[0]): RoutineCandidate {
  return legistarOutcomesCandidate(input, PIMA_OUTCOME_TENANT);
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** A minutes tenant's projection identity: its own slug and portal meeting ids, nothing else. */
export function minutesOutcomeScopeIssue(snapshot: OutcomeSnapshot, tenant: OutcomeTenant = MESA_OUTCOME_TENANT): string | null {
  const slug = tenant.slug;
  if (snapshot.tenants.some((name) => name !== slug)) return `The ${tenant.label} minutes outcome contract names a different tenant.`;
  const stray = snapshot.sittings.find((sitting) => sitting.slug !== slug || sitting.meetingId !== `legistar-insite:${slug}:${sitting.eventId}`);
  return stray ? `${stray.meetingId} crosses the ${tenant.label} tenant or its portal meeting-id scope.` : null;
}

/** Mesa's projection identity, as it has always been checked. */
export function mesaMinutesOutcomeScopeIssue(snapshot: OutcomeSnapshot): string | null {
  return minutesOutcomeScopeIssue(snapshot, MESA_OUTCOME_TENANT);
}

/**
 * A Mesa minutes-outcome candidate built only from exact HTTP-response
 * receipts: the calendar grid read and each minutes document walked this run.
 *
 * A sitting whose minutes request failed refuses the candidate (the prior GOOD
 * pointer stays live); a sitting whose read minutes yielded nothing is held as
 * the failed extraction it is, with the bytes it failed on (2026-09-25). A
 * sitting whose minutes are not yet published is a valid, stated row — a fact
 * about the publisher, never a failure of ours.
 */
export function legistarMinutesOutcomesCandidate(input: {
  readonly snapshot: OutcomeSnapshot;
  readonly acquisitions: readonly SourceAcquisitionEvidence[];
  readonly retrievedAt: string;
  readonly sourceThrough: string;
  readonly failureDetail?: string;
}, tenant: OutcomeTenant = MESA_OUTCOME_TENANT): RoutineCandidate {
  const { snapshot, acquisitions } = input;
  const contract = tenant;
  const portalPrefix = `https://${tenant.portalHost}/`;
  const members = snapshot.sittings.flatMap(sittingMembers).sort((left, right) => left.key.localeCompare(right.key));
  const violations: string[] = [];
  const ids = snapshot.sittings.map((sitting) => sitting.meetingId);
  if (new Set(ids).size !== ids.length) violations.push(`${tenant.label} sitting ids are duplicated.`);
  const scopeIssue = minutesOutcomeScopeIssue(snapshot, tenant);
  if (scopeIssue) violations.push(scopeIssue);
  /*
   * A failed REQUEST read no bytes and is retried soon: it refuses the candidate and the prior GOOD pointer stays
   * live. A document read whose extraction failed on its bytes, held with those bytes' identity
   * (`failedMinutesRead`, 2026-09-25), is a named failure of ours, not a retryable request: it is admitted as
   * the failed extraction it is, with no record, so the same unchanged document is not downloaded and failed
   * again on every hourly retry. The fail-closed rule is unchanged: it claims nothing about what was decided.
   */
  const failed = snapshot.sittings.filter((sitting) =>
    sitting.extraction === "REQUEST_FAILED" || (sitting.extraction === "ZERO_ROWS_FAILED" && sitting.failedMinutesRead === undefined));
  if (failed.length > 0) {
    violations.push(`${failed.length} minutes read(s) failed (${failed.map((sitting) => sitting.meetingId).join(", ")}); the prior GOOD projection remains live.`);
  }
  for (const sitting of snapshot.sittings.filter((row) => row.failedMinutesRead !== undefined)) {
    const read = sitting.failedMinutesRead!;
    if (!SHA256_HEX.test(read.sha256) || !read.url.startsWith(portalPrefix) || !read.reason.trim() || !read.parserRevision) {
      violations.push(`${sitting.meetingId} holds a failed minutes read without the exact document, digest, parser and reason it failed on.`);
    }
    if (sitting.extraction === "ZERO_ROWS_FAILED" && (sitting.outcomes.length > 0 || sitting.agenda.length > 0 || sitting.rollCalls.length > 0)) {
      violations.push(`${sitting.meetingId} is a failed extraction and carries records; a failed extraction claims nothing.`);
    }
    if (sitting.extraction !== "ZERO_ROWS_FAILED" && sitting.extraction !== "RETRIEVED") {
      violations.push(`${sitting.meetingId} remembers a failed minutes read on a ${sitting.extraction} sitting.`);
    }
    const acquired = acquisitions.filter((row) => row.finalUrl === read.url || row.requestedUrl === read.url);
    if (acquired.length > 0 && !acquired.some((row) => row.rawHash === read.sha256)) {
      violations.push(`${sitting.meetingId}'s failed minutes digest does not match the bytes this run acquired from ${read.url}.`);
    }
  }
  if (snapshot.sittings.some((sitting) => !sitting.sourceOrg || !sitting.publication.observedAt)) {
    violations.push("A sitting lacks its publisher or observation time.");
  }
  for (const sitting of snapshot.sittings.filter((row) => row.extraction === "RETRIEVED")) {
    const document = sitting.minutesDocument;
    if (!document || !SHA256_HEX.test(document.sha256) || !document.url.startsWith(portalPrefix)) {
      violations.push(`${sitting.meetingId} carries outcomes without the exact minutes document they were read from.`);
      continue;
    }
    if (sitting.outcomes.some((record) => record.provenance.endpoint !== document.url || !record.quote)) {
      violations.push(`${sitting.meetingId} has a recorded action without its exact passage of ${document.url}.`);
    }
    const read = acquisitions.filter((row) => row.finalUrl === document.url || row.requestedUrl === document.url);
    if (read.length > 0 && !read.some((row) => row.rawHash === document.sha256)) {
      violations.push(`${sitting.meetingId}'s minutes digest does not match the bytes this run acquired from ${document.url}.`);
    }
  }
  if (new Set(members.map((member) => member.key)).size !== members.length) {
    violations.push("Outcome projection members do not have unique stable identities.");
  }
  const rawHash = acquisitions.length > 0 ? acquisitionHash(acquisitions) : null;
  const normalizedPayload = { acquisitions, snapshot };
  const projectionHash = sha256(canonicalCivicDataJson(snapshot));
  const normalizedPayloadHash = sha256(canonicalCivicDataJson(normalizedPayload));
  const primary = acquisitions[0];
  return {
    id: `cv-${sha256(`${contract.sourceId}\u001f${contract.scope}\u001f${rawHash ?? "failed"}\u001f${projectionHash}\u001f${input.failureDetail ?? "ok"}\u001f${input.retrievedAt}`).slice(0, 32)}`,
    sourceId: contract.sourceId,
    recordClass: contract.recordClass,
    scope: contract.scope,
    sourceProjectionEvidence: sourceProjectionEvidence(contract.sourceId, contract.recordClass, contract.scope),
    retrieval: {
      succeeded: acquisitions.length > 0 && input.failureDetail === undefined,
      requestedUrl: primary?.requestedUrl ?? contract.requestedUrl,
      finalUrl: primary?.finalUrl ?? null,
      httpStatus: primary?.httpStatus ?? null,
      retrievedAt: input.retrievedAt,
      rawHash,
      failureDetail: input.failureDetail ?? (acquisitions.length > 0 ? undefined : `No ${tenant.label} portal response bytes were acquired.`),
    },
    normalization: {
      succeeded: true,
      parserVersion: contract.parserVersion,
      schemaVersion: "legistar-outcomes/2",
      normalizedHash: projectionHash,
      normalizedPayloadHash,
      inputRecords: members.length,
      outputRecords: members.length,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: snapshot.sittings.map((sitting) => ({
      subjectId: sitting.meetingId,
      jurisdiction: tenant.jurisdiction,
      identifiers: { meeting_id: sitting.meetingId, event_id: String(sitting.eventId) },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
    })),
    temporal: {
      version: input.sourceThrough,
      expectedVersion: input.sourceThrough,
      sourceThrough: input.sourceThrough,
      staleAtRetrieval: false,
    },
    semantics: { factKind: tenant === MESA_OUTCOME_TENANT ? "Mesa City Council actions and their recorded results, read off the council's minutes" : `${tenant.label} actions and their recorded results, read off the body's minutes`, violations },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: `${tenant.label}'s InSite calendar grid and each changed concluded sitting's minutes document on the portal host`,
      returnedRecords: members.length,
      declaredTotal: null,
      paginationComplete: true,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      {
        consumer: "lib/outcomes/store.ts",
        passed: minutesOutcomeScopeIssue(snapshot, tenant) === null,
        detail: "Every outcome joins to its sitting by the InSite adapter's exact portal meeting id.",
      },
      {
        consumer: "Ask meeting outcomes and meeting Reader records",
        passed: snapshot.sittings.every((sitting) => sitting.agenda.length === 0 && sitting.rollCalls.length === 0 &&
          sitting.outcomes.every((record) => record.recordClass === "ACTION_SUMMARY" && Boolean(record.quote))),
        detail: "Minutes yield action records with their exact passage; no agenda or per-person roll-call record is minted from them.",
      },
    ],
    normalizedPayload,
    readModel: snapshot,
    civicRecords: members,
    excludedFacts: [
      ...snapshot.sittings
        .filter((sitting) => sitting.extraction === "NOT_YET_PUBLISHED")
        .map((sitting) => ({
          key: `${sitting.meetingId}:minutes`,
          code: "MINUTES_NOT_YET_PUBLISHED",
          detail: sitting.extractionNote ?? "The publisher has not published minutes for this sitting yet.",
        })),
      // Visible on every candidate while held: a named failure of ours, with the bytes it failed on.
      ...snapshot.sittings
        .filter((sitting) => sitting.failedMinutesRead !== undefined)
        .map((sitting) => ({
          key: `${sitting.meetingId}:minutes-extraction`,
          code: "MINUTES_EXTRACTION_FAILED_HELD",
          detail:
            `${sitting.failedMinutesRead!.url} (${sitting.failedMinutesRead!.byteCount} bytes, sha256 ${sitting.failedMinutesRead!.sha256.slice(0, 16)}…, ` +
            `parser ${sitting.failedMinutesRead!.parserRevision}, read ${sitting.failedMinutesRead!.readAt}): ${sitting.failedMinutesRead!.reason} ` +
            "Read again when the document changes, the parser changes, or the failure is a week old.",
        })),
    ],
  };
}

/** Mesa's candidate, as it has always been built. */
export function mesaLegistarMinutesOutcomesCandidate(input: Parameters<typeof legistarMinutesOutcomesCandidate>[0]): RoutineCandidate {
  return legistarMinutesOutcomesCandidate(input, MESA_OUTCOME_TENANT);
}
