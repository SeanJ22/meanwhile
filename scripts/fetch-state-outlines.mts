import { fetchSource } from "../lib/sources/fetch-source.ts";
/** @freshness-reads-here */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { HELD_GEOMETRY_FIPS, SLUG_BY_FIPS } from "../lib/coverage/artifacts.ts";
import { stamp } from "./stamp.mts";

const SOURCE_ORG = "U.S. Census Bureau";
const SERVICE =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query";

/** FIPS for the states the product covers. Adding a state adds a code here. */
const STATE_FIPS = HELD_GEOMETRY_FIPS;


const MAX_ALLOWABLE_OFFSET = 0.0005;

const url =
  `${SERVICE}?where=${encodeURIComponent(
    `STATE IN (${STATE_FIPS.map((f) => `'${f}'`).join(",")})`,
  )}` +
  `&outFields=STATE,NAME&returnGeometry=true&geometryPrecision=5` +
  `&maxAllowableOffset=${MAX_ALLOWABLE_OFFSET}&outSR=4326&f=geojson`;

console.log(`fetching ${url}`);
const response = await fetchSource(url, {
  headers: { "User-Agent": "we-the-people civic map (state outlines)" },
});
if (!response.ok) {
  throw new Error(`TIGERweb answered ${response.status} for the state outlines`);
}

const raw = (await response.json()) as {
  features?: Array<{
    type: "Feature";
    properties: { STATE: string; NAME: string };
    geometry: { type: string; coordinates: unknown };
  }>;
};

const features = raw.features ?? [];

// TIGERweb answers 200 with an empty feature list for a `where` clause that matches nothing.
if (features.length !== STATE_FIPS.length) {
  throw new Error(
    `expected ${STATE_FIPS.length} state outline(s), got ${features.length} — ` +
      "refusing to write a partial file over a complete one",
  );
}

const out = {
  type: "FeatureCollection" as const,
  source: url,
  sourceOrg: SOURCE_ORG,
  collectedAt: stamp(),
  note:
    `Generalized at maxAllowableOffset=${MAX_ALLOWABLE_OFFSET}° for the ` +
    "state-focus shading. NOT district truth and never resolved against — " +
    "see scripts/fetch-state-outlines.mts.",
  features: features.map((f) => ({
    type: "Feature" as const,
    properties: {
      statefp: f.properties.STATE,
      name: f.properties.NAME,
      // The state's own OCD-ID, so the map's focus can be keyed the way
      // everything else in this product is keyed — never on a name string.
      ocdId: `ocd-division/country:us/state:${stateAbbrFor(f.properties.STATE)}`,
    },
    geometry: f.geometry,
  })),
};

function stateAbbrFor(fips: string): string {
  const abbr = SLUG_BY_FIPS[fips];
  if (!abbr) throw new Error(`no abbreviation recorded for state FIPS ${fips}`);
  return abbr;
}

const dir = join(process.cwd(), "public", "geo");
mkdirSync(dir, { recursive: true });
const path = join(dir, "state-outlines.geojson");
writeFileSync(path, JSON.stringify(out) + "\n", "utf8");

const points = features.reduce((total, f) => {
  const rings = f.geometry.coordinates as number[][][];
  return total + rings.reduce((n, ring) => n + ring.length, 0);
}, 0);
console.log(
  `wrote ${path}: ${features.length} state(s), ${points} points, ` +
    `${Math.round(JSON.stringify(out).length / 1024)} KB`,
);
