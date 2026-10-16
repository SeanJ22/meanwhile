import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
type BallotStateFile = Awaited<ReturnType<typeof import("../lib/ballot/state-file.ts").readBallotStateFile>>;
import { stateBallotScope, stateBallotContractId } from "../lib/ballot/state-scopes.ts";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { publishBallotState, runBallotState } from "./helpers/publish-ballot-state.ts";
import { ballotElectionKey, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { genericSourcesForDivisions } from "../lib/ballot/reader-sources.ts";
import { manualProjectionCandidate, type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { contestsForDivisions } from "../lib/sources/ballot-nj-morris/index.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";

const now = "2026-10-13T12:00:00.000Z";
const fixture = async () => JSON.parse(await readFile("tests/fixtures/ballot-national/tx.json", "utf8")) as BallotStateFile;
const ballotOf = (input: BallotStateFile) => Object.values(input.ballots)[0];
const packageFor = (state: BallotStateFile): ManualProjectionPackage => ({ contractId: stateBallotContractId("ballot-contests", ballotOf(state).election.state), version: "fixture",
  sourceThrough: state.sourceReceipt.reviewedAt, sourceReceipt: state.sourceReceipt, payload: { kind: "ballot-contests", ballots: state.ballots } });

async function publish(store: MemoryRoutineDataStore, input: ManualProjectionPackage) {
  const result = await processRegisteredManualCandidate(store, input.contractId, manualProjectionCandidate(input), now);
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

test("assembles only the named state and never opens another state's malformed file or promotion", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ballot-state-"));
  try {
    const store = new MemoryRoutineDataStore();
    const prior = changeSource(await fixture(), "NH", "2026-10-12T00:00:00.000Z");
    await publish(store, packageFor(prior));
    await writeFile(resolve(directory, "tx.json"), JSON.stringify(await fixture()));
    await writeFile(resolve(directory, "az.json"), "{");
    const reads: string[] = [];
    const readPromotion = store.readPromotion.bind(store);
    store.readPromotion = async (recordClass, scope) => { reads.push(scope); return readPromotion(recordClass, scope); };
    const result = await publishBallotState({ state: "TX", directory, store, now });
    assert.deepEqual(result.merged, ["tx.json"]); assert.deepEqual(result.skipped, []);
    assert.deepEqual(Object.keys(result.payload.ballots), ["TX:fixture-2026-general"]);
    assert.ok(reads.every(scope => scope === "US-TX:state-election-ballots"));
    assert.equal(result.sourceReceipt.sources.length, 1);
    const read = await readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", "TX"), { store, now, bypassCache: true });
    assert.equal(read.kind, "PROMOTED");
    const rerun = await publishBallotState({ state: "TX", directory, store, now });
    assert.deepEqual(rerun.payload, result.payload);
    await rm(resolve(directory, "tx.json"));
    await assert.rejects(publishBallotState({ state: "TX", directory, store, now }), /ENOENT/);
    assert.ok(await readPromotion("BALLOT_CANDIDACY", "US-NH:state-election-ballots"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a successor streams candidates before contests, uses prior proof metadata, and releases the prior envelope", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ballot-state-stream-"));
  try {
    const store = new MemoryRoutineDataStore(), state = await fixture();
    await publish(store, packageFor(await fixture()));
    const ballot = ballotOf(state), { candidacies, ...rest } = ballot;
    candidacies[0].familyName = "Corrected";
    await writeFile(resolve(directory, "tx.json"), JSON.stringify({ sourceReceipt: state.sourceReceipt,
      ballots: { [ballotElectionKey(ballot)]: { candidacies, ...rest } } }));
    let readingPrior = false;
    const readCandidate = store.readCandidate.bind(store), readCandidateProof = store.readCandidateProof.bind(store);
    store.readCandidate = async id => { assert.equal(readingPrior, false, "prior reads must not load a full candidate"); return readCandidate(id); };
    store.readCandidateProof = async id => { assert.equal(readingPrior, false, "prior reads must not load a full proof"); return readCandidateProof(id); };
    const readProof = store.readPublishedCandidateMetadata.bind(store);
    let proofReads = 0, priorProofReads = 0;
    store.readPublishedCandidateMetadata = async id => { proofReads++; return readProof(id); };
    const stages: string[] = [];
    const result = await publishBallotState({ state: "TX", directory, store, now,
      onStage: (stage, phase) => {
        stages.push(`${stage}:${phase}`);
        if (stage === "prior-state") { readingPrior = phase === "start"; if (phase === "end") priorProofReads = proofReads; }
      } });
    assert.equal(Object.values(result.payload.ballots)[0].candidacies[0].familyName, "Corrected");
    assert.equal("prior" in result, false);
    assert.ok(result.versionId);
    assert.equal(priorProofReads, 1);
    assert.deepEqual(stages, ["input-metadata", "prior-state", "state-contests", "state-records", "candidate-build", "promotion"]
      .flatMap(stage => [`${stage}:start`, `${stage}:end`]));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("streaming input refuses repeated contest and candidate identities instead of silently collapsing them", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ballot-state-duplicates-"));
  try {
    for (const field of ["contests", "candidacies"] as const) {
      const state = await fixture(), ballot = ballotOf(state);
      if (field === "contests") ballot.contests.push({ ...ballot.contests[0] });
      else ballot.candidacies.push({ ...ballot.candidacies[0], familyName: "Contradiction" });
      await writeFile(resolve(directory, "tx.json"), JSON.stringify(state));
      const failed = await runBallotState({ state: "TX", directory, store: new MemoryRoutineDataStore(), now });
      assert.equal(failed.report.status, "HELD");
      assert.match(failed.report.reason!, /INPUT_IDENTITY_DUPLICATED/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("streaming input refuses orphan candidacies and duplicated current/filing identities before filtering", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ballot-state-joins-"));
  try {
    for (const issue of ["orphan", "filing"] as const) {
      const state = await fixture(), ballot = ballotOf(state);
      if (issue === "orphan") ballot.candidacies.push({ ...ballot.candidacies[0], id: "orphan", contestId: "missing" });
      else ballot.filingCandidacies = [{ ...ballot.candidacies[0] }];
      await writeFile(resolve(directory, "tx.json"), JSON.stringify(state));
      const failed = await runBallotState({ state: "TX", directory, store: new MemoryRoutineDataStore(), now });
      assert.equal(failed.report.status, "HELD");
      assert.match(failed.report.reason!, issue === "orphan" ? /INPUT_CONTEST_MISSING/ : /INPUT_IDENTITY_DUPLICATED/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
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
  await publish(new MemoryRoutineDataStore(), structuredClone(input));
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
    const result = await publishBallotState({ state: "TX", directory: scratch, store, now });
    const merged = result.payload.ballots[ballotElectionKey(ballot)];
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(merged.contests.map(row => row.id).sort(), ["county-contest", "fixture-tx-governor", "fixture-tx-senate", "omitted-contest"]);
    assert.deepEqual(merged.candidacies.map(row => row.familyName).sort(), ["Adams", "Adams", "Baker", "Earlier"]);
    assert.equal(result.sourceReceipt.sources.length, 3);
    await writeFile(resolve(scratch, "tx.json"), JSON.stringify(old));
    const stale = await publishBallotState({ state: "TX", directory: scratch, store, now });
    assert.deepEqual(stale.payload, result.payload);
    const conflict = changeSource(await fixture(), "TX", now, "Different election authority");
    await writeFile(resolve(scratch, "tx.json"), JSON.stringify(conflict));
    const failed = await runBallotState({ state: "TX", directory: scratch, store, now });
    assert.equal(failed.report.status, "HELD");
    assert.match(failed.report.reason!, /authority conflicts/);
    assert.equal((await store.readPromotion("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", "TX")))?.versionId, result.versionId);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("refuses an unavailable published prior", async () => {
  const store = new MemoryRoutineDataStore();
  store.readPromotion = async () => { throw new Error("unavailable"); };
  const failed = await runBallotState({ state: "TX", directory: "tests/fixtures/ballot-national", store, now });
  assert.equal(failed.report.status, "HELD");
  assert.match(failed.report.reason!, /BASE_UNAVAILABLE/);
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
    const result = await publishBallotState({ state: "TX", directory: scratch, store, now });
    assert.deepEqual(result.skipped, []);
    assert.equal(result.payload.ballots[ballotElectionKey(ballot)].contacts?.[0].email, "new@example.test");
    await writeFile(resolve(scratch, "tx.json"), JSON.stringify(state));
    const stale = await publishBallotState({ state: "TX", directory: scratch, store, now });
    assert.equal(stale.payload.ballots[ballotElectionKey(ballot)].contacts?.[0].email, "new@example.test");
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("a state with only empty contests publishes scoped gaps, then verified candidates clear them without losing other states", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ballot-holds-"));
  try {
    const state = await fixture(), ballot = ballotOf(state);
    for (const contest of ballot.contests) contest.candidateListComplete = false;
    ballot.contests[1].ocdId = "ocd-division/country:us/state:tx/cd:38";
    ballot.candidacies = [];
    await writeFile(resolve(directory, "tx.json"), JSON.stringify(state));
    const store = new MemoryRoutineDataStore();
    const held = await publishBallotState({ state: "TX", directory, store, now });
    assert.deepEqual(held.skipped, []);
    const heldBallot = held.payload.ballots[ballotElectionKey(ballot)];
    assert.deepEqual(heldBallot.contests, []);
    assert.deepEqual(heldBallot.candidacies, []);
    assert.equal(heldBallot.heldContests?.length, 2);
    assert.equal(contestsForDivisions(heldBallot, ["ocd-division/country:us/state:tx/cd:37"]).heldContests?.length, 1);
    assert.equal(contestsForDivisions(heldBallot, ["ocd-division/country:us/state:tx/cd:38"]).heldContests?.length, 2);
    assert.equal(genericSourcesForDivisions(held.payload, ["ocd-division/country:us/state:tx"]).length, 1);
    const complete = changeSource(await fixture(), "TX", now, state.sourceReceipt.sources[0].publisher);
    ballotOf(complete).contests[1].ocdId = ballot.contests[1].ocdId;
    await writeFile(resolve(directory, "tx.json"), JSON.stringify(complete));
    const resolved = await publishBallotState({ state: "TX", directory, store, now });
    assert.deepEqual(resolved.heldContests, []);
    assert.equal(resolved.payload.ballots[ballotElectionKey(ballot)].contests.length, 2);
    await writeFile(resolve(directory, "tx.json"), JSON.stringify(state));
    const stale = await publishBallotState({ state: "TX", directory, store, now });
    assert.deepEqual(stale.payload, resolved.payload);
    assert.deepEqual(stale.heldContests, []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("incomplete lists remain named, same-date complete corrections publish, and later partial input retains the complete prior", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ballot-holds-"));
  try {
    const state = await fixture(), store = new MemoryRoutineDataStore();
    ballotOf(state).contests[0].candidateListComplete = false;
    await writeFile(resolve(directory, "tx.json"), JSON.stringify(state));
    const held = await publishBallotState({ state: "TX", directory, store, now });
    assert.deepEqual(held.heldContests.map(row => row.contestId), ["fixture-tx-governor"]);
    assert.deepEqual(Object.values(held.payload.ballots)[0].candidacies.map(row => row.familyName), ["Baker"]);
    const complete = await fixture();
    await writeFile(resolve(directory, "tx.json"), JSON.stringify(complete));
    const corrected = await publishBallotState({ state: "TX", directory, store, now });
    assert.deepEqual(corrected.heldContests, []);
    assert.equal(Object.values(corrected.payload.ballots)[0].candidacies.length, 2);
    await writeFile(resolve(directory, "tx.json"), JSON.stringify(state));
    const retained = await publishBallotState({ state: "TX", directory, store, now });
    assert.deepEqual(retained.payload, corrected.payload);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
