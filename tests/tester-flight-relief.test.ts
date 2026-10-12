import assert from "node:assert/strict";
import test from "node:test";
import { applicationLayer, holdMapPresentation, releaseMapPresentation, mapPresentationHeld, setPresentationVisible } from "../lib/map/flight-presentation.ts";
import type { Map as MapLibreMap } from "maplibre-gl";

test("presentation hold covers boundary and relief classes without changing base tiles", () => {
  const layers=["land","roads","district-county-line","district-school-unified-fill","state-relief-light","state-relief-shadow"];
  const changes: unknown[]=[];
  const map={getStyle:()=>({layers:layers.map(id=>({id}))}),setLayoutProperty:(...args:unknown[])=>changes.push(args)} as unknown as MapLibreMap;
  holdMapPresentation(map);
  setPresentationVisible(map,false);
  assert.ok(mapPresentationHeld(map));
  assert.deepEqual(changes, layers.filter(applicationLayer).map(id=>[id,"visibility","none"]));
  assert.ok(mapPresentationHeld(map));
  releaseMapPresentation(map);
  assert.equal(mapPresentationHeld(map),false);
});
