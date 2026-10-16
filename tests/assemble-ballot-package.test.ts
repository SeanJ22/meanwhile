import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { stateBallotScope, stateBallotContractId, BALLOT_STATES, type BallotState } from "../lib/civic-data/state-scopes.ts";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { ballotElectionKey, type GenericBallotProjection, genericBallotProblems } from "../lib/ballot/generic-projection.ts";
import { genericSourcesForDivisions } from "../lib/ballot/reader-sources.ts";
import { manualProjectionCandidate, type ManualProjectionPackage, completeOfficialBallotContests } from "../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { contestsForDivisions } from "../lib/sources/ballot-nj-morris/index.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { type BallotSet } from "../lib/ballot/types.ts";
import { runBallotPublication } from "../scripts/assemble-ballot-package.mts";

async function runBallotState(options: Parameters<typeof runBallotPublication>[0]) {
  const environment = { WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local", DATABASE_URL: "postgresql://local:local@staging.invalid/reader",
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@staging.invalid/control", WTP_SANCTIONED_WRITE: "routine-civic-data-promotion" };
  const prior = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  try { return await runBallotPublication(options); }
  finally { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

async function publishBallotState(options: Parameters<typeof runBallotPublication>[0]) {
  const store = options.store ?? new MemoryRoutineDataStore();
  const result = await runBallotState({ ...options, store });
  assert.equal(result.report.status, "PUBLISHED", result.report.reason ?? JSON.stringify(result.receipt));
  const pointer = await store.readPromotion<GenericBallotProjection>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", options.state));
  assert.ok(pointer);
  assert.equal(pointer.versionId, result.report.versionId);
  const saved = await store.readCandidate(pointer.versionId);
  assert.ok(saved);
  const sourceReceipt = saved.candidate.retrieval.manualSourceReceipt;
  assert.ok(sourceReceipt);
  return { ...result.report, heldContests: result.report.heldContests ?? [], payload: pointer.payload, candidate: saved.candidate, sourceReceipt };
}

type BallotStateFile = Awaited<ReturnType<typeof import("../lib/ballot/state-file.ts").readBallotStateFile>>;

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
  const later = structuredClone(state), analysed = structuredClone(state);
  await publish(new MemoryRoutineDataStore(), input);
  ballotOf(later).candidacies[0].provenance.sourceUrl = "https://unreceipted.example.gov/candidates";
  assert.ok(manualProjectionCandidate(packageFor(later)).semantics.violations.some(problem => problem.includes("unreceipted.example.gov")));
  ballotOf(analysed).measureAnalyses = { generatedAt: now, counts: { measures: 1, fetched: 1, extracted: 1, failed: 0 }, analyses: [{
    contestId: "fixture-measure", measureTitle: "Fixture measure", analysisUrl: "https://analysis.example.gov/measure.pdf",
    sourceOrg: "Election authority", retrievedAt: now, contentHash: "c".repeat(64), text: "Official analysis.",
    extraction: "pdf", extractionNote: null }] };
  assert.ok(manualProjectionCandidate(packageFor(analysed)).semantics.violations.some(problem => problem.includes("analysis.example.gov")));
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

{
  const baseline = {
    az: "f78aa7a6260e4b5c34be091aef15f6943cff7ac2a50a847a19edc6e61329e904",
    nh: "d7b42860429c6f8036422de3bd454af6caf368d06e97b2602d43cb3687e01019",
    nj: "e057d3890a9156816d39b7d3145db49b5c122cc73701f37a24722e4fb217468f",
  };

  const directory = "data/ballot/2026-general";

  const stateFile = async (state: string): Promise<BallotStateFile> =>
    JSON.parse(await readFile(`${directory}/${state.toLowerCase()}.json`, "utf8"));

  const publishState = (state: BallotState) => publishBallotState({ state, directory,
    store: new MemoryRoutineDataStore(), now: "2026-10-15T23:59:00.000Z" });

  test("all 51 state files publish independently with complete lists or named gaps", async () => {
    const files = (await readdir(directory)).filter(file => /^[a-z]{2}\.json$/.test(file)).sort();
    assert.deepEqual(files, BALLOT_STATES.map(state => `${state.toLowerCase()}.json`).sort());
    for (const state of BALLOT_STATES) {
      const assembled = await publishState(state);
      assert.deepEqual(assembled.skipped, []);
      assert.deepEqual(assembled.merged, [`${state.toLowerCase()}.json`]);
      const payload = assembled.payload as GenericBallotProjection;
      assert.deepEqual(genericBallotProblems(payload, state), [], state);
      assert.ok(Object.values(payload.ballots).every(ballot => ballot.election.state === state));
      assert.ok(Object.values(payload.ballots).every(ballot => ballot.contests.every(contest =>
        contest.type === "MEASURE" || contest.candidateListComplete === true)));
      assert.ok(assembled.heldContests.every(contest => contest.state === state && contest.title && contest.reason));
    }
  });

  for (const state of ["az", "nh", "nj"] as const) {
    test(`${state.toUpperCase()} preserves original ballot facts and their sources in its state publication`, async () => {
      const file = await stateFile(state);
      const ballot = Object.values(file.ballots)[0];
      const assembled = await publishState(state.toUpperCase() as BallotState);
      const payload = assembled.payload as GenericBallotProjection;
      for (const [key, expected] of Object.entries(file.ballots)) {
        const actual = payload.ballots[key];
        for (const field of Object.keys(expected) as (keyof BallotSet)[]) {
          assert.deepEqual(actual[field], expected[field], `${state} retains ${field}`);
        }
        assert.deepEqual(actual.heldContests ?? [], []);
      }
      for (const source of assembled.sourceReceipt.sources) {
        assert.ok(file.sourceReceipt.sources.some(row => canonicalCivicDataJson(row) === canonicalCivicDataJson(source)),
          `full source receipt retained: ${source.requestedUrl}`);
      }
      const records = Object.fromEntries((["contests", "candidacies", "measures", "absences", "removals"] as const).map(key => [key,
        (key === "candidacies" ? [...ballot.candidacies, ...ballot.filingCandidacies ?? []] : ballot[key] ?? [])
          .filter(row => state === "nj" || !("id" in row) || row.id.startsWith(state === "az" ? "ballot-az-pima:" : "ballot-nh-merrimack:"))
          .filter(row => state !== "nh" || key !== "absences" || !("ocdId" in row) || !row.ocdId.includes("school_district:"))
          .map(row => {
            const copy = { ...row } as Record<string, unknown>;
            delete copy.candidateListComplete;
            delete copy.scopeNote;
            delete copy.identity;
            delete copy.filing;
            if (key === "contests") delete copy.provenance;
            if (state === "nh" && key === "candidacies" && "filing" in row && row.filing) copy.provenance = row.filing.provenance;
            if (state === "nj" && copy.provenance) {
              const provenance = { ...copy.provenance } as Record<string, unknown>;
              delete provenance.collectedAt;
              delete provenance.verifiedAt;
              copy.provenance = provenance;
            }
            return copy;
          }).sort((a, b) => canonicalCivicDataJson(a).localeCompare(canonicalCivicDataJson(b))),
      ]));
      assert.equal(createHash("sha256").update(canonicalCivicDataJson(records)).digest("hex"), baseline[state]);
      assert.deepEqual(genericBallotProblems(payload, state.toUpperCase() as BallotState), []);
      assert.deepEqual(assembled.candidate.normalization.missingRequiredFields, []);
      assert.deepEqual(assembled.candidate.semantics.violations, []);
      assert.equal(completeOfficialBallotContests(payload, assembled.sourceReceipt).length,
        ballot.contests.filter(contest => contest.type === "CANDIDACY").length);
      if (state === "az") {
        assert.equal(ballot.measureRecords?.length, 15);
        assert.equal(ballot.measureAnalyses?.analyses.length, 11);
        assert.equal("identityRegistry" in ballot, false);
        assert.equal("candidateFilings" in ballot, false);
        const candidates = [...ballot.candidacies, ...ballot.filingCandidacies ?? []];
        assert.equal(candidates.filter(row => row.identity).length, 274);
        assert.equal(candidates.filter(row => row.filing).length, 266);
        assert.equal(new Set(candidates.map(row => row.id)).size, candidates.length);
        assert.equal(ballot.filingCandidacies?.length, 78);
        assert.ok(ballot.lineupReconciliation?.rows.length);
        for (const [family, count] of [["cd", 9], ["sldu", 30], ["sldl", 30]] as const) {
          assert.equal(new Set(ballot.contests.filter(contest => contest.ocdId.includes(`/${family}:`)).map(contest => contest.ocdId)).size, count, family);
        }
        const house = ballot.contests.find(contest => contest.ocdId === "ocd-division/country:us/state:az/cd:1")!;
        assert.ok(ballot.candidacies.some(row => row.contestId === house.id && /Shah/i.test(row.familyName)));
        assert.ok(ballot.candidacies.some(row => row.contestId === house.id && /Feely/i.test(row.familyName)));
      }
      if (state === "nh") {
        assert.equal(ballot.candidacies.length, 27);
        assert.equal(ballot.filingCandidacies?.length, 25);
        assert.ok(ballot.absences.some(row => row.ocdId.includes("school_district:") && /not yet been acquired/.test(row.statement)));
      }
      if (state === "nj") {
        assert.equal(ballot.contacts?.length, 275);
        assert.ok(ballot.contacts?.every(contact => !("filedAddress" in contact)));
        assert.deepEqual(ballot.sourceAggregates, [{
          id: "cv-6b34ecf034982a30594c3aca512cb61a", sourceId: "nj-morris-county-clerk", scope: "US-NJ:county:morris:2026-general",
          rawDocumentCount: 3,
          retrieval: { rawHash: "f4f38c7cc25b42337a6c88e716edb218b98125dca629b3720e337a02d9c04e81",
            finalUrl: "https://www.morriscountyclerk.org/Elections/Current-Election-Candidates", succeeded: true, httpStatus: 200,
            retrievedAt: "2026-10-15T21:30:53.825Z", requestedUrl: "https://www.morriscountyclerk.org/Elections/Current-Election-Candidates" },
        }]);
        assert.ok(assembled.sourceReceipt.sources.every(source => source.rawHash !== ballot.sourceAggregates![0].retrieval.rawHash));
      }
    });
  }

  test("Illinois, West Virginia and Wisconsin publish verified lists while Illinois names four gaps", async () => {
    for (const [state, count, held] of [["IL", 159, 4], ["WV", 122, 0], ["WI", 8, 0]] as const) {
      const result = await publishState(state);
      const payload = result.payload as GenericBallotProjection;
      assert.equal(completeOfficialBallotContests(payload, result.sourceReceipt).length, count, state);
      assert.equal(result.heldContests.length, held, state);
      if (state === "WV") {
        const candidates = Object.values(payload.ballots).flatMap(ballot => ballot.candidacies);
        assert.equal(candidates.length, 243);
        for (const name of ["Legg", "Cantrell", "Louisos", "Martinez", "DEHART", "HENDERSHOT JR"]) {
          assert.ok(candidates.some(row => row.familyName.toLowerCase() === name.toLowerCase()), name);
        }
      }
    }
  });
}
