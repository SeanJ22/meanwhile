import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

import { lightTokens, rootTokens } from "../lib/design/theme-parity.ts";
import { NATIONAL_BOUNDARIES_SOURCE, labelLayerId, lineLayerId, preserveDistrictStyle, withDistricts } from "../lib/map/districts.ts";

/* The document the map reads its tokens from: `data-theme` on <html>, every value from app/globals.css. */
const css = readFileSync(join(import.meta.dirname, "..", "app", "globals.css"), "utf8");
const dark = rootTokens(css);
const light = lightTokens(css);
let theme: "dark" | "light" = "dark";
const g = globalThis as unknown as Record<string, unknown>;
g.window = { location: { href: "http://localhost/" } };
g.document = { documentElement: { getAttribute: (name: string) => (name === "data-theme" && theme === "light" ? "light" : null) } };
g.getComputedStyle = () => ({ getPropertyValue: (name: string) => (theme === "light" ? light.get(name) ?? dark.get(name) : dark.get(name)) ?? "" });

const basemap = (glyphs: boolean): StyleSpecification => ({
  version: 8,
  ...(glyphs ? { glyphs: "https://glyphs.example/{fontstack}/{range}.pbf" } : {}),
  sources: { place: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
  layers: [
    { id: "background", type: "background" },
    { id: "place-label", type: "symbol", source: "place", layout: { "text-field": "x" } },
  ],
});
const paint = (style: StyleSpecification, id: string) =>
  (style.layers.find(layer => layer.id === id) as Extract<LayerSpecification, { type: "symbol" }> | undefined)?.paint as Record<string, unknown> | undefined;

test("a switch to light rebuilds district labels with the light --bg halo, never the dark one", () => {
  theme = "dark";
  const prevDark = withDistricts(basemap(true), ["state-house", "congressional"], "NM");
  assert.equal(paint(prevDark, labelLayerId("state-house"))?.["text-halo-color"], dark.get("--bg"));

  theme = "light";
  const nextLight = preserveDistrictStyle(prevDark, basemap(true));
  for (const type of ["state-house", "congressional"] as const) {
    const label = paint(nextLight, labelLayerId(type));
    assert.equal(label?.["text-halo-color"], "#f0f2f5", `${type} label halo is the light --bg`);
    assert.equal(label?.["text-halo-color"], light.get("--bg"));
    assert.equal(label?.["text-halo-width"], 1.5);
    assert.equal(label?.["text-halo-blur"], 0.5);
  }
  assert.equal(paint(nextLight, labelLayerId("state-house"))?.["text-color"], light.get("--accent-state"), "the accent is the light one too");
  assert.equal(nextLight.sources[NATIONAL_BOUNDARIES_SOURCE], prevDark.sources[NATIONAL_BOUNDARIES_SOURCE], "the source carries over, so tiles and feature-state survive");
  assert.ok(nextLight.layers.findIndex(layer => layer.id === lineLayerId("congressional")) < nextLight.layers.findIndex(layer => layer.id === "place-label"),
    "boundaries stay under the basemap's place labels");

  for (const layer of nextLight.layers.filter(layer => layer.id.startsWith("district-"))) {
    assert.match(JSON.stringify("filter" in layer ? layer.filter : null), /"state".*"NM"/);
  }
  theme = "dark";
  const backToDark = preserveDistrictStyle(nextLight, basemap(true));
  assert.equal(paint(backToDark, labelLayerId("congressional"))?.["text-halo-color"], dark.get("--bg"), "and back again");
});

test("only the district types already drawn come back, and a basemap without glyphs keeps lines but no labels", () => {
  theme = "dark";
  const prev = withDistricts(basemap(true), ["state-senate"], "NM");
  const next = preserveDistrictStyle(prev, basemap(false));
  const ids = next.layers.map(layer => layer.id).filter(id => id.startsWith("district-"));
  assert.deepEqual(ids.sort(), [`district-state-senate-fill`, `district-state-senate-line`].sort());
  assert.equal(preserveDistrictStyle(basemap(true), basemap(true)).layers.some(layer => layer.id.startsWith("district-")), false,
    "with no boundary source drawn, the next style is untouched");
});
