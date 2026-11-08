/**
 * The scorecard card's words and dot math: the control sentence, party lines, and seat-dot layout.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  scorecardsFromFacts,
  type ChamberScore, type Scorecard, type SeatCounts,
  chamberFlipped, chamberHeaderRows, columnsFor, controlSummary, dotSize, governorBlock, partyLines, scorecardSources, scorecardTitle,
  seatCountParts, seatGrid, statewideFlips,
} from "../lib/ballot/scorecard-view.ts";

const seats = (D: number, R: number, counting = 0, O = 0): SeatCounts => ({ D, R, O, counting });
const chamber = (name: string, total: number, toControl: number, before: SeatCounts, now: SeatCounts, controlBefore: "D" | "R" | null, controlNow: "D" | "R" | null, note?: string): ChamberScore =>
  ({ name, seats: total, toControl, before, now, controlBefore, controlNow, ...(note ? { note } : {}) });

const arizona: Scorecard = {
  scope: "AZ", name: "Arizona",
  chambers: [
    chamber("State House", 60, 31, seats(27, 33), seats(33, 17, 10), "R", "D"),
    chamber("State Senate", 30, 16, seats(13, 17), seats(19, 10, 1), "R", "D"),
  ],
  governor: { name: "Katie Hobbs", party: "D", flipped: false, reelected: true },
  statewide: { total: 8, flipped: [{ office: "Treasurer", to: "D" }, { office: "State Mine Inspector", to: "D" }] },
  incumbentsLostTotal: 9,
  sources: [{ what: "Results", from: "Arizona Secretary of State", checked: "2026-11-06T14:40:00Z", url: "https://azsos.gov/results" }],
};

const nation: Scorecard = {
  scope: "US", name: "Congress",
  chambers: [
    chamber("U.S. House", 435, 218, seats(215, 220), seats(251, 154, 30), "R", "D"),
    chamber("U.S. Senate", 100, 51, seats(47, 53), seats(54, 45, 1), "R", "D", "Counts include independents who vote with each party."),
  ],
  governor: null, statewide: null,
  incumbentsLostTotal: 31,
  sources: [],
};

test("the state sentence names who holds what now and who held the chambers before", () => {
  assert.equal(controlSummary(arizona),
    "Democrats now hold the governor’s office, the State House and the State Senate. Before the election, Republicans held both chambers.");
});

test("the national sentence says both without the word chambers", () => {
  assert.equal(controlSummary(nation), "Democrats now hold the U.S. House and the U.S. Senate. Before the election, Republicans held both.");
});

test("a split result names each party's offices and a chamber still undecided", () => {
  const split: Scorecard = { ...arizona, governor: { name: "A B", party: "R", flipped: false, reelected: false }, chambers: [
    chamber("State House", 60, 31, seats(27, 33), seats(33, 27), "R", "D"),
    chamber("State Senate", 30, 16, seats(13, 17), seats(14, 14, 2), "R", null),
  ] };
  assert.equal(controlSummary(split),
    "Democrats now hold the State House. Republicans now hold the governor’s office. No party has won the State Senate yet. Before the election, Republicans held both chambers.");
});

test("a state where nothing changed says so", () => {
  const same: Scorecard = { ...arizona, chambers: arizona.chambers.map(c => ({ ...c, controlBefore: "D", controlNow: "D" })) };
  assert.match(controlSummary(same), /No chamber changed party\.$/);
});

test("control that moved to a party is a flip, and unknown control is not", () => {
  assert.equal(chamberFlipped(arizona.chambers[0]), "D");
  assert.equal(chamberFlipped({ ...arizona.chambers[0], controlNow: null }), null);
  assert.equal(chamberFlipped({ ...arizona.chambers[0], controlBefore: null }), null);
  assert.deepEqual(chamberHeaderRows(arizona), [{ name: "State House", flippedTo: "D" }, { name: "State Senate", flippedTo: "D" }]);
});

test("the governor block says re-elected, won or flipped", () => {
  assert.deepEqual(governorBlock(arizona), { label: "Governor", text: "Katie Hobbs, Democrat, re-elected. The office did not change party." });
  assert.equal(governorBlock({ ...arizona, governor: { name: "Pat Lee", party: "R", flipped: true, reelected: false } })?.text, "Pat Lee, Republican, won. The office flipped to Republicans.");
  assert.equal(governorBlock({ ...arizona, governor: null }), null);
});

test("the national scorecard has no governor block", () => {
  assert.equal(governorBlock(nation), null);
});

test("statewide flips carry an exact count and appear only when there are some", () => {
  assert.deepEqual(statewideFlips(arizona)?.label, "Statewide offices that flipped · 2 of 8");
  assert.equal(statewideFlips({ ...arizona, statewide: { total: 8, flipped: [] } }), null);
  assert.equal(statewideFlips(nation), null);
});

test("seat counts read as colored text, with still counting only when there are some", () => {
  assert.deepEqual(seatCountParts(seats(27, 33)).map(part => part.text), ["27 Democrats", "33 Republicans"]);
  assert.deepEqual(seatCountParts(seats(33, 17, 10)).map(part => part.text), ["33 Democrats", "17 Republicans", "10 still counting"]);
  assert.deepEqual(seatCountParts(seats(1, 1, 0, 1)).map(part => part.text), ["1 Democrats", "1 Republicans", "1 independent"]);
});

test("the Arizona party scorecards: seats, governor, flips and incumbents lost, exact numbers", () => {
  const d = partyLines(arizona, "D");
  assert.deepEqual(d.map(line => [line.label, line.value, line.kind, line.hot]), [
    ["State House seats", "27 → 33", "plain", false],
    ["State Senate seats", "13 → 19", "plain", false],
    ["Governor", "Held", "held", false],
    ["Statewide offices flipped to this party", "2", "flip", true],
  ]);
  const r = partyLines(arizona, "R");
  assert.deepEqual(r.map(line => [line.label, line.value]).filter(([label]) => label === "Governor"),
    [["Governor", "Not held"]]);
  assert.equal(r.find(line => line.label === "Governor")?.kind, "plain");
});

test("the national party scorecards show the chamber seats and leave out the state-only lines", () => {
  const d = partyLines(nation, "D");
  assert.deepEqual(d.map(line => line.label), ["U.S. House seats", "U.S. Senate seats"]);
  assert.equal(d[0].value, "215 → 251");
});

test("dot size is 6 above 100 seats and 10 otherwise", () => {
  assert.equal(dotSize(435), 6);
  assert.equal(dotSize(101), 6);
  assert.equal(dotSize(100), 10);
  assert.equal(dotSize(30), 10);
});

test("columns are floor((width + 4) / (size + 4)), at least one", () => {
  assert.equal(columnsFor(450, 6), 45);
  assert.equal(columnsFor(450, 10), 32);
  assert.equal(columnsFor(246, 10), 17);
  assert.equal(columnsFor(3, 10), 1);
  assert.equal(columnsFor(0, 6), 1);
});

test("dots fill Democrats, still counting, then Republicans, one square per seat", () => {
  const grid = seatGrid(seats(2, 3, 1), 6, 450);
  assert.deepEqual(grid.groups.map(group => [group.kind, group.rects.length]), [["D", 2], ["counting", 1], ["R", 3]]);
  assert.equal(grid.size, 10);
  assert.deepEqual(grid.groups[0].rects, [{ x: 0, y: 0 }, { x: 14, y: 0 }]);
  assert.deepEqual(grid.groups[1].rects, [{ x: 28, y: 0 }]);
  assert.deepEqual(grid.groups[2].rects[0], { x: 42, y: 0 });
});

test("dots wrap at the measured width and the grid is exactly as big as its dots", () => {
  // 60 seats, 10px dots, 246px wide: 17 columns, 4 rows.
  const grid = seatGrid(seats(33, 17, 10), 60, 246);
  const all = grid.groups.flatMap(group => group.rects);
  assert.equal(all.length, 60);
  assert.equal(Math.max(...all.map(rect => rect.x)), 16 * 14);
  assert.equal(grid.width, 17 * 10 + 16 * 4);
  assert.equal(grid.height, 4 * 10 + 3 * 4);
  const house = seatGrid(seats(251, 154, 30), 435, 450);
  assert.equal(house.size, 6);
  assert.equal(house.groups.flatMap(group => group.rects).length, 435);
  assert.equal(house.width, 45 * 6 + 44 * 4);
  assert.equal(house.height, 10 * 6 + 9 * 4);
});

test("a small chamber never draws a wider grid than its seats", () => {
  const grid = seatGrid(seats(2, 1), 3, 900);
  assert.equal(grid.width, 3 * 10 + 2 * 4);
  assert.equal(grid.height, 10);
});

test("sources become the card's Sources entries", () => {
  assert.deepEqual(scorecardSources(arizona), [{
    what: "Results",
    provenance: { sourceUrl: "https://azsos.gov/results", sourceOrg: "Arizona Secretary of State", collectedAt: "2026-11-06T14:40:00Z", verifiedAt: "2026-11-06T14:40:00Z" },
  }]);
  assert.deepEqual(scorecardSources(undefined), []);
});

test("titles", () => {
  assert.equal(scorecardTitle(arizona, "Arizona", "AZ"), "Arizona after the election");
  assert.equal(scorecardTitle(undefined, "Texas", "TX"), "Texas after the election");
  assert.equal(scorecardTitle(nation, "United States", "US"), "Congress after the election");
});

test("the published result summaries become the state and United States scorecards", () => {
  const summary = (state: string, chambers: { name: string; before: Record<string, number>; now: Record<string, number>; counting: number; controlBefore: string; controlNow: string; seatsFlipped?: number }[]) => ({
    state, governor: { before: "R", now: "D", name: "Jordan Example" }, statewideOfficesFlipped: [{ office: "Treasurer", from: "R", to: "D" }], incumbentsLost: 7,
    chambers: chambers.map(chamber => ({ name: chamber.name, seatsBefore: chamber.before, seatsNow: chamber.now, stillCounting: chamber.counting,
      controlBefore: chamber.controlBefore, controlNow: chamber.controlNow, ...(chamber.seatsFlipped === undefined ? {} : { seatsFlipped: chamber.seatsFlipped }) })),
    source: { name: "MultiState", url: "https://example.test/ms" }, creditedSources: [{ name: "State election office" }], checkedAt: "2026-11-06T12:00:00.000Z" });
  const cards = scorecardsFromFacts({
    "ocd-division/country:us/state:az": summary("AZ", [{ name: "House", before: { D: 27, R: 33 }, now: { D: 37, R: 20 }, counting: 3, controlBefore: "R", controlNow: "D", seatsFlipped: 10 }]),
    "ocd-division/country:us#election_summary:us_senate": summary("US", [{ name: "us_senate", before: { D: 47, R: 53, I: 0 }, now: { D: 48, R: 50, I: 2, Vacant: 0 }, counting: 0, controlBefore: "R", controlNow: "R" }]),
  } as never, "AZ", "Arizona");
  assert.ok(cards);
  const house = cards.AZ.chambers[0];
  assert.deepEqual([house.name, house.seats, house.toControl, house.now.counting, house.seatsFlipped], ["State House", 60, 31, 3, 10]);
  assert.equal(chamberFlipped(house), "D");
  const senate = cards.US.chambers[0];
  assert.deepEqual([senate.name, senate.now.O, senate.controlNow], ["U.S. Senate", 2, "R"]);
  assert.deepEqual([cards.AZ.governor?.name, cards.AZ.governor?.flipped, cards.AZ.incumbentsLostTotal], ["Jordan Example", true, 7]);
  assert.deepEqual(cards.AZ.statewide?.flipped, [{ office: "Treasurer", to: "D" }]);
  assert.deepEqual(cards.AZ.sources.map((source: { from: string }) => source.from), ["MultiState", "State election office"]);
  assert.equal(scorecardsFromFacts({}, "AZ", "Arizona"), undefined);
});
