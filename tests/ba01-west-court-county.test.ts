import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import type { BallotSet } from "../lib/ballot/types.ts";

function ballot(state: string): BallotSet {
  return Object.values(JSON.parse(readFileSync(`data/ballot/2026-general/${state}.json`, "utf8")).ballots)[0] as BallotSet;
}

test("Fargo's saved public address resolves all 26 sampled contests without widening its school measure", () => {
  const base = "ocd-division/country:us/state:nd";
  const set = ballot("nd");
  const divisions = [base, `${base}/cd:0`, `${base}/sldu:44`, `${base}/sldl:44`, `${base}/county:cass`,
    `${base}/place:fargo`, `${base}/school_district:fargo_public_school_district_1`];
  const selected = ballotForDivisions(set, divisions);
  assert.equal(selected.contests.length, 26);
  assert.equal(selected.candidacies.length, 35);
  assert.equal(selected.measures.length, 3);
  assert.equal(selected.contests.filter(row => row.id.startsWith("nd-east-central-general-2026-")).length, 6);
  const neighboringSchool = ballotForDivisions(set, divisions.filter(id => !id.includes("/school_district:"))
    .concat(`${base}/school_district:west_fargo_public_school_district_6`));
  assert.equal(neighboringSchool.measures.length, 2);
  assert.ok(!neighboringSchool.contests.some(row => row.id === "nd-fargo-school-district-1-general-2026-measure-1"));
});

test("official county memberships show every Bernalillo judicial choice and leave neighboring county voters alone", () => {
  const base = "ocd-division/country:us/state:nm";
  const set = ballot("nm");
  const selected = ballotForDivisions(set, [`${base}/county:bernalillo`]);
  const local = selected.contests.filter(row => row.id.startsWith("nm-bernalillo-general-2026-"));
  assert.equal(local.length, 26);
  assert.equal(selected.candidacies.filter(row => local.some(contest => row.contestId === contest.id)).length, 28);
  assert.ok(!ballotForDivisions(set, [`${base}/county:sandoval`]).contests
    .some(row => row.id.startsWith("nm-bernalillo-general-2026-")));
});

test("Montana court membership respects compound county names and the Yellowstone electorate", () => {
  const base = "ocd-division/country:us/state:mt";
  const set = ballot("mt");
  const courtRaces = (county: string) => ballotForDivisions(set, [`${base}/county:${county}`]).contests
    .filter(row => row.id.startsWith("mt-general-2026-district-court-judge-"));
  assert.equal(courtRaces("yellowstone").length, 4);
  assert.ok(courtRaces("yellowstone").every(row => row.type === "RETENTION"));
  assert.equal(courtRaces("lewis_and_clark").length, 1);
  assert.equal(courtRaces("broadwater").length, 1);
  assert.equal(courtRaces("lewis").length, 0);
  assert.equal(courtRaces("clark").length, 0);
  assert.equal(courtRaces("gallatin").length, 1);
});
