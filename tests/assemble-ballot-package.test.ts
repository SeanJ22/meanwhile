import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { assembleBallotPackage, type BallotStateFile } from "../scripts/assemble-ballot-package.mts";
import { ballotElectionKey, readGenericBallotProjection, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { genericSourcesForDivisions } from "../lib/ballot/reader-sources.ts";
import { manualProjectionCandidate, type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";

const now = "2026-10-13T12:00:00.000Z";
const fixture = async () => JSON.parse(await readFile("tests/fixtures/ballot-national/tx.json", "utf8")) as BallotStateFile;
const payloadOf = (input: ManualProjectionPackage) => input.payload as GenericBallotProjection;
const ballotOf = (input: BallotStateFile) => Object.values(input.ballots)[0];
const packageFor = (state: BallotStateFile): ManualProjectionPackage => ({ contractId: "ballot-contests", version: "fixture",
  sourceThrough: state.sourceReceipt.reviewedAt, sourceReceipt: state.sourceReceipt, payload: { kind: "ballot-contests", ballots: state.ballots } });

async function publish(store: MemoryRoutineDataStore, input: ManualProjectionPackage) {
  const result = await processRegisteredManualCandidate(store, "ballot-contests", manualProjectionCandidate(input), now);
  assert.ok(result.promoted, result.candidate.failureDetail ?? JSON.stringify(result.candidate.receipt));
  assert.equal(result.readerReadback?.status, "PASS", JSON.stringify(result.readerReadback));
}

function changeSource(state: BallotStateFile, stateCode: string, at: string, publisher = `Fixture ${stateCode} election authority`) {
  const ballot = ballotOf(state), url = `https://elections.example.gov/${stateCode.toLowerCase()}/candidates`;
  ballot.election.state = stateCode;
  for (const row of [...ballot.contests, ...ballot.candidacies]) {
    row.provenance = { ...row.provenance, sourceUrl: url, sourceOrg: publisher, collectedAt: at, verifiedAt: at };
    row.id = row.id.replace("-tx-", `-${stateCode.toLowerCase()}-`);
  }
  for (const contest of ballot.contests) contest.ocdId = `ocd-division/country:us/state:${stateCode.toLowerCase()}`;
  for (const row of ballot.candidacies) row.contestId = row.contestId.replace("-tx-", `-${stateCode.toLowerCase()}-`);
  return { ballots: { [ballotElectionKey(ballot)]: ballot }, sourceReceipt: { ...state.sourceReceipt, reviewedAt: at,
    sources: state.sourceReceipt.sources.map(source => ({ ...source, publisher, requestedUrl: url, finalUrl: url, retrievedAt: at,
      rawHash: "b".repeat(64) })) } };
}

test("assembles a two-contest state with a published prior, skips bad states, and preserves states on rerun", async () => {
  const scratch = await mkdtemp(resolve(tmpdir(), "ballot-national-"));
  try {
    const directory = resolve(scratch, "states");
    await mkdir(directory);
    const store = new MemoryRoutineDataStore();
    const prior = changeSource(await fixture(), "NH", "2026-10-12T00:00:00.000Z");
    await publish(store, packageFor(prior));
    await writeFile(resolve(directory, "tx.json"), JSON.stringify(await fixture()));
    const bad = changeSource(await fixture(), "OH", now);
    ballotOf(bad).candidacies[0].provenance.sourceUrl = "https://unreceipted.example.gov/candidates";
    await writeFile(resolve(directory, "oh.json"), JSON.stringify(bad));
    await writeFile(resolve(directory, "az.json"), "{");
    const result = await assembleBallotPackage({ directory, store, now });
    assert.deepEqual(result.merged, ["tx.json"]);
    assert.deepEqual(result.skipped.map(row => row.file), ["az.json", "oh.json"]);
    assert.match(result.skipped[1].reason, /unreceipted/);
    assert.deepEqual(Object.keys(payloadOf(result.package).ballots).sort(), ["NH:fixture-2026-general", "TX:fixture-2026-general"]);
    assert.deepEqual(payloadOf(result.package).ballots["NH:fixture-2026-general"], ballotOf(prior));
    assert.equal(payloadOf(result.package).ballots["TX:fixture-2026-general"].contests.length, 2);
    assert.equal(result.package.sourceReceipt.sources.length, 2);
    await publish(store, result.package);
    const read = await readGenericBallotProjection({ store, now, bypassCache: true });
    assert.equal(read.kind, "PROMOTED");
    if (read.kind === "PROMOTED") {
      for (const state of ["nh", "tx"]) assert.equal(genericSourcesForDivisions(read.value, [`ocd-division/country:us/state:${state}`]).length, 1);
    }
    const rerun = await assembleBallotPackage({ directory, store, now });
    assert.deepEqual(rerun.package.payload, result.package.payload);
    assert.deepEqual(rerun.package.sourceReceipt.sources, result.package.sourceReceipt.sources);
    await rm(resolve(directory, "tx.json"));
    const retained = await assembleBallotPackage({ directory, store, now });
    assert.deepEqual(retained.package.payload, result.package.payload);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("candidate websites and measure links are values on the cited official record; every provenance URL still needs a receipt", async () => {
  const state = await fixture();
  ballotOf(state).candidacies[0].websiteUrl = "https://ALICE.Example.org/";
  ballotOf(state).candidacies[1].websiteUrl = "https://www.facebook.com/fixture-candidate";
  const ballot = ballotOf(state);
  ballot.contests.push({ ...ballot.contests[0], id: "fixture-measure", type: "MEASURE", measureTextUrl: "https://records.example.gov/measure.pdf" });
  ballot.measures.push({ id: "fixture-measure-text", contestId: "fixture-measure", questionText: "Fixture measure wording.",
    officialStatement: null, provenance: ballot.contests[0].provenance });
  const input = packageFor(state);
  assert.deepEqual(manualProjectionCandidate(input).semantics.violations, []);
  await publish(new MemoryRoutineDataStore(), input);
  ballotOf(state).candidacies[0].provenance.sourceUrl = "https://unreceipted.example.gov/candidates";
  assert.ok(manualProjectionCandidate(input).semantics.violations.some(problem => problem.includes("unreceipted.example.gov")));
  ballot.candidacies[0].provenance.sourceUrl = ballot.contests[0].provenance.sourceUrl;
  ballot.measureAnalyses = { generatedAt: now, counts: { measures: 1, fetched: 1, extracted: 1, failed: 0 }, analyses: [{
    contestId: "fixture-measure", measureTitle: "Fixture measure", analysisUrl: "https://analysis.example.gov/measure.pdf",
    sourceOrg: "Election authority", retrievedAt: now, contentHash: "c".repeat(64), text: "Official analysis.",
    extraction: "pdf", extractionNote: null }] };
  assert.ok(manualProjectionCandidate(input).semantics.violations.some(problem => problem.includes("analysis.example.gov")));
});

test("only a newer complete list from the same authority replaces candidates and keeps unrelated contests", async () => {
  const scratch = await mkdtemp(resolve(tmpdir(), "ballot-national-"));
  try {
    const next = await fixture(), old = changeSource(await fixture(), "TX", "2026-10-12T00:00:00.000Z", next.sourceReceipt.sources[0].publisher);
    const ballot = ballotOf(old);
    ballot.candidacies[0].familyName = "Earlier";
    ballot.candidacies[0].id = "earlier-candidate";
    ballot.contests.push({ ...ballot.contests[0], id: "omitted-contest" });
    ballot.candidacies.push({ ...ballot.candidacies[0], id: "omitted-candidate", contestId: "omitted-contest" });
    const other = changeSource(await fixture(), "TX", "2026-10-12T00:00:00.000Z", "Fixture county election authority");
    const unrelated = { ...ballotOf(other).contests[0], id: "county-contest", provenance: {
      ...ballotOf(other).contests[0].provenance, sourceUrl: "https://county.example.gov/candidates" } };
    ballot.contests.push(unrelated);
    ballot.candidacies.push({ ...ballotOf(other).candidacies[0], id: "county-candidate", contestId: unrelated.id, provenance: unrelated.provenance });
    const receipt = { ...old.sourceReceipt, sources: [...old.sourceReceipt.sources,
      { ...other.sourceReceipt.sources[0], requestedUrl: unrelated.provenance.sourceUrl!, finalUrl: unrelated.provenance.sourceUrl! }] };
    const store = new MemoryRoutineDataStore();
    await publish(store, packageFor({ ...old, sourceReceipt: receipt }));
    await writeFile(resolve(scratch, "tx.json"), JSON.stringify(next));
    const result = await assembleBallotPackage({ directory: scratch, store, now });
    const merged = payloadOf(result.package).ballots[ballotElectionKey(ballot)];
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(merged.contests.map(row => row.id).sort(), ["county-contest", "fixture-tx-governor", "fixture-tx-senate", "omitted-contest"]);
    assert.deepEqual(merged.candidacies.map(row => row.familyName).sort(), ["Adams", "Adams", "Baker", "Earlier"]);
    assert.equal(result.package.sourceReceipt.sources.length, 3);
    await publish(store, result.package);
    await writeFile(resolve(scratch, "tx.json"), JSON.stringify(old));
    const stale = await assembleBallotPackage({ directory: scratch, store, now });
    assert.deepEqual(stale.package.payload, result.package.payload);
    const conflict = changeSource(await fixture(), "TX", now, "Different election authority");
    await writeFile(resolve(scratch, "tx.json"), JSON.stringify(conflict));
    const refused = await assembleBallotPackage({ directory: scratch, store, now });
    assert.match(refused.skipped[0].reason, /authority conflicts/);
    assert.deepEqual(refused.package.payload, result.package.payload);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("refuses an unavailable published prior", async () => {
  const store = new MemoryRoutineDataStore();
  const broken = { readPromotion: async () => { throw new Error("unavailable"); }, readCandidate: store.readCandidate.bind(store) };
  await assert.rejects(assembleBallotPackage({ store: broken, now }), /BASE_UNAVAILABLE/);
});


test("supplemental contact changes publish without a changed contest list and stale copies cannot erase them", async () => {
  const scratch = await mkdtemp(resolve(tmpdir(), "ballot-contact-"));
  try {
    const state = await fixture(), ballot = ballotOf(state);
    const contact = { candidacyId: ballot.candidacies[0].id, email: "old@example.test",
      sourceUrl: ballot.candidacies[0].provenance.sourceUrl!, sourceOrg: state.sourceReceipt.sources[0].publisher,
      collectedAt: "2026-10-12T00:00:00.000Z" };
    ballot.contacts = [contact];
    const store = new MemoryRoutineDataStore();
    await publish(store, packageFor(state));
    const successor = structuredClone(state);
    ballotOf(successor).contacts = [{ ...contact, email: "new@example.test", collectedAt: now }];
    await writeFile(resolve(scratch, "tx.json"), JSON.stringify(successor));
    const result = await assembleBallotPackage({ directory: scratch, store, now });
    assert.deepEqual(result.skipped, []);
    assert.equal(payloadOf(result.package).ballots[ballotElectionKey(ballot)].contacts?.[0].email, "new@example.test");
    await publish(store, result.package);
    await writeFile(resolve(scratch, "tx.json"), JSON.stringify(state));
    const stale = await assembleBallotPackage({ directory: scratch, store, now });
    assert.equal(payloadOf(stale.package).ballots[ballotElectionKey(ballot)].contacts?.[0].email, "new@example.test");
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
