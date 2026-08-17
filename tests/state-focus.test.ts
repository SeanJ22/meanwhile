import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NO_STATE,
  extrusionSpecForZoom,
  filterStateAbbr,
  riseAlphasFor,
  simplifyScreenRing,
  stateAbbrFromOcdId,
  stateFilter,
  stateOcdIdAt,
  type StateOutlines,
} from "../lib/map/state-focus.ts";
import { DISTRICT_TYPES, filesFor } from "../lib/map/districts.ts";

/**
 * The state extrusion and the per-state map (g4 items 1, 2 and 3).
 *
 * These are the parts of those items that are DECIDABLE without a browser.
 * The pixels are the job of `pnpm measure:extrusion`, which subtracts the
 * effect from its own frame and reports gradients and lobe positions; this
 * file holds the rules underneath it — which state is raised, what gets
 * fetched, and the geometry that keeps the silhouette from sawing.
 */

/** A square state and a triangular one, in the shape the real file ships. */
const OUTLINES: StateOutlines = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        statefp: "04",
        name: "Squareland",
        ocdId: "ocd-division/country:us/state:az",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-10, -10],
            [-10, 10],
            [10, 10],
            [10, -10],
            [-10, -10],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        statefp: "33",
        name: "Farland",
        ocdId: "ocd-division/country:us/state:nh",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [50, 50],
            [50, 60],
            [60, 60],
            [50, 50],
          ],
        ],
      },
    },
  ],
};

/* ---------------------------------------------- item 1: whose mask is it --- */

test("a point resolves to the state it is actually in", () => {
  assert.equal(stateOcdIdAt(OUTLINES, 0, 0), "ocd-division/country:us/state:az");
  assert.equal(stateOcdIdAt(OUTLINES, 55, 52), "ocd-division/country:us/state:nh");
});

test("a point in no covered state resolves to NULL, never to the last one", () => {
  /*
   * The whole of g4 item 1 in one assertion.
   *
   * The shipped `activateAt` read this as "if I cannot identify a state,
   * change nothing", so an unresolvable point left the previous state raised
   * and the reader looked at Arizona through New Hampshire's mask. A null
   * here has to stay a null all the way to the map: no state raised, and
   * nothing muted.
   */
  assert.equal(stateOcdIdAt(OUTLINES, 0, 200), null);
  assert.equal(stateOcdIdAt(null, 0, 0), null);
});

/* --------------------------------------- item 3: only the active state --- */

test("the state code comes off the OCD-ID, never off a name string", () => {
  assert.equal(stateAbbrFromOcdId("ocd-division/country:us/state:az"), "AZ");
  assert.equal(stateAbbrFromOcdId("ocd-division/country:us/state:nh"), "NH");
  // A district's own id is not a state id, and must not be mistaken for one.
  assert.equal(stateAbbrFromOcdId("ocd-division/country:us/state:az/cd:7"), null);
  assert.equal(stateAbbrFromOcdId(null), null);
});

test("no active state fetches NOTHING for any district type", () => {
  for (const type of DISTRICT_TYPES) {
    assert.deepEqual(
      filesFor(type, null),
      [],
      `${type} tried to fetch with no state active`,
    );
  }
});

test("each state fetches its own files and no other state's", () => {
  const az = filesFor("congressional", "AZ");
  assert.deepEqual(az, ["cd119-04.geojson"]);

  const school = filesFor("school", "NH");
  assert.ok(school.length > 0, "New Hampshire fetches some school geometry");
  for (const file of school) {
    assert.ok(
      file.includes("-33."),
      `${file} is not New Hampshire's and must not be fetched for it`,
    );
  }
});

test("a national file is fetched for every state", () => {
  // county-us.geojson holds three counties in total; splitting it would cost
  // more in files than it saves in bytes, so the LAYER FILTER is what keeps
  // Pima off a New Hampshire map.
  for (const abbr of ["AZ", "NH", "NJ"]) {
    assert.deepEqual(filesFor("county", abbr), ["county-us.geojson"]);
  }
});

test("the layer filter pins a layer to one state, and reads back", () => {
  const filter = stateFilter("AZ");
  assert.equal(filterStateAbbr(filter), "AZ");
  // The no-state sentinel must read back as null, because that is the case
  // the walk asserts: nothing active means no boundaries anywhere.
  assert.equal(filterStateAbbr(stateFilter(null)), null);
  assert.equal(String((stateFilter(null) as unknown[])[2]), NO_STATE);
  assert.equal(filterStateAbbr(undefined), null);
});

/* ------------------------------------------------ item 2: the geometry --- */

test("simplification drops collinear noise and keeps the silhouette", () => {
  // A straight run of points with one real corner in it.
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0.2 },
    { x: 20, y: 0 },
    { x: 30, y: 0.1 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
  ];
  const simplified = simplifyScreenRing(points, 1);
  assert.ok(
    simplified.length < points.length,
    "sub-pixel wobble along a straight edge survived",
  );
  // The corner is the silhouette and may never be simplified away.
  assert.deepEqual(simplified.at(-1), { x: 40, y: 40 });
  assert.deepEqual(simplified[0], { x: 0, y: 0 });
});

test("simplification never reduces a ring below a triangle", () => {
  // An enormous tolerance would otherwise collapse the state to a line, and
  // an empty path clears the mask and un-mutes the whole country — a far
  // louder failure than a coarse shape.
  const ring = Array.from({ length: 20 }, (_, i) => ({
    x: Math.cos((i / 20) * Math.PI * 2),
    y: Math.sin((i / 20) * Math.PI * 2),
  }));
  assert.ok(simplifyScreenRing(ring, 10_000).length >= 3);
  // Already minimal input is returned intact rather than resampled.
  const triangle = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  assert.deepEqual(simplifyScreenRing(triangle, 5), triangle);
});

test("the rise scales with zoom and never reaches zero", () => {
  const near = extrusionSpecForZoom(14);
  const far = extrusionSpecForZoom(1);
  assert.ok(near.offsetPx > far.offsetPx, "the rise does not scale with zoom");
  assert.ok(near.blurPx > far.blurPx);

  /*
   * The author's ruling, as an assertion: the effect NEVER releases. e's 6b2
   * surrendered focus on zoom-out and g4 retired that rule, so a spec that
   * interpolated to zero would be the release arriving through the back door
   * — invisible in review, because the code would still say it draws.
   */
  for (const zoom of [0, 1, 2, 3, 4, 6, 8, 10, 14, 18]) {
    const spec = extrusionSpecForZoom(zoom);
    assert.ok(spec.offsetPx > 0, `the rise vanished at zoom ${zoom}`);
    assert.ok(spec.blurPx > 0, `the blur vanished at zoom ${zoom}`);
    assert.ok(spec.featherPx > 0, `the feather vanished at zoom ${zoom}`);
  }
});

test("the offset stays comparable to the blur at every zoom", () => {
  /*
   * The rejected build's actual arithmetic: two opposed strokes 4 px apart
   * and 7 px wide overlapped over most of their width and composited to the
   * grey band the author rejected. The same thing happens to two silhouettes
   * whose offset is small against their blur, so the ratio is pinned here
   * rather than left to whoever next retunes the look.
   */
  for (const zoom of [1, 4, 7, 10, 16]) {
    const spec = extrusionSpecForZoom(zoom);
    const ratio = spec.offsetPx / spec.blurPx;
    assert.ok(
      ratio >= 0.7 && ratio <= 1.4,
      `at zoom ${zoom} the offset:blur ratio is ${ratio.toFixed(2)} — the two ` +
        "silhouettes will overlap into a single grey band",
    );
  }
});

test("the light is brighter than the shade on a light ground", () => {
  /*
   * Measured, then pinned. A white silhouette at half opacity over a pale
   * basemap is almost invisible while the same black one is not, so one pair
   * of alphas for both themes produced a rim and no light in light mode —
   * `pnpm measure:extrusion` failed the one-light-source test at both zooms
   * in light and passed both in dark.
   */
  const light = riseAlphasFor("light");
  const dark = riseAlphasFor("dark");
  assert.ok(
    light.light > light.dark,
    "on a pale ground the highlight must outweigh the shadow",
  );
  assert.ok(light.light > dark.light, "the highlight is stronger on a pale ground");
  for (const alphas of [light, dark]) {
    assert.ok(alphas.light > 0 && alphas.light <= 1);
    assert.ok(alphas.dark > 0 && alphas.dark <= 1);
  }
});
