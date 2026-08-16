import assert from "node:assert/strict";
import test from "node:test";

import { RADIUS_LADDER_KM } from "../lib/meetings/constants.ts";
import {
  requestRadiusKm,
  shouldRequery,
  viewportRadiusKm,
} from "../lib/map/viewport-radius.ts";

/**
 * **More viewport must never mean fewer pins** — g3 item 6, the author's find
 * (2026-08-16): "casually zooming out DROPS pins."
 *
 * The cause was not clustering and not culling. The map re-queried on settle
 * and the query carried no `radiusKm`, so the server used the ladder's first
 * rung — 25 km — at every zoom level. A wheel zoom pulls the centre toward
 * the cursor, so zooming out also MOVES the centre; once it moved past the
 * re-query threshold, a fresh 25 km circle was drawn around a new centre and
 * every pin in the old circle but not the new one disappeared. The reader
 * asked to see more and got less.
 */

test("the requested radius covers what the reader can see", () => {
  // Roughly a US-state-sized view. Whatever the exact figure, it must be far
  // wider than the default rung, or the extra viewport stays empty.
  const wide = viewportRadiusKm({ north: 36, south: 31, east: -108, west: -115 });
  assert.ok(wide > RADIUS_LADDER_KM[0], `${wide} km did not exceed the default rung`);
  assert.equal(requestRadiusKm(wide), Math.min(RADIUS_LADDER_KM[2], Math.ceil(wide)));
});

test("zooming in never asks for less than the default rung", () => {
  // One neighbourhood. A reader zoomed to a street still expects the
  // neighbourhood's meetings, and shrinking the circle would drop pins in the
  // other direction.
  const tight = viewportRadiusKm({
    north: 32.23,
    south: 32.21,
    east: -110.96,
    west: -110.98,
  });
  assert.ok(tight < RADIUS_LADDER_KM[0]);
  assert.equal(requestRadiusKm(tight), RADIUS_LADDER_KM[0]);
});

test("the request is capped at the ladder's top rung, which the server clamps to anyway", () => {
  assert.equal(requestRadiusKm(100_000), RADIUS_LADDER_KM[RADIUS_LADDER_KM.length - 1]);
});

test("a degenerate viewport falls back to the default rather than to zero", () => {
  // A zero or NaN radius would ask the server for nothing and get nothing —
  // an empty map produced by arithmetic, which is the render-default failure
  // in its cheapest form.
  assert.equal(requestRadiusKm(0), RADIUS_LADDER_KM[0]);
  assert.equal(requestRadiusKm(Number.NaN), RADIUS_LADDER_KM[0]);
  assert.equal(requestRadiusKm(-5), RADIUS_LADDER_KM[0]);
});

test("zooming out in place re-asks, even though the centre never moved", () => {
  // This is the half the distance threshold missed entirely.
  const here = { lat: 32.217, lng: -110.971, radiusKm: 25 };
  assert.equal(
    shouldRequery(here, { ...here, radiusKm: 25 }),
    false,
    "an identical view re-queried for nothing",
  );
  assert.equal(
    shouldRequery(here, { ...here, radiusKm: 60 }),
    true,
    "a reader zoomed out and the map never widened its question",
  );
});

test("zooming IN never re-asks for a smaller circle", () => {
  const wide = { lat: 32.217, lng: -110.971, radiusKm: 150 };
  assert.equal(
    shouldRequery(wide, { ...wide, radiusKm: 25 }),
    false,
    "zooming in threw away pins the reader could still see",
  );
});

test("a real pan still re-asks", () => {
  const here = { lat: 32.217, lng: -110.971, radiusKm: 25 };
  assert.equal(
    shouldRequery(here, { lat: 32.6, lng: -110.971, radiusKm: 25 }),
    true,
  );
});

test("the first settle always asks", () => {
  assert.equal(shouldRequery(null, { lat: 0, lng: 0, radiusKm: 25 }), true);
});

/**
 * The invariant itself, stated as arithmetic rather than as a screenshot: a
 * strictly wider viewport can only ever produce a wider or equal request, so
 * the served set can only ever grow.
 */
test("a wider viewport never produces a narrower request", () => {
  let previous = 0;
  for (const span of [0.01, 0.05, 0.2, 1, 3, 8, 20]) {
    const km = viewportRadiusKm({
      north: 32 + span,
      south: 32 - span,
      east: -110 + span,
      west: -110 - span,
    });
    const asked = requestRadiusKm(km);
    assert.ok(
      asked >= previous,
      `a viewport of ±${span}° asked for ${asked} km after a narrower one asked for ${previous} km`,
    );
    previous = asked;
  }
});
