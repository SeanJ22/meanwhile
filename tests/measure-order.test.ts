import { azBallot, azPlaceMeasures } from "./helpers/ballot-district-fixtures.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { measureNumber, orderMeasures } from "../lib/ballot/measure-order.ts";
import type { Contest } from "../lib/ballot/types.ts";
import { installBallots, installPlaceMeasures } from "./helpers/promoted-fixtures.ts";
import { readerBallotSources } from "../lib/ballot/reader-sources.ts";

const contest = (id: string, title: string, ballotOrder?: number): Contest & { ballotOrder?: number } =>
  ({
    id,
    title,
    type: "MEASURE",
    electionId: "e",
    ocdId: "ocd-division/country:us/state:az",
    divisionVintage: "2020",
    voteFor: 1,
    termYears: null,
    // Present only when the authority published one, so absence is not a zero.
    ...(ballotOrder === undefined ? {} : { ballotOrder }),
  }) as Contest & { ballotOrder?: number };

test("BAL-29: Proposition 423 precedes 425, the reported regression", () => {
  const ordered = orderMeasures([
    contest("ballot-az-pima:prop-425", "Proposition 425: Permanent Base Adjustment"),
    contest("ballot-az-pima:prop-423", "Proposition 423: Vail Unified School District budget override continuation"),
  ]);
  assert.deepEqual(
    ordered.map((m) => measureNumber(m)),
    [423, 425],
  );
});

test("BAL-29: the reader composes and orders state, county and school measures", async () => {
  await installBallots(azBallot);
  await installPlaceMeasures(...azPlaceMeasures);
  const sources = await readerBallotSources([
    "ocd-division/country:us/state:az",
    "ocd-division/country:us/state:az/county:pima",
    "ocd-division/country:us/state:az/school_district:vail_unified_district",
  ]);
  assert.equal(sources.length, 1);
  const set = sources[0].source.normalize(await sources[0].source.fetch());
  const measures = set.contests.filter((c) => c.type === "MEASURE");
  assert.equal(measures.length, 10, "eight state measures join only the county and school in scope");
  const numbers = orderMeasures(measures.slice().reverse()).map(measureNumber);
  assert.deepEqual(
    numbers,
    [141, 142, 144, 316, 317, 318, 319, 320, 423, 425],
    "measures must come out in ascending proposition order",
  );
  assert.deepEqual(orderMeasures(measures).map(measureNumber), numbers);
});

test("BAL-29 control: three digits never sort before two", () => {
  const ordered = orderMeasures([
    contest("x:prop-100", "Proposition 100: Something"),
    contest("x:prop-20", "Proposition 20: Something else"),
    contest("x:prop-9", "Proposition 9: A third thing"),
  ]);
  assert.deepEqual(ordered.map(measureNumber), [9, 20, 100]);

  const lexicographic = [...ordered]
    .map((m) => m.title)
    .sort();
  assert.equal(lexicographic[0], "Proposition 100: Something");
});

test("BAL-29 control: a published ballot order beats the number", () => {
  const ordered = orderMeasures([
    contest("x:prop-423", "Proposition 423: later on the ballot", 2),
    contest("x:prop-425", "Proposition 425: first on the ballot", 1),
  ]);
  assert.deepEqual(ordered.map(measureNumber), [425, 423]);
});

test("BAL-29 control: authority-placed measures stay ahead of unplaced ones", () => {
  // Guessing where an unplaced measure belongs inside an official order would invent a ballot.
  const ordered = orderMeasures([
    contest("x:prop-500", "Proposition 500: unplaced"),
    contest("x:prop-9", "Proposition 9: placed second", 2),
    contest("x:prop-8", "Proposition 8: placed first", 1),
  ]);
  assert.deepEqual(ordered.map(measureNumber), [8, 9, 500]);
});

test("BAL-29 control: an unnumbered question keeps a stable place, never a random one", () => {
  const ordered = orderMeasures([
    contest("x:q-b", "Bond authorization for the regional library"),
    contest("x:prop-12", "Proposition 12: numbered"),
    contest("x:q-a", "Athletic facilities question"),
  ]);
  assert.equal(measureNumber(ordered[0]), 12, "numbered measures come first");
  assert.deepEqual(
    ordered.slice(1).map((m) => m.title),
    [
      "Athletic facilities question",
      "Bond authorization for the regional library",
    ],
  );
});

test("BAL-29: ordering never drops or duplicates a measure", () => {
  const input = [
    contest("x:prop-425", "Proposition 425: a"),
    contest("x:prop-423", "Proposition 423: b"),
    contest("x:q-none", "An unnumbered question"),
    contest("x:prop-1", "Proposition 1: c", 3),
  ];
  const ordered = orderMeasures(input);
  assert.equal(ordered.length, input.length);
  assert.deepEqual(
    ordered.map((m) => m.id).sort(),
    input.map((m) => m.id).sort(),
  );
});

test("BAL-29: the number is read from the title, and the id is only a fallback", () => {
  assert.equal(measureNumber({ title: "Proposition 425: X", id: "junk" }), 425);
  assert.equal(measureNumber({ title: "Prop. No. 7 — Y", id: "junk" }), 7);
  assert.equal(measureNumber({ title: "Untitled", id: "ballot-az-pima:prop-318" }), 318);
  assert.equal(measureNumber({ title: "A bond question", id: "x:q-bond" }), null);
});
