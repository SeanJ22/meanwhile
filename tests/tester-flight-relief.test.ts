import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalStateBounds, directionalStateEdges, ensureStateRelief, RELIEF_THEME, RELIEF_CANDIDATES, RELIEF_LAYERS, RELIEF_SOURCE, RELIEF_EDGES, stateReliefLayers } from "../lib/map/state-relief.ts";
import { applicationLayer, holdMapPresentation, releaseMapPresentation, mapPresentationHeld, setPresentationVisible } from "../lib/map/flight-presentation.ts";
import type { StateOutlines, StateOutlineFeature } from "../lib/map/state-focus.ts";
import type { Map as MapLibreMap } from "maplibre-gl";
import { COVERED_STATES } from "../lib/coverage/states.ts";
import { RAISED_STATE_CANDIDATES } from "../lib/review/contract.ts";

test("every directional segment preserves the canonical state's exact border and river vertices", () => {
  const states: StateOutlines = JSON.parse(readFileSync("public/geo/state-outlines.geojson", "utf8"));
  assert.deepEqual(states.features.map(f => f.properties.statefp).sort(), COVERED_STATES.map(s => s.fips).sort());
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

test("Raised State A/B/C vary only restrained flat paints on the same canonical sources in both themes", () => {
  for (const theme of ["dark", "light"] as const) {
    let lastShadow = 0;
    let lastOffset = 0;
    for (const { id } of RAISED_STATE_CANDIDATES) {
      const layers = stateReliefLayers(theme, id);
      assert.deepEqual(layers.map(layer => layer.id), [...RELIEF_LAYERS]);
      assert.ok(layers.every(layer => layer.type === "fill" || layer.type === "line"));
      assert.ok(layers.every(layer => "source" in layer && [RELIEF_SOURCE, RELIEF_EDGES].includes(layer.source as string)));
      const lift = RELIEF_CANDIDATES[id];
      assert.ok(lift[theme].shadow > lastShadow, "A/B/C offer progressively more separation, without selecting a winner");
      assert.ok(lift.offset[1] > lastOffset);
      assert.ok(lift.shadowBlur >= lift.shadowWidth * 0.85, "soft penumbra rather than a hard outline");
      assert.ok(lift[theme].surface < 0.1, "the basemap remains the material surface");
      lastShadow = lift[theme].shadow;
      lastOffset = lift.offset[1];
    }
  }
  assert.notDeepEqual(stateReliefLayers("dark", "B_MATERIAL_LIFT"), stateReliefLayers("light", "B_MATERIAL_LIFT"));
});

test("Arizona and irregular New Jersey relief retain sources through settle, candidate and theme changes", () => {
  const states: StateOutlines = JSON.parse(readFileSync("public/geo/state-outlines.geojson", "utf8"));
  for (const statefp of ["04", "34"]) {
    const outline = states.features.find(feature => feature.properties.statefp === statefp)!;
    assert.ok(outline);
    const [[west, south], [east, north]] = canonicalStateBounds(outline);
    const points = outline.geometry.coordinates.flat();
    assert.ok(points.every(([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north));
    for (const [axis, extreme] of [[0, west], [0, east], [1, south], [1, north]]) {
      assert.ok(points.some(point => point[axis] === extreme), "review framing uses actual canonical extremes");
    }
    const sources = new Map<string, { data: unknown; setData: (data: unknown) => void }>();
    const layers = new Map<string, unknown>();
    let dataUpdates = 0;
    let sourceAdds = 0;
    const map = {
      getStyle: () => ({ layers: [{ id: "land", type: "fill" }] }),
      getSource: (id: string) => sources.get(id),
      getLayer: (id: string) => layers.get(id),
      addSource: (id: string, specification: { data: unknown; tolerance: number }) => {
        assert.equal(specification.tolerance, 0, "canonical vertices are not simplified");
        sourceAdds++;
        const source = { data: specification.data, setData: (data: unknown) => { source.data = data; dataUpdates++; } };
        sources.set(id, source);
      },
      addLayer: (layer: { id: string }) => { layers.set(layer.id, layer); },
      setPaintProperty: () => {},
    } as unknown as MapLibreMap;
    ensureStateRelief(map, outline, "dark", "A_SOFT_LIFT");
    const retained = [...sources.values()];
    for (const theme of ["dark", "light"] as const) {
      for (const { id } of RAISED_STATE_CANDIDATES) {
        for (let settle = 0; settle < 3; settle++) ensureStateRelief(map, outline, theme, id);
      }
    }
    assert.equal(sourceAdds, 2);
    assert.equal(dataUpdates, 0, "settling, changing theme or reviewing another lift never resends unchanged geometry");
    assert.deepEqual([...sources.values()], retained);
    assert.strictEqual(sources.get(RELIEF_SOURCE)?.data, outline, "the fill holds the canonical feature itself");
    assert.deepEqual(sources.get(RELIEF_EDGES)?.data, directionalStateEdges(outline));
    assert.equal(layers.size, RELIEF_LAYERS.length);
    // A real style replacement discards sources. Recreate them without a second outline.
    sources.clear(); layers.clear();
    ensureStateRelief(map, outline, "light", "C_DEEP_LIFT");
    assert.equal(sourceAdds, 4);
    assert.equal(layers.size, RELIEF_LAYERS.length);
  }
});
