import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { directionalStateEdges, RELIEF_THEME } from "../lib/map/state-relief.ts";
import { applicationLayer, holdMapPresentation, releaseMapPresentation, mapPresentationHeld, setPresentationVisible } from "../lib/map/flight-presentation.ts";
import type { StateOutlines, StateOutlineFeature } from "../lib/map/state-focus.ts";
import type { Map as MapLibreMap } from "maplibre-gl";
import { HELD_GEOMETRY_FIPS } from "../lib/coverage/artifacts.ts";

test("every directional segment preserves the canonical state's exact border and river vertices", () => {
  const states: StateOutlines = JSON.parse(readFileSync("public/geo/state-outlines.geojson", "utf8"));
  assert.deepEqual(states.features.map(f => f.properties.statefp).sort(), HELD_GEOMETRY_FIPS.sort());
  for (const outline of states.features) {
    const result = directionalStateEdges(outline);
    for (const [ringIndex, ring] of outline.geometry.coordinates.entries()) {
      const expected = ring.slice(1).map((point, i) => JSON.stringify([ring[i], point]));
      const actual = result.features.filter(f => f.properties.ring === ringIndex).flatMap(f => f.geometry.coordinates.slice(1).map((point, i) => JSON.stringify([f.geometry.coordinates[i], point])));
      assert.deepEqual(actual, expected, `${outline.properties.name} ring ${ringIndex}: no changed, dropped, shifted or added edge`);
    }
  }
});

test("top/left edges face the light in either ring winding; bottom/right face shade", () => {
  const points = [[0,0],[1,0],[1,1],[0,1],[0,0]];
  for (const ring of [points, [...points].reverse()]) {
    const outline: StateOutlineFeature = { type:"Feature", properties:{statefp:"00", name:"geometry control", ocdId:"control"}, geometry:{type:"Polygon", coordinates:[ring]} };
    for (const feature of directionalStateEdges(outline).features) {
      for (let i=1;i<feature.geometry.coordinates.length;i++) {
        const [a,b]=[feature.geometry.coordinates[i-1],feature.geometry.coordinates[i]];
        const topOrLeft = (a[1]===1 && b[1]===1) || (a[0]===0 && b[0]===0);
        assert.equal(feature.properties.light, topOrLeft);
      }
    }
  }
  assert.notDeepEqual(RELIEF_THEME.light, RELIEF_THEME.dark);
});

test("presentation hold covers boundary and relief classes without changing base tiles", () => {
  const layers=["land","roads","district-county-line","district-school-unified-fill","state-relief-light","state-relief-shadow"];
  const changes: unknown[]=[];
  const map={getStyle:()=>({layers:layers.map(id=>({id}))}),setLayoutProperty:(...args:unknown[])=>changes.push(args)} as unknown as MapLibreMap;
  holdMapPresentation(map);
  setPresentationVisible(map,false);
  assert.ok(mapPresentationHeld(map));
  assert.deepEqual(changes, layers.filter(applicationLayer).map(id=>[id,"visibility","none"]));
  // Moveend alone does not release the hold; the caller's idle path does.
  assert.ok(mapPresentationHeld(map));
  releaseMapPresentation(map);
  assert.equal(mapPresentationHeld(map),false);
});
