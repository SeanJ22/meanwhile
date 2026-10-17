import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NO_STATE,
  filterStateAbbr,
  stateAbbrFromOcdId,
  stateFilter,
  stateOcdIdAt,
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

test("district:dc and all territory identifiers select their postal state", () => {
  for (const [prefix, code] of [["district", "dc"], ...["as", "gu", "mp", "pr", "vi"].map(code => ["territory", code])]) {
    assert.equal(stateAbbrFromOcdId(`ocd-division/country:us/${prefix}:${code}`), code.toUpperCase());
  }
});

test("a composed district filter reports the state while preserving boundary-kind selection", () => {
  assert.equal(filterStateAbbr(["all", ["==", ["get", "boundaryType"], "county"], stateFilter("NM")] as import("maplibre-gl").FilterSpecification), "NM");
  assert.equal(filterStateAbbr(["==", ["get", "boundaryType"], "county"]), null);
});
