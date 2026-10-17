/** The places a deploy warms come from the published manifest, one ZIP per county. */
import assert from "node:assert/strict";
import test from "node:test";

import { publishedCountyDivisions, warmPlacesForCounties } from "../lib/ops/warm-places.ts";

const D = (rest: string) => `ocd-division/country:us/${rest}`;

test("only county divisions are taken from the published places, once each", () => {
  const divisions = [
    D("state:az/county:cochise"), D("state:az/county:cochise#governing"),
    D("state:az/place:tombstone"), D("state:oh/county:delaware"),
    D("state:oh"), D("state:oh/county:delaware/school_district:x"), D("state:az/county:cochise"),
  ];
  assert.deepEqual(publishedCountyDivisions(divisions), [D("state:az/county:cochise"), D("state:oh/county:delaware")]);
});

test("one place per county: its lowest ZIP and the map's centroid; a shared ZIP warms once; gaps are counted", () => {
  const zips: Record<string, string> = { a: "11111", b: "11111", c: "22222" };
  const out = warmPlacesForCounties({
    counties: ["a", "b", "c", "d"],
    zipFor: (c) => zips[c],
    centroidFor: (z) => (z === "22222" ? null : { lat: 1, lng: 2 }),
  });
  assert.deepEqual(out.places, [{ zip: "11111", lat: 1, lng: 2 }]);
  assert.equal(out.skipped, 2, "no centroid for c, no ZIP for d");
});
