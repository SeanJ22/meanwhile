import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_RADIUS_KM, MAX_RADIUS_KM } from "../lib/meetings/constants.ts";
import {
  requestRadiusKm,
  shouldRequery,
  viewportRadiusKm,
} from "../lib/map/viewport-radius.ts";

test("the requested radius covers what the reader can see", () => {
  // Roughly a US-state-sized view. Whatever the exact figure, it must be far
  // wider than the default radius, or the extra viewport stays empty.
  const wide = viewportRadiusKm({ north: 36, south: 31, east: -108, west: -115 });
  assert.ok(wide > DEFAULT_RADIUS_KM, `${wide} km did not exceed the default radius`);
  assert.equal(requestRadiusKm(wide), Math.min(MAX_RADIUS_KM, Math.ceil(wide)));
});

test("zooming in never asks for less than the default radius", () => {
  // Shrinking the circle below the default radius would drop pins in the other direction.
  const tight = viewportRadiusKm({
    north: 32.23,
    south: 32.21,
    east: -110.96,
    west: -110.98,
  });
  assert.ok(tight < DEFAULT_RADIUS_KM);
  assert.equal(requestRadiusKm(tight), DEFAULT_RADIUS_KM);
});

test("the request is capped at the maximum radius, which the server clamps to anyway", () => {
  assert.equal(requestRadiusKm(100_000), MAX_RADIUS_KM);
});

test("a degenerate viewport falls back to the default rather than to zero", () => {
  // A zero or NaN radius would ask the server for nothing.
  assert.equal(requestRadiusKm(0), DEFAULT_RADIUS_KM);
  assert.equal(requestRadiusKm(Number.NaN), DEFAULT_RADIUS_KM);
  assert.equal(requestRadiusKm(-5), DEFAULT_RADIUS_KM);
});

test("zooming out in place re-asks, even though the centre never moved", () => {
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
