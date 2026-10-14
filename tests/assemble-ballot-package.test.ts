import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
    const directory = resolve(scratch, "states"), out = resolve(scratch, "ballot package's.json");
    await mkdir(directory);
    const store = new MemoryRoutineDataStore();
    const prior = changeSource(await fixture(), "NH", "2026-10-12T00:00:00.000Z");
    await publish(store, packageFor(prior));
    await writeFile(resolve(directory, "tx.json"), JSON.stringify(await fixture()));
    const bad = changeSource(await fixture(), "OH", now);
    ballotOf(bad).contests[0].candidateListComplete = false;
    await writeFile(resolve(directory, "oh.json"), JSON.stringify(bad));
    await writeFile(resolve(directory, "az.json"), "{");
    const result = await assembleBallotPackage({ directory, out, store, now });
    assert.deepEqual(result.merged, ["tx.json"]);
    assert.deepEqual(result.skipped.map(row => row.file), ["az.json", "oh.json"]);
    assert.match(result.skipped[1].reason, /complete official/);
    assert.deepEqual(Object.keys(payloadOf(result.package).ballots).sort(), ["NH:fixture-2026-general", "TX:fixture-2026-general"]);
    assert.deepEqual(payloadOf(result.package).ballots["NH:fixture-2026-general"], ballotOf(prior));
    assert.equal(payloadOf(result.package).ballots["TX:fixture-2026-general"].contests.length, 2);
    assert.equal(result.package.sourceReceipt.sources.length, 2);
    assert.deepEqual(JSON.parse(await readFile(out, "utf8")), result.package);
    assert.equal(result.promoteCommand, `pnpm exec tsx scripts/promote-manual-civic-projection.mts --contract=ballot-contests --package='${out.replaceAll("'", "'\\''")}'`);
    await publish(store, result.package);
    const read = await readGenericBallotProjection({ store, now, bypassCache: true });
    assert.equal(read.kind, "PROMOTED");
    if (read.kind === "PROMOTED") {
      for (const state of ["nh", "tx"]) assert.equal(genericSourcesForDivisions(read.value, [`ocd-division/country:us/state:${state}`]).length, 1);
    }
    const rerun = await assembleBallotPackage({ directory, out, store, now });
    assert.deepEqual(rerun.package.payload, result.package.payload);
    assert.deepEqual(rerun.package.sourceReceipt.sources, result.package.sourceReceipt.sources);
    await rm(resolve(directory, "tx.json"));
    const retained = await assembleBallotPackage({ directory, out, store, now });
    assert.deepEqual(retained.package.payload, result.package.payload);
  } finally { await rm(scratch, { recursive: true, force: true }); }
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
    const result = await assembleBallotPackage({ directory: scratch, out: resolve(scratch, "package.out"), store, now });
    const merged = payloadOf(result.package).ballots[ballotElectionKey(ballot)];
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(merged.contests.map(row => row.id).sort(), ["county-contest", "fixture-tx-governor", "fixture-tx-senate", "omitted-contest"]);
    assert.deepEqual(merged.candidacies.map(row => row.familyName).sort(), ["Adams", "Adams", "Baker", "Earlier"]);
    assert.equal(result.package.sourceReceipt.sources.length, 3);
    await publish(store, result.package);
    await writeFile(resolve(scratch, "tx.json"), JSON.stringify(old));
    const stale = await assembleBallotPackage({ directory: scratch, out: resolve(scratch, "package.out"), store, now });
    assert.deepEqual(stale.package.payload, result.package.payload);
    const conflict = changeSource(await fixture(), "TX", now, "Different election authority");
    await writeFile(resolve(scratch, "tx.json"), JSON.stringify(conflict));
    const refused = await assembleBallotPackage({ directory: scratch, out: resolve(scratch, "package.out"), store, now });
    assert.match(refused.skipped[0].reason, /authority conflicts/);
    assert.deepEqual(refused.package.payload, result.package.payload);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("refuses an unavailable prior and repository output including symlinks", async () => {
  const scratch = await mkdtemp(resolve(tmpdir(), "ballot-national-"));
  try {
    const store = new MemoryRoutineDataStore();
    await assert.rejects(assembleBallotPackage({ out: resolve("ballot-package.json"), store, now }), /outside the repository/);
    await symlink(process.cwd(), resolve(scratch, "repo"));
    await assert.rejects(assembleBallotPackage({ out: resolve(scratch, "repo/ballot-package.json"), store, now }), /outside the repository/);
    const broken = { readPromotion: async () => { throw new Error("unavailable"); }, readCandidate: store.readCandidate.bind(store) };
    await assert.rejects(assembleBallotPackage({ out: resolve(scratch, "package.out"), store: broken, now }), /BASE_UNAVAILABLE/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
