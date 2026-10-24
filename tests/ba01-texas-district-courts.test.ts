import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import type { BallotSet } from "../lib/ballot/types.ts";

const source = JSON.parse(readFileSync("data/ballot/2026-general/tx.json", "utf8"));
const ballot = Object.values(source.ballots)[0] as BallotSet;
const state = "ocd-division/country:us/state:tx";

test("Travis readers receive its ten certified district judges without another county's courts", () => {
  const result = ballotForDivisions(ballot, [`${state}/county:travis`]);
  const districtJudges = result.contests.filter(row => row.id.startsWith("tx-ba01-2026-district-judge-"));
  assert.deepEqual(new Set(districtJudges.map(row => row.ocdId)), new Set(
    [147, 201, 250, 261, 299, 331, 403, 419, 455, 459].map(number => `${state}/judicial_district:${number}`)));
  assert.equal(ballotForDivisions(ballot, [state]).contests.some(row => row.id.startsWith("tx-ba01-2026-district-judge-")), false);
  assert.equal(districtJudges.some(row => row.ocdId === `${state}/judicial_district:276`), false);
});

test("a write-in-only court retains its certified choice and an enacted boundary correction excludes the former county", () => {
  for (const county of ["camp", "marion", "morris", "titus"]) {
    const result = ballotForDivisions(ballot, [`${state}/county:${county}`]);
    const contest = result.contests.find(row => row.ocdId === `${state}/judicial_district:276`);
    assert.ok(contest, county);
    const candidates = result.candidacies.filter(row => row.contestId === contest.id);
    assert.equal(candidates.length, 1, "the only certified choice is a declared write-in; no printed opponent is invented");
    const writeIn = candidates.find(row => row.familyName === "Michael P. Kopech");
    assert.ok(writeIn);
    assert.equal(writeIn.partyLabel, null);
    const ordinary = ballotForDivisions(ballot, [`${state}/county:travis`]).candidacies
      .find(row => row.contestId === "tx-ba01-2026-district-judge-147")!;
    assert.deepEqual(Object.keys(writeIn).sort(), Object.keys(ordinary).sort(), "write-ins and printed candidates use the same reader fields");
    const sourceChoice = ballot.candidacies.find(row => row.id === writeIn.id)!;
    assert.ok(sourceChoice);
    assert.deepEqual(writeIn.provenance, sourceChoice.provenance);
    assert.equal(writeIn.givenName, sourceChoice.givenName);
    assert.equal(writeIn.familyName, sourceChoice.familyName);
    assert.ok(writeIn.aliases?.includes(sourceChoice.id), "the original certified choice remains an addressable alias");
  }
  assert.equal(ballotForDivisions(ballot, [`${state}/county:travis`]).candidacies.some(row => row.familyName === "Michael P. Kopech"), false);
  for (const county of ["comal", "hays"]) assert.ok(ballotForDivisions(ballot, [`${state}/county:${county}`]).contests
    .some(row => row.id === "tx-ba01-2026-district-judge-274"));
  assert.equal(ballotForDivisions(ballot, [`${state}/county:guadalupe`]).contests
    .some(row => row.id === "tx-ba01-2026-district-judge-274"), false);
  const report = JSON.parse(readFileSync("data/ballot/reports/ba01-tx-district-courts.json", "utf8"));
  assert.deepEqual(report.sourceConflicts, []);
  assert.equal(report.resolvedSourceDifferences[0].district, "274");
});

test("the visually resolved 31st district attorney write-in reaches exactly its five official counties", () => {
  const id = "tx-ba01-2026-district-attorney-31-unexpired";
  for (const county of ["gray", "hemphill", "lipscomb", "roberts", "wheeler"]) {
    const result = ballotForDivisions(ballot, [`${state}/county:${county}`]);
    assert.ok(result.contests.some(row => row.id === id), county);
    const choices = result.candidacies.filter(row => row.contestId === id);
    assert.equal(choices.length, 1);
    assert.equal(choices[0].familyName, "Leslie Timmons");
    assert.equal(choices[0].partyLabel, null);
  }
  assert.equal(ballotForDivisions(ballot, [`${state}/county:travis`]).contests.some(row => row.id === id), false);
});
