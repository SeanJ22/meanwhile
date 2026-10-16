import { morrisCurrentFilingDocumentSet, newestFilingPdfs } from "../lib/hunt/nj-filing.ts";
import { stateBallotScope } from "../lib/civic-data/state-scopes.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { ballotElectionKey, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import type { CivicDataReadStore } from "../lib/civic-data/read-model.ts";
import { manualEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { njMorrisFiling } from "./helpers/reader-fixtures.ts";
import { njMorrisFilingCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { readNjMorrisFiling } from "../lib/sources/ballot-nj-morris/index.ts";

const noPointer: CivicDataReadStore = {
  readPromotion: async () => null,
  readCandidate: async () => null,
};
const failedStore: CivicDataReadStore = {
  readPromotion: async () => { throw new Error("database offline"); },
  readCandidate: async () => { throw new Error("database offline"); },
};
const filing = njMorrisFiling([{
  id: "contest:county", title: "County Commissioner", ocdId: "ocd-division/country:us/state:nj/county:morris",
  candidacies: [{ id: "candidacy:a", familyName: "ALPHA", givenName: "Ann" }],
}], { contacts: [{
  candidacyId: "candidacy:a", email: "a@example.test",
  sourceUrl: "https://www.morriscountyclerk.org/Elections/Current-Election-Candidates",
  sourceOrg: "County Clerk", collectedAt: "2026-09-08",
}] });
const ballot = { ...filing.ballot, contacts: filing.contacts.contacts.map(contact => ({
  candidacyId: contact.candidacyId, email: contact.email ?? null, sourceUrl: contact.sourceUrl,
  sourceOrg: contact.sourceOrg, collectedAt: contact.collectedAt,
})) };
const projection: GenericBallotProjection = { kind: "ballot-contests", ballots: { [ballotElectionKey(ballot)]: ballot } };

test("the retained Morris writer publishes its clerk documents through the existing reader contract", async () => {
  const at = "2026-09-08T02:00:00.000Z", store = new MemoryRoutineDataStore();
  const candidate = njMorrisFilingCandidate({ ballot: filing.ballot, contacts: filing.contacts,
    rawBodies: ["clerk listing", "general document hash", "school document hash"],
    currentDocumentSet: { generalCandidatesUrl: "https://www.morriscountyclerk.org/files/v/12/2026-general-candidates.pdf",
      schoolCandidatesUrl: "https://www.morriscountyclerk.org/files/v/14/2026-general-school-candidates.pdf" },
    finalUrl: "https://www.morriscountyclerk.org/Elections/Current-Election-Candidates", retrievedAt: at, inputRecords: 1, refused: [] });
  const result = await processRegisteredRoutineCandidate(store, "nj-morris-filing", candidate, at);
  assert.ok(result.promoted, result.candidate.failureDetail ?? result.candidate.state);
  assert.equal(result.readerReadback?.status, "PASS");
  const read = await readNjMorrisFiling({ store, now: at, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.deepEqual(read.value, filing);
});

test("a missing state ballot pointer is NOT_RECORDED", async () => {
  const result = await readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", "NJ"), { store: noPointer, now: "2026-09-08T00:00:00.000Z" });
  assert.equal(result.kind, "NOT_RECORDED");
});

test("Morris ballot and contacts share the state promoted projection", async () => {
  const promoted = await readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", "NJ"), {
    now: "2026-09-08T02:00:00.000Z",
    edge: manualEdgeEntry("ballot-contests:NJ", projection, "national-ballot-1"),
  });
  assert.equal(promoted.kind, "PROMOTED");
  if (promoted.kind !== "PROMOTED") return;
  assert.equal(promoted.metadata.versionId, "national-ballot-1");
  assert.equal(promoted.metadata.lastKnownGoodVersionId, "national-ballot-1");
  assert.deepEqual(promoted.value.ballots[ballotElectionKey(ballot)], ballot);
  assert.deepEqual(promoted.value.ballots[ballotElectionKey(ballot)].contacts, ballot.contacts);
});

test("a state store failure exposes no ballot or contact values", async () => {
  const result = await readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", "NJ"), { store: failedStore, bypassCache: true });
  assert.equal(result.kind, "STORE_UNREACHABLE");
  if (result.kind === "STORE_UNREACHABLE") assert.equal(result.code, "STORE_READ_FAILED");
  assert.equal(result.value, null);
});

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
  assert.deepEqual(newestFilingPdfs(links(replaced, renamed), CLERK), [renamed]);
  assert.deepEqual(newestFilingPdfs(links(renamed, replaced), CLERK), [renamed]);
  assert.deepEqual(
    newestFilingPdfs(links("/files/2026-general-candidates-9012026.pdf", "/files/2026-general-candidates-082126.pdf"), CLERK),
    [`${CLERK}/files/2026-general-candidates-9012026.pdf`],
  );
  assert.deepEqual(
    newestFilingPdfs(links("/files/2026-general-candidates-010227.pdf", "/files/2026-general-candidates-123126.pdf"), CLERK),
    [`${CLERK}/files/2026-general-candidates-010227.pdf`],
  );
  const school = `${CLERK}/files/sharedassets/clerk/v/14/e/2026-general-school-candidates-082126.pdf`;
  assert.equal(
    morrisCurrentFilingDocumentSet([`${CLERK}/files/sharedassets/clerk/v/11/e/2026-general-election-candidates-9012026.pdf`, renamed, school])
      .generalCandidatesUrl,
    renamed,
  );
  assert.throws(
    () => morrisCurrentFilingDocumentSet([`${CLERK}/files/2026-general-election-candidates.pdf`, `${CLERK}/files/2026-general-candidates.pdf`, school]),
    /MORRIS_CURRENT_FILING_DOCUMENT_SET_INCOMPLETE.*general=2/,
  );
});
