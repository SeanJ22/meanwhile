import assert from "node:assert/strict";
import test from "node:test";
import { fecFundingCandidate } from "../lib/civic-data/candidate-builders.ts";
import { stateCampaignFinanceCandidate } from "../lib/funding/data-plane.ts";
import { nativeStateMoneyRecord, upsertStateMoney } from "../lib/funding/state-native.ts";
import { knownReleaseSourceCheck } from "../lib/sources/known-release.ts";
import { fundingFixtureForState } from "./helpers/funding-fixture.ts";

const retrievedAt = "2026-09-01T00:00:00.000Z", checkedAt = "2026-10-09T00:00:00.000Z";
const hash = "a".repeat(64);
const check = (url: string) => knownReleaseSourceCheck({ requestedUrl: url, finalUrl: url, sha256: hash, checkedAt, lastCheckStatus: 304 });

test("FEC revalidation retains original bytes' date and cannot collide with a changed durable cursor", () => {
  const snapshot = fundingFixtureForState("AZ"), candidateId = snapshot.candidates[0].fecCandidateId;
  const url = `https://api.open.fec.gov/v1/candidate/${candidateId}/totals/?cycle=2026`;
  const input = { snapshot, rawBodies: [], rawHashes: [hash], finalUrl: url, retrievedAt, sourceCheck: check(url), excludedFacts: [] };
  const first = fecFundingCandidate(input);
  assert.equal(first.retrieval.retrievedAt, retrievedAt);
  assert.deepEqual(first.retrieval.sourceCheck, check(url));
  assert.equal(fecFundingCandidate(input).id, first.id, "replaying the same evidence has stable identity");
  const progressed = fecFundingCandidate({ ...input, snapshot: { ...snapshot, refreshAttempts: { [candidateId]: "2026-10-10T00:00:00.000Z" } } });
  assert.notEqual(progressed.id, first.id, "cursor state cannot overwrite an immutable prior candidate");
  assert.equal(progressed.retrieval.sourceCheck?.checkedAt, checkedAt, "operational progress is not a provider check");
});

test("state finance separates a conditional provider check from held observation and publication", () => {
  const url = "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails";
  const record = nativeStateMoneyRecord({ state: "NH", committeeId: "1", name: "Filed Committee", candidateName: "Alice Adams",
    office: "State Senator", year: 2026, receipts: 100, spent: null, period: "2026 cycle", sourceUrl: url, agency: "NH Secretary of State", observedAt: retrievedAt });
  const snapshot = upsertStateMoney(null, [record], { state: "NH", year: 2026, observedAt: retrievedAt });
  const input = { jurisdiction: "NH" as const, snapshot, rawBodies: [], rawHashes: [hash], requestedUrl: url, finalUrl: url,
    retrievedAt, sourceCheck: check(url), query: "native filer index", paginationComplete: true };
  const first = stateCampaignFinanceCandidate(input);
  const progressed = stateCampaignFinanceCandidate({ ...input, snapshot: { ...snapshot, acquisitionCursors: { "nh:next-page": 2 } } });
  assert.equal(first.retrieval.retrievedAt, retrievedAt);
  assert.deepEqual(first.retrieval.sourceCheck, check(url));
  assert.equal((first.readModel as typeof snapshot).records[0].provenance.collectedAt, retrievedAt);
  assert.notEqual(progressed.id, first.id);
  assert.equal(progressed.retrieval.sourceCheck?.checkedAt, checkedAt);
});
