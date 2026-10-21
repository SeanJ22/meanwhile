import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import { genericBallotProblems } from "../lib/ballot/generic-projection.ts";
import type { BallotWithDistrictMemberships } from "../lib/ballot/district-memberships.ts";

function load(state: string) {
  const data = JSON.parse(readFileSync(`data/ballot/2026-general/${state}.json`, "utf8"));
  return { data, ballot: Object.values(data.ballots)[0] as BallotWithDistrictMemberships, base: `ocd-division/country:us/state:${state}` };
}

test("Fargo 58102 public-address sample matches every race and printed name in the reader", () => {
  const { ballot, base } = load("nd");
  const report = JSON.parse(readFileSync("data/ballot/ba01-west-evidence/nd-fargo-comparison.json", "utf8"));
  const selected = ballotForDivisions(ballot, [base, `${base}/cd:0`, `${base}/sldu:44`, `${base}/sldl:44`,
    `${base}/county:cass`, `${base}/place:fargo`, `${base}/school_district:fargo_public_school_district_1`]);
  assert.equal(selected.contests.length, 26);
  assert.equal(selected.candidacies.length, 35);
  assert.equal(selected.measures.length, 3);
  for (const race of report.races) {
    assert.ok(selected.contests.some(row => row.id === race.repoContestId), race.title);
    const names = selected.candidacies.filter(row => row.contestId === race.repoContestId)
      .map(row => `${row.givenName} ${row.familyName}`.trim()).sort();
    assert.deepEqual(names, [...race.sourceNames].sort(), race.title);
  }
});

test("Idaho countywide highway offices and Fourth District judicial runoff reach their exact electorates", () => {
  const { ballot, base } = load("id");
  const county = (name: string) => ballotForDivisions(ballot, [`${base}/county:${name}`]);
  const highway = (name: string) => county(name).contests.filter(row => row.id.startsWith("id-ada-general-2026-highway-commissioner-"));
  assert.equal(highway("ada").length, 2);
  assert.equal(highway("canyon").length, 0);
  const ids = new Set(highway("ada").map(row => row.id));
  assert.equal(county("ada").candidacies.filter(row => ids.has(row.contestId)).length, 7);
  for (const name of ["ada", "boise", "elmore", "valley"]) {
    const set = county(name);
    assert.equal(set.contests.filter(row => row.id === "id-general-2026-district-judge-4-ada-a").length, 1);
    assert.equal(set.candidacies.filter(row => row.contestId === "id-general-2026-district-judge-4-ada-a").length, 2);
  }
  assert.ok(!county("canyon").contests.some(row => row.id === "id-general-2026-district-judge-4-ada-a"));
});

test("New Mexico district judges span their official counties while magistrate divisions remain unmapped", () => {
  const { ballot, base } = load("nm");
  const court = (name: string) => ballotForDivisions(ballot, [`${base}/county:${name}`]).contests
    .filter(row => row.ocdId === `${base}/judicial_district:13`).map(row => row.id).sort();
  assert.equal(court("sandoval").length, 3);
  assert.deepEqual(court("sandoval"), court("valencia"));
  assert.deepEqual(court("sandoval"), court("cibola"));
  assert.equal(court("bernalillo").length, 0);
  assert.ok(ballot.districtMemberships?.some(row => row.memberOcdId === `${base}/county:dona_ana`));
  assert.ok(!ballot.contests.some(row => row.title.startsWith("Magistrate Judge")));
});

test("Arizona city and county additions appear only within the proven electorate", () => {
  const { ballot, base } = load("az");
  const scoped = (id: string) => ballotForDivisions(ballot, [id]).contests;
  assert.equal(scoped(`${base}/county:pima`).filter(row => (row.id.startsWith("az-pima-general-2026-") || row.id === "ballot-az-pima-general-2026-clerk-of-the-superior-court")).length, 14);
  assert.equal(scoped(`${base}/county:maricopa`).filter(row => (row.id.startsWith("az-pima-general-2026-") || row.id === "ballot-az-pima-general-2026-clerk-of-the-superior-court")).length, 0);
  assert.equal(scoped(`${base}/place:peoria`).filter(row => row.id.startsWith("az-peoria-general-2026-")).length, 2);
  assert.equal(scoped(`${base}/place:tempe`).filter(row => row.id.startsWith("az-tempe-general-2026-")).length, 1);
  assert.ok(!scoped(`${base}/place:glendale`).some(row => row.id.startsWith("az-peoria-general-2026-")));
});

test("all five expanded state packages pass the actual publication ballot schema", () => {
  for (const state of ["az", "id", "nd", "nm", "ut"]) {
    const { data } = load(state);
    assert.deepEqual(genericBallotProblems({ kind: "ballot-contests", ballots: data.ballots }, state.toUpperCase()), [], state);
  }
});

test("Utah certified regional retentions follow every listed county and stop at the Eighth District", () => {
  const { ballot, base } = load("ut");
  const count = (county: string) => ballotForDivisions(ballot, [`${base}/county:${county}`]).contests
    .filter(row => row.id.startsWith("ut-general-2026-")).length;
  for (const county of ["salt_lake", "summit", "tooele"]) assert.equal(count(county), 7);
  for (const county of ["utah", "wasatch", "juab", "millard"]) assert.equal(count(county), 5);
  assert.equal(count("davis"), 6);
  assert.equal(count("washington"), 3);
  assert.equal(count("uintah"), 0);
  assert.equal(count("daggett"), 0);
});
