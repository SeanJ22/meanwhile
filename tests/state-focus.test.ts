import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NO_STATE,
  capSpecToSpan,
  clipRingToBox,
  extrusionSpecForZoom,
  filterStateAbbr,
  riseAlphasFor,
  simplifyScreenRing,
  stateAbbrFromOcdId,
  stateFilter,
  stateOcdIdAt,
  type ScreenPoint,
  type StateOutlines,
} from "../lib/map/state-focus.ts";
import { DISTRICT_TYPES, DISTRICT_LAYERS } from "../lib/map/districts.ts";

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

test("a point resolves to the state it is actually in", () => {
  assert.equal(stateOcdIdAt(OUTLINES, 0, 0), "ocd-division/country:us/state:az");
  assert.equal(stateOcdIdAt(OUTLINES, 55, 52), "ocd-division/country:us/state:nh");
});

test("a point in no covered state resolves to NULL, never to the last one", () => {

  assert.equal(stateOcdIdAt(OUTLINES, 0, 200), null);
  assert.equal(stateOcdIdAt(null, 0, 0), null);
});

test("the state code comes off the OCD-ID, never off a name string", () => {
  assert.equal(stateAbbrFromOcdId("ocd-division/country:us/state:az"), "AZ");
  assert.equal(stateAbbrFromOcdId("ocd-division/country:us/state:nh"), "NH");
  // A district's own id is not a state id, and must not be mistaken for one.
  assert.equal(stateAbbrFromOcdId("ocd-division/country:us/state:az/cd:7"), null);
  assert.equal(stateAbbrFromOcdId(null), null);
});

test("national district kinds have Census layers without an active-state file list", () => {
  assert.deepEqual(DISTRICT_LAYERS.municipal.censusLayers, ["place", "cousub"]);
  for (const type of DISTRICT_TYPES) assert.ok(DISTRICT_LAYERS[type].censusLayers.length > 0);
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

  for (const zoom of [0, 1, 2, 3, 4, 6, 8, 10, 14, 18]) {
    const spec = extrusionSpecForZoom(zoom);
    assert.ok(spec.offsetPx > 0, `the rise vanished at zoom ${zoom}`);
    assert.ok(spec.blurPx > 0, `the blur vanished at zoom ${zoom}`);
    assert.ok(spec.featherPx > 0, `the feather vanished at zoom ${zoom}`);
  }
});

test("the offset stays comparable to the blur at every zoom", () => {

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

const BOX = { minX: -120, minY: -120, maxX: 780, maxY: 920 };

const bboxOf = (points: readonly ScreenPoint[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};

test("a ring far larger than the viewport comes back no larger than the box", () => {
  // A large state at city zoom, near enough: roughly 16,800 x 20,000 CSS pixels.
  const huge: ScreenPoint[] = [
    { x: -10869, y: -16547 },
    { x: 5940, y: -16547 },
    { x: 5940, y: 3432 },
    { x: -10869, y: 3432 },
  ];
  const clipped = clipRingToBox(huge, BOX);
  assert.ok(clipped.length >= 3, "a viewport inside the state keeps a region");
  const bbox = bboxOf(clipped);
  assert.ok(bbox.minX >= BOX.minX - 0.001, `minX ${bbox.minX}`);
  assert.ok(bbox.minY >= BOX.minY - 0.001, `minY ${bbox.minY}`);
  assert.ok(bbox.maxX <= BOX.maxX + 0.001, `maxX ${bbox.maxX}`);
  assert.ok(bbox.maxY <= BOX.maxY + 0.001, `maxY ${bbox.maxY}`);
  // And it is the whole box, because the viewport is entirely inside: the
  // scrim's even-odd clip then subtracts the box from the viewport rectangle
  // and leaves an empty region, which is "nothing is muted".
  assert.ok(bbox.maxX - bbox.minX > 800, "the box survives, not a sliver");
});

test("a ring entirely outside the viewport clips to NOTHING, which means everything is muted", () => {
  const elsewhere: ScreenPoint[] = [
    { x: 4000, y: 4000 },
    { x: 5000, y: 4000 },
    { x: 5000, y: 5000 },
    { x: 4000, y: 5000 },
  ];
  assert.deepEqual(clipRingToBox(elsewhere, BOX), []);
});

test("a ring already inside the box is returned unchanged", () => {
  const small: ScreenPoint[] = [
    { x: 100, y: 100 },
    { x: 300, y: 120 },
    { x: 260, y: 400 },
    { x: 90, y: 380 },
  ];
  assert.deepEqual(clipRingToBox(small, BOX), small);
});

test("a ring crossing the border keeps the crossing, on the border", () => {
  // Half in, half out to the east: the surviving edge must sit exactly on
  // maxX, because that is where the state's own edge leaves the screen and a
  // shadow cast from anywhere further out cannot reach back into view.
  const crossing: ScreenPoint[] = [
    { x: 400, y: 200 },
    { x: 9000, y: 200 },
    { x: 9000, y: 600 },
    { x: 400, y: 600 },
  ];
  const clipped = clipRingToBox(crossing, BOX);
  const bbox = bboxOf(clipped);
  assert.equal(bbox.minX, 400);
  assert.equal(bbox.maxX, BOX.maxX);
  assert.equal(bbox.minY, 200);
  assert.equal(bbox.maxY, 600);
});

test("a hole is clipped like any other ring, so a viewport inside one cancels to nothing", () => {
  // Even-odd: the outer ring and the hole both clip to the whole box, and two
  // crossings is outside. A reader standing in a hole is outside the state,
  // and the frame is muted — the same answer as standing in another state.
  const outer: ScreenPoint[] = [
    { x: -9000, y: -9000 },
    { x: 9000, y: -9000 },
    { x: 9000, y: 9000 },
    { x: -9000, y: 9000 },
  ];
  const hole: ScreenPoint[] = [
    { x: -4000, y: -4000 },
    { x: 4000, y: -4000 },
    { x: 4000, y: 4000 },
    { x: -4000, y: 4000 },
  ];
  const clippedOuter = clipRingToBox(outer, BOX);
  const clippedHole = clipRingToBox(hole, BOX);
  assert.deepEqual(bboxOf(clippedOuter), bboxOf(clippedHole));
});

test("the clip runs before simplification and leaves a ring the simplifier can hold", () => {
  const huge: ScreenPoint[] = [
    { x: -10869, y: -16547 },
    { x: 5940, y: -16547 },
    { x: 5940, y: 3432 },
    { x: -10869, y: 3432 },
  ];
  const simplified = simplifyScreenRing(clipRingToBox(huge, BOX), 0.9);
  assert.ok(simplified.length >= 3, "never below a triangle");
  const bbox = bboxOf(simplified);
  assert.ok(bbox.maxX <= BOX.maxX + 0.001 && bbox.maxY <= BOX.maxY + 0.001);
});

test("the rise is capped by the size of the state it is marking", () => {

  const far = extrusionSpecForZoom(4);
  const tiny = capSpecToSpan(far, 25);
  assert.ok(tiny.featherPx <= 25 / 6, `feather ${tiny.featherPx} swamps a 25px state`);
  assert.ok(tiny.offsetPx <= 25 / 3);
  assert.ok(tiny.blurPx <= 25 / 3);

  // NEVER to zero. A rise that vanished on a small state would be the retired
  // release rule arriving through the back door — the same trap the zoom ramp
  // is written to avoid, one axis over.
  for (const span of [0.5, 1, 4, 12, 25]) {
    const capped = capSpecToSpan(far, span);
    assert.ok(capped.featherPx > 0, `feather vanished at span ${span}`);
    assert.ok(capped.offsetPx > 0, `offset vanished at span ${span}`);
    assert.ok(capped.blurPx > 0, `blur vanished at span ${span}`);
  }

  // A state larger than its own rise is untouched, as is anything filling the viewport.
  assert.deepEqual(capSpecToSpan(far, 4000), far);
  assert.deepEqual(capSpecToSpan(far, Number.POSITIVE_INFINITY), far);
  // No shape on screen at all leaves the spec alone rather than collapsing it.
  assert.deepEqual(capSpecToSpan(far, 0), far);
});

test("district:dc and all territory identifiers select their postal state", () => {
  for (const [prefix, code] of [["district", "dc"], ...["as", "gu", "mp", "pr", "vi"].map(code => ["territory", code])]) {
    assert.equal(stateAbbrFromOcdId(`ocd-division/country:us/${prefix}:${code}`), code.toUpperCase());
  }
});

test("a composed district filter reports the state while preserving boundary-kind selection", () => {
  assert.equal(filterStateAbbr(["all", ["==", ["get", "boundaryType"], "county"], stateFilter("NM")] as import("maplibre-gl").FilterSpecification), "NM");
  assert.equal(filterStateAbbr(["==", ["get", "boundaryType"], "county"]), null);
});
