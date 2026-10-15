import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { BALLOT_STATES, type BallotState } from "../lib/ballot/state-scopes.ts";
import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { completeOfficialBallotContests } from "../lib/civic-data/manual-projections.ts";
import { assembleBallotPackage, type BallotStateFile } from "../scripts/assemble-ballot-package.mts";
import { genericBallotProblems, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";

const baseline = {
  az: "723514489a4af9f353b5fc10a7f4cd46fbd66d5a97bfab9e86194d43c9d8e233",
  nh: "c2e544912272c10f2cbc6558b19e0d0df06ffa23d97c3312c266956e7a325423",
  nj: "811444b772e6238eb429555c71f3657a7d9aee84a21795a4db67876167d054c0",
};
const directory = "data/ballot/2026-general";
const stateFile = async (state: string): Promise<BallotStateFile> =>
  JSON.parse(await readFile(`${directory}/${state.toLowerCase()}.json`, "utf8"));
const assemble = (state: BallotState) => assembleBallotPackage({ state, directory,
  store: new MemoryRoutineDataStore(), now: "2026-10-15T23:59:00.000Z" });

test("all 51 state files publish independently with complete lists or named gaps", async () => {
  const files = (await readdir(directory)).filter(file => /^[a-z]{2}\.json$/.test(file)).sort();
  assert.deepEqual(files, BALLOT_STATES.map(state => `${state.toLowerCase()}.json`).sort());
  for (const state of BALLOT_STATES) {
    const assembled = await assemble(state);
    assert.deepEqual(assembled.skipped, []);
    assert.deepEqual(assembled.merged, [`${state.toLowerCase()}.json`]);
    const payload = assembled.package.payload as GenericBallotProjection;
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
    const assembled = await assemble(state.toUpperCase() as BallotState);
    const payload = assembled.package.payload as GenericBallotProjection;
    for (const [key, expected] of Object.entries(file.ballots)) {
      const actual = payload.ballots[key];
      for (const field of Object.keys(expected) as (keyof BallotSet)[]) {
        assert.deepEqual(actual[field], expected[field], `${state} retains ${field}`);
      }
      assert.deepEqual(actual.heldContests ?? [], expected.heldContests ?? []);
    }
    for (const source of assembled.package.sourceReceipt.sources) {
      assert.ok(file.sourceReceipt.sources.some(row => canonicalCivicDataJson(row) === canonicalCivicDataJson(source)),
        `full source receipt retained: ${source.requestedUrl}`);
    }
    const records = Object.fromEntries((["contests", "candidacies", "removals"] as const).map(key => [key,
      (key === "candidacies" ? [...ballot.candidacies, ...ballot.filingCandidacies ?? []] : ballot[key] ?? [])
        .filter(row => state === "nj" || !("id" in row) || row.id.startsWith(state === "az" ? "ballot-az-pima:" : "ballot-nh-merrimack:"))
        .filter(row => key !== "contests" || !("type" in row) || row.type !== "MEASURE")
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
    assert.equal(completeOfficialBallotContests(payload, assembled.package.sourceReceipt).length,
      ballot.contests.filter(contest => contest.type === "CANDIDACY").length);
    if (state === "az") {
      assert.deepEqual(ballot.contests.filter(row => row.type === "MEASURE").map(row => row.id).sort(),
        [141, 142, 144, 316, 317, 318, 319, 320].map(number => `ballot-az-pima:prop-${number}`));
      assert.equal(ballot.measureRecords?.length, 8);
      assert.ok(ballot.measures.every(row => row.officialText && row.voterGuide));
      assert.deepEqual(ballot.heldContests?.map(row => row.id).sort(), [143, 145, 212].map(number => `ballot-az-pima:prop-${number}`));
      const localDirectory = "data/ballot/measures/2026-general/AZ";
      const locals = await Promise.all((await readdir(localDirectory)).map(async name => {
        const held = JSON.parse(await readFile(`${localDirectory}/${name}`, "utf8"));
        assert.equal(name, `${encodeURIComponent(held.payload.ocdId)}.json`);
        assert.equal(held.contractId, "ballot-measures");
        const local = Object.values(held.payload.ballots)[0] as BallotSet;
        assert.ok(local.contests.every(row => row.ocdId === held.payload.ocdId));
        assert.ok(local.measures.every(row => row.officialText && row.voterGuide));
        assert.equal(local.measureRecords?.length, 1);
        return local.contests[0].id;
      }));
      assert.deepEqual(locals.sort(), [423, 425, 428, 429].map(number => `ballot-az-pima:prop-${number}`));
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
    }
  });
}

test("Illinois, West Virginia and Wisconsin publish verified lists while Illinois names four gaps", async () => {
  for (const [state, count, held] of [["IL", 159, 4], ["WV", 122, 0], ["WI", 8, 0]] as const) {
    const result = await assemble(state);
    const payload = result.package.payload as GenericBallotProjection;
    assert.equal(completeOfficialBallotContests(payload, result.package.sourceReceipt).length, count, state);
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
