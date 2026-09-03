/**
 * `pnpm zip:intersect` — EVERY feature of every boundary layer that touches
 * this ZIP, by polygon intersection rather than by sampling.
 *
 * ## Why this exists alongside the point probe
 *
 * `pnpm district:probe` samples points and reports which districts contain
 * them. That answers "what governs a reader HERE", which is the reader's
 * question, and it is the right instrument for it.
 *
 * It is the WRONG instrument for "what governs anybody in this zip", because a
 * sampling grid has holes. A fire district covering one subdivision can sit
 * entirely between two sample points and be reported by silence. **A finite
 * sample count never earns an absence** — the grid is a floor, never a
 * completion condition.
 *
 * So this asks each layer a different question: hand it the ZCTA polygon and
 * ask for every feature that INTERSECTS it. There is no sampling and therefore
 * no sampling gap. What remains is the layer's own completeness, which is a
 * property of the publisher and is reported as such.
 *
 * Run both. Where the two disagree, the intersect found something the sample
 * missed, and that difference is itself the measurement of how leaky sampling
 * was here.
 *
 * Usage:
 *   pnpm zip:intersect --zip 85641
 *   pnpm zip:intersect --zip 85641 --layers data/states/az/hunt/az-district-layers.json --out <file>
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const UA = "we-the-people/1.0 (civic data; +mailto:seanj22@gmail.com)";
const TIGERWEB =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query";

interface Layer {
  key: string;
  url: string;
  nameField: string;
  extraFields?: string[];
  publisher: string;
  vintage: string;
  strength: string;
  where?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface ArcGisResponse {
  error?: { code: number; message: string };
  count?: number;
  exceededTransferLimit?: boolean;
  features?: Array<{ attributes?: Record<string, unknown>; geometry?: { rings?: number[][][] } }>;
}

async function getJson(url: string, init?: RequestInit): Promise<ArcGisResponse> {
  const res = await fetch(url, {
    ...init,
    headers: { "user-agent": UA, accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as ArcGisResponse;
  if (body.error) throw new Error(`service error ${body.error.code}: ${body.error.message}`);
  return body;
}

const zip = arg("zip") ?? "85641";
const layersPath = arg("layers") ?? "data/states/az/hunt/az-district-layers.json";
if (!existsSync(layersPath)) {
  console.error(`--layers ${layersPath} does not exist`);
  process.exit(2);
}
const layers = JSON.parse(readFileSync(layersPath, "utf8")).layers as Layer[];

/* --- the ZCTA polygon, from the Bureau's own service ---------------------- */
const zctaUrl =
  `${TIGERWEB}?where=${encodeURIComponent(`ZCTA5='${zip}'`)}` +
  "&outFields=ZCTA5&returnGeometry=true&outSR=4326&f=json";
const zcta = await getJson(zctaUrl);
const rings: number[][][] = [];
for (const f of zcta.features ?? []) for (const r of f.geometry?.rings ?? []) rings.push(r);
if (rings.length === 0) {
  console.error(`no ZCTA polygon for ${zip} — a failed read, not an empty zip`);
  process.exit(1);
}

// ArcGIS takes the geometry as a POST body: a zip polygon is far past what a
// query string will carry, and a truncated geometry silently intersects the
// wrong area rather than erroring.
const geometry = JSON.stringify({ rings, spatialReference: { wkid: 4326 } });
let vertices = 0;
for (const r of rings) vertices += r.length;

console.log(`ZIP ${zip} — polygon intersect against ${layers.length} layer(s)`);
console.log(`  ZCTA polygon  ${rings.length} ring(s), ${vertices} vertices`);
console.log("");

interface Row {
  layer: string;
  publisher: string;
  strength: string;
  vintage: string;
  name: string;
  attributes: Record<string, unknown>;
}

const rows: Row[] = [];
const status: Array<{ key: string; status: string; detail: string }> = [];

for (const layer of layers) {
  const fields = [layer.nameField, ...(layer.extraFields ?? [])].join(",");
  const body = new URLSearchParams({
    f: "json",
    geometry,
    geometryType: "esriGeometryPolygon",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    where: layer.where ?? "1=1",
    outFields: fields,
    returnGeometry: "false",
  });
  try {
    // The control question first: does this layer hold anything at all under
    // its own filter? A layer that answers 0 to everything reads as a zip with
    // no districts, and the control is what tells the two apart.
    const ctl = await getJson(`${layer.url}/query`, {
      method: "POST",
      body: new URLSearchParams({ f: "json", where: layer.where ?? "1=1", returnCountOnly: "true" }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const total = ctl.count ?? 0;
    if (total === 0) {
      status.push({ key: layer.key, status: "CONTROL_EMPTY", detail: "layer holds 0 features under its own filter" });
      continue;
    }

    const j = await getJson(`${layer.url}/query`, {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const feats = j.features ?? [];
    for (const f of feats) {
      rows.push({
        layer: layer.key,
        publisher: layer.publisher,
        strength: layer.strength,
        vintage: layer.vintage,
        name: String(f.attributes?.[layer.nameField] ?? "(unnamed)"),
        attributes: f.attributes ?? {},
      });
    }
    status.push({
      key: layer.key,
      status: "WALKED",
      detail: `${feats.length} of ${total} feature(s) intersect the zip${j.exceededTransferLimit ? " — TRANSFER LIMIT EXCEEDED, the list is TRUNCATED" : ""}`,
    });
  } catch (e) {
    // A layer that fails is LAYER_FAILED. Never zero districts.
    status.push({ key: layer.key, status: "LAYER_FAILED", detail: (e as Error).message });
  }
}

console.log("LAYERS");
for (const s of status) console.log(`  ${s.status.padEnd(14)} ${s.key.padEnd(34)} ${s.detail}`);
console.log("");

const byLayer = new Map<string, Row[]>();
for (const r of rows) {
  const list = byLayer.get(r.layer) ?? [];
  list.push(r);
  byLayer.set(r.layer, list);
}

console.log(`FEATURES INTERSECTING ZIP ${zip}: ${rows.length} across ${byLayer.size} layer(s)`);
console.log("");
for (const [key, list] of byLayer) {
  const first = list[0];
  console.log(`--- ${key}  (${first.strength} · ${first.publisher})`);
  const names = [...new Set(list.map((r) => r.name))].sort();
  console.log(`    ${names.join(" · ")}`);
  console.log("");
}

const failedLayers = status.filter((s) => s.status === "LAYER_FAILED");
if (failedLayers.length) {
  console.log(`FAILED LAYERS (${failedLayers.length}) — these are failures, never absences:`);
  for (const f of failedLayers) console.log(`  ${f.key}: ${f.detail}`);
  console.log("");
}

const out = arg("out");
if (out) {
  writeFileSync(
    out,
    JSON.stringify(
      {
        zip,
        method: "ZCTA polygon from TIGERweb, POSTed to each layer with spatialRel=esriSpatialRelIntersects",
        zctaRings: rings.length,
        zctaVertices: vertices,
        layers: status,
        features: rows,
        note:
          "INTERSECTS the zip is not the same as GOVERNS a given reader. A district " +
          "whose edge clips the zip appears here and may govern nobody at a given " +
          "address; run pnpm district:probe for the per-point answer.",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(`wrote ${out}`);
}
