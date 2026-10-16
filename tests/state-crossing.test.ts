import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
import { outlineFor, stateContainsPoint, stateOcdIdAt, type StateOutlines } from "../lib/map/state-focus.ts";
import { DISTRICT_TYPES, setDistrictState, withDistricts } from "../lib/map/districts.ts";
import type { MapLibreMap, StyleSpecification } from "maplibre-gl";

const outlines = JSON.parse(readFileSync(new URL("../public/geo/state-outlines.geojson", import.meta.url), "utf8")) as StateOutlines;

test("all 56 jurisdictions have a distinct Census display outline and their correct OCD prefix", () => {
  assert.equal(outlines.features.length, 56);
  for (const state of US_JURISDICTIONS) {
    const id = `ocd-division/country:us/${state.prefix}:${state.slug}`;
    const feature = outlineFor(outlines, id);
    assert.ok(feature, state.usps);
    assert.equal(feature.properties.statefp, state.fips);
    assert.ok(feature.geometry.coordinates.length);
  }
});

test("Arizona to New Mexico and back, DC, islands and wrapped longitudes resolve their own state", () => {
  const points: [string, number, number][] = [
    ["state:az", 32.2226, -110.9747], ["state:nm", 32.32, -108.7], ["state:az", 32.32, -109.2],
    ["district:dc", 38.9072, -77.0369], ["territory:pr", 18.4655, -66.1057],
    ["territory:vi", 18.3419, -64.9307], ["territory:gu", 13.4443, 144.7937],
    ["territory:mp", 15.185, 145.746], ["territory:as", -14.278, -170.702],
    ["state:ak", 51.85, -176.65], ["state:hi", 21.307, -157.858],
  ];
  for (const [state, lat, lng] of points) {
    const id = `ocd-division/country:us/${state}`;
    for (const turn of [-360, 0, 360]) assert.equal(stateOcdIdAt(outlines, lat, lng + turn), id, `${state}: ${lng + turn}`);
    assert.equal(stateContainsPoint(outlineFor(outlines, id), lat, lng), true);
  }
  assert.equal(stateOcdIdAt(outlines, 0, 0), null);
});

test("every displayed boundary is confined to the active state, including after a style reset", () => {
  const style = { version: 8, sources: {}, layers: [], glyphs: "https://example.test/{fontstack}/{range}.pbf" } as StyleSpecification;
  const current = withDistricts(style, DISTRICT_TYPES, "AZ");
  const filters = new Map(current.layers.map(layer => [layer.id, "filter" in layer ? layer.filter : undefined]));
  for (const state of ["AZ", "NM", "AZ", "PR", null]) {
    const fake = {
      getLayer: (id: string) => current.layers.find(layer => layer.id === id),
      getFilter: (id: string) => filters.get(id),
      setFilter: (id: string, filter: unknown) => filters.set(id, filter as never),
    } as unknown as MapLibreMap;
    setDistrictState(fake, state);
    for (const filter of filters.values()) assert.match(JSON.stringify(filter), new RegExp(`"state".*"${state ?? "__none__"}"`));
  }
});

test("the ballot link carries the active map state and point even when the nearest ZIP is across the line", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { PillCluster } = await import("../components/shell/pill-cluster.tsx");
  for (const [state, zip, point] of [
    ["NM", "85701", { lat: 32.32, lng: -108.7 }],
    ["GU", null, { lat: 13.4443, lng: 144.7937 }],
  ] as const) {
    const html = renderToStaticMarkup(createElement(PillCluster, {
      placement: "map", zip, state, point, pop: null, governsOpen: false,
      onOpenPop: () => {}, onOpenGoverns: () => {},
    }));
    const href = /href="([^"]+)"/.exec(html)?.[1].replace(/&amp;/g, "&");
    assert.ok(href);
    const url = new URL(href, "http://localhost");
    assert.equal(url.pathname, "/ballot");
    assert.equal(url.searchParams.get("state"), state);
    assert.equal(url.searchParams.get("lat"), String(point.lat));
    assert.equal(url.searchParams.get("lng"), String(point.lng));
    assert.equal(url.searchParams.get("zip"), zip);
  }
});
