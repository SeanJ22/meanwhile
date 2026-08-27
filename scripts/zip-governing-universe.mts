/**
 * `pnpm zip:governing` — WHO GOVERNS A PERSON AT THIS ZIP, from authoritative
 * geography rather than from a directory that links outward.
 *
 * ## Why this exists
 *
 * The 85641 gap ledger entry, stamped 2026-08-21, reports 28 governments in the
 * universe touching the zip and **4 territory-resolved**. The other 24 are Pima
 * County special districts whose boundaries "are not published anywhere in that
 * data at all" — measured by the national boundary join of 2026-08-24, which
 * resolved 47,834 of the country's 90,837 governments and **not one special
 * district**.
 *
 * That is a statement about ONE dataset, and it was being carried as a
 * statement about the world. A special district's territory is published — it
 * is just published by the county that assesses tax on it, in a GIS service,
 * rather than by the Census in a national boundary file.
 *
 * ## What it does
 *
 * 1. Reads the ZCTA polygon from TIGERweb (the Bureau's own service).
 * 2. Samples a GRID of interior points, not one centroid. **A ZIP is not a
 *    government and has no reason to nest inside one**, so a single point can
 *    only ever report one of the combinations a reader might live in. The whole
 *    question "does this ZIP cross districts?" is unanswerable from a centroid.
 * 3. Asks the Census geographies endpoint, at every point, for EVERY layer —
 *    congressional district, both legislative chambers, school districts,
 *    county subdivision, place, tract, block.
 * 4. Reports the DISTINCT combinations, with how many sample points landed in
 *    each, so a boundary crossing shows up as more than one row.
 *
 * Every fact printed carries the point it was measured at. Nothing is inferred
 * from the ZIP code itself.
 *
 * Usage:
 *   pnpm zip:governing --zip 85641
 *   pnpm zip:governing --zip 85641 --grid 12 --json
 */

import { writeFileSync } from "node:fs";

const UA = "we-the-people/1.0 (civic data; +mailto:seanj22@gmail.com)";

const TIGERWEB =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query";
const GEOGRAPHIES =
  "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";

interface Ring {
  readonly ring: ReadonlyArray<readonly [number, number]>;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function getJson(url: string, label: string): Promise<any> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} for ${url}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // RULING 100 — an operation that can return nothing is asked what it
    // returned. A geocoder that answers with an HTML error page is a FAILED
    // read, never an empty result.
    throw new Error(`${label}: response was not JSON (${text.slice(0, 200)})`);
  }
}

/** The ZCTA polygon, as rings of [lon, lat]. */
async function zctaRings(zip: string): Promise<Ring[]> {
  const url =
    `${TIGERWEB}?where=${encodeURIComponent(`ZCTA5='${zip}'`)}` +
    "&outFields=ZCTA5,AREALAND&returnGeometry=true&outSR=4326&f=json";
  const j = await getJson(url, "TIGERweb ZCTA");
  const features = j.features ?? [];
  if (features.length === 0) throw new Error(`TIGERweb returned no ZCTA polygon for ${zip}`);
  const rings: Ring[] = [];
  for (const f of features) {
    for (const r of f.geometry?.rings ?? []) rings.push({ ring: r });
  }
  if (rings.length === 0) throw new Error(`TIGERweb returned a ZCTA feature with no rings for ${zip}`);
  return rings;
}

function bbox(rings: Ring[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { ring } of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

function inside(rings: Ring[], x: number, y: number): boolean {
  let hits = 0;
  for (const { ring } of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hits += 1;
    }
  }
  return hits % 2 === 1;
}

/** Every geography the Bureau will name for one point. */
async function geographiesAt(lon: number, lat: number): Promise<Record<string, string>> {
  const url =
    `${GEOGRAPHIES}?x=${lon}&y=${lat}&benchmark=Public_AR_Current` +
    "&vintage=Current_Current&layers=all&format=json";
  const j = await getJson(url, "census geographies");
  const geos: Record<string, any[]> = j.result?.geographies ?? {};
  const out: Record<string, string> = {};
  for (const [layer, rows] of Object.entries(geos)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const names = rows
      .map((r) => r.NAME ?? r.BASENAME ?? r.GEOID ?? "")
      .filter(Boolean);
    if (names.length) out[layer] = names.join(" | ");
  }
  return out;
}

/* ------------------------------------------------------------------ run */

const zip = arg("zip") ?? "85641";
const grid = Number(arg("grid") ?? 10);
const asJson = process.argv.includes("--json");

const rings = await zctaRings(zip);
const [minX, minY, maxX, maxY] = bbox(rings);

// The grid is over the BOUNDING BOX and then filtered to the polygon, so the
// sample follows the zip's actual shape. A zip shaped like an L would otherwise
// be sampled mostly outside itself.
const points: Array<[number, number]> = [];
for (let i = 0; i < grid; i += 1) {
  for (let k = 0; k < grid; k += 1) {
    const x = minX + ((maxX - minX) * (i + 0.5)) / grid;
    const y = minY + ((maxY - minY) * (k + 0.5)) / grid;
    if (inside(rings, x, y)) points.push([x, y]);
  }
}

if (points.length === 0) {
  console.error(`no interior sample points for ${zip} — the polygon read is wrong, not the zip empty`);
  process.exit(1);
}

console.log(`ZIP ${zip} — ZCTA polygon read from TIGERweb`);
console.log(`  bbox           ${minX.toFixed(4)},${minY.toFixed(4)} .. ${maxX.toFixed(4)},${maxY.toFixed(4)}`);
console.log(`  grid           ${grid} x ${grid} = ${grid * grid} candidates`);
console.log(`  interior       ${points.length} sample point(s)`);
console.log("");

const combos = new Map<string, { geos: Record<string, string>; count: number; at: Array<[number, number]> }>();
const failures: string[] = [];

for (const [x, y] of points) {
  try {
    const g = await geographiesAt(x, y);
    const key = JSON.stringify(g);
    const prior = combos.get(key);
    if (prior) {
      prior.count += 1;
      prior.at.push([x, y]);
    } else {
      combos.set(key, { geos: g, count: 1, at: [[x, y]] });
    }
  } catch (e) {
    // A failed point is a FAILED READ and is reported as one. It is never
    // silently dropped, because a dropped point looks exactly like a zip with
    // fewer governing combinations than it has.
    failures.push(`${x.toFixed(5)},${y.toFixed(5)}: ${(e as Error).message}`);
  }
}

const LAYERS_OF_INTEREST = [
  "States",
  "Counties",
  "County Subdivisions",
  "Incorporated Places",
  "Census Designated Places",
  "116th Congressional Districts",
  "119th Congressional Districts",
  "Congressional Districts",
  "State Legislative Districts - Upper",
  "State Legislative Districts - Lower",
  "Unified School Districts",
  "Elementary School Districts",
  "Secondary School Districts",
  "Census Tracts",
  "2020 Census Blocks",
  "Urban Areas",
  "American Indian Area Geography",
];

const sorted = [...combos.values()].sort((a, b) => b.count - a.count);
console.log(`DISTINCT GOVERNING COMBINATIONS: ${sorted.length}`);
console.log("");
for (const [i, c] of sorted.entries()) {
  console.log(`--- combination ${i + 1} — ${c.count} of ${points.length} sample point(s)`);
  console.log(`    first at ${c.at[0][1].toFixed(5)}, ${c.at[0][0].toFixed(5)}`);
  const keys = Object.keys(c.geos).sort((a, b) => {
    const ia = LAYERS_OF_INTEREST.indexOf(a);
    const ib = LAYERS_OF_INTEREST.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  for (const k of keys) console.log(`    ${k.padEnd(42)} ${c.geos[k]}`);
  console.log("");
}

if (failures.length) {
  console.log(`FAILED POINT READS (${failures.length}) — these are failures, never absences:`);
  for (const f of failures.slice(0, 20)) console.log(`  ${f}`);
  if (failures.length > 20) console.log(`  ... ${failures.length - 20} more`);
  console.log("");
}

if (asJson) {
  const path = `data/hunt/${zip}-governing-universe.json`;
  writeFileSync(
    path,
    JSON.stringify(
      {
        zip,
        source: "TIGERweb ZCTA polygon + Census geographies endpoint, layers=all",
        benchmark: "Public_AR_Current / Current_Current",
        samplePoints: points.length,
        combinations: sorted.map((c) => ({ count: c.count, at: c.at[0], geographies: c.geos })),
        failedReads: failures,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(`wrote ${path}`);
}
