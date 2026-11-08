import assert from "node:assert/strict";
import test from "node:test";

import {
  districtTitle, fillClass, flipCount, flipParty, nationalResults, parseDistrictOcd, resultContests, resultsByDistrict,
  type ContestStatus, type ResultContest,
} from "../lib/map/results.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import type { BallotResultFacts } from "../lib/ballot/election-results.ts";

const AT = "2026-11-06T12:00:00.000Z";
const provenance = { sourceOrg: "Synthetic", sourceUrl: "https://example.gov", collectedAt: AT, verifiedAt: AT };
const attribution = { sources: [{ name: "Synthetic results" }], checkedAt: AT };
type Person = [name: string, party: string, incumbent: boolean, won: boolean, votes: number];
interface Race { id: string; ocdId: string; title?: string; status: ContestStatus; seats?: number; flip?: string; flipSeats?: number; people: Person[] }
/** A state's sliced ballot: who ran in which contest. Results are not on it; the results job publishes them separately. */
function ballotOf(races: Race[], date = "2026-11-03"): Pick<BallotSet, "contests" | "candidacies"> & { election: BallotSet["election"] } {
  return {
    election: { id: `az-${date}`, date, name: "General", state: "AZ" },
    contests: races.map(race => ({ id: race.id, electionId: "e", ocdId: race.ocdId, divisionVintage: "2026", title: race.title ?? "State House", type: "CANDIDACY" as const,
      voteFor: race.seats ?? 1, termYears: 2, scopeNote: null, provenance })),
    candidacies: races.flatMap(race => race.people.map(([name, party, incumbent], index) => ({ id: `${race.id}-${index}`, contestId: race.id,
      givenName: name, familyName: "Test", partyLabel: party, slogan: null, incumbent, websiteUrl: null, provenance }))),
  };
}
/** What the results job's state feed holds for those races, keyed by contest and candidate id. */
const factsOf = (races: Race[]): BallotResultFacts => Object.fromEntries(races.flatMap(race => [
  [race.id, { status: race.status, seatsToFill: race.seats ?? 1, flipped: Boolean(race.flip), gainedByParty: race.flip ?? null,
    ...race.flipSeats === undefined ? {} : { seatsFlipped: race.flipSeats }, ...attribution }],
  ...race.people.map(([, , , won, votes], index) => [`${race.id}-${index}`, { won, votes, ...attribution }]),
]));
const azId = (kind: string, n: number) => az(kind, n);
const az = (kind: string, n: number) => `ocd-division/country:us/state:az/${kind}:${n}`;
const races: Race[] = [
  { id: "h1", ocdId: az("sldl", 1), status: "called", seats: 2, people: [["A", "Republican", true, true, 100], ["B", "Republican", true, true, 99], ["C", "Democrat", false, false, 60]] },
  { id: "h4", ocdId: az("sldl", 4), status: "called", seats: 2, flip: "Democrat", flipSeats: 2, people: [["Gresham", "Democrat", false, true, 58], ["Caputi", "Democrat", false, true, 57], ["Gress", "Republican", true, false, 54], ["Carter", "Republican", true, false, 50]] },
  { id: "h5", ocdId: az("sldl", 5), status: "called", seats: 2, people: [["D1", "Democrat", true, true, 70], ["R1", "Republican", false, true, 69], ["R2", "Republican", false, false, 40]] },
  { id: "h6", ocdId: az("sldl", 6), status: "counting", seats: 2, people: [["D2", "Democrat", false, true, 10], ["R3", "Republican", false, false, 9]] },
  { id: "s1", ocdId: az("sldu", 1), status: "called", people: [["S1", "Republican", true, true, 5], ["S2", "Democrat", false, false, 4]] },
  { id: "s2", ocdId: az("sldu", 2), status: "called", flip: "Democrat", people: [["S3", "Democrat", false, true, 5], ["S4", "Republican", true, false, 4]] },
  { id: "gov", ocdId: "ocd-division/country:us/state:az", title: "Governor / Lieutenant Governor", status: "called", people: [["G", "Democrat", true, true, 9]] },
  { id: "sen", ocdId: "ocd-division/country:us/state:az", title: "U.S. Senator", status: "called", flip: "Democrat", people: [["U1", "Democrat", false, true, 9], ["U2", "Republican", true, false, 8]] },
];
const ballot = ballotOf(races), facts = factsOf(races);
const contests = resultContests(ballot, facts);
const results = resultsByDistrict(contests);
const lower = Object.values(results).filter(r => parseDistrictOcd(r.ocdId)?.kind === "sldl");
const upper = Object.values(results).filter(r => parseDistrictOcd(r.ocdId)?.kind === "sldu");

test("only districts and the U.S. Senate seat are drawn; the governor's race shares the state's division but is left out", () => {
  assert.equal(contests.length, 7);
  assert.ok(contests.some(c => c.ocdId === "ocd-division/country:us/state:az" && c.candidates[0].name === "U1 Test"));
  assert.ok(!contests.some(c => c.candidates.some(p => p.name === "G Test")));
});

test("every seat is accounted for, with seats still being counted drawn as counting", () => {
  assert.equal(lower.flatMap(r => r.seats).length, 8);
  assert.deepEqual(lower.find(r => r.ocdId === az("sldl", 6))?.seats.map(s => s.party), ["D", "C"]);
  assert.equal(fillClass(lower.find(r => r.ocdId === az("sldl", 6))!), "counting");
  assert.equal(fillClass(lower.find(r => r.ocdId === az("sldl", 1))!), "R");
  assert.equal(fillClass(upper.find(r => r.ocdId === az("sldu", 1))!), "R");
});

test("a seat with one member of each party draws as split", () => {
  const split = lower.find(r => r.ocdId === az("sldl", 5))!;
  assert.equal(fillClass(split), "split");
  assert.equal(split.seats.length, 2);
});

test("a flip carries the gaining party and the source's own seat count, and none where the source gives none", () => {
  assert.equal(flipParty(results[az("sldl", 4)]), "D");
  assert.equal(flipCount(results[az("sldl", 4)]), 2);
  assert.equal(results[az("sldu", 2)].flipSeats, null);
  assert.equal(flipCount(results[az("sldu", 2)]), 1, "a single-seat contest that flipped is one seat");
  assert.equal(flipParty(results[az("sldu", 2)]), "D");
  assert.equal(flipParty(results[az("sldu", 1)]), null);
  assert.equal(flipParty(results[az("sldl", 1)]), null);
});

test("titles and ids", () => {
  assert.equal(districtTitle("ocd-division/country:us/state:az/sldl:17"), "State House, District 17");
  assert.equal(districtTitle("ocd-division/country:us/state:az/sldu:4"), "State Senate, District 4");
  assert.equal(districtTitle("ocd-division/country:us/state:az/cd:6"), "U.S. House, District 6");
  assert.deepEqual(parseDistrictOcd("ocd-division/country:us/state:az/cd:6"), { state: "az", kind: "cd", number: "6" });
  assert.equal(parseDistrictOcd("ocd-division/country:us/state:az"), null);
});

const row = (seatsNow: Record<string, number>, stillCounting: number, seatsFlipped: number, reportedRaces = 1) =>
  ({ scope: "election-races" as const, seatsNow, stillCounting, seatsFlipped, unknownFlipRaces: 0, incumbentsLost: 0, unknownIncumbentLossRaces: 0, reportedRaces, totalRaces: reportedRaces + stillCounting });
const summary = { states: {
  OH: { us_house: row({ D: 5, R: 10 }, 0, 2, 15), us_senate: row({ D: 1 }, 0, 1) },
  PA: { us_house: row({ D: 8, R: 9 }, 1, 0, 17), us_senate: row({}, 0, 0, 0) },
  TX: { us_house: row({}, 0, 0, 0), us_senate: row({ R: 1 }, 1, 0, 1) },
} };

test("the national summary becomes one result per state: seats held, seats still counting, and flips so far", () => {
  const house = nationalResults(summary, "us_house"), ohio = house["ocd-division/country:us/state:oh"];
  assert.equal(fillClass(ohio), "split");
  assert.equal(flipCount(ohio), 2);
  assert.equal(ohio.seats.length, 15);
  assert.equal(fillClass(house["ocd-division/country:us/state:pa"]), "counting");
  assert.equal(house["ocd-division/country:us/state:tx"], undefined, "a state that reported no races in the chamber is absent");
  const senate = nationalResults(summary, "us_senate");
  assert.equal(fillClass(senate["ocd-division/country:us/state:oh"]), "D");
  assert.equal(flipParty(senate["ocd-division/country:us/state:oh"]), "D", "a flip's party is known when one party holds every seat won");
  assert.equal(flipParty(ohio), null, "a state split between parties names no gaining party");
  assert.equal(senate["ocd-division/country:us/state:pa"], undefined);
});

test("a ballot without result fields yields no results, so the map shows its banner", () => {
  const bare = ballotOf([{ id: "c1", ocdId: az("cd", 6), title: "U.S. Representative", status: "called", people: [["A", "Democrat", false, true, 1]] }]);
  assert.deepEqual(resultContests(bare, {}), []);
});

test("a called race with a flip, a winner's share, and an incumbent who lost", () => {
  const race: Race = { id: "c", ocdId: az("cd", 6), title: "U.S. Representative", status: "called", flip: "Democrat", flipSeats: 1,
    people: [["JoAnna", "Democrat", false, true, 181117], ["Juan", "Republican", true, false, 160000]] };
  const one = resultsByDistrict(resultContests(ballotOf([race]), factsOf([race])))[az("cd", 6)];
  assert.equal(fillClass(one), "D");
  assert.equal(flipParty(one), "D");
  assert.equal(one.candidates[1].incumbent, true);
  assert.equal(one.candidates[0].votes, 181117);
});

/* ---------------------------------------------------------------- styling --- */

import { countyOutlineLayers, groupByFill, resultLayers, stateBadgePoints, stateCentroid, RESULTS_STATES_SOURCE } from "../lib/map/results-style.ts";
import { NATIONAL_BOUNDARIES_SOURCE } from "../lib/map/districts.ts";

const lowerLayers = () => resultLayers({ kind: "districts", boundary: "state-house", state: "AZ" }, Object.fromEntries(Object.entries(results).filter(([id]) => id.includes("/sldl:"))),
  { theme: "dark", yours: ["ocd-division/country:us/state:az/sldl:17"] });

test("each fill class gets its own layer on the existing boundary source, with the reader's district outlined", () => {
  const layers = lowerLayers();
  assert.deepEqual(layers.map(l => l.id), ["results-fill", "results-counting", "results-split", "results-line", "results-yours", "results-flip-D"]);
  for (const layer of layers) assert.equal((layer as { source: string }).source, NATIONAL_BOUNDARIES_SOURCE);
  const groups = groupByFill(Object.fromEntries(Object.entries(results).filter(([id]) => id.includes("/sldl:"))));
  assert.deepEqual([groups.R.length, groups.D.length, groups.split.length, groups.counting.length, groups.O.length], [1, 1, 1, 1, 0]);
  const fill = layers[0] as unknown as { paint: { "fill-color": unknown[] }; filter: unknown[] };
  assert.deepEqual(fill.filter, ["all", ["==", ["get", "boundaryType"], "state-house"], ["==", ["get", "state"], "AZ"]]);
  assert.deepEqual(fill.paint["fill-color"].slice(0, 2), ["match", ["get", "ocdId"]]);
  assert.ok(fill.paint["fill-color"].includes("#2457b8") && fill.paint["fill-color"].includes("#b3362a"));
});

test("the fill color is a complete match: a district with no result takes the neutral color", () => {
  const color = (lowerLayers()[0] as unknown as { paint: { "fill-color": unknown[] } }).paint["fill-color"];
  assert.equal(color.length % 2, 1);
  assert.equal(color.at(-1), "#262a33");
});

test("a state with no results draws every district neutral, with no pattern layers", () => {
  const layers = resultLayers({ kind: "districts", boundary: "congressional", state: "TX" }, {}, { theme: "dark", yours: [] });
  assert.deepEqual(layers.map(l => l.id), ["results-fill", "results-line"]);
  assert.equal((layers[0] as unknown as { paint: { "fill-color": string } }).paint["fill-color"], "#262a33");
});

test("the national House view draws every state's districts: no state filter", () => {
  const layers = resultLayers({ kind: "districts", boundary: "congressional", state: null }, {}, { theme: "dark", yours: [] });
  assert.deepEqual((layers[0] as unknown as { filter: unknown }).filter, ["==", ["get", "boundaryType"], "congressional"]);
  assert.ok(layers.some(l => l.id === "results-state-lines" && (l as { source: string }).source === RESULTS_STATES_SOURCE), "state lines sit on top of the districts");
});

test("state shapes draw from the state source, and flip badges are not drawn on districts there", () => {
  const states = resultsByDistrict([{ ocdId: "ocd-division/country:us/state:tx", status: "called", seats: 1, flip: { to: "D", seats: 1 },
    candidates: [{ name: "A", party: "D", incumbent: false, result: "won", votes: 1 }] }]);
  const layers = resultLayers({ kind: "states" }, states, { theme: "light", yours: [] });
  for (const layer of layers) assert.equal((layer as { source: string }).source, RESULTS_STATES_SOURCE);
  assert.ok(!layers.some(l => l.id.startsWith("results-flip")));
});

test("the county outline is one halo and one line on the county's own id", () => {
  const [halo, line] = countyOutlineLayers("ocd-division/country:us/state:az/county:pima", "dark");
  assert.equal(halo.id, "results-county-halo");
  assert.equal(line.id, "results-county-line");
  assert.deepEqual((line as unknown as { filter: unknown }).filter, ["all", ["==", ["get", "boundaryType"], "county"], ["==", ["get", "ocdId"], "ocd-division/country:us/state:az/county:pima"]]);
});

test("state badges sit inside the state's largest part", () => {
  const shape = { properties: { ocdId: "ocd-division/country:us/state:xx" }, geometry: { coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]] ] } };
  const [x, y] = stateCentroid(shape);
  assert.ok(Math.abs(x - 5) < 1e-9 && Math.abs(y - 5) < 1e-9);
  const points = stateBadgePoints([shape, { ...shape, properties: { ocdId: "ocd-division/country:us/state:yy" } }], { "ocd-division/country:us/state:xx": { party: "R", count: 3 } });
  assert.equal(points.features.length, 1);
  assert.deepEqual(points.features[0].properties, { party: "R", count: "3" });
});

/* ------------------------------------------------------------- scope sync --- */

import { closeResults, getResultsScope, openResults, resultsRequestedBy, setResultsDistricts, setResultsScope, showResultsState } from "../lib/map/results-scope.ts";

test("map and scorecard share one scope: drilling in adds the visited tab, going home keeps it", () => {
  const az = { abbr: "AZ", name: "Arizona" }, tx = { abbr: "TX", name: "Texas" };
  openResults(az);
  assert.deepEqual(getResultsScope(), { open: true, scope: "state", state: az, home: az, visited: null, districts: false });
  setResultsScope("nation");
  assert.equal(getResultsScope().scope, "nation");
  showResultsState(tx);
  assert.deepEqual(getResultsScope(), { open: true, scope: "state", state: tx, home: az, visited: tx, districts: false });
  showResultsState(az);
  assert.deepEqual(getResultsScope().visited, tx);
  assert.equal(getResultsScope().state, az);
  closeResults();
  assert.equal(getResultsScope().open, false);
  showResultsState(tx);
  assert.equal(getResultsScope().open, false);
});

test("the map's district request is shared so the one map loads boundaries only when they are drawn", () => {
  openResults({ abbr: "AZ", name: "Arizona" });
  setResultsDistricts(true);
  assert.equal(getResultsScope().districts, true);
  setResultsDistricts(false);
  assert.equal(getResultsScope().districts, false);
  closeResults();
  setResultsDistricts(true);
  assert.equal(getResultsScope().districts, false);
});

/* --------------------------------------------------------------- the read --- */

import { latestResultBallot, mapResults, parseResultsRequest } from "../lib/map/results-read.ts";
import { electionFeedFixture } from "./helpers/election-feed-fixture.ts";
import type { StateResultFeed } from "../lib/election-results/feed-types.ts";

test("requests parse to one state, the Senate, or the House; anything else is refused", () => {
  assert.deepEqual(parseResultsRequest({ scope: "state", state: "az" }), { scope: "state", state: "AZ" });
  assert.deepEqual(parseResultsRequest({ scope: "us-senate", state: null }), { scope: "us-senate" });
  assert.deepEqual(parseResultsRequest({ scope: "us-house", state: null }), { scope: "us-house" });
  for (const bad of [{ scope: "state", state: null }, { scope: "state", state: "arizona" }, { scope: "state", state: "ZZ" }, { scope: "county", state: null }, { scope: null, state: null }])
    assert.equal(parseResultsRequest(bad), null);
});

const feedOf = (state: string, facts: BallotResultFacts): StateResultFeed => ({ formatVersion: 1, state, ballotVersion: null, checkedAt: AT, fingerprint: "synthetic", facts });
const rowsFor = (ballot: ReturnType<typeof ballotOf>) => [{ published: true, payload: { kind: "ballot-contests", ballots: { [`${ballot.election.state}:${ballot.election.id}`]: ballot } } }];

test("a national request reads the one published summary and never touches the ballots or the database", async context => {
  const copy = electionFeedFixture(context);
  await copy.store.writeNation({ checkedAt: AT, sources: [], states: summary.states });
  let queries = 0;
  const query = async () => { queries++; return [[]]; };
  const senate = await mapResults({ scope: "us-senate" }, { store: copy.store, query });
  assert.deepEqual(Object.keys(senate).sort(), ["ocd-division/country:us/state:oh", "ocd-division/country:us/state:tx"]);
  const house = await mapResults({ scope: "us-house" }, { store: copy.store, query });
  assert.deepEqual(Object.keys(house).sort(), ["ocd-division/country:us/state:oh", "ocd-division/country:us/state:pa"]);
  assert.equal(queries, 0);
  assert.equal(copy.databaseReads(), 0);
  assert.deepEqual(copy.reads, ["nation.json", "nation.json"]);
});

test("nothing published nationally is an empty answer, so the national views show their banner", async context => {
  const copy = electionFeedFixture(context);
  assert.deepEqual(await mapResults({ scope: "us-house" }, { store: copy.store }), {});
});

test("a state's districts join its sliced ballot to its results feed; a state with no feed costs no database request", async context => {
  const copy = electionFeedFixture(context);
  let queries = 0;
  const query = async () => { queries++; return [rowsFor(ballot)]; };
  assert.deepEqual(await mapResults({ scope: "state", state: "TX" }, { store: copy.store, query }), {});
  assert.equal(queries, 0);
  await copy.store.writeState("AZ", feedOf("AZ", facts));
  const az = await mapResults({ scope: "state", state: "AZ" }, { store: copy.store, query });
  assert.equal(queries, 1);
  assert.equal(fillClass(az[azId("sldl", 1)]), "R");
  assert.equal(flipCount(az[azId("sldl", 4)]), 2);
  assert.ok(az["ocd-division/country:us/state:az"], "the U.S. Senate seat is carried");
  assert.equal(Object.values(az).some(result => result.candidates.some(person => person.name === "G Test")), false, "the governor's race is not drawn");
});

/* ---------------------------------------------------------------- counties --- */

import { COUNTY_SEARCH_MIN, countyChoices, countyLabel, matchCounties } from "../lib/map/results-counties.ts";

const tile = (ocdId: string, label: string, box = [0, 0, 1, 1]) => ({ properties: { ocdId, label, west: box[0], south: box[1], east: box[2], north: box[3] } });

test("counties from the loaded tiles are unique, sorted, and carry their bounds", () => {
  const list = countyChoices([tile("c:pima", "Pima County", [-113, 31, -110, 33]), tile("c:apache", "Apache County"), tile("c:pima", "Pima County"), tile("c:bad", "No Bounds", [NaN, 0, 1, 1]), { properties: null }]);
  assert.deepEqual(list.map(c => c.name), ["Apache", "Pima"]);
  assert.deepEqual(list[1].bounds, [[-113, 31], [-110, 33]]);
  assert.equal(countyLabel(list[1]), "Pima County");
});

test("search filters as you type, matches anywhere in the name, and an empty query lists every county", () => {
  const list = countyChoices(["Cochise", "Coconino", "Pima", "Pinal", "Santa Cruz"].map(n => tile(`c:${n}`, `${n} County`)));
  assert.deepEqual(matchCounties(list, "co").map(c => c.name), ["Cochise", "Coconino"]);
  assert.deepEqual(matchCounties(list, "  CRUZ ").map(c => c.name), ["Santa Cruz"]);
  assert.equal(matchCounties(list, "").length, 5);
  assert.deepEqual(matchCounties(list, "zzz"), []);
  assert.equal(COUNTY_SEARCH_MIN, 10);
});

/* -------------------------------------------------------------------- cards --- */

import { districtCard, houseStateMeta, senateCard } from "../lib/map/results-card.ts";

const sldl = (n: number) => `ocd-division/country:us/state:az/sldl:${n}`;

test("a two-seat district card lists both winners, the incumbent who lost, and a flip pill for the seats that changed", () => {
  const district = results[sldl(4)];
  const card = districtCard(sldl(4), district, true);
  assert.equal(card.title, "State House, District 4");
  assert.equal(card.meta, "Your district · Top 2 win");
  assert.deepEqual(card.flip, { party: "D", label: "2 seats flipped" });
  assert.deepEqual(card.rows.filter(r => r.note === "Won").map(r => r.name).sort(), ["Caputi Test", "Gresham Test"]);
  assert.deepEqual(card.rows.filter(r => r.note === "Incumbent · lost").map(r => r.name).sort(), ["Carter Test", "Gress Test"]);
});

test("a single-seat card shows the winner's share, and a seat still being counted says so", () => {
  const sen = (party: "D" | "R", votes: [number, number], won: boolean): ResultContest => ({
    ocdId: "ocd-division/country:us/state:az/cd:6", status: won ? "called" : "counting", seats: 1, flip: null,
    candidates: [{ name: "A", party, incumbent: false, result: won ? "won" : null, votes: votes[0] }, { name: "B", party: party === "D" ? "R" : "D", incumbent: true, result: null, votes: votes[1] }],
  });
  const called = districtCard("ocd-division/country:us/state:az/cd:6", resultsByDistrict([sen("D", [531, 469], true)])["ocd-division/country:us/state:az/cd:6"], false);
  assert.deepEqual(called.rows.map(r => [r.name, r.note]), [["A", "Won · 53.1%"], ["B", "Incumbent · lost"]]);
  assert.equal(called.meta, "Vote for 1");
  const counting = districtCard("ocd-division/country:us/state:az/cd:6", resultsByDistrict([sen("D", [531, 469], false)])["ocd-division/country:us/state:az/cd:6"], false);
  assert.ok(counting.rows.some(r => r.party === "C"));
});

test("a district with nothing filed has no rows, so its card says we are working on it", () => {
  const card = districtCard("ocd-division/country:us/state:tx/sldu:5", undefined, false);
  assert.equal(card.hasResult, false);
  assert.deepEqual(card.rows, []);
  assert.equal(card.flip, null);
});

test("Senate and House state cards", () => {
  assert.equal(senateCard("Ohio", undefined, false).meta, "No U.S. Senate race this year");
  assert.equal(senateCard("Ohio", undefined, false).raceThisYear, false);
  assert.deepEqual(houseStateMeta("Ohio", 3, false), { title: "U.S. House, Ohio", meta: "3 seats flipped so far" });
  assert.equal(houseStateMeta("Arizona", 1, true).meta, "Your state · 1 seat flipped so far");
  assert.equal(houseStateMeta("Utah", 0, false).meta, "No flips reported yet");
});

import { outlineBounds } from "../lib/map/results-counties.ts";
test("a state's box covers every part of its outline", () => {
  assert.deepEqual(outlineBounds({ geometry: { coordinates: [[[0, 0], [10, 0], [10, 5], [0, 0]], [[20, 20], [21, 22], [20, 20]]] } }), [[0, 0], [21, 22]]);
  assert.deepEqual(outlineBounds({ geometry: { coordinates: [[[-170, 60], [-130, 55], [-150, 70], [-170, 60]], [[172, 52], [179, 51], [175, 53], [172, 52]]] } }), [[-188, 51], [-130, 70]]);
  assert.equal(outlineBounds(null), null);
  assert.equal(outlineBounds({ geometry: { coordinates: [] } }), null);
});

test("a state with a primary and a general on file shows the latest election that has results", () => {
  const race: Race = { id: "r", ocdId: az("sldu", 1), status: "called", people: [["A", "Democrat", false, true, 1]] };
  const primary = ballotOf([race], "2026-07-21"), general = ballotOf([race], "2026-11-03"), upcoming = ballotOf([], "2026-12-01");
  const found = factsOf([race]);
  assert.equal(latestResultBallot([primary as BallotSet, upcoming as BallotSet, general as BallotSet], found)?.election.date, "2026-11-03");
  assert.equal(latestResultBallot([upcoming as BallotSet], found), null);
});

test("a results link opens the map: /?results, with or without a value, and not any other query", () => {
  assert.equal(resultsRequestedBy("?results"), true);
  assert.equal(resultsRequestedBy("?zip=85704&results=1"), true);
  assert.equal(resultsRequestedBy("?zip=85704"), false);
  assert.equal(resultsRequestedBy(""), false);
});

test("redrawing the results keeps the large state-shapes source and closing them removes everything", async () => {
  const { clearResultLayers, drawResultLayers } = await import("../lib/map/results-apply.ts");
  const sources = new Map<string, unknown>(), layers: { id: string }[] = [];
  const map = { getStyle: () => ({ layers: [...layers] }), removeLayer: (id: string) => { layers.splice(layers.findIndex(l => l.id === id), 1); },
    getSource: (id: string) => sources.get(id), addSource: (id: string, spec: unknown) => { sources.set(id, spec); }, removeSource: (id: string) => { sources.delete(id); },
    addLayer: (layer: { id: string }) => { layers.push(layer); }, hasImage: () => true, addImage: () => undefined } as unknown as import("maplibre-gl").Map;
  (globalThis as { window?: unknown }).window = { location: { href: "https://example.org/" } };
  const states = resultLayers({ kind: "states" }, {}, { theme: "dark", yours: [] });
  const badges = { type: "FeatureCollection" as const, features: [] };
  drawResultLayers(map, states, { theme: "dark", states: true, badges });
  const held = sources.get("results-states");
  assert.ok(held && sources.has("results-state-badges"));
  drawResultLayers(map, states, { theme: "dark", states: true, badges });
  assert.equal(sources.get("results-states"), held, "a redraw does not make the browser parse the shapes again");
  clearResultLayers(map, true);
  assert.equal(sources.size, 0);
  assert.equal(layers.length, 0);
  delete (globalThis as { window?: unknown }).window;
});
