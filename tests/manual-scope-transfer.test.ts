import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { manualProjectionCandidate, type CuratedReaderProjection, type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { prepareManualProjectionScopeTransfer, prepareManualProjectionSuccessor } from "../lib/civic-data/manual-successor.ts";
import { manualPriorAuthorityIssue } from "../lib/civic-data/manual-prior-authority.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { promotionProofIssue } from "../lib/civic-data/read-model.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";

const firstAt = "2026-10-14T19:00:00.000Z", transferAt = "2026-10-14T19:01:00.000Z", nextAt = "2026-10-14T19:02:00.000Z";
const hash = (value: unknown) => createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex");
const sourceUrl = "https://azsos.gov/elections/voters";

function freshPackage(at: string, count = 10, idPrefix = "new-navigation"): ManualProjectionPackage {
  return { contractId: "ballot-navigation", version: at, sourceThrough: at, sourceReceipt: {
    contractVersion: 1, reviewedAt: at, reviewedBy: "navigation source fixture", sources: [{
      requestedUrl: sourceUrl, finalUrl: sourceUrl, publisher: "Arizona Secretary of State", sourceClass: "ELECTION_AUTHORITY",
      retrievedAt: at, httpStatus: 200, rawHash: "a".repeat(64), reviewOutcome: "SUPPORTED", reviewedEvidence: "Saved official-page fixture",
    }],
  }, payload: { kind: "ballot-navigation", records: Array.from({ length: count }, (_, index) => ({
    id: `${idPrefix}:${index}`, kind: "ELECTION_FIELD", value: {
      state: "AZ", divisionId: "ocd-division/country:us/state:az", fieldKind: "registration_deadline",
      text: `Voter registration deadline October 5, 2026, source row ${index}.`, quote: `Voter registration deadline October 5, 2026, source row ${index}.`,
      dates: ["2026-10-05"], electionDate: "2026-11-03", url: sourceUrl, navigationUrl: null,
      sourceOrg: "Arizona Secretary of State", collectedAt: at, verifiedAt: at,
    },
  })) } };
}

function importedSource() {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/retained-ballot-navigation-import.json", import.meta.url), "utf8")) as {
    record: CandidateVersionRecord; projection: PromotedProjection<CuratedReaderProjection>;
  };
  assert.equal(promotionProofIssue("CURATED_READER_RECORD", fixture.record.candidate.scope, fixture.projection, fixture.record), null);
  const candidates = new Map([[fixture.record.candidate.id, fixture.record]]), promotions = new Map([[fixture.projection.key, fixture.projection]]);
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates, promotions });
  return { ...fixture, candidates, promotions, store };
}

async function prepareTransfer() {
  const fixture = importedSource();
  const target = await processRegisteredManualCandidate(fixture.store, "ballot-navigation", manualProjectionCandidate(freshPackage(firstAt)), firstAt);
  assert.ok(target.promoted, JSON.stringify(target.candidate.receipt));
  const input = freshPackage(transferAt);
  const withOld = { ...input, payload: { ...(input.payload as CuratedReaderProjection),
    records: [...(input.payload as CuratedReaderProjection).records, ...fixture.projection.payload.records] } };
  const prepared = await prepareManualProjectionScopeTransfer(withOld, fixture.store, fixture.record.candidate.scope, transferAt);
  return { ...fixture, target: target.candidate, ...prepared };
}

test("an explicit transfer carries six intact imported navigation records beside ten sourced national records", async () => {
  const fixture = await prepareTransfer();
  assert.equal(fixture.candidate.scope, "US:official-ballot-navigation");
  assert.equal(fixture.expectedBaseVersionId, fixture.target.candidate.id);
  assert.equal(fixture.candidate.manualPriorAuthority?.additionalProjections?.[0].retainedMembers.length, 6);
  assert.equal(fixture.candidate.retrieval.manualSourceReceipt?.sources.length, 1);
  assert.deepEqual(fixture.candidate.retrieval.manualSourceReceipt?.sources.map(source => source.finalUrl), [sourceUrl]);
  assert.equal((fixture.candidate.readModel as CuratedReaderProjection).records.length, 16);
  for (const original of fixture.projection.payload.records) {
    assert.deepEqual((fixture.candidate.readModel as CuratedReaderProjection).records.find(row => row.id === original.id), original);
    assert.match((original.value as { verifiedAt: string }).verifiedAt, /^2026-08-(13|15)$/);
  }
  const result = await processRegisteredManualCandidate(fixture.store, "ballot-navigation", fixture.candidate, transferAt, fixture.expectedBaseVersionId);
  assert.equal(result.candidate.receipt?.decision, "GOOD", JSON.stringify(result.candidate.receipt));
  assert.equal(result.readerReadback?.status, "PASS");
  assert.ok(result.promoted);
  assert.match(result.candidate.receipt!.checks.find(check => check.check === "SOURCE_AUTHENTICITY")!.detail, /no fresh HTTP retrieval is asserted/);
});

test("ordinary future successors retain carried facts after the source scope is retired", async () => {
  const fixture = await prepareTransfer();
  const transferred = await processRegisteredManualCandidate(fixture.store, "ballot-navigation", fixture.candidate, transferAt, fixture.expectedBaseVersionId);
  assert.ok(transferred.promoted);
  assert.equal(await fixture.store.retireTransferredProjection({ recordClass: "CURATED_READER_RECORD",
    sourceScope: fixture.record.candidate.scope, sourceVersionId: fixture.record.candidate.id,
    targetScope: fixture.candidate.scope, targetVersionId: transferred.promoted.versionId, at: transferAt }), true);
  assert.equal(await fixture.store.readPromotion("CURATED_READER_RECORD", fixture.record.candidate.scope), null);
  const next = await prepareManualProjectionSuccessor(freshPackage(nextAt, 1, "later-deadline"), fixture.store, nextAt);
  assert.equal(next.candidate.manualPriorAuthority?.additionalProjections, undefined);
  const result = await processRegisteredManualCandidate(fixture.store, "ballot-navigation", next.candidate, nextAt, next.expectedBaseVersionId);
  assert.ok(result.promoted, JSON.stringify(result.candidate.receipt));
  assert.equal((result.promoted.payload as CuratedReaderProjection).records.length, 17);
  for (const original of fixture.projection.payload.records) assert.deepEqual((result.promoted.payload as CuratedReaderProjection).records.find(row => row.id === original.id), original);
  assert.ok(await fixture.store.readCandidate(fixture.record.candidate.id), "retiring a scope must preserve its immutable evidence");
});

test("a transfer without new fields publishes the existing exact national and source members", async () => {
  const fixture = importedSource();
  const first = await processRegisteredManualCandidate(fixture.store, "ballot-navigation", manualProjectionCandidate(freshPackage(firstAt)), firstAt);
  assert.ok(first.promoted);
  const source = freshPackage(transferAt);
  const prepared = await prepareManualProjectionScopeTransfer({ ...source,
    payload: { ...(source.payload as CuratedReaderProjection), records: [] } }, fixture.store, fixture.record.candidate.scope, transferAt);
  assert.deepEqual(prepared.candidate.normalization.missingRequiredFields, []);
  const published = await processRegisteredManualCandidate(fixture.store, "ballot-navigation", prepared.candidate, transferAt, prepared.expectedBaseVersionId);
  assert.ok(published.promoted, JSON.stringify(published.candidate.receipt));
  assert.equal((published.promoted.payload as CuratedReaderProjection).records.length, 16);
});

test("retirement refuses an uncopied source and stale source or target pointers", async () => {
  const fixture = await prepareTransfer();
  const retirement = { recordClass: "CURATED_READER_RECORD" as const, sourceScope: fixture.record.candidate.scope,
    sourceVersionId: fixture.record.candidate.id, targetScope: fixture.target.candidate.scope,
    targetVersionId: fixture.target.candidate.id, at: transferAt };
  await assert.rejects(() => fixture.store.retireTransferredProjection(retirement), /MEMBERS_NOT_TRANSFERRED/);
  assert.equal(await fixture.store.retireTransferredProjection({ ...retirement, sourceVersionId: "changed-source" }), false);
  assert.equal(await fixture.store.retireTransferredProjection({ ...retirement, targetVersionId: "changed-target" }), false);
  assert.ok(await fixture.store.readPromotion("CURATED_READER_RECORD", retirement.sourceScope));
});

test("changed member bytes, copied identity and transferred model hashes cannot inherit authority", async () => {
  const fixture = await prepareTransfer();
  const changed = structuredClone(fixture.candidate);
  const old = (changed.readModel as CuratedReaderProjection).records.find(row => row.id === "registration:NH")!;
  (old.value as Record<string, unknown>).url = "https://wrong.example.gov/";
  assert.match(manualPriorAuthorityIssue(changed, fixture.target, [fixture.record])!, /changed, duplicated, invented/);
  const identity = { ...fixture.candidate, identities: fixture.candidate.identities.map(row =>
    row.identifiers.record_id === "registration:NH" ? { ...row, jurisdiction: "US-NJ" } : row) };
  assert.match(manualPriorAuthorityIssue(identity, fixture.target, [fixture.record])!, /original exact member identity/);
  const digest = structuredClone(fixture.candidate);
  (digest.manualPriorAuthority!.additionalProjections![0] as { readModelSha256: string }).readModelSha256 = "0".repeat(64);
  assert.match(manualPriorAuthorityIssue(digest, fixture.target, [fixture.record])!, /exact GOOD base/);
  assert.equal(hash(fixture.record.candidate.readModel), fixture.candidate.manualPriorAuthority?.additionalProjections?.[0].readModelSha256);
});

test("a corrupt or moved source pointer refuses transfer without replacing the target", async () => {
  for (const alter of ["payload", "version"] as const) {
    const fixture = await prepareTransfer();
    fixture.promotions.set(fixture.projection.key, alter === "payload" ? { ...fixture.projection, payload: { kind: "ballot-navigation", records: [] } }
      : { ...fixture.projection, versionId: "newer-source-version" });
    const result = await processRegisteredManualCandidate(fixture.store, "ballot-navigation", fixture.candidate, transferAt, fixture.expectedBaseVersionId);
    assert.equal(result.promoted, null);
    assert.equal(result.candidate.receipt?.decision, "FAIL");
    assert.equal((await fixture.store.readPromotion("CURATED_READER_RECORD", fixture.candidate.scope))?.versionId, fixture.expectedBaseVersionId);
  }
});

test("wrong source family, changed supplied copies and ambiguous identities refuse transfer", async () => {
  const fixture = importedSource();
  const target = await processRegisteredManualCandidate(fixture.store, "ballot-navigation", manualProjectionCandidate(freshPackage(firstAt)), firstAt);
  assert.ok(target.promoted);
  const input = freshPackage(transferAt);
  const wrong = { ...input, contractId: "comment-access" as const, payload: { kind: "comment-access", records: [] } as CuratedReaderProjection };
  await assert.rejects(prepareManualProjectionScopeTransfer(wrong, fixture.store, fixture.record.candidate.scope, transferAt), /TRANSFER_INVALID|TARGET_NOT_PROMOTED/);
  const changed = structuredClone(fixture.projection.payload.records[0]);
  (changed.value as Record<string, unknown>).verifiedAt = transferAt;
  await assert.rejects(prepareManualProjectionScopeTransfer({ ...input, payload: { ...(input.payload as CuratedReaderProjection),
    records: [...(input.payload as CuratedReaderProjection).records, changed] } }, fixture.store, fixture.record.candidate.scope, transferAt), /MEMBER_CHANGED/);
  const prepared = await prepareManualProjectionScopeTransfer(input, fixture.store, fixture.record.candidate.scope, transferAt);
  const ambiguous = { ...prepared.candidate, identities: [...prepared.candidate.identities,
    prepared.candidate.identities.find(row => row.identifiers.record_id === "registration:NH")!] };
  assert.match(manualPriorAuthorityIssue(ambiguous, target.candidate, [fixture.record])!, /original exact member identity/);
});
