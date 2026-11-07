import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  districtTitle, fillClass, flipCount, flipParty, houseFlipsByState, parseDistrictOcd, resultContests, resultsByDistrict,
  type ContestStatus, type ResultContest, type ResultParty,
} from "../lib/map/results.ts";

interface MultiStateRow {
  chamber: "House" | "Senate"; district: string; numSeats: number; status: string;
  flipped: { from: string; to: string; seats?: number } | null;
  candidates: { name: string; party: string; incumbent: boolean; result: string; votes: number | null }[];
}
/** Arizona's real 2026 legislative results from MultiState's public file (tests/fixtures). */
const rows = (JSON.parse(readFileSync(new URL("./fixtures/multistate-az-results.json", import.meta.url), "utf8")) as { legislative: MultiStateRow[] }).legislative;
const party = (code: string): ResultParty => code === "D" ? "D" : code === "R" ? "R" : "O";
const status = (value: string): ContestStatus => value === "Called" ? "called" : value === "Certified" ? "certified" : "counting";
const azContests: ResultContest[] = rows.map(row => ({
  ocdId: `ocd-division/country:us/state:az/${row.chamber === "Senate" ? "sldu" : "sldl"}:${row.district}`,
  status: status(row.status),
  seats: row.numSeats,
  flip: row.flipped ? { to: party(row.flipped.to), seats: row.flipped.seats ?? 1 } : null,
  candidates: row.candidates.filter(c => c.result === "Won" || c.result === "Lost" || c.result === "Pending").map(c => ({
    name: c.name, party: party(c.party), incumbent: c.incumbent, result: c.result === "Won" ? "won" : null, votes: c.votes,
  })),
}));
const results = resultsByDistrict(azContests);
const lower = Object.values(results).filter(r => parseDistrictOcd(r.ocdId)?.kind === "sldl");
const upper = Object.values(results).filter(r => parseDistrictOcd(r.ocdId)?.kind === "sldu");
const seatsOf = (list: typeof lower, p: string) => list.flatMap(r => r.seats).filter(s => s.party === p).length;

test("every Arizona district gets a result, with every seat accounted for", () => {
  assert.equal(lower.length, 30);
  assert.equal(upper.length, 30);
  assert.equal(lower.flatMap(r => r.seats).length, 60);
  assert.equal(upper.flatMap(r => r.seats).length, 30);
});

test("seat counts match the called winners in MultiState's file", () => {
  const won = (chamber: string, p: string) => rows.filter(r => r.chamber === chamber).flatMap(r => r.candidates).filter(c => c.result === "Won" && c.party === p).length;
  for (const p of ["D", "R"]) {
    assert.equal(seatsOf(lower, p), won("House", p));
    assert.equal(seatsOf(upper, p), won("Senate", p));
  }
  assert.equal(seatsOf(lower, "C") + seatsOf(upper, "C"), rows.reduce((n, r) => n + r.numSeats - r.candidates.filter(c => c.result === "Won").length, 0));
});

test("flips follow the source's flipped seats, in the gaining party's direction", () => {
  const flippedSeats = (list: typeof lower) => list.reduce((n, r) => n + flipCount(r), 0);
  const expected = (chamber: string) => rows.filter(r => r.chamber === chamber && r.flipped).reduce((n, r) => n + (r.flipped!.seats ?? 1), 0);
  assert.equal(flippedSeats(lower), expected("House"));
  assert.equal(flippedSeats(upper), expected("Senate"));
  assert.ok(flippedSeats(lower) > 0, "the fixture should carry flips");
  for (const r of [...lower, ...upper]) if (flipCount(r)) assert.equal(flipParty(r), "D");
});

test("a two-seat district split between parties draws as split, one still counting draws as counting", () => {
  const classes = new Set(Object.values(results).map(fillClass));
  assert.ok(classes.has("D") && classes.has("R"));
  for (const r of Object.values(results)) {
    const parties = new Set(r.seats.map(s => s.party));
    if (parties.has("C")) assert.equal(fillClass(r), "counting");
    else if (parties.size > 1) assert.equal(fillClass(r), "split");
  }
  const split = Object.values(results).find(r => fillClass(r) === "split");
  assert.ok(split, "Arizona has districts that sent one member of each party");
  assert.equal(split.seats.length, 2);
});

test("titles and ids", () => {
  assert.equal(districtTitle("ocd-division/country:us/state:az/sldl:17"), "State House, District 17");
  assert.equal(districtTitle("ocd-division/country:us/state:az/sldu:4"), "State Senate, District 4");
  assert.equal(districtTitle("ocd-division/country:us/state:az/cd:6"), "U.S. House, District 6");
  assert.deepEqual(parseDistrictOcd("ocd-division/country:us/state:az/cd:6"), { state: "az", kind: "cd", number: "6" });
  assert.equal(parseDistrictOcd("ocd-division/country:us/state:az"), null);
});

test("phone House view counts flipped seats by state", () => {
  const cd = (state: string, n: number, flip: boolean, to: ResultParty = "D"): ResultContest => ({
    ocdId: `ocd-division/country:us/state:${state}/cd:${n}`, status: "called", seats: 1, flip: flip ? { to, seats: 1 } : null,
    candidates: [{ name: "A", party: to, incumbent: false, result: "won", votes: 1 }],
  });
  const byState = houseFlipsByState(resultsByDistrict([cd("oh", 7, true), cd("oh", 10, true), cd("oh", 1, false), cd("pa", 1, true, "R")]));
  assert.deepEqual(byState, { oh: { count: 2, party: "D" }, pa: { count: 1, party: "R" } });
});

test("a ballot without result fields yields no results, so the map shows its banner", () => {
  const ballot = {
    contests: [{ id: "c1", ocdId: "ocd-division/country:us/state:az/cd:6", voteFor: 1 }],
    candidacies: [{ contestId: "c1", givenName: "A", familyName: "B", partyLabel: "Democrat", incumbent: false }],
  };
  assert.deepEqual(resultContests(ballot), []);
});

test("result fields on a ballot turn into contests", () => {
  const ballot = {
    contests: [{ id: "c1", ocdId: "ocd-division/country:us/state:az/cd:6", voteFor: 1, result: { status: "called" as const, flip: { to: "D" as const, seats: 1 } } }],
    candidacies: [
      { contestId: "c1", givenName: "JoAnna", familyName: "Mendoza", partyLabel: "Democrat", incumbent: false, result: { outcome: "won" as const, votes: 181117 } },
      { contestId: "c1", givenName: "Juan", familyName: "Ciscomani", partyLabel: "Republican", incumbent: true, result: { outcome: null, votes: 160000 } },
    ],
  };
  const [district] = Object.values(resultsByDistrict(resultContests(ballot)));
  assert.equal(fillClass(district), "D");
  assert.equal(flipParty(district), "D");
  assert.equal(district.candidates[1].incumbent, true);
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
  assert.equal(groups.D.length + groups.R.length + groups.split.length + groups.counting.length + groups.O.length, 30);
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

import { closeResults, getResultsScope, openResults, setResultsDistricts, setResultsScope, showResultsState } from "../lib/map/results-scope.ts";

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

import { inRequest, mapResults, parseResultsRequest } from "../lib/map/results-read.ts";

test("requests parse to one state, the Senate, or the House; anything else is refused", () => {
  assert.deepEqual(parseResultsRequest(new URLSearchParams("scope=state&state=az")), { scope: "state", state: "AZ" });
  assert.deepEqual(parseResultsRequest(new URLSearchParams("scope=us-senate")), { scope: "us-senate" });
  assert.deepEqual(parseResultsRequest(new URLSearchParams("scope=us-house")), { scope: "us-house" });
  for (const bad of ["scope=state", "scope=state&state=arizona", "scope=county", ""]) assert.equal(parseResultsRequest(new URLSearchParams(bad)), null);
});

test("a state request returns only that state's districts; Senate returns states; House returns districts only", async () => {
  const contest = (ocdId: string): ResultContest => ({ ocdId, status: "called", seats: 1, flip: null, candidates: [{ name: "A", party: "D", incumbent: false, result: "won", votes: 1 }] });
  const all = [contest("ocd-division/country:us/state:az/sldu:1"), contest("ocd-division/country:us/state:tx/sldu:1"), contest("ocd-division/country:us/state:az/cd:6"),
    contest("ocd-division/country:us/state:az"), contest("ocd-division/country:us/district:dc")];
  const read = async () => all;
  assert.deepEqual(Object.keys(await mapResults({ scope: "state", state: "AZ" }, read)).sort(), ["ocd-division/country:us/state:az/cd:6", "ocd-division/country:us/state:az/sldu:1"]);
  assert.deepEqual(Object.keys(await mapResults({ scope: "us-senate" }, read)).sort(), ["ocd-division/country:us/district:dc", "ocd-division/country:us/state:az"]);
  assert.deepEqual(Object.keys(await mapResults({ scope: "us-house" }, read)), ["ocd-division/country:us/state:az/cd:6"]);
  assert.equal(inRequest({ scope: "state", state: "AZ" }, "ocd-division/country:us/state:az/county:pima"), false);
});

test("with no filed results the read is empty, so every district shows the banner", async () => {
  assert.deepEqual(await mapResults({ scope: "state", state: "TX" }), {});
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
  const four = rows.find(row => row.chamber === "House" && row.district === "4")!;
  const district = results[sldl(4)];
  const card = districtCard(sldl(4), district, true);
  assert.equal(card.title, "State House, District 4");
  assert.equal(card.meta, "Your district · Top 2 win");
  assert.deepEqual(card.flip, { party: "D", label: "2 seats flipped" });
  const won = four.candidates.filter(c => c.result === "Won").map(c => c.name);
  assert.deepEqual(card.rows.filter(r => r.note === "Won").map(r => r.name).sort(), won.sort());
  const lostIncumbents = four.candidates.filter(c => c.incumbent && c.result !== "Won").map(c => c.name);
  assert.ok(lostIncumbents.includes("Matt Gress"));
  assert.deepEqual(card.rows.filter(r => r.note === "Incumbent · lost").map(r => r.name).sort(), lostIncumbents.sort());
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
