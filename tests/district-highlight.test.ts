import assert from "node:assert/strict";
import test from "node:test";
import type { MapLibreMap, StyleSpecification } from "maplibre-gl";
import { fillLayerId, preserveDistrictStyle, setNarrowedDistricts, setSelectedDistrict, withDistricts } from "../lib/map/districts.ts";

test("transparent hit areas skip painting until selected or narrowed, and retain shading across a theme rebuild", () => {
  const base: StyleSpecification = { version: 8, sources: {}, layers: [] };
  let style = withDistricts(base, ["county", "state-house"], "AZ");
  const paint = (id: string) => (style.layers.find(layer => layer.id === id) as { paint: Record<string, unknown> }).paint;
  const states: unknown[] = [];
  const map = {
    getSource: () => ({}), getLayer: (id: string) => style.layers.find(layer => layer.id === id),
    getPaintProperty: (id: string, key: string) => paint(id)[key],
    setPaintProperty: (id: string, key: string, value: unknown) => { paint(id)[key] = value; },
    setFeatureState: (...args: unknown[]) => states.push(args),
  } as unknown as MapLibreMap;
  const county = fillLayerId("county"), house = fillLayerId("state-house");
  assert.equal(paint(county)["fill-layer-opacity"], 0);
  assert.equal(paint(house)["fill-layer-opacity"], 0);
  setSelectedDistrict(map, "county", "county:fixture");
  assert.equal(paint(county)["fill-layer-opacity"], 1);
  assert.equal(paint(house)["fill-layer-opacity"], 0);
  setNarrowedDistricts(map, [{ type: "state-house", ocdId: "house:fixture" }]);
  style = preserveDistrictStyle(style, base);
  assert.equal(paint(county)["fill-layer-opacity"], 1);
  assert.equal(paint(house)["fill-layer-opacity"], 1);
  setSelectedDistrict(map, null, null);
  assert.equal(paint(county)["fill-layer-opacity"], 0);
  assert.equal(paint(house)["fill-layer-opacity"], 1);
  setNarrowedDistricts(map, []);
  assert.equal(paint(house)["fill-layer-opacity"], 0);
  assert.equal(states.length, 4);
});
