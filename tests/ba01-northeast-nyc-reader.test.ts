import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { contestsForDivisions } from "../lib/ballot/contests.ts";
import type { BallotSet } from "../lib/ballot/types.ts";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const ballot = Object.values(read("data/ballot/2026-general/ny.json").ballots)[0] as BallotSet;
const official = read("data/ballot/sources/ba01-northeast/nyc-10001-contests.json").parties[0].contests;
const district = read("data/ballot/sources/ba01-northeast/nyc-10001-pollsite.json");
const prefix = "ocd-division/country:us/state:ny";
const base = [prefix, `${prefix}/county:new_york`, `${prefix}/place:new_york`,
  `${prefix}/cd:${Number(district.congress_district)}`, `${prefix}/sldu:${Number(district.senate_district)}`,
  `${prefix}/sldl:${Number(district.assembly_district)}`];

test("the official10001 address divisions return every one of its16 source contests", () => {
  const matched = contestsForDivisions(ballot, [...base,
    `${prefix}/place:new_york/council_district:${Number(district.council_district)}`,
    `${prefix}/county:new_york/municipal_court_district:${Number(district.municipal_court_district)}`]).contests;
  assert.equal(official.length, 16);
  assert.equal(matched.length, official.length);
  assert.equal(matched.filter(row => row.type === "CANDIDACY").length, 11);
  const ids = new Set(matched.map(row => row.id));
  assert.equal(ballot.candidacies.filter(row => ids.has(row.contestId)).length, 32);
  assert.equal(ballot.measures.filter(row => ids.has(row.contestId)).length, 5);
  assert.ok(matched.some(row => row.ocdId === `${prefix}/supreme_court:1`));
});

test("one address's local districts never widen its Assembly district into those electorates", () => {
  const matched = contestsForDivisions(ballot, base).contests;
  assert.ok(!matched.some(row => row.id === "ny-2026-new-york-city-council-3"));
  assert.ok(!matched.some(row => row.id === "ny-2026-new-york-county-municipal-court-3"));
});

test("the official11201 address returns all13 source races through its county and state districts", () => {
  const site = read("data/ballot/sources/ba01-northeast/nyc-kings-2.json");
  const source = read("data/ballot/sources/ba01-northeast/nyc-kings-3.json").parties[0].contests;
  const matched = contestsForDivisions(ballot, [prefix, `${prefix}/place:new_york`, `${prefix}/county:kings`,
    `${prefix}/cd:${Number(site.congress_district)}`, `${prefix}/sldu:${Number(site.senate_district)}`,
    `${prefix}/sldl:${Number(site.assembly_district)}`]).contests;
  assert.equal(source.length, 13);
  assert.equal(matched.length, 13);
  const ids = new Set(matched.map(row => row.id));
  assert.equal(ballot.candidacies.filter(row => ids.has(row.contestId)).length, 22);
  assert.equal(ballot.measures.filter(row => ids.has(row.contestId)).length, 5);
});
