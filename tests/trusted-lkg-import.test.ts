import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalCivicDataJson, civicRecordsFor } from "../lib/civic-data/changes.ts";
import {
  processRegisteredManualCandidate,
  processRegisteredRoutineCandidate,
  processRoutineCandidate,
} from "../lib/civic-data/promotion.ts";
import { projectRoutineDataObservability } from "../lib/civic-data/observability.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { promotionProofIssue, readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  PDC_V2_FROZEN_BASE_SHA,
  TRUSTED_LKG_IMPORT_AUTHORIZATION,
  TRUSTED_LKG_IMPORT_PURPOSE,
  trustedLkgCandidateId,
  trustedLkgCandidateEnvelopeSha256,
  trustedLkgFixtureSetSha256,
  trustedLkgImportEvidenceIssue,
  trustedLkgImportUrl,
  trustedLkgValidatorIds,
} from "../lib/civic-data/trusted-lkg-import.ts";
import {
  sourceProjectionEvidence,
  type RoutineCandidate,
  type TrustedLkgImportEvidence,
} from "../lib/civic-data/types.ts";

const FIRST = "2026-09-09T12:00:00.000Z";
const SECOND = "2026-09-09T13:00:00.000Z";
const MANUAL_CONTRACT_ID = "comment-access" as const;
const MANUAL_SOURCE_ID = "curated-reader-primary-sources" as const;
const MANUAL_RECORD_CLASS = "CURATED_READER_RECORD" as const;
const MANUAL_SCOPE = "US-AZ+US-NH+US-NJ:public-comment-rules:reviewed-bodies" as const;
const MANUAL_BODY_ID = "ocd-division/country:us/state:az/county:example" as const;
const MANUAL_RECORD_ID = `comment-access:${MANUAL_BODY_ID}` as const;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function candidate(
  importedAt = FIRST,
  importerCodeSha = "a".repeat(40),
  door: "MANUAL" | "ROUTINE" = "MANUAL",
): RoutineCandidate {
  const manual = door === "MANUAL";
  const contractId = manual ? MANUAL_CONTRACT_ID : "dotgov";
  const sourceId = manual ? MANUAL_SOURCE_ID : "cisa-dotgov-registry";
  const recordClass = manual ? MANUAL_RECORD_CLASS : "DOTGOV_REFERENCE";
  const scope = manual ? MANUAL_SCOPE : "US:current-full:election-domains";
  const parserVersion = manual ? "curated-reader-records/2" : "cisa-dotgov/2";
  const payload = manual
    ? {
        kind: MANUAL_CONTRACT_ID,
        records: [{
          id: MANUAL_RECORD_ID,
          bodyId: MANUAL_BODY_ID,
          publicComment: "Published exact frozen public-comment rule.",
        }],
      }
    : {
        source: { commit: "fixture-source-version" },
        electionDomains: [{ domain: "elections.example.gov", organization: "Example Election Authority" }],
      };
  const civicRecords = civicRecordsFor(recordClass, payload);
  const fixtures = [{
    path: manual ? "lib/registry/comment-access.ts" : "data/dotgov/snapshot.json",
    sha256: sha256("exact frozen fixture bytes"),
    bytes: Buffer.byteLength("exact frozen fixture bytes"),
  }] as const;
  const fixtureSetSha256 = trustedLkgFixtureSetSha256(fixtures);
  const normalizedPayloadSha256 = sha256(canonicalCivicDataJson(payload));
  const partial: RoutineCandidate = {
    id: "pending-content-address",
    sourceId,
    recordClass,
    scope,
    retrieval: {
      succeeded: true,
      requestedUrl: trustedLkgImportUrl(contractId),
      finalUrl: null,
      httpStatus: null,
      retrievedAt: importedAt,
      rawHash: fixtureSetSha256,
    },
    normalization: {
      succeeded: true,
      parserVersion,
      schemaVersion: `${contractId}:trusted-lkg:1`,
      normalizedHash: normalizedPayloadSha256,
      normalizedPayloadHash: normalizedPayloadSha256,
      inputRecords: civicRecords.length,
      outputRecords: civicRecords.length,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: [{
      subjectId: manual ? MANUAL_RECORD_ID : "elections.example.gov",
      jurisdiction: "US",
      identifiers: manual
        ? { record_id: MANUAL_RECORD_ID, body_id: MANUAL_BODY_ID }
        : { domain: "elections.example.gov", source_sha: "fixture-source-version" },
      matchBasis: "OFFICIAL_ID",
      ambiguous: false,
    }],
    temporal: {
      version: "fixture-source-version",
      expectedVersion: "fixture-source-version",
      sourceThrough: "2026-09-08T00:00:00.000Z",
      staleAtRetrieval: true,
    },
    semantics: { factKind: `frozen ${contractId} LKG`, violations: [] },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: "exact frozen LKG members without a current publisher-universe claim",
      returnedRecords: civicRecords.length,
      declaredTotal: null,
      paginationComplete: false,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    sourceProjectionEvidence: sourceProjectionEvidence(
      sourceId,
      recordClass,
      scope,
    ),
    dependentChecks: [{
      consumer: `${contractId} Reader projection`,
      passed: true,
      detail: "The exact frozen projection satisfies its contract-specific Reader shape.",
    }],
    normalizedPayload: payload,
    readModel: payload,
    civicRecords,
  };
  const evidence: TrustedLkgImportEvidence = {
    contractVersion: 1,
    kind: "TRUSTED_LKG_IMPORT",
    authorization: TRUSTED_LKG_IMPORT_AUTHORIZATION,
    purpose: TRUSTED_LKG_IMPORT_PURPOSE,
    sourceAuthenticated: false,
    contractId,
    sourceId: partial.sourceId,
    recordClass: partial.recordClass,
    scope: partial.scope,
    parserVersion: partial.normalization.parserVersion,
    sourceVersion: partial.temporal.version,
    sourceThrough: partial.temporal.sourceThrough,
    importedAt,
    frozenBaseSha: PDC_V2_FROZEN_BASE_SHA,
    importerCodeSha,
    fixtureSetSha256,
    fixtures,
    normalizedPayloadSha256,
    readModelSha256: sha256(canonicalCivicDataJson(payload)),
    candidateEnvelopeSha256: trustedLkgCandidateEnvelopeSha256(partial),
    validatorIds: trustedLkgValidatorIds(partial),
  };
  return { ...partial, id: trustedLkgCandidateId(evidence), bootstrapImport: evidence };
}

test("PDC-v2 trusted LKG imports only through the exact registered door and remain due", async () => {
  const directStore = new MemoryRoutineDataStore();
  await assert.rejects(
    processRoutineCandidate(directStore, candidate(), FIRST),
    /TRUSTED_LKG_IMPORT_REQUIRES_REGISTERED_DOOR:comment-access/,
  );
  assert.equal(await directStore.readPromotion(MANUAL_RECORD_CLASS, MANUAL_SCOPE), null);

  const ordinaryRoutineStore = new MemoryRoutineDataStore();
  await assert.rejects(
    processRegisteredRoutineCandidate(ordinaryRoutineStore, "dotgov", candidate(FIRST, "a".repeat(40), "ROUTINE"), FIRST),
    /TRUSTED_LKG_IMPORT_REQUIRES_REGISTERED_DOOR:dotgov/,
    "the temporary seed never needed and may not use the ordinary routine-contract door",
  );
  assert.equal(await ordinaryRoutineStore.readPromotion("DOTGOV_REFERENCE", "US:current-full:election-domains"), null);

  const store = new MemoryRoutineDataStore();
  const outcome = await processRegisteredManualCandidate(store, MANUAL_CONTRACT_ID, candidate(), FIRST);
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.equal(outcome.promoted?.versionId, outcome.candidate.candidate.id);
  assert.equal(
    outcome.candidate.receipt?.checks.find((check) => check.check === "SOURCE_AUTHENTICITY")?.code,
    "TRUSTED_LKG_IMPORT_PROVENANCE_VALID",
  );
  assert.match(
    outcome.candidate.receipt?.checks.find((check) => check.check === "SOURCE_AUTHENTICITY")?.detail ?? "",
    /non-source-authenticated/i,
  );
  const clock = await store.clock(MANUAL_SOURCE_ID, MANUAL_RECORD_CLASS, MANUAL_SCOPE);
  assert.equal(clock.lastAttemptedAt, undefined, "the import is not a publisher attempt and cannot own the source retry clock");
  assert.equal(clock.lastSucceededAt, undefined, "the import cannot defer the first live publisher acquisition");

  const read = await readPromotedCivicData(MANUAL_RECORD_CLASS, MANUAL_SCOPE, {
    store,
    now: SECOND,
    bypassCache: true,
  });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.metadata.stale, "STALE", "Reader serves the LKG but never confuses it with current source truth");
});

test("trusted LKG evidence is content-bound and cannot replace an existing authority", async () => {
  const store = new MemoryRoutineDataStore();
  const first = await processRegisteredManualCandidate(store, MANUAL_CONTRACT_ID, candidate(), FIRST);
  assert.ok(first.promoted);

  const replacement = candidate(SECOND, "b".repeat(40));
  const refused = await processRegisteredManualCandidate(store, MANUAL_CONTRACT_ID, replacement, SECOND);
  assert.equal(refused.candidate.state, "SOURCE_BLOCKED");
  assert.equal(refused.candidate.failureCode, "TRUSTED_LKG_IMPORT_REQUIRES_EMPTY_POINTER");
  assert.equal(
    (await store.readPromotion(MANUAL_RECORD_CLASS, MANUAL_SCOPE))?.versionId,
    first.promoted!.versionId,
  );

  const wrongContract = candidate();
  const mismatched = {
    ...wrongContract,
    bootstrapImport: { ...wrongContract.bootstrapImport!, contractId: "campaign-sites" },
  };
  await assert.rejects(
    processRegisteredManualCandidate(new MemoryRoutineDataStore(), MANUAL_CONTRACT_ID, mismatched, FIRST),
    /trusted-LKG contract campaign-sites does not equal comment-access/,
  );

  const invalid = candidate();
  const invalidEvidence = invalid.bootstrapImport;
  assert.ok(invalidEvidence);
  if (invalidEvidence.kind !== "TRUSTED_LKG_IMPORT") assert.fail("test candidate is not a first-seed import");
  const corrupt = {
    ...invalid,
    bootstrapImport: {
      ...invalidEvidence,
      fixtures: [{ ...invalidEvidence.fixtures[0]!, sha256: "f".repeat(64) }],
    },
  };
  const corruptOutcome = await processRegisteredManualCandidate(new MemoryRoutineDataStore(), MANUAL_CONTRACT_ID, corrupt, FIRST);
  assert.equal(corruptOutcome.candidate.state, "SOURCE_BLOCKED");
  assert.equal(corruptOutcome.candidate.failureCode, "TRUSTED_LKG_IMPORT_INVALID");
});

test("Reader proof fails closed if durable trusted-LKG evidence is altered", async () => {
  const store = new MemoryRoutineDataStore();
  const outcome = await processRegisteredManualCandidate(store, MANUAL_CONTRACT_ID, candidate(), FIRST);
  assert.ok(outcome.promoted);
  const altered = {
    ...outcome.candidate,
    candidate: {
      ...outcome.candidate.candidate,
      bootstrapImport: {
        ...outcome.candidate.candidate.bootstrapImport!,
        sourceAuthenticated: true,
      },
    },
  } as unknown as typeof outcome.candidate;
  assert.match(
    promotionProofIssue(MANUAL_RECORD_CLASS, MANUAL_SCOPE, outcome.promoted!, altered) ?? "",
    /trusted-LKG import evidence is invalid/i,
  );

  const exactCandidate = outcome.candidate.candidate;
  const firstRecord = exactCandidate.civicRecords?.[0];
  const firstAdded = exactCandidate.changeSet?.added[0];
  assert.ok(firstRecord && firstAdded);
  const fabricatedMemberAndDelta = {
    ...outcome.candidate,
    candidate: {
      ...exactCandidate,
      civicRecords: [
        { ...firstRecord, record: { fabricated: true } },
        ...exactCandidate.civicRecords!.slice(1),
      ],
      changeSet: {
        ...exactCandidate.changeSet!,
        added: [
          { ...firstAdded, after: { fabricated: true } },
          ...exactCandidate.changeSet!.added.slice(1),
        ],
      },
    },
  };
  assert.match(
    promotionProofIssue(
      MANUAL_RECORD_CLASS,
      MANUAL_SCOPE,
      outcome.promoted!,
      fabricatedMemberAndDelta,
    ) ?? "",
    /civic-record members do not exactly equal/i,
    "a matching fabricated member and delta cannot falsify Admin while the Reader payload stays intact",
  );

  const fabricatedDeltaOnly = {
    ...outcome.candidate,
    candidate: {
      ...exactCandidate,
      changeSet: {
        ...exactCandidate.changeSet!,
        added: [
          { ...firstAdded, after: { fabricated: true } },
          ...exactCandidate.changeSet!.added.slice(1),
        ],
      },
    },
  };
  assert.match(
    promotionProofIssue(
      MANUAL_RECORD_CLASS,
      MANUAL_SCOPE,
      outcome.promoted!,
      fabricatedDeltaOnly,
    ) ?? "",
    /change set does not exactly equal/i,
    "the durable first-pointer delta is derived evidence, not an independently mutable claim",
  );

  const fabricatedCandidateProof = {
    ...outcome.candidate,
    candidate: {
      ...exactCandidate,
      dependentChecks: exactCandidate.dependentChecks.map((check, index) => index === 0
        ? { ...check, passed: false, detail: "fabricated durable failure" }
        : check),
    },
  };
  assert.match(
    promotionProofIssue(
      MANUAL_RECORD_CLASS,
      MANUAL_SCOPE,
      outcome.promoted!,
      fabricatedCandidateProof,
    ) ?? "",
    /complete persisted candidate proof envelope/i,
    "durable candidate provenance and validator outcomes cannot change beneath an unchanged GOOD receipt",
  );

  const completeClaim = exactCandidate;
  const completeClaimWithoutUpdatedEvidence = {
    ...completeClaim,
    horizon: {
      kind: "BOUNDED" as const,
      query: "fabricated complete publisher universe",
      returnedRecords: completeClaim.normalization.outputRecords,
      declaredTotal: completeClaim.normalization.outputRecords,
      paginationComplete: true,
      claimsComplete: true,
    },
  };
  const completeClaimEvidence = {
    ...completeClaim.bootstrapImport!,
    candidateEnvelopeSha256: trustedLkgCandidateEnvelopeSha256(completeClaimWithoutUpdatedEvidence),
  };
  const selfConsistentCompleteClaim = {
    ...completeClaimWithoutUpdatedEvidence,
    id: trustedLkgCandidateId(completeClaimEvidence),
    bootstrapImport: completeClaimEvidence,
  };
  assert.match(
    trustedLkgImportEvidenceIssue(selfConsistentCompleteClaim) ?? "",
    /must make no publisher-universe completeness claim/i,
    "even self-consistent bootstrap evidence cannot turn a frozen snapshot into current completeness proof",
  );
});

test("Admin exposes imported LKG without claiming freshness or a source-authenticated success", async () => {
  const store = new MemoryRoutineDataStore();
  const outcome = await processRegisteredManualCandidate(store, MANUAL_CONTRACT_ID, candidate(), FIRST);
  assert.ok(outcome.promoted);
  const row = outcome.candidate;
  const events = await store.events(row.candidate.id);
  const view = projectRoutineDataObservability({
    candidates: [{
      id: row.candidate.id,
      sourceId: row.candidate.sourceId,
      recordClass: row.candidate.recordClass,
      scope: row.candidate.scope,
      state: row.state,
      acquisitionSucceeded: row.acquisitionSucceeded,
      retrievedAt: row.candidate.retrieval.retrievedAt,
      sourceThrough: row.candidate.temporal.sourceThrough,
      candidate: row.candidate,
      validationReceipt: row.receipt,
      promotedVersionId: row.promotedVersion,
      lastKnownGoodVersionId: row.lastKnownGoodVersion,
      failureCode: row.failureCode,
      failureDetail: row.failureDetail,
    }],
    events: events.map((event) => ({ ...event, id: `${event.candidateId}:${event.sequence}` })),
    promotions: [{
      key: outcome.promoted!.key,
      sourceId: outcome.promoted!.sourceId,
      recordClass: outcome.promoted!.recordClass,
      scope: outcome.promoted!.scope,
      currentVersionId: outcome.promoted!.versionId,
      lastKnownGoodVersionId: outcome.promoted!.lastKnownGoodVersionId,
      promotedAt: outcome.promoted!.promotedAt,
      payload: outcome.promoted!.payload,
      validationReceipt: outcome.promoted!.receipt,
    }],
  }, SECOND, [requiredManualProductionContract(MANUAL_CONTRACT_ID)]);
  const observed = view.contracts[0];
  assert.equal(observed.canonicalPromotion.kind, "MEASURED");
  if (observed.canonicalPromotion.kind === "MEASURED") {
    assert.equal(observed.canonicalPromotion.value.authorityOrigin, "TRUSTED_LKG_IMPORT");
  }
  assert.equal(observed.cadence.freshness, "STALE", "the imported LKG remains explicitly stale");
  assert.equal(observed.cadence.operationalState, "UNKNOWN", "an owner-invoked source has no fabricated routine clock");
  assert.equal(observed.lastSuccessfulAcquisition.kind, "NOT_RECORDED");
  assert.equal(observed.histories["24h"].counts.successfulAcquisitions.kind, "MEASURED");
  assert.equal(observed.histories["24h"].counts.successfulAcquisitions.value, 0);
  assert.equal(observed.histories["24h"].attempts[0]?.authorityOrigin, "TRUSTED_LKG_IMPORT");
  assert.equal(observed.lkg.kind, "MEASURED");
  if (observed.lkg.kind === "MEASURED") {
    assert.equal(observed.lkg.value.state, "TRUSTED_LKG_IMPORT");
    assert.equal(observed.lkg.value.currentlyServing, true);
  }
  assert.equal(view.summary.healthy.kind, "MEASURED");
  assert.equal(view.summary.stale.kind, "MEASURED");
  assert.equal(view.summary.lkgServing.kind, "MEASURED");
  if (view.summary.healthy.kind === "MEASURED") assert.equal(view.summary.healthy.value, 0);
  if (view.summary.stale.kind === "MEASURED") assert.equal(view.summary.stale.value, 1);
  if (view.summary.lkgServing.kind === "MEASURED") assert.equal(view.summary.lkgServing.value, 1);
});
