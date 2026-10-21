import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import type { BallotWithDistrictMemberships } from "../lib/ballot/district-memberships.ts";

const root = "data/ballot/sources/ba-01/ca-local/";
const input = JSON.parse(readFileSync("data/ballot/2026-general/ca.json", "utf8"));
const ballot = Object.values(input.ballots)[0] as BallotSet;
const state = "ocd-division/country:us/state:ca";
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");

test("California appellate electorates and Los Angeles filings retain the exact official responses", () => {
  for (const name of ["appeal-home.html", "appeal-retention.html", "la-index.html", "la-candidates.pdf", "la-measures.pdf"]) {
    const meta = JSON.parse(readFileSync(root + name + ".meta.json", "utf8"));
    const raw = gunzipSync(readFileSync(root + meta.file));
    assert.equal(sha(raw), meta.rawHash);
    assert.equal(meta.httpStatus, 200);
    assert.ok(input.sourceReceipt.sources.some((row: { finalUrl: string; retrievedAt: string; rawHash: string }) =>
      row.finalUrl === meta.finalUrl && row.retrievedAt === meta.retrievedAt && row.rawHash === meta.rawHash));
    if (name.endsWith(".pdf")) {
      assert.equal(raw.subarray(0, 4).toString(), "%PDF");
      assert.equal(sha(readFileSync(root + meta.extractedText.file)), meta.extractedText.sha256);
    }
  }
});

test("all 58 counties reach only their official appellate district, including San Francisco's eleven retention races", () => {
  const memberships = (ballot as BallotWithDistrictMemberships).districtMemberships!
    .filter(row => row.id.startsWith("ca-ba01-county-appeal-"));
  assert.equal(memberships.length, 58);
  assert.equal(new Set(memberships.map(row => row.memberOcdId)).size, 58);
  for (const membership of memberships) {
    const reader = ballotForDivisions(ballot, [membership.memberOcdId]);
    const expected = ballot.contests.filter(row => row.ocdId === membership.districtOcdId);
    const actual = reader.contests.filter(row => row.ocdId.includes("/court_of_appeals:"));
    assert.deepEqual(new Set(actual.map(row => row.id)), new Set(expected.map(row => row.id)), membership.memberOcdId);
  }
  const sf = ballotForDivisions(ballot, [state + "/county:san_francisco"]);
  assert.equal(sf.contests.filter(row => row.ocdId.endsWith("/court_of_appeals:1")).length, 11);
  assert.equal(ballotForDivisions(ballot, [state]).contests.some(row => row.ocdId.includes("/court_of_appeals:")), false);
});

test("Los Angeles' five countywide races and two questions reach county readers while city facts retain their exact electorate", () => {
  const reader = ballotForDivisions(ballot, [state + "/county:los_angeles"]);
  const local = reader.contests.filter(row => row.id.startsWith("ca-ba01-la-"));
  assert.equal(local.filter(row => row.type === "CANDIDACY").length, 5);
  assert.equal(local.filter(row => row.type === "MEASURE").length, 2);
  const ids = new Set(local.filter(row => row.type === "CANDIDACY").map(row => row.id));
  assert.equal(reader.candidacies.filter(row => ids.has(row.contestId)).length, 10);
  const city = ballotForDivisions(ballot, [state + "/county:los_angeles", state + "/place:los_angeles"]);
  assert.equal(city.contests.filter(row => row.ocdId === state + "/place:los_angeles" && row.type === "CANDIDACY").length, 2);
  assert.equal(city.measures.filter(row => city.contests.some(contest => contest.id === row.contestId && contest.ocdId === state + "/place:los_angeles")).length, 8);
  assert.equal(city.contests.some(row => row.title === "Inglewood — Mayor"), false);
  const choices = ballot.candidacies.filter(row => row.contestId.startsWith("ca-ba01-la-"));
  assert.equal(choices.length, 54);
  for (const choice of choices) assert.deepEqual(Object.keys(choice).sort(), Object.keys(choices[0]).sort());
  assert.equal(choices.every(row => row.partyLabel === null), true, "official NON PARTISAN status is retained without inventing a party");
  assert.equal(ballot.measures.filter(row => row.contestId.startsWith("ca-ba01-la-measure-")).length, 54);
});
