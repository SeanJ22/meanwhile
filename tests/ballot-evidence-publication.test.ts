import { stateBallotContractId } from "../lib/ballot/state-scopes.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { contentHash } from "../lib/control-plane/ids.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { BallotSet, BallotSourceCorpusReference, MeasureSourceReference } from "../lib/ballot/types.ts";
import type { BallotSourceCorpusEntry } from "../lib/ballot/source-corpus.ts";
import { manualProjectionCandidate, type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";

const at = "2026-10-15T04:00:00Z", key = "CO:2026-general", contractId = stateBallotContractId("ballot-contests", "CO");
const wording = "Shall the library levy be adopted? A YES vote adopts the levy. A NO vote keeps the existing levy.";

class CountedVault extends MemoryEvidenceStore {
  streams: string[] = [];
  override async stream(key: string) { this.streams.push(key); return super.stream(key); }
  override async get(): Promise<never> { throw new Error("Ballot publication must stream evidence."); }
}

async function source(vault: MemoryEvidenceStore, id: string): Promise<MeasureSourceReference> {
  const sourceUrl = `https://elections.example.gov/${id}`, bytes = Buffer.from(wording), sourceHash = contentHash(bytes).slice(7);
  const reference: MeasureSourceReference = { sourceUrl, sourceHash, retrievedAt: at, publisher: "State election authority", vault: {
    key: `project/freshness/source/elections.example.gov/2026/10/15/${id}/sha256-${sourceHash}.txt`, byteLength: bytes.length, contentType: "text/plain" } };
  await vault.put(reference.vault.key, bytes, { byteLength: bytes.length, contentHash: `sha256-${sourceHash}`, contentType: "text/plain",
    custom: { tier: "RAW", canonicalUrl: sourceUrl } });
  return reference;
}

const reviewed = (reference: MeasureSourceReference) => ({ requestedUrl: reference.sourceUrl, finalUrl: reference.sourceUrl,
  publisher: reference.publisher, sourceClass: "ELECTION_AUTHORITY" as const, retrievedAt: reference.retrievedAt, httpStatus: 200,
  rawHash: reference.sourceHash, reviewedEvidence: "Exact official source bytes reviewed." });

async function corpus(vault: MemoryEvidenceStore, sources: MeasureSourceReference[]): Promise<BallotSourceCorpusReference> {
  const entries: BallotSourceCorpusEntry[] = sources.map(source => ({ source, receipt: reviewed(source) }))
    .sort((a, b) => a.source.vault.key.localeCompare(b.source.vault.key));
  const bytes = Buffer.from(entries.map(entry => JSON.stringify(entry) + "\n").join("")), sourceHash = contentHash(bytes).slice(7);
  const reference: BallotSourceCorpusReference = { format: "ballot-source-corpus@1", state: "CO", electionId: "2026-general", sourceHash,
    documentCount: entries.length, reviewedAt: at, reviewedBy: "Source reviewer", vault: {
      key: `project/freshness/source/ballot-corpus-co/2026/10/15/test/sha256-${sourceHash}.ndjson`, byteLength: bytes.length, contentType: "application/x-ndjson" } };
  await vault.put(reference.vault.key, bytes, { contentHash: `sha256-${sourceHash}`, byteLength: bytes.length, contentType: reference.vault.contentType,
    custom: { format: reference.format, state: reference.state, electionId: reference.electionId, reviewedAt: at, reviewedBy: reference.reviewedBy } });
  return reference;
}

async function fixture() {
  const vault = new CountedVault(), officialText = await source(vault, "measure-81"), sourceCorpus = await corpus(vault, [officialText]);
  const provenance = { sourceUrl: officialText.sourceUrl, sourceOrg: officialText.publisher, collectedAt: at, verifiedAt: at };
  const ballot: BallotSet = { election: { id: "2026-general", state: "CO", name: "General election", date: "2026-11-03" },
    contests: [{ id: "measure:81", electionId: "2026-general", ocdId: "ocd-division/country:us/state:co", divisionVintage: "2020",
      title: "Amendment 81", type: "MEASURE", measureTextUrl: officialText.sourceUrl, voteFor: null, termYears: null, scopeNote: null, provenance }],
    candidacies: [], absences: [], sourceCorpus, measures: [{ id: "measure:81#question", contestId: "measure:81", questionText: wording,
      officialStatement: null, officialText, provenance }], measureRecords: [{ contestId: "measure:81", whatItDoes: wording,
      yesMeans: "A YES vote adopts the levy.", noMeans: "A NO vote keeps the existing levy.", parts: [],
      sourceUrl: officialText.sourceUrl, sourceHash: officialText.sourceHash, writtenAt: at }] };
  const input: ManualProjectionPackage = { contractId, version: "first", sourceThrough: at,
    sourceReceipt: { contractVersion: 1, reviewedAt: at, reviewedBy: "Source reviewer", sources: [reviewed(officialText)] },
    payload: { kind: "ballot-contests", ballots: { [key]: ballot } } };
  return { vault, officialText, ballot, input };
}

test("the registered ballot door verifies vault sources, skips unchanged evidence and publishes new corpus pointers", async () => {
  const { vault, ballot, input, officialText } = await fixture(), store = new MemoryRoutineDataStore();
  const first = await processRegisteredManualCandidate(store, contractId, manualProjectionCandidate(input), at, null, { vault });
  assert.ok(first.promoted, JSON.stringify(first.candidate));
  assert.equal(vault.streams.length, 2);
  vault.streams.length = 0;
  const unchanged = await processRegisteredManualCandidate(store, contractId, manualProjectionCandidate({ ...input, version: "rechecked" }),
    at, first.promoted.versionId, { vault });
  assert.ok(unchanged.confirmed, JSON.stringify(unchanged.candidate));
  assert.equal(vault.streams.length, 0);
  const added = await source(vault, "sample-style-2"), sourceCorpus = await corpus(vault, [officialText, added]);
  const updated = { ...input, version: "new-corpus", payload: { kind: "ballot-contests" as const, ballots: { [key]: { ...ballot, sourceCorpus } } } };
  const next = await processRegisteredManualCandidate(store, contractId, manualProjectionCandidate(updated), at, first.promoted.versionId, { vault });
  assert.ok(next.promoted, JSON.stringify(next.candidate));
  assert.equal(next.confirmed, undefined);
  assert.notEqual(next.promoted.versionId, first.promoted.versionId);
  assert.deepEqual(vault.streams, [sourceCorpus.vault.key, added.vault.key]);
});

test("missing corpus bytes or invented source excerpts preserve the published ballot and record the failure", async () => {
  const { vault, ballot, input } = await fixture(), store = new MemoryRoutineDataStore();
  const first = await processRegisteredManualCandidate(store, contractId, manualProjectionCandidate(input), at, null, { vault });
  assert.ok(first.promoted);
  const forged = { ...input, version: "forged-excerpt", payload: { kind: "ballot-contests" as const, ballots: { [key]: {
    ...ballot, measureRecords: [{ ...ballot.measureRecords![0], whatItDoes: "The levy saves every resident $500." }] } } } };
  const refused = await processRegisteredManualCandidate(store, contractId, manualProjectionCandidate(forged), at, first.promoted.versionId, { vault });
  assert.equal(refused.promoted, null);
  assert.match(refused.candidate.failureDetail ?? "", /absent from its official source/);
  assert.equal((await store.readPromotion("BALLOT_CANDIDACY", first.promoted.scope))?.versionId, first.promoted.versionId);
  const missingStore = new MemoryRoutineDataStore();
  const missingVault = new MemoryEvidenceStore();
  await source(missingVault, "measure-81");
  const missing = await processRegisteredManualCandidate(missingStore, contractId, manualProjectionCandidate(input), at, null, { vault: missingVault });
  assert.equal(missing.promoted, null);
  assert.match(missing.candidate.failureDetail ?? "", /Ballot corpus is missing/);
  assert.equal(await missingStore.readPromotion("BALLOT_CANDIDACY", first.promoted.scope), null);
});
