import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { contestsForDivisions } from "../lib/ballot/contests.ts";
import { divisionsWithDistrictMemberships, type BallotWithDistrictMemberships } from "../lib/ballot/district-memberships.ts";
import type { Contest } from "../lib/ballot/types.ts";

const state = "ocd-division/country:us/state:nh", base = `${state}/sldl:521`, overlay = `${state}/sldl:hillsborough_39`;
const provenance = { sourceUrl: "https://www.gc.nh.gov/rsa/html/LXIII/662/662-mrg.htm", sourceOrg: "New Hampshire General Court",
  collectedAt: "2026-10-20T00:00:00Z", verifiedAt: null, quote: "The entire member district belongs to this floterial district." };
const contest = (id: string, ocdId: string): Contest => ({ id, electionId: "general", ocdId, title: id,
  divisionVintage: "2022", type: "CANDIDACY", voteFor: 1, termYears: 2, scopeNote: null, provenance });

test("an official whole-division membership includes its overlay without widening a neighboring ballot", () => {
  const ballot: BallotWithDistrictMemberships = { election: { id: "general", date: "2026-11-03", name: "General", state: "NH" },
    contests: [contest("state", state), contest("base", base), contest("overlay", overlay), contest("neighbor", `${state}/sldl:522`)],
    candidacies: [], measures: [], absences: [],
    districtMemberships: [{ id: "membership", memberOcdId: base, districtOcdId: overlay, provenance }] };
  const before = structuredClone(ballot);
  assert.deepEqual(contestsForDivisions(ballot, [base]).contests.map(row => row.id), ["state", "base", "overlay"]);
  assert.deepEqual(contestsForDivisions(ballot, [`${state}/sldl:522`]).contests.map(row => row.id), ["state", "neighbor"]);
  assert.deepEqual(contestsForDivisions(ballot, [state]).contests.map(row => row.id), ["state"]);
  assert.deepEqual(ballot, before);
});

test("New Hampshire's saved statutory memberships show the appropriate overlay and county office", () => {
  const file = JSON.parse(readFileSync("data/ballot/2026-general/nh.json", "utf8"));
  const ballot = Object.values(file.ballots)[0] as BallotWithDistrictMemberships;
  assert.ok(ballot.districtMemberships!.length > 0);
  for (const row of ballot.districtMemberships!) {
    assert.ok(row.provenance.quote?.trim());
    assert.ok(file.sourceReceipt.sources.some((source: { requestedUrl: string; retrievedAt: string }) =>
      source.requestedUrl === row.provenance.sourceUrl && source.retrievedAt === row.provenance.collectedAt));
  }
  const manchester = contestsForDivisions(ballot, [`${state}/sldl:521`]).contests;
  const goffstown = contestsForDivisions(ballot, [`${state}/sldl:529`]).contests;
  assert.ok(manchester.some(row => row.ocdId === `${state}/sldl:hillsborough_40`));
  assert.ok(!goffstown.some(row => row.ocdId === `${state}/sldl:hillsborough_40`));
  assert.ok(goffstown.some(row => row.ocdId === `${state}/sldl:hillsborough_44`));
  assert.ok(manchester.some(row => row.ocdId === `${state}/executive_district:4`));
  assert.ok(goffstown.some(row => row.ocdId === `${state}/county:hillsborough/council_district:3`));
});

test("explicit county-to-court membership is directional and cycles cannot loop or cross a state", () => {
  const county = "ocd-division/country:us/state:ar/county:washington", court = "ocd-division/country:us/state:ar/circuit_court:4";
  const ballot: BallotWithDistrictMemberships = { election: { id: "general", date: "2026-11-03", name: "General", state: "AR" },
    contests: [], candidacies: [], measures: [], absences: [], districtMemberships: [
      { id: "county-court", memberOcdId: county, districtOcdId: court, provenance },
      { id: "cycle", memberOcdId: court, districtOcdId: county, provenance },
      { id: "wrong-state", memberOcdId: county, districtOcdId: overlay, provenance },
    ] };
  const resolved = divisionsWithDistrictMemberships(ballot, [county]);
  assert.ok(resolved.has(court));
  assert.ok(!resolved.has(overlay));
  assert.equal(resolved.size, 3);
  assert.ok(!divisionsWithDistrictMemberships(ballot, ["ocd-division/country:us/state:ar/county:benton"]).has(court));
});

test("malformed optional membership metadata cannot break an otherwise usable ballot", () => {
  const ballot: BallotWithDistrictMemberships = { election: { id: "general", date: "2026-11-03", name: "General", state: "NH" },
    contests: [contest("state", state), contest("base", base), contest("overlay", overlay)],
    candidacies: [], measures: [], absences: [] };
  const malformed = [null, {}, { memberOcdId: base, districtOcdId: overlay, provenance: null },
    { memberOcdId: base, districtOcdId: overlay, provenance: { sourceUrl: 42 } }];
  for (const rows of [null, {}, [...malformed], [...malformed, { id: "valid", memberOcdId: base, districtOcdId: overlay, provenance }]]) {
    const supplied = { ...ballot, districtMemberships: rows } as unknown as BallotWithDistrictMemberships;
    const expected = Array.isArray(rows) && rows.length > malformed.length ? ["state", "base", "overlay"] : ["state", "base"];
    assert.deepEqual(contestsForDivisions(supplied, [base]).contests.map(row => row.id), expected);
  }
});
