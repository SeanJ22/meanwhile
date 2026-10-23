import assert from "node:assert/strict";
import test from "node:test";
import { applicationLayer, holdMapPresentation, releaseMapPresentation, mapPresentationHeld, setPresentationVisible } from "../lib/map/flight-presentation.ts";
import type { Map as MapLibreMap } from "maplibre-gl";

test("presentation hold covers boundary and relief classes without changing base tiles", () => {
  const layers=["land","roads","district-county-line","district-school-unified-fill","state-relief-light","state-relief-shadow"];
  const changes: unknown[]=[],visibility=new Map<string,string>();
  const map={getStyle:()=>({layers:layers.map(id=>({id}))}),getLayoutProperty:(id:string)=>visibility.get(id),
    setLayoutProperty:(id:string,key:string,value:string)=>{visibility.set(id,value);changes.push([id,key,value]);}} as unknown as MapLibreMap;
  setPresentationVisible(map,true);
  assert.deepEqual(changes,[],"the first visible style must not be rebuilt to assign its existing default");
  holdMapPresentation(map);
  setPresentationVisible(map,false);
  assert.ok(mapPresentationHeld(map));
  assert.deepEqual(changes, layers.filter(applicationLayer).map(id=>[id,"visibility","none"]));
  setPresentationVisible(map,false);
  assert.equal(changes.length,layers.filter(applicationLayer).length,"an already hidden layer does not restart worker layout");
  assert.ok(mapPresentationHeld(map));
  releaseMapPresentation(map);
  assert.equal(mapPresentationHeld(map),false);
  setPresentationVisible(map,true);
  const count=changes.length;
  setPresentationVisible(map,true);
  assert.equal(changes.length,count,"a second reveal cannot restart layout either");
});
