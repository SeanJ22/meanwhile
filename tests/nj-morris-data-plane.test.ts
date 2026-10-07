import assert from "node:assert/strict";
import test from "node:test";

import { candidateContactCensus } from "../lib/ballot/candidate-contacts.ts";
import { VALIDATION_CHECKS, sourceProjectionEvidence, type CandidateVersionRecord, type PromotedProjection, type ValidationReceipt } from "../lib/civic-data/types.ts";
import type { CivicDataReadStore } from "../lib/civic-data/read-model.ts";
import {
  readNjMorrisFiling,
  type NjMorrisReadModel,
} from "../lib/sources/ballot-nj-morris/index.ts";
import { morrisCurrentFilingDocumentSet, newestFilingPdfs } from "../lib/hunt/nj-filing.ts";
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

const CLERK = "https://www.morriscountyclerk.org";

test("Morris: the clerk's unstamped 2026-09-18 revision is the current general document", () => {
  // The clerk page's own PDF hrefs.
  const page = [
    '<a href="/files/sharedassets/clerk/v/12/elections/past-results/2026-general-candidates.pdf">General</a>',
    '<a href="/files/sharedassets/clerk/v/14/elections/past-results/2026-general-school-candidates-082126.pdf">School</a>',
    '<a href="/files/sharedassets/clerk/v/1/elections/past-results/2026-general-candidate-order-081026.pdf">Order</a>',
  ].join("\n");
  assert.deepEqual(
    morrisCurrentFilingDocumentSet(newestFilingPdfs(page, `${CLERK}/Elections/Current-Election-Candidates`)),
    {
      generalCandidatesUrl: `${CLERK}/files/sharedassets/clerk/v/12/elections/past-results/2026-general-candidates.pdf`,
      schoolCandidatesUrl: `${CLERK}/files/sharedassets/clerk/v/14/elections/past-results/2026-general-school-candidates-082126.pdf`,
    },
  );
});

test("Morris: between revisions the clerk's asset version decides, then the stamp in any of its formats", () => {
  const links = (...hrefs: string[]) => hrefs.map((href) => `<a href="${href}">pdf</a>`).join("");
  const renamed = `${CLERK}/files/sharedassets/clerk/v/12/e/2026-general-candidates.pdf`;
  const replaced = `${CLERK}/files/sharedassets/clerk/v/11/e/2026-general-candidates-090126.pdf`;
  // A renamed revision listed beside the one it replaced wins on /v/<n>/, in either order.
  assert.deepEqual(newestFilingPdfs(links(replaced, renamed), CLERK), [renamed]);
  assert.deepEqual(newestFilingPdfs(links(renamed, replaced), CLERK), [renamed]);
  // MDDYYYY is a date: 9012026 (September 1) is newer than 082126 (August 21).
  assert.deepEqual(
    newestFilingPdfs(links("/files/2026-general-candidates-9012026.pdf", "/files/2026-general-candidates-082126.pdf"), CLERK),
    [`${CLERK}/files/2026-general-candidates-9012026.pdf`],
  );
  // MMDDYY still orders across a year boundary.
  assert.deepEqual(
    newestFilingPdfs(links("/files/2026-general-candidates-010227.pdf", "/files/2026-general-candidates-123126.pdf"), CLERK),
    [`${CLERK}/files/2026-general-candidates-010227.pdf`],
  );

  // Two NAMES for one document are resolved inside the class...
  const school = `${CLERK}/files/sharedassets/clerk/v/14/e/2026-general-school-candidates-082126.pdf`;
  assert.equal(
    morrisCurrentFilingDocumentSet([`${CLERK}/files/sharedassets/clerk/v/11/e/2026-general-election-candidates-9012026.pdf`, renamed, school])
      .generalCandidatesUrl,
    renamed,
  );
  // ...and a tie nothing orders is refused, never guessed.
  assert.throws(
    () => morrisCurrentFilingDocumentSet([`${CLERK}/files/2026-general-election-candidates.pdf`, `${CLERK}/files/2026-general-candidates.pdf`, school]),
    /MORRIS_CURRENT_FILING_DOCUMENT_SET_INCOMPLETE.*general=2/,
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

const PROVENANCE = { sourceUrl: "https://www.morriscountyclerk.org/Elections/Current-Election-Candidates", sourceOrg: "County Clerk", collectedAt: "2026-09-08", verifiedAt: "2026-09-08" };
const READ_MODEL = {
  ballot: {
    formatVersion: 1,
    election: { id: "nj-2026-11-03", state: "NJ", name: "General election", date: "2026-11-03" },
    contests: [{ id: "contest:county", electionId: "nj-2026-11-03", ocdId: "ocd-division/country:us/state:nj/county:morris", divisionVintage: "fixture", title: "County Commissioner", type: "CANDIDACY", voteFor: 1, termYears: 3, scopeNote: null, provenance: PROVENANCE }],
    candidacies: [{ id: "candidacy:a", contestId: "contest:county", familyName: "ALPHA", givenName: "Ann", partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance: PROVENANCE }],
    measures: [],
    absences: [],
    removals: [],
  },
  contacts: { contacts: [{ candidacyId: "candidacy:a", email: "a@example.test", sourceUrl: PROVENANCE.sourceUrl, sourceOrg: PROVENANCE.sourceOrg, collectedAt: PROVENANCE.collectedAt }] },
} as unknown as NjMorrisReadModel;

test("an answered missing NJ pointer is NOT_RECORDED, never a bundled ballot", async () => {
  const result = await readNjMorrisFiling({ store: noPointer, now: "2026-09-08T00:00:00.000Z" });
  assert.equal(result.kind, "NOT_RECORDED");
});

test("NJ Reader uses the promoted ballot/contact projection and exposes its exact LKG", async () => {
  const promoted = await readNjMorrisFiling({
    store: promotedStore(READ_MODEL),
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
