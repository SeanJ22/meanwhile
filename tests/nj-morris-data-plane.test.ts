import assert from "node:assert/strict";
import test from "node:test";

import { candidateContactCensus } from "../lib/ballot/candidate-contacts.ts";
import { VALIDATION_CHECKS, sourceProjectionEvidence, type CandidateVersionRecord, type PromotedProjection, type ValidationReceipt } from "../lib/civic-data/types.ts";
import type { CivicDataReadStore } from "../lib/civic-data/read-model.ts";
import {
  ballotNjMorrisSource,
  readNjMorrisFiling,
  type NjMorrisReadModel,
} from "../lib/sources/ballot-nj-morris/index.ts";
import { morrisCurrentFilingDocumentSet } from "../lib/hunt/nj-filing.ts";
import { normalizedHash } from "../lib/civic-data/candidate-builders.ts";

test("Morris filing horizon requires the clerk's current general and school documents", () => {
  const general = "https://www.morriscountyclerk.org/files/v/11/2026-general-election-candidates-090126.pdf";
  const school = "https://www.morriscountyclerk.org/files/v/14/2026-general-school-candidates-090126.pdf";
  assert.deepEqual(morrisCurrentFilingDocumentSet([general, school]), {
    generalCandidatesUrl: general,
    schoolCandidatesUrl: school,
  });
  assert.throws(
    () => morrisCurrentFilingDocumentSet([general]),
    /MORRIS_CURRENT_FILING_DOCUMENT_SET_INCOMPLETE.*school=0/,
  );
  assert.throws(
    () => morrisCurrentFilingDocumentSet([school]),
    /MORRIS_CURRENT_FILING_DOCUMENT_SET_INCOMPLETE.*general=0/,
  );
  assert.throws(
    () => morrisCurrentFilingDocumentSet([
      general,
      "https://untrusted.example/2026-general-school-candidates-090126.pdf",
    ]),
    /MORRIS_CURRENT_FILING_DOCUMENT_SET_INCOMPLETE.*school=0/,
  );
});

const noPointer: CivicDataReadStore = {
  readPromotion: async () => null,
  readCandidate: async () => null,
};

const failedStore: CivicDataReadStore = {
  readPromotion: async () => { throw new Error("database offline"); },
  readCandidate: async () => { throw new Error("database offline"); },
};

function promotedStore(payload: NjMorrisReadModel): CivicDataReadStore {
  const payloadHash = normalizedHash(payload);
  const receipt: ValidationReceipt = {
    contractVersion: 2,
    decision: "GOOD",
    candidateId: "nj-candidate-1",
    sourceId: "nj-morris-county-clerk",
    recordClass: "BALLOT_FILING",
    scope: "US-NJ:county:morris:2026-general",
    validatedAt: "2026-09-08T00:30:00.000Z",
    checks: VALIDATION_CHECKS.map((check) => ({ check, verdict: "PASS", code: `${check}_PASS`, detail: `${check} was proven.` })),
    excludedFacts: [],
  };
  const projection = {
    key: "BALLOT_FILING:US-NJ:county:morris:2026-general",
    sourceId: "nj-morris-county-clerk",
    recordClass: "BALLOT_FILING",
    scope: "US-NJ:county:morris:2026-general",
    versionId: "nj-candidate-1",
    lastKnownGoodVersionId: "nj-candidate-1",
    promotedAt: "2026-09-08T01:00:00.000Z",
    payload,
    receipt,
  } satisfies PromotedProjection<NjMorrisReadModel>;
  const candidate = {
    candidate: {
      id: "nj-candidate-1",
      sourceId: "nj-morris-county-clerk",
      recordClass: "BALLOT_FILING",
      scope: "US-NJ:county:morris:2026-general",
      sourceProjectionEvidence: sourceProjectionEvidence("nj-morris-county-clerk", "BALLOT_FILING", "US-NJ:county:morris:2026-general"),
      retrieval: { succeeded: true, requestedUrl: "https://www.morriscountyclerk.org/", finalUrl: "https://www.morriscountyclerk.org/", httpStatus: 200, retrievedAt: "2026-09-08T00:00:00.000Z", rawHash: "a".repeat(64) },
      normalization: { succeeded: true, parserVersion: "nj-morris-filing/2", schemaVersion: "test", normalizedHash: payloadHash, normalizedPayloadHash: payloadHash, inputRecords: 1, outputRecords: 1, droppedRecords: 0, missingRequiredFields: [] },
      identities: [],
      temporal: { version: "2026-11-03", expectedVersion: "2026-11-03", sourceThrough: "2026-09-08", staleAtRetrieval: false },
      semantics: { factKind: "test", violations: [] },
      horizon: { kind: "BOUNDED", query: "test", returnedRecords: 1, declaredTotal: 1, paginationComplete: true, claimsComplete: true },
      absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
      dependentChecks: [{ consumer: "test", passed: true, detail: "accepted" }],
      normalizedPayload: payload,
      readModel: payload,
    },
    state: "PROMOTED",
    acquisitionSucceeded: true,
    receipt,
    promotedVersion: "nj-candidate-1",
    lastKnownGoodVersion: "nj-candidate-1",
    failureCode: null,
    failureDetail: null,
  } satisfies CandidateVersionRecord;
  return {
    readPromotion: async <T>() => projection as unknown as PromotedProjection<T>,
    readCandidate: async () => candidate,
  };
}

test("NJ ballot and filed contacts bootstrap only after an answered missing pointer", async () => {
  const result = await readNjMorrisFiling({ store: noPointer, now: "2026-09-08T00:00:00.000Z" });
  assert.equal(result.kind, "BOOTSTRAP");
  if (result.kind !== "BOOTSTRAP") return;
  assert.equal(result.metadata.sourceId, "nj-morris-county-clerk");
  assert.match(result.detail, /store answered with no promoted pointer/);
  assert.ok(result.value.ballot.contests.length >= 80);
  assert.equal(candidateContactCensus().contacts.length, result.value.ballot.candidacies.length);
  assert.match(ballotNjMorrisSource.normalize([result.value.ballot]).coverageNotes?.[0] ?? "", /bundled first-bootstrap/);
});

test("NJ Reader uses the promoted ballot/contact projection and exposes its exact LKG", async () => {
  const seeded = await readNjMorrisFiling({ store: noPointer });
  assert.equal(seeded.kind, "BOOTSTRAP");
  if (seeded.kind !== "BOOTSTRAP") return;
  const promoted = await readNjMorrisFiling({
    store: promotedStore(seeded.value),
    now: "2026-09-08T02:00:00.000Z",
  });
  assert.equal(promoted.kind, "PROMOTED");
  if (promoted.kind !== "PROMOTED") return;
  assert.equal(promoted.metadata.versionId, "nj-candidate-1");
  assert.equal(promoted.metadata.lastKnownGoodVersionId, "nj-candidate-1");
  assert.equal(candidateContactCensus().contacts.length, promoted.value.contacts.contacts.length);
});

test("NJ store failure is not disguised as a successful bundled ballot read", async () => {
  const result = await readNjMorrisFiling({ store: failedStore });
  assert.equal(result.kind, "STORE_UNREACHABLE");
  if (result.kind === "STORE_UNREACHABLE") assert.equal(result.code, "STORE_READ_FAILED");
  assert.throws(() => candidateContactCensus(), /projection is STORE_UNREACHABLE/);
});
