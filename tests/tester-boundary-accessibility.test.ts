import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Map as MapLibreMap, LayerSpecification } from "maplibre-gl";
import {
  addDistrictLayer,
  DISTRICT_LAYERS,
  DISTRICT_LINE_OPACITY,
  DISTRICT_TYPES,
  type DistrictCollection,
} from "../lib/map/districts.ts";
import { ALL_DISTRICT_TYPES, INITIAL_STATE } from "../lib/state/defaults.ts";

test("ACC-1: every boundary type has a distinct non-hue signature, including State House and unified schools", () => {
  const signatures = DISTRICT_TYPES.map((type) => {
    const { dash, weight } = DISTRICT_LAYERS[type];
    assert.ok(dash.length % 2 === 0 && dash.every((n) => n > 0), type);
    assert.ok(weight > 0, type);
    return dash.join(",");
  });
  assert.equal(new Set(signatures).size, ALL_DISTRICT_TYPES.length);
  assert.notDeepEqual(DISTRICT_LAYERS["state-house"].dash, DISTRICT_LAYERS["school-unified"].dash);
});

test("ACC-1: map style uses the key's exact dash and weight specification without modifying geometry", () => {
  for (const type of DISTRICT_TYPES) {
    const data: DistrictCollection = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { ocdId: "test-boundary", state: "AZ", district: "test", label: "Test boundary" },
        geometry: { type: "Polygon", coordinates: [[[-111, 32], [-110, 32.25], [-110.5, 33], [-111, 32]]] },
      }],
    };
    const before = JSON.stringify(data);
    const layers: LayerSpecification[] = [];
    const sourceData: unknown[] = [];
    const map = {
      getSource: () => undefined,
      getLayer: () => undefined,
      getStyle: () => ({ layers: [] }),
      addSource: (_id: string, source: { data: unknown }) => sourceData.push(source.data),
      addLayer: (layer: LayerSpecification) => layers.push(layer),
    } as unknown as MapLibreMap;
    addDistrictLayer(map, type, data, "AZ");
    const line = layers.find((layer) => layer.type === "line");
    assert.ok(line?.type === "line");
    assert.deepEqual(line.paint?.["line-dasharray"], DISTRICT_LAYERS[type].dash);
    const opacity = line.paint?.["line-opacity"] as unknown[];
    assert.equal(opacity.at(-1), DISTRICT_LINE_OPACITY);
    const width = line.paint?.["line-width"] as unknown[];
    assert.equal((width[4] as unknown[]).at(-1), 0.9 * DISTRICT_LAYERS[type].weight);
    assert.equal((width[6] as unknown[]).at(-1), 1.65 * DISTRICT_LAYERS[type].weight);
    assert.equal(sourceData[0], data);
    assert.equal(JSON.stringify(data), before);
  }
});

test("ACC-1: opacity raises luminance contrast for every existing tier color in both themes", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const lightStart = css.indexOf('[data-theme="light"]');
  assert.ok(lightStart > 0);
  const hex = (value: string) => [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const luminance = (rgb: number[]) => rgb.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const [theme, source] of [["dark", css.slice(0, lightStart)], ["light", css.slice(lightStart)]] as const) {
    const token = (name: string) => {
      const match = source.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"));
      assert.ok(match, `${theme} ${name}`);
      return hex(match[1]);
    };
    const background = token("--bg");
    const bgLum = luminance(background);
    for (const tier of ["local", "state", "national"]) {
      const accent = token(`--accent-${tier}`);
      const contrast = (opacity: number) => {
        const lineLum = luminance(accent.map((v, i) => v * opacity + background[i] * (1 - opacity)));
        return (Math.max(lineLum, bgLum) + 0.05) / (Math.min(lineLum, bgLum) + 0.05);
      };
      assert.ok(contrast(DISTRICT_LINE_OPACITY) > contrast(0.7), `${theme} ${tier}`);
    }
  }
});

test("TUT-1 / ACC-1: all eight boundary types stay selected and Filters stays collapsed for a new reader", () => {
  assert.equal(ALL_DISTRICT_TYPES.length, 8);
  assert.deepEqual(INITIAL_STATE.filters.districtTypes, ALL_DISTRICT_TYPES);
  assert.equal(INITIAL_STATE.filtersPanelOpen, false);
});
