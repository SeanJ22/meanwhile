import assert from "node:assert/strict";
import test from "node:test";
import type { Map as MapLibreMap } from "maplibre-gl";
import { mapPresentationHeld, mapPresentationCanRefresh, startMapMovement, settleMapPresentation } from "../lib/map/flight-presentation.ts";

function renderer() {
  let moving = false;
  let loaded = true;
  const layers = ["land", "district-county-fill", "state-relief-light", "state-relief-shadow", "voting-address-ring"];
  const visibility = new Map(layers.map(id => [id, "visible"]));
  const writes: unknown[][] = [];
  const map = {
    getStyle: () => ({ layers: layers.map(id => ({ id })) }),
    isMoving: () => moving,
    isStyleLoaded: () => loaded,
    areTilesLoaded: () => loaded,
    setLayoutProperty: (id: string, property: string, value: string) => {
      writes.push([id, property, value]);
      visibility.set(id, value);
    },
  } as unknown as MapLibreMap;
  return { map, visibility, writes, setMoving: (value: boolean) => { moving = value; }, setLoaded: (value: boolean) => { loaded = value; } };
}

test("initial flight reveals its first complete presentation only at settled idle", () => {
  const scene = renderer();
  assert.equal(startMapMovement(scene.map, "initial-flight"), true);
  assert.equal(scene.visibility.get("land"), "visible");
  assert.equal(scene.visibility.get("state-relief-light"), "none");
  scene.setMoving(true);
  assert.equal(settleMapPresentation(scene.map), false);
  assert.equal(mapPresentationHeld(scene.map), true);
  // A finger taking over an unfinished arrival does not prematurely reveal it.
  assert.equal(startMapMovement(scene.map, "manual"), false);
  scene.setMoving(false);
  assert.equal(settleMapPresentation(scene.map), true);
  assert.ok([...scene.visibility.values()].every(value => value === "visible"));
  assert.equal(settleMapPresentation(scene.map), false, "repeated idle is not a readiness state change");
});

test("mouse drag, wheel zoom, touch pan and pinch retain every last-good application layer after arrival", () => {
  const scene = renderer();
  startMapMovement(scene.map, "initial-flight");
  settleMapPresentation(scene.map);
  scene.writes.length = 0;
  for (const gesture of ["mouse drag", "wheel zoom", "touch pan", "touch pinch"]) {
    scene.setMoving(true);
    for (let event = 0; event < 40; event++) {
      assert.equal(startMapMovement(scene.map, "manual"), false, `${gesture}: no new hold/readiness callback`);
      assert.equal(mapPresentationHeld(scene.map), false);
    }
    scene.setMoving(false);
    assert.equal(settleMapPresentation(scene.map), false, `${gesture}: nothing despawned to reveal again`);
  }
  assert.deepEqual(scene.writes, [], "manual movement never toggles application visibility");
  assert.ok([...scene.visibility.values()].every(value => value === "visible"));
});

test("ordinary camera adjustments retain presentation; a later explicit flight can opt into one hold/reveal", () => {
  const scene = renderer();
  assert.equal(startMapMovement(scene.map, "camera-adjustment"), false);
  assert.deepEqual(scene.writes, []);
  assert.equal(startMapMovement(scene.map, "programmatic-flight"), true);
  const hiddenWrites = scene.writes.length;
  assert.equal(startMapMovement(scene.map, "programmatic-flight"), false);
  assert.equal(scene.writes.length, hiddenWrites, "repeated movement events never repeat the hold");
  assert.equal(settleMapPresentation(scene.map), true);
  assert.equal(scene.writes.length, hiddenWrites * 2);
  assert.equal(startMapMovement(scene.map, "manual"), false);
});

test("viewport replacement waits for settled tiles while the last-good presentation remains visible", () => {
  const scene = renderer();
  scene.setMoving(true);
  assert.equal(mapPresentationCanRefresh(scene.map), false);
  scene.setLoaded(false);
  scene.setMoving(false);
  assert.equal(mapPresentationCanRefresh(scene.map), false, "moveend alone cannot replace results from incomplete tiles");
  assert.ok([...scene.visibility.values()].every(value => value === "visible"));
  scene.setLoaded(true);
  assert.equal(mapPresentationCanRefresh(scene.map), true);
  startMapMovement(scene.map, "programmatic-flight");
  assert.equal(mapPresentationCanRefresh(scene.map), false);
  settleMapPresentation(scene.map);
  assert.equal(mapPresentationCanRefresh(scene.map), true);
});
