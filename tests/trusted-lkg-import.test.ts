import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalCivicDataJson, civicRecordsFor } from "../lib/civic-data/changes.ts";
import { RETAINED_LKG_FIXTURE } from "./fixtures/retained-lkg-promotion.ts";
import { processRoutineCandidate } from "../lib/civic-data/candidate-lifecycle.ts";
import { promotionProofIssue, readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { MemoryRoutineDataStore, trustedLkgImportClock } from "../lib/civic-data/store.ts";
import { routineTaskDue, ROUTINE_SOURCE_TASKS, type RoutineSourceTask } from "../lib/civic-data/runner.ts";
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
  type CandidateVersionRecord,
  type RoutineCandidate,
  type CandidateEvent,
  type TrustedLkgImportEvidence,
} from "../lib/civic-data/types.ts";
import { routineCandidateFixture } from "./helpers/routine-candidate-fixture.ts";

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
  const scope = manual ? MANUAL_SCOPE : "US:current-full:domains";
  const parserVersion = manual ? "curated-reader-records/2" : "cisa-dotgov/3";
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
    path: manual ? "lib/registry/comment-access.ts" : "lib/civic-data/contracts.ts",
    sha256: sha256("exact frozen fixture bytes"),
    bytes: Buffer.byteLength("exact frozen fixture bytes"),
  }] as const;
  const fixtureSetSha256 = trustedLkgFixtureSetSha256(fixtures);
  const normalizedPayloadSha256 = sha256(canonicalCivicDataJson(payload));
  const partial = routineCandidateFixture({
    id: "pending-content-address",
    sourceId,
    recordClass,
    scope,
    parserVersion,
    schemaVersion: `${contractId}:trusted-lkg:1`,
    records: civicRecords.length,
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
      query: "exact frozen LKG members without a current publisher-universe claim",
      paginationComplete: false,
    },
    dependentChecks: [{
      consumer: `${contractId} Reader projection`,
      passed: true,
      detail: "The exact frozen projection satisfies its contract-specific Reader shape.",
    }],
    normalizedPayload: payload,
    readModel: payload,
  }, {
    retrieval: {
      succeeded: true,
      requestedUrl: trustedLkgImportUrl(contractId),
      finalUrl: null,
      httpStatus: null,
      retrievedAt: importedAt,
      rawHash: fixtureSetSha256,
    },
    civicRecords,
  });
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



function retainedHistoricalLkg() {
  const { outcome, events } = structuredClone(RETAINED_LKG_FIXTURE);
  assert.ok(outcome.promoted);
  assert.equal(promotionProofIssue(MANUAL_RECORD_CLASS, MANUAL_SCOPE, outcome.promoted, outcome.candidate), null);
  assert.deepEqual(events.map(({ sequence }) => sequence), [1, 2, 3, 4, 5]);
  const store = new MemoryRoutineDataStore();
  Object.assign(store, {
    candidates: new Map([[outcome.candidate.candidate.id, outcome.candidate]]),
    history: new Map([[outcome.candidate.candidate.id, [...events]]]),
    promotions: new Map([[outcome.promoted.key, outcome.promoted]]),
  });
  return { store, outcome };
}

test("retired trusted-LKG doors refuse new imports while retained history remains due", async () => {
  const directStore = new MemoryRoutineDataStore();
  await assert.rejects(
    processRoutineCandidate(directStore, candidate(), FIRST),
    /TRUSTED_LKG_ADMISSION_RETIRED/,
  );
  assert.equal(await directStore.readPromotion(MANUAL_RECORD_CLASS, MANUAL_SCOPE), null);

  const ordinaryRoutineStore = new MemoryRoutineDataStore();
  await assert.rejects(
    processRoutineCandidate(ordinaryRoutineStore, candidate(FIRST, "a".repeat(40), "ROUTINE"), FIRST),
    /TRUSTED_LKG_ADMISSION_RETIRED/,
    "retained routine-source markers cannot create a new promotion",
  );
  assert.equal(await ordinaryRoutineStore.readPromotion("DOTGOV_REFERENCE", "US:current-full:domains"), null);
  const retiredManualStore = new MemoryRoutineDataStore();
  await assert.rejects(
    processRoutineCandidate(retiredManualStore, candidate(), FIRST),
    /TRUSTED_LKG_ADMISSION_RETIRED/,
  );
  assert.equal(await retiredManualStore.readPromotion(MANUAL_RECORD_CLASS, MANUAL_SCOPE), null);
  for (const marker of [null, { kind: "TRUSTED_LKG_REATTESTATION" }]) {
    const malformed = { ...candidate(), bootstrapImport: marker } as unknown as RoutineCandidate;
    await assert.rejects(processRoutineCandidate(new MemoryRoutineDataStore(), malformed, FIRST), /TRUSTED_LKG_ADMISSION_RETIRED/);
  }

  const { store, outcome } = retainedHistoricalLkg();
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

  });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.metadata.stale, "STALE", "Reader serves the LKG but never confuses it with current source truth");
});

test("trusted LKG evidence is content-bound and cannot replace an existing authority", async () => {
  const { store, outcome: first } = retainedHistoricalLkg();
  assert.ok(first.promoted);

  const replacement = candidate(SECOND, "b".repeat(40));
  await assert.rejects(
    processRoutineCandidate(store, replacement, SECOND),
    /TRUSTED_LKG_ADMISSION_RETIRED/,
  );
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
    processRoutineCandidate(new MemoryRoutineDataStore(), mismatched, FIRST),
    /TRUSTED_LKG_ADMISSION_RETIRED/,
  );

  const invalid = structuredClone(first.candidate.candidate);
  const invalidEvidence = invalid.bootstrapImport;
  assert.ok(invalidEvidence);
  if (invalidEvidence.kind !== "TRUSTED_LKG_IMPORT") assert.fail("test candidate is not a first-seed import");
  assert.equal(trustedLkgImportEvidenceIssue(invalid), null, "untampered historical evidence remains valid");
  const corrupt = {
    ...invalid,
    bootstrapImport: {
      ...invalidEvidence,
      fixtures: [{ ...invalidEvidence.fixtures[0]!, sha256: "f".repeat(64) }],
    },
  };
  assert.match(trustedLkgImportEvidenceIssue(corrupt) ?? "", /fixture-set digest does not match/, "historical evidence still rejects the exact changed fixture hash");
  await assert.rejects(
    processRoutineCandidate(new MemoryRoutineDataStore(), corrupt, FIRST),
    /TRUSTED_LKG_ADMISSION_RETIRED/,
  );
});

test("Reader proof fails closed if durable trusted-LKG evidence is altered", async () => {
  const { outcome } = retainedHistoricalLkg();
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

function withLiveAttempt(store: MemoryRoutineDataStore, template: CandidateVersionRecord, id: string, at: string): void {
  const { bootstrapImport: _import, ...live } = structuredClone(template.candidate);
  const rows = store as unknown as {
    candidates: Map<string, CandidateVersionRecord>;
    history: Map<string, CandidateEvent[]>;
  };
  rows.candidates.set(id, {
    ...structuredClone(template),
    candidate: { ...live, id },
    state: "SOURCE_BLOCKED",
    acquisitionSucceeded: false,
    receipt: null,
    promotedVersion: null,
    failureCode: "SOURCE_BLOCKED",
    failureDetail: "the live read was refused",
  });
  rows.history.set(id, [{ candidateId: id, sequence: 1, state: "FETCHED", at, detail: "attempted" }]);
}

test("a failed live read after a trusted-LKG import waits its retry clock; an earlier attempt never postpones the first live read", async () => {
  const { store, outcome } = retainedHistoricalLkg();
  const importedAt = outcome.promoted!.promotedAt;
  const retry = { ...ROUTINE_SOURCE_TASKS[0], id: "trusted-import-retry", recordClass: "MEETING" as const, retryMs: 60 * 60 * 1000, contract: {cadence: {defaultEveryMs: 60 * 60 * 1000, description: "Fixture live retry"}} } as RoutineSourceTask;

  withLiveAttempt(store, outcome.candidate, "live-before-import", "2026-09-09T11:00:00.000Z");
  assert.ok(Date.parse("2026-09-09T11:00:00.000Z") < Date.parse(importedAt));
  const beforeImport = await store.clock(MANUAL_SOURCE_ID, MANUAL_RECORD_CLASS, MANUAL_SCOPE);
  assert.deepEqual(beforeImport, {}, "an attempt older than the import does not delay the first live read");
  assert.equal(routineTaskDue(retry, beforeImport, Date.parse(SECOND)), true);

  withLiveAttempt(store, outcome.candidate, "live-after-import", SECOND);
  const afterImport = await store.clock(MANUAL_SOURCE_ID, MANUAL_RECORD_CLASS, MANUAL_SCOPE);
  assert.deepEqual(afterImport, { lastAttemptedAt: SECOND }, "the failed live read is the attempt");
  assert.equal(routineTaskDue(retry, afterImport, Date.parse(SECOND) + 5 * 60 * 1000), false, "the next pass does not re-fetch");
  assert.equal(routineTaskDue(retry, afterImport, Date.parse(SECOND) + retry.retryMs), true, "the retry clock owns the next attempt");
});

test("the trusted-LKG import clock counts only attempts strictly after the import's pointer move", () => {
  const importedAt = "2026-09-14T04:24:22.927Z";
  assert.deepEqual(trustedLkgImportClock(undefined, importedAt), {});
  assert.deepEqual(trustedLkgImportClock("2026-09-14T04:24:22.927Z", importedAt), {}, "the import's own instant is not an attempt");
  assert.deepEqual(trustedLkgImportClock("2026-09-14T04:00:00.000Z", importedAt), {});
  assert.deepEqual(
    trustedLkgImportClock("2026-09-24T05:15:59.400Z", importedAt),
    { lastAttemptedAt: "2026-09-24T05:15:59.400Z" },
  );
  assert.deepEqual(trustedLkgImportClock("not a time", importedAt), {}, "an unreadable attempt decides nothing");
  assert.deepEqual(trustedLkgImportClock("2026-09-24T05:15:59.400Z", "not a time"), {}, "an unreadable import time decides nothing");
});

test("an import is read whole by its proof: its evidence binds the complete envelope", async () => {
  const { store, outcome } = retainedHistoricalLkg();
  assert.ok(outcome.promoted);
  const whole = outcome.candidate;
  const narrowed = await store.readCandidateProof(whole.candidate.id);
  assert.ok(narrowed);
  assert.deepEqual(narrowed, whole, "the envelope hash covers every field, identities included");
  const decide = (record: typeof whole) => promotionProofIssue(MANUAL_RECORD_CLASS, MANUAL_SCOPE, outcome.promoted!, record);
  assert.equal(decide(narrowed), null);
  const tampers: readonly ((record: typeof whole) => typeof whole)[] = [
    (record) => ({ ...record, candidate: { ...record.candidate, readModel: { tampered: true } } }) as typeof whole,
    (record) => ({ ...record, candidate: { ...record.candidate, normalizedPayload: { tampered: true } } }) as typeof whole,
    (record) => ({ ...record, candidate: { ...record.candidate, civicRecords: [] } }) as typeof whole,
    (record) => ({ ...record, candidate: { ...record.candidate, changeSet: undefined } }) as unknown as typeof whole,
    (record) => ({ ...record, state: "VALIDATED" }) as typeof whole,
  ];
  for (const tamper of tampers) {
    const issue = decide(tamper(whole));
    assert.ok(issue, "the whole row refuses the tamper");
    assert.equal(decide(tamper(narrowed)), issue);
  }
  const read = await readPromotedCivicData(MANUAL_RECORD_CLASS, MANUAL_SCOPE, { store,  now: SECOND });
  assert.equal(read.kind, "PROMOTED", "the Reader proves an import through the narrowed door");
});
