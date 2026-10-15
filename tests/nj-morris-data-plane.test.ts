import assert from "node:assert/strict";
import test from "node:test";
import { candidateContactCensus } from "../lib/ballot/candidate-contacts.ts";
import { ballotElectionKey, readGenericBallotProjection, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import type { CivicDataReadStore } from "../lib/civic-data/read-model.ts";
import { manualEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { njMorrisFiling } from "./helpers/reader-fixtures.ts";

const noPointer: CivicDataReadStore = {
  readPromotion: async () => null,
  readCandidate: async () => null,
};
const failedStore: CivicDataReadStore = {
  readPromotion: async () => { throw new Error("database offline"); },
  readCandidate: async () => { throw new Error("database offline"); },
};
const ballot = njMorrisFiling([{
  id: "contest:county", title: "County Commissioner", ocdId: "ocd-division/country:us/state:nj/county:morris",
  candidacies: [{ id: "candidacy:a", familyName: "ALPHA", givenName: "Ann" }],
}], { contacts: [{
  candidacyId: "candidacy:a", email: "a@example.test",
  sourceUrl: "https://www.morriscountyclerk.org/Elections/Current-Election-Candidates",
  sourceOrg: "County Clerk", collectedAt: "2026-09-08",
}] });
const projection: GenericBallotProjection = { kind: "ballot-contests", ballots: { [ballotElectionKey(ballot)]: ballot } };

test("a missing national ballot pointer is NOT_RECORDED", async () => {
  const result = await readGenericBallotProjection("NJ", { store: noPointer, now: "2026-09-08T00:00:00.000Z" });
  assert.equal(result.kind, "NOT_RECORDED");
});

test("Morris ballot and contacts share the national promoted projection", async () => {
  const promoted = await readGenericBallotProjection("NJ", {
    now: "2026-09-08T02:00:00.000Z",
    edge: manualEdgeEntry("ballot-contests:NJ", projection, "national-ballot-1"),
  });
  assert.equal(promoted.kind, "PROMOTED");
  if (promoted.kind !== "PROMOTED") return;
  assert.equal(promoted.metadata.versionId, "national-ballot-1");
  assert.equal(promoted.metadata.lastKnownGoodVersionId, "national-ballot-1");
  assert.deepEqual(promoted.value.ballots[ballotElectionKey(ballot)], ballot);
  assert.deepEqual(candidateContactCensus("NJ").contacts, ballot.contacts);
});

test("a national store failure stays explicit for ballot and contact readers", async () => {
  const result = await readGenericBallotProjection("NJ", { store: failedStore, bypassCache: true });
  assert.equal(result.kind, "STORE_UNREACHABLE");
  if (result.kind === "STORE_UNREACHABLE") assert.equal(result.code, "STORE_READ_FAILED");
  assert.throws(() => candidateContactCensus("NJ"), /NJ is STORE_UNREACHABLE/);
});
