import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
import { stamp } from "./stamp.mts";

const service = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query";
const offset = 0.0005;
const params = new URLSearchParams({
  where: `STATE IN (${US_JURISDICTIONS.map(state => `'${state.fips}'`).join(",")})`,
  outFields: "STATE,NAME", returnGeometry: "true", geometryPrecision: "5",
  maxAllowableOffset: String(offset), outSR: "4326", f: "geojson",
});
const url = `${service}?${params}`;
const response = await fetch(url);
if (!response.ok) throw new Error(`TIGERweb answered ${response.status}`);
const raw = await response.json() as {
  features?: Array<{
    properties: { STATE: string; NAME: string };
    geometry: { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
  }>;
};
const features = US_JURISDICTIONS.map(state => {
  const matches = raw.features?.filter(feature => feature.properties.STATE === state.fips) ?? [];
  if (matches.length !== 1) throw new Error(`Expected one outline for ${state.usps}, got ${matches.length}`);
  const feature = matches[0];
  const coordinates = feature.geometry.type === "MultiPolygon"
    ? feature.geometry.coordinates.flat() : feature.geometry.coordinates;
  if (!coordinates.length || coordinates.some(ring => ring.length < 4)) throw new Error(`Invalid outline for ${state.usps}`);
  return {
    type: "Feature", properties: {
      statefp: state.fips, name: feature.properties.NAME,
      ocdId: `ocd-division/country:us/${state.prefix}:${state.slug}`,
    },
    geometry: { type: "Polygon", coordinates },
  };
});
const out = JSON.stringify({
  type: "FeatureCollection", source: url, sourceOrg: "U.S. Census Bureau", collectedAt: stamp(),
  note: `Display outlines generalized at ${offset} degrees; district membership uses the place resolver.`, features,
}) + "\n";
const dir = join(process.cwd(), "public", "geo");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "state-outlines.geojson"), out);
console.log(JSON.stringify({ states: features.length, points: features.reduce((total, feature) => total + feature.geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0), 0), bytes: Buffer.byteLength(out) }));
