import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCongressResults, updateCongressResults } from "../lib/election-results/summary.ts";
import type { ElectionResult } from "../lib/election-results/types.ts";

const at = "2026-11-08T02:00:00.000Z";
const race = (id: string, changes: Partial<ElectionResult> = {}): ElectionResult => ({ sourceId: "ballotpedia", sourceName: "Ballotpedia",
  sourceUrl: `https://ballotpedia.org/${id}`, sourceRaceId: id, state: "AZ", office: "us_house", officeName: "U.S. House Arizona",
  electionDate: "2026-11-03", status: "called", candidates: [{ name: "Synthetic winner", party: "D", won: true }],
  seatsFlipped: 1, incumbentsLost: 1, checkedAt: at, quote: "Synthetic source evidence", creditedSources: [{ name: "State election office" }], ...changes });

test("national document retains unmatched races and earlier states across partial and unchanged runs", () => {
  const first = updateCongressResults(undefined, [race("az1"), race("az2"), race("ny1", { state: "NY", seatsFlipped: 0, incumbentsLost: 0 })]);
  const next = updateCongressResults(first, [race("az2", { checkedAt: "2026-11-08T08:00:00.000Z" })]);
  assert.equal(Object.keys(next).length, 3);
  const summary = summarizeCongressResults(Object.values(next), at, [{ state: "AZ", office: "us_house", url: "https://ballotpedia.org/az3" }]);
  assert.deepEqual(summary.states.AZ.us_house, { scope: "election-races", seatsNow: { D: 2 }, stillCounting: 1,
    seatsFlipped: 2, unknownFlipRaces: 0, incumbentsLost: 2, unknownIncumbentLossRaces: 0, reportedRaces: 2, totalRaces: 3 });
  assert.equal(summary.states.NY.us_house.seatsNow.D, 1);
  assert.equal(summary.states.AZ.us_senate.totalRaces, 0, "no Senate holdover or election is invented");
  assert.equal(JSON.stringify(next).includes("Synthetic source evidence"), false, "the source body and quotes are transient");
});

test("counting candidates and unknown flip or incumbent counts stay unknown", () => {
  const values = updateCongressResults(undefined, [race("called", { seatsFlipped: undefined, incumbentsLost: undefined }),
    race("counting", { status: "counting" })]);
  const summary = summarizeCongressResults(Object.values(values), at);
  assert.deepEqual(summary.states.AZ.us_house, { scope: "election-races", seatsNow: { D: 1 }, stillCounting: 1,
    seatsFlipped: 0, unknownFlipRaces: 1, incumbentsLost: 0, unknownIncumbentLossRaces: 1, reportedRaces: 2, totalRaces: 2 });
});

test("a called open seat with unknown previous party never hides other verified flips", () => {
  const values = updateCongressResults(undefined, [race("flip-one"), race("flip-two"),
    race("open-seat", { seatsFlipped: undefined, incumbentsLost: 0 })]);
  const summary = summarizeCongressResults(Object.values(values), at);
  assert.equal(summary.states.AZ.us_house.seatsFlipped, 2);
  assert.equal(summary.states.AZ.us_house.unknownFlipRaces, 1);
  assert.equal(summary.states.AZ.us_house.incumbentsLost, 2);
  assert.equal(summary.states.AZ.us_house.unknownIncumbentLossRaces, 0);
});

test("a corrected outcome replaces its own source identity without adding a seat", () => {
  const first = updateCongressResults(undefined, [race("az1")]);
  const next = updateCongressResults(first, [race("az1", { candidates: [{ name: "Corrected winner", party: "R", won: true }], seatsFlipped: 0 })]);
  const summary = summarizeCongressResults(Object.values(next), at);
  assert.deepEqual(summary.states.AZ.us_house.seatsNow, { R: 1 });
  assert.equal(summary.states.AZ.us_house.seatsFlipped, 0);
  assert.equal(summary.states.AZ.us_house.totalRaces, 1);
});

test("a partial state run preserves the previous national document's other states and source-held governor fields", () => {
  const first = summarizeCongressResults(Object.values(updateCongressResults(undefined, [race("ny", { state: "NY" })])), at);
  const previous = { ...first, statewide: { NY: { state: "NY", governor: { before: "D", now: "D", name: "Synthetic governor" },
    chambers: [], statewideOfficesFlipped: [], source: { name: "MultiState" }, creditedSources: [], checkedAt: at } } };
  const next = summarizeCongressResults(Object.values(updateCongressResults(undefined, [race("az")])), at, [], previous);
  assert.deepEqual(next.states.NY, first.states.NY);
  assert.equal(next.states.AZ.us_house.seatsNow.D, 1);
  assert.equal(next.statewide!.NY.governor.name, "Synthetic governor");
  assert.equal(next.statewide!.NY.incumbentsLost, undefined, "no absent source count becomes zero");
});
