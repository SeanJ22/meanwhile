/**
 * `pnpm district:probe` — DOES THIS DISTRICT GOVERN THIS POINT?
 *
 * ## The gap this closes
 *
 * `docs/gap-ledger.md` records 24 Pima County special districts as
 * territory-UNRESOLVED, and states why: the national boundary join of
 * 2026-08-24 "resolved 47,834 of the country's 90,837 governments and **not one
 * special district** — the boundaries are not published anywhere in that data
 * at all."
 *
 * That sentence is true about the Census boundary files and false about the
 * world. Special-district territory IS published — by the state agency that
 * regulates the district class, and by the county that levies its tax — as an
 * ArcGIS feature service, which is a queryable API rather than a downloadable
 * national file. A route that only knows how to read national shapefiles
 * concludes "not published"; the district's own regulator is publishing it.
 *
 * **So the failure was a route gap wearing an absence's clothes**, which is the
 * exact shape `CLAUDE.md` names: a wall never renders as an emptiness.
 *
 * ## What it does
 *
 * Takes a set of POINTS and a set of ArcGIS feature layers, and asks each layer
 * which of its features contain each point. It reports, per point, the
 * districts that govern it — and per district, how many of the points it holds.
 *
 * ## The three honesty rules it enforces
 *
 * 1. **A layer that errors is `LAYER_FAILED`, never zero districts.** A query
 *    that 500s and a query that returns no feature are opposite facts, and the
 *    difference is the whole product.
 * 2. **A CONTROL QUERY runs first.** Every layer is asked for its total feature
 *    count before it is asked about our points. A layer that answers 0 to
 *    everything is a broken layer, and without the control it reads as a
 *    jurisdiction where no district governs anybody.
 * 3. **Every result carries the layer's own publisher and vintage**, because
 *    "a state wildfire-dispatch layer says so" and "the county's tax roll says
 *    so" are different strengths of evidence and must never print the same.
 *
 * Usage:
 *   pnpm district:probe --points data/hunt/85641-governing-universe.json
 *   pnpm district:probe --points <file> --layers data/hunt/az-district-layers.json --out <file>
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const UA = "we-the-people/1.0 (civic data; +mailto:seanj22@gmail.com)";

export interface DistrictLayer {
  /** Stable id used in output and in the method record. */
  readonly key: string;
  /** ArcGIS layer query URL, ending in the layer index. */
  readonly url: string;
  /** Field carrying the district's name. */
  readonly nameField: string;
  /** Extra fields worth carrying onto the finding. */
  readonly extraFields?: readonly string[];
  /** Who publishes it. Printed with every finding it produces. */
  readonly publisher: string;
  /** What the publisher says the data is for, and when it was last updated. */
  readonly vintage: string;
  /** How strong this is as evidence of LEGAL territory. */
  readonly strength: "REGULATORY" | "OPERATIONAL" | "DERIVED";
  /** Optional server-side filter, e.g. County = 'Pima'. */
  readonly where?: string;
}

interface Probe {
  readonly lon: number;
  readonly lat: number;
  readonly label: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function arcgis(url: string, params: Record<string, string>): Promise<any> {
  const q = new URLSearchParams({ f: "json", ...params });
  const res = await fetch(`${url}/query?${q}`, {
    headers: { "user-agent": UA, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  // An ArcGIS service reports its errors INSIDE a 200. A caller that only
  // checks the status code reads an error object as an empty result set.
  if (j.error) throw new Error(`service error ${j.error.code}: ${j.error.message}`);
  return j;
}

/** RULING 100 / the control query: prove the layer answers before trusting a zero. */
async function control(layer: DistrictLayer): Promise<number> {
  const j = await arcgis(layer.url, {
    where: layer.where ?? "1=1",
    returnCountOnly: "true",
  });
  return j.count ?? 0;
}

async function featuresAt(layer: DistrictLayer, p: Probe): Promise<string[]> {
  const fields = [layer.nameField, ...(layer.extraFields ?? [])].join(",");
  const j = await arcgis(layer.url, {
    geometry: `${p.lon},${p.lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    where: layer.where ?? "1=1",
    outFields: fields,
    returnGeometry: "false",
  });
  return (j.features ?? []).map((f: any) => String(f.attributes?.[layer.nameField] ?? "(unnamed)"));
}

/* ------------------------------------------------------------------ run */

const pointsPath = arg("points");
if (!pointsPath || !existsSync(pointsPath)) {
  console.error("--points <file> is required (the output of pnpm zip:governing --json)");
  process.exit(2);
}
const layersPath = arg("layers") ?? "data/hunt/az-district-layers.json";
if (!existsSync(layersPath)) {
  console.error(`--layers ${layersPath} does not exist`);
  process.exit(2);
}

const universe = JSON.parse(readFileSync(pointsPath, "utf8"));
const layers = JSON.parse(readFileSync(layersPath, "utf8")).layers as DistrictLayer[];

const probes: Probe[] = (universe.combinations ?? []).map((c: any, i: number) => ({
  lon: c.at[0],
  lat: c.at[1],
  label: `combination ${i + 1} (${c.count} pt)`,
}));

if (probes.length === 0) {
  console.error("no probe points read — that is a broken read, not an empty zip");
  process.exit(1);
}

console.log(`DISTRICT TERRITORY PROBE — ${probes.length} point(s), ${layers.length} layer(s)`);
console.log(`points from ${pointsPath} (zip ${universe.zip})`);
console.log("");

interface Finding {
  layer: string;
  publisher: string;
  strength: string;
  vintage: string;
  district: string;
  pointsHeld: number;
  pointLabels: string[];
}

const findings = new Map<string, Finding>();
const layerStatus: Array<{ key: string; status: string; detail: string }> = [];

for (const layer of layers) {
  let total: number;
  try {
    total = await control(layer);
  } catch (e) {
    layerStatus.push({ key: layer.key, status: "LAYER_FAILED", detail: `control query: ${(e as Error).message}` });
    continue;
  }
  if (total === 0) {
    // A layer whose control query returns nothing cannot answer a question
    // about our points either. It is a failed layer, not a place with no
    // districts.
    layerStatus.push({ key: layer.key, status: "CONTROL_EMPTY", detail: "the layer holds 0 features under its own filter" });
    continue;
  }

  let asked = 0;
  let failed = 0;
  for (const p of probes) {
    try {
      const names = await featuresAt(layer, p);
      asked += 1;
      for (const n of names) {
        const key = `${layer.key}::${n}`;
        const prior = findings.get(key);
        if (prior) {
          prior.pointsHeld += 1;
          prior.pointLabels.push(p.label);
        } else {
          findings.set(key, {
            layer: layer.key,
            publisher: layer.publisher,
            strength: layer.strength,
            vintage: layer.vintage,
            district: n,
            pointsHeld: 1,
            pointLabels: [p.label],
          });
        }
      }
    } catch {
      failed += 1;
    }
  }
  layerStatus.push({
    key: layer.key,
    status: failed === 0 ? "WALKED" : "PARTIAL",
    detail: `${total} feature(s) in the layer; ${asked} point(s) answered, ${failed} failed`,
  });
}

console.log("LAYERS");
for (const s of layerStatus) {
  console.log(`  ${s.status.padEnd(14)} ${s.key.padEnd(34)} ${s.detail}`);
}
console.log("");

const list = [...findings.values()].sort(
  (a, b) => b.pointsHeld - a.pointsHeld || a.district.localeCompare(b.district),
);
console.log(`DISTRICTS HOLDING AT LEAST ONE POINT: ${list.length}`);
for (const f of list) {
  console.log(`  ${String(f.pointsHeld).padStart(3)} pt  ${f.district}`);
  console.log(`          ${f.layer} · ${f.strength} · ${f.publisher} · ${f.vintage}`);
}
console.log("");

const out = arg("out");
if (out) {
  writeFileSync(
    out,
    JSON.stringify(
      {
        zip: universe.zip,
        probedPoints: probes.length,
        layers: layerStatus,
        findings: list,
        note:
          "A district absent from this list was not found to contain any probed point. " +
          "That is a statement about the probed points and the walked layers, never a " +
          "statement that the district does not govern this zip.",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(`wrote ${out}`);
}
