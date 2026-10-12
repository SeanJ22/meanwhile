import test from "node:test";
import assert from "node:assert/strict";

import {
  NEARBY_RADIUS_MILES,
  milesBetween,
  milesLabel,
  sitesNearestFirst,
  type VotingSite,
} from "../lib/ballot/voting-sites.ts";

const site = (id: string, lat: number | null, lng: number | null): VotingSite =>
  ({
    id,
    name: `Site ${id}`,
    address: `${id} Main Street`,
    room: null,
    lat,
    lng,
    kind: "ELECTION_DAY",
    election: null,
    serves: null,
  }) as VotingSite;

const HOME = { lat: 40.9, lng: -74.52 };

test("VOT-1 — THE LOAD-BEARING CASE: every site comes back, sorted or not", () => {
  const input = [
    site("far", 40.99, -74.42),
    site("near", 40.902, -74.522),
    site("unplaced", null, null),
    site("mid", 40.93, -74.5),
  ];
  for (const point of [HOME, null]) {
    const out = sitesNearestFirst(input, point);
    assert.equal(out.length, input.length, "a site was dropped — that is a filter, not a sort");
    assert.deepEqual(
      out.map((r) => r.site.id).sort(),
      input.map((s) => s.id).sort(),
      "the set changed between input and output",
    );
  }
});

test("VOT-1: the closest placed site is first", () => {
  const out = sitesNearestFirst(
    [site("far", 40.99, -74.42), site("near", 40.902, -74.522), site("mid", 40.93, -74.5)],
    HOME,
  );
  assert.deepEqual(out.map((r) => r.site.id), ["near", "mid", "far"]);
  assert.ok((out[0].miles ?? Infinity) < 1, `the nearest site measured ${String(out[0].miles)} miles`);
});

test("VOT-1: an UNPLACED site keeps its published order after the placed ones", () => {
  const out = sitesNearestFirst(
    [site("unplaced-a", null, null), site("near", 40.902, -74.522), site("unplaced-b", null, null)],
    HOME,
  );
  assert.deepEqual(out.map((r) => r.site.id), ["near", "unplaced-a", "unplaced-b"]);
  assert.equal(out[1].miles, null);
  assert.equal(out[2].miles, null);
});

test("VOT-1: with NO resolved point the authority's own order stands", () => {
  const input = [site("c", 40.99, -74.42), site("a", 40.902, -74.522), site("b", 40.93, -74.5)];
  const out = sitesNearestFirst(input, null);
  assert.deepEqual(out.map((r) => r.site.id), ["c", "a", "b"]);
  for (const r of out) assert.equal(r.miles, null);
});

test("VOT-1: the distance is a real great-circle measure, checked against a known pair", () => {
  // Newark NJ to Trenton NJ is about 48 statute miles.
  const miles = milesBetween({ lat: 40.7357, lng: -74.1724 }, { lat: 40.2206, lng: -74.7597 });
  assert.ok(miles > 44 && miles < 52, `Newark to Trenton measured ${miles} miles`);
  assert.equal(milesBetween(HOME, HOME), 0);
});

test("VOT-1: the radius Sean named is the radius the map draws", () => {
  assert.equal(NEARBY_RADIUS_MILES, 10);
});

test("VOT-1: a distance reads as a sentence, and one mile is singular", () => {
  assert.equal(milesLabel(0.84), "0.8 miles away");
  assert.equal(milesLabel(1), "1 mile away");
  assert.equal(milesLabel(12.4), "12 miles away");
});
