import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { assembleBallotPackage, type BallotStateFile } from "../scripts/assemble-ballot-package.mts";
import { ballotElectionKey, readGenericBallotProjection, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { genericSourcesForDivisions } from "../lib/ballot/reader-sources.ts";
import { manualProjectionCandidate, type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { validateBallotMeasureEvidence } from "../lib/ballot/measure-evidence.ts";
import type { MeasureSourceReference } from "../lib/ballot/types.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";

const evidenceStore = new MemoryEvidenceStore();
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
    ballotOf(bad).contests[0].candidateListComplete = false;
    await writeFile(resolve(directory, "oh.json"), JSON.stringify(bad));
    await writeFile(resolve(directory, "az.json"), "{");
    const result = await assembleBallotPackage({ evidenceStore, directory, store, now });
    assert.deepEqual(result.merged, ["tx.json"]);
    assert.deepEqual(result.skipped.map(row => row.file), ["az.json", "oh.json"]);
    assert.match(result.skipped[1].reason, /complete official/);
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
    const rerun = await assembleBallotPackage({ evidenceStore, directory, store, now });
    assert.deepEqual(rerun.package.payload, result.package.payload);
    assert.deepEqual(rerun.package.sourceReceipt.sources, result.package.sourceReceipt.sources);
    await rm(resolve(directory, "tx.json"));
    const retained = await assembleBallotPackage({ evidenceStore, directory, store, now });
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
    const result = await assembleBallotPackage({ evidenceStore, directory: scratch, store, now });
    const merged = payloadOf(result.package).ballots[ballotElectionKey(ballot)];
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(merged.contests.map(row => row.id).sort(), ["county-contest", "fixture-tx-governor", "fixture-tx-senate", "omitted-contest"]);
    assert.deepEqual(merged.candidacies.map(row => row.familyName).sort(), ["Adams", "Adams", "Baker", "Earlier"]);
    assert.equal(result.package.sourceReceipt.sources.length, 3);
    await publish(store, result.package);
    await writeFile(resolve(scratch, "tx.json"), JSON.stringify(old));
    const stale = await assembleBallotPackage({ evidenceStore, directory: scratch, store, now });
    assert.deepEqual(stale.package.payload, result.package.payload);
    const conflict = changeSource(await fixture(), "TX", now, "Different election authority");
    await writeFile(resolve(scratch, "tx.json"), JSON.stringify(conflict));
    const refused = await assembleBallotPackage({ evidenceStore, directory: scratch, store, now });
    assert.match(refused.skipped[0].reason, /authority conflicts/);
    assert.deepEqual(refused.package.payload, result.package.payload);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("refuses an unavailable published prior", async () => {
  const store = new MemoryRoutineDataStore();
  const broken = { readPromotion: async () => { throw new Error("unavailable"); }, readCandidate: store.readCandidate.bind(store) };
  await assert.rejects(assembleBallotPackage({ evidenceStore, store: broken, now }), /BASE_UNAVAILABLE/);
});

test("new full text and guide publish without changing the ballot question's collection clock", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "measure-enrichment-"));
  try {
    const state = await fixture(), ballot = ballotOf(state), store = new MemoryRoutineDataStore();
    const contest = { ...ballot.contests[0], id: "fixture-measure", title: "Amendment 1", type: "MEASURE" as const,
      measureTextUrl: "https://elections.example.gov/tx/amendment-1" };
    ballot.contests.push(contest);
    ballot.measures.push({ id: "fixture-measure-text", contestId: contest.id, questionText: "Shall the fund be established?",
      officialStatement: null, provenance: contest.provenance });
    ballot.coverageNotes = ["Full text and official explanation are still owed."];
    await publish(store, packageFor(state));
    const source = async (text: string, sourceUrl: string): Promise<MeasureSourceReference> => {
      const sourceHash = createHash("sha256").update(text).digest("hex"), bytes = Buffer.from(text);
      const vault = { key: `project/freshness/source/elections/2026/10/13/measure/sha256-${sourceHash}.txt`, byteLength: bytes.length, contentType: "text/plain" };
      await evidenceStore.put(vault.key, bytes, { ...vault, contentHash: `sha256-${sourceHash}`,
        custom: { tier: "RAW", canonicalUrl: sourceUrl } });
      return { sourceUrl, sourceHash, retrievedAt: now, publisher: contest.provenance.sourceOrg, vault };
    };
    const legalText = "Section 1. A fund is established.";
    const officialText = await source(legalText, contest.measureTextUrl);
    const voterGuide = { ...await source("The state would establish a fund. Supporters favor the fund. Opponents oppose the cost.",
      "https://elections.example.gov/tx/voter-guide"), summary: "The state would establish a fund.",
      argumentsFor: ["Supporters favor the fund."], argumentsAgainst: ["Opponents oppose the cost."] };
    Object.assign(ballot.measures[0], { officialText, voterGuide });
    ballot.coverageNotes = ["Full official text and the state explanation are held."];
    ballot.measureRecords = [{ contestId: contest.id, whatItDoes: legalText, yesMeans: null, noMeans: null,
      parts: [{ id: `${contest.id}#section-1`, number: "1", kind: "PROGRAM", label: "Section 1", what: legalText }],
      sourceUrl: officialText.sourceUrl, sourceHash: officialText.sourceHash, writtenAt: now }];
    const enriched = { ...state, sourceReceipt: { ...state.sourceReceipt, reviewedAt: now, sources: [
      ...state.sourceReceipt.sources, ...[officialText, voterGuide].map(source => ({ ...state.sourceReceipt.sources[0],
        requestedUrl: source.sourceUrl, finalUrl: source.sourceUrl, retrievedAt: now, rawHash: source.sourceHash })),
    ] } };
    await writeFile(resolve(directory, "tx.json"), JSON.stringify(enriched));
    const result = await assembleBallotPackage({ evidenceStore, directory, store, now });
    assert.deepEqual(result.skipped, []);
    const held = Object.values(payloadOf(result.package).ballots)[0];
    assert.deepEqual(held.measures[0].voterGuide, voterGuide);
    assert.deepEqual(held.measureRecords, ballot.measureRecords);
    assert.deepEqual(held.coverageNotes, ballot.coverageNotes);
    assert.equal(held.contests.find(row => row.id === contest.id)?.provenance.collectedAt, contest.provenance.collectedAt);
    await publish(store, result.package);
    const reads: string[] = [], tracked = { put: evidenceStore.put.bind(evidenceStore), head: evidenceStore.head.bind(evidenceStore),
      list: evidenceStore.list.bind(evidenceStore), get: async (key: string) => { reads.push(key); return evidenceStore.get(key); } };
    assert.deepEqual((await assembleBallotPackage({ evidenceStore: tracked, directory, store, now })).package.payload, result.package.payload);
    assert.deepEqual(reads, []);
    const stale = structuredClone(enriched);
    delete ballotOf(stale).measures[0].officialText;
    delete ballotOf(stale).measures[0].voterGuide;
    delete ballotOf(stale).measureRecords;
    ballotOf(stale).coverageNotes = ["Full text and official explanation are still owed."];
    await writeFile(resolve(directory, "tx.json"), JSON.stringify(stale));
    assert.deepEqual((await assembleBallotPackage({ evidenceStore: tracked, directory, store, now })).package.payload, result.package.payload);
    assert.deepEqual(reads, []);
    voterGuide.argumentsFor.push("An invented argument.");
    await assert.rejects(validateBallotMeasureEvidence(ballotOf(enriched), evidenceStore), /guide|argument/i);
    await writeFile(resolve(directory, "tx.json"), JSON.stringify(enriched));
    await writeFile(resolve(directory, "nh.json"), JSON.stringify(changeSource(await fixture(), "NH", now)));
    const refused = await assembleBallotPackage({ evidenceStore: tracked, directory, store, now });
    assert.deepEqual(reads, [voterGuide.vault.key]);
    assert.deepEqual(refused.skipped.map(row => row.file), ["tx.json"]);
    assert.deepEqual(payloadOf(refused.package).ballots[ballotElectionKey(ballot)], held);
    assert.deepEqual(refused.merged, ["nh.json"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
