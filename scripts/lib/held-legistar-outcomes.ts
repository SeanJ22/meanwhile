import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "../../lib/civic-data/changes.ts";
import { sourceProjectionEvidence, type CivicRecordMember, type RoutineCandidate } from "../../lib/civic-data/types.ts";
import { PIMA_OUTCOME_TENANT, type OutcomeTenant } from "../../lib/outcomes/data-plane.ts";
import type { OutcomeSnapshot, PersistedSittingOutcomes } from "../../lib/outcomes/types.ts";
import type { SourceAcquisitionEvidence } from "../../lib/sources/acquisition-trace.ts";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A missing member in an open fact set does not retract a previously verified record. */
export function retainVerifiedSittingRecords(fresh: PersistedSittingOutcomes, prior: PersistedSittingOutcomes | undefined): PersistedSittingOutcomes {
  if (!prior || prior.extraction !== "RETRIEVED" || fresh.extraction !== "RETRIEVED") return fresh;
  if (fresh.meetingId !== prior.meetingId || fresh.bodyId !== prior.bodyId || fresh.eventId !== prior.eventId || fresh.slug !== prior.slug) {
    throw new Error("OUTCOME_PRIOR_SITTING_IDENTITY_MISMATCH");
  }
  const retain = <T extends { readonly eventItemId: number }>(current: readonly T[], held: readonly T[]): T[] => {
    const ids = new Set(current.map(row => row.eventItemId));
    return [...current, ...held.filter(row => !ids.has(row.eventItemId))];
  };
  return { ...fresh, agenda: retain(fresh.agenda, prior.agenda), outcomes: retain(fresh.outcomes, prior.outcomes),
    rollCalls: retain(fresh.rollCalls, prior.rollCalls) };
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
        // Minutes-route sittings only.
        ...(sitting.minutesDocument ? { minutesDocument: sitting.minutesDocument } : {}),
        // A held failed minutes extraction and the bytes it failed on; absent elsewhere.
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

/** A Legistar candidate for one tenant, built only from exact HTTP-response receipts. */
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
  // Failed item votes stay in excludedFacts; they do not invalidate independently verified agenda or actions.
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

export function pimaLegistarOutcomesCandidate(input: Parameters<typeof legistarOutcomesCandidate>[0]): RoutineCandidate {
  return legistarOutcomesCandidate(input, PIMA_OUTCOME_TENANT);
}
