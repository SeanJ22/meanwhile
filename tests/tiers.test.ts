import assert from "node:assert/strict";
import { test } from "node:test";

import {
  matchesTiers,
  ocdSegmentValue,
  ocdSegments,
  tierForOcdId,
} from "../lib/ocd/tiers.ts";

test("tier comes from the deepest segment, not the first", () => {
  // Contains country and state, but it is a city.
  assert.equal(
    tierForOcdId("ocd-division/country:us/state:az/place:tucson"),
    "local",
  );
  assert.equal(
    tierForOcdId("ocd-division/country:us/state:az/county:pima"),
    "local",
  );
});

test("congressional seats are national even though they nest under a state", () => {
  assert.equal(tierForOcdId("ocd-division/country:us/state:az/cd:7"), "national");
  assert.equal(tierForOcdId("ocd-division/country:us"), "national");
});

test("state legislative chambers are state", () => {
  assert.equal(
    tierForOcdId("ocd-division/country:us/state:az/sldl:18"),
    "state",
  );
  assert.equal(
    tierForOcdId("ocd-division/country:us/state:nh/sldu:7"),
    "state",
  );
  assert.equal(tierForOcdId("ocd-division/country:us/state:nj"), "state");
});

test("DC and territories are state-equivalents, but their seats are national", () => {
  assert.equal(tierForOcdId("ocd-division/country:us/district:dc"), "state");
  assert.equal(
    tierForOcdId("ocd-division/country:us/district:dc/cd:at-large"),
    "national",
  );
  assert.equal(tierForOcdId("ocd-division/country:us/territory:pr"), "state");
});

test("school districts and wards are local", () => {
  assert.equal(
    tierForOcdId(
      "ocd-division/country:us/state:nj/county:morris/school_district:rockaway-township",
    ),
    "local",
  );
  assert.equal(
    tierForOcdId("ocd-division/country:us/state:az/place:tucson/ward:3"),
    "local",
  );
});

test("an unrecognised division is null, never a guess", () => {
  // A source inventing a division type must surface as unknown rather than
  // being silently filed under whichever tier happened to be nearest.
  assert.equal(
    tierForOcdId("ocd-division/country:us/state:az/water_district:avra"),
    null,
  );
  assert.equal(tierForOcdId(""), null);
  assert.equal(tierForOcdId("nonsense"), null);
});

test("segments parse, and a malformed id yields none rather than throwing", () => {
  assert.deepEqual(
    ocdSegments("ocd-division/country:us/state:az/place:tucson"),
    [
      { key: "country", value: "us" },
      { key: "state", value: "az" },
      { key: "place", value: "tucson" },
    ],
  );
  assert.deepEqual(ocdSegments("ocd-division//state:az/broken"), [
    { key: "state", value: "az" },
  ]);
  assert.deepEqual(ocdSegments(""), []);
});

test("segment values read back", () => {
  const id = "ocd-division/country:us/state:az/county:pima";
  assert.equal(ocdSegmentValue(id, "state"), "az");
  assert.equal(ocdSegmentValue(id, "county"), "pima");
  assert.equal(ocdSegmentValue(id, "place"), null);
});

test("tier matching is empty-safe", () => {
  const tucson = "ocd-division/country:us/state:az/place:tucson";
  assert.equal(matchesTiers(tucson, ["local"]), true);
  assert.equal(matchesTiers(tucson, ["state", "national"]), false);
  // No tier selected shows nothing, rather than quietly showing everything.
  assert.equal(matchesTiers(tucson, []), false);
  assert.equal(matchesTiers("nonsense", ["local", "state", "national"]), false);
});
