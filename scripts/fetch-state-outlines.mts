/**
 * `pnpm states:fetch` — the covered states' outlines, for the state-focus
 * map (g3 item 10, M91).
 *
 * ## Why this is its own tiny script
 *
 * `scripts/fetch-districts.ts` is the district pipeline: shapefile archives,
 * a TIGER/Line attribute join, OCD identity per feature. States need none of
 * that — one outline per state, no attributes, no identity resolution — and
 * bolting a type onto that table would drag the whole apparatus along for a
 * layer whose only job is to be a mask.
 *
 * ## The source, and the generalization
 *
 * Census TIGERweb, the Bureau's own REST service over TIGER/Line — the same
 * authority `CLAUDE.md`'s source table names for boundaries, reached through
 * the endpoint that speaks GeoJSON so nothing here parses a shapefile.
 *
 * **Generalized on purpose, and the number is stated:** `maxAllowableOffset`
 * of 0.005° (roughly half a kilometre) takes the three states from 673 KB to
 * about 10 KB. That is a deliberate loss of fidelity and it is safe for
 * exactly one reason — this geometry NEVER answers a question. It is not a
 * boundary the product makes a claim from, not a join key, and nothing is
 * resolved against it. District truth still comes from the committed
 * cartographic boundaries, which are unchanged. This outline only decides
 * which pixels are muted, and a reader cannot tell a half-kilometre error in
 * a blur edge from the blur.
 *
 * If a later feature ever wants to ASK this geometry something, it needs the
 * unsimplified file and this comment is the warning.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { COVERED_FIPS, SLUG_BY_FIPS } from "../lib/coverage/artifacts.ts";
import { stamp } from "./stamp.mts";

const SOURCE_ORG = "U.S. Census Bureau";
const SERVICE =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query";

/** FIPS for the states the product covers. Adding a state adds a code here. */
const STATE_FIPS = COVERED_FIPS;

/** Roughly half a kilometre. Stated, not tuned by eye — see the header. */
const MAX_ALLOWABLE_OFFSET = 0.005;

const url =
  `${SERVICE}?where=${encodeURIComponent(
    `STATE IN (${STATE_FIPS.map((f) => `'${f}'`).join(",")})`,
  )}` +
  `&outFields=STATE,NAME&returnGeometry=true&geometryPrecision=3` +
  `&maxAllowableOffset=${MAX_ALLOWABLE_OFFSET}&outSR=4326&f=geojson`;

console.log(`fetching ${url}`);
const response = await fetch(url, {
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

// An operation that can return nothing is asked what it returned. TIGERweb
// answers 200 with an empty feature list for a `where` clause that matches
// nothing, which is the empty-success shape this repo keeps catching.
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
