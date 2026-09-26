/**
 * `node --experimental-strip-types scripts/build-az-fire-district-territory.mts [--download] [--tiger-cache <dir>]`
 *
 * **ARIZONA'S FIRE DISTRICTS, AS APPROXIMATE ZCTA SHARES, FOR SEND PLACEMENT ONLY.** (2026-09-26, the 85635
 * expansion.)
 *
 * TIGER publishes no special-district boundary, so no Send could place a fire district. The one free public
 * boundary source is the Arizona Department of Forestry and Fire Management's "Arizona Fire Districts" layer on the
 * AZGeo Data Hub. Its own disclaimer calls the boundaries approximate and their purpose wildfire dispatch, so this
 * extract is labelled APPROXIMATE with the layer's name, vintage and URL, and it is read ONLY to decide where a Send
 * creates discovery work (`lib/control-plane/expansion/district-territory.ts`), never for a reader-facing governance
 * claim (a guard test holds the reader paths off it). An error costs one extra or one missed walk.
 *
 * THE METHOD is the national territory resolution's own (`scripts/build-zip-governments.mts`): each Arizona ZCTA
 * (TIGER cartographic boundary, 2020) is sampled on the same 0.01-degree lattice of interior points, and a
 * district's share of a ZCTA is its samples there over the ZCTA's samples, by the same even-odd ray cast
 * (`lib/geo/point-in-polygon.ts`). A ZCTA smaller than the lattice catches no node and is left out: a floor, never a
 * guess. Only features of TYPE_ "District" are districts (a "Municipal" feature is a city's own department, not a
 * government), and each is matched to exactly one Arizona special-district Census unit by its exact name, or listed
 * unmatched.
 *
 * @freshness-reads-here The download path stamps retrievedAt only after fetching the layer's pages;
 * cached rebuilds carry that saved receipt without advancing its retrieval date.
 * `--download` reads the layer (one identified, paginated query; robots.txt does not govern an ArcGIS REST API,
 * and no key or login is involved) into `.cache/dffm/`, with its receipt. Without it the cached copy is read, so a
 * rebuild is reproducible. The TIGER ZCTA file is read from `.cache/tiger` (`pnpm tiger:fetch`), or `--tiger-cache`.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildGrid, candidatesAt, containsPoint, indexPolygon } from "../lib/geo/point-in-polygon.ts";
import { readBoundaryZip, type Ring } from "../lib/geo/shapefile.ts";

const LAYER = "https://services6.arcgis.com/clPWQMwZfdWn4MQZ/arcgis/rest/services/Arizona_Fire_Districts_Spatial_Join/FeatureServer/0";
const UA = "we-the-people-freshness/1.0 (civic records refresh; public data; contact via repository)";
const CACHE = join(process.cwd(), ".cache", "dffm");
const RAW = join(CACHE, "arizona-fire-districts.json");
const RECEIPT = join(CACHE, "arizona-fire-districts.receipt.json");
const OUT = join(process.cwd(), "lib", "control-plane", "expansion", "reference", "az-fire-district-territory.json");
const SAMPLE_RES = 0.01;
const ZCTA_FILE = "cb_2020_us_zcta520_500k.zip";

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

interface EsriFeature {
  readonly attributes: { readonly NAME: string; readonly TYPE_: string; readonly STATUS: string; readonly County: string };
  readonly geometry?: { readonly rings: Ring[] };
}

async function download(): Promise<void> {
  mkdirSync(CACHE, { recursive: true });
  const meta = (await (await fetch(`${LAYER}?f=json`, { headers: { "user-agent": UA } })).json()) as { name: string; editingInfo?: { dataLastEditDate?: number } };
  const features: EsriFeature[] = [];
  for (let offset = 0; ; offset += 100) {
    const url = `${LAYER}/query?where=1%3D1&outFields=NAME,TYPE_,STATUS,County&returnGeometry=true&outSR=4326&resultOffset=${offset}&resultRecordCount=100&orderByFields=OBJECTID&f=json`;
    const page = (await (await fetch(url, { headers: { "user-agent": UA } })).json()) as { features?: EsriFeature[]; exceededTransferLimit?: boolean; error?: unknown };
    if (page.error !== undefined || page.features === undefined) throw new Error(`the layer refused the query at offset ${offset}: ${JSON.stringify(page.error)}`);
    features.push(...page.features);
    if (page.features.length < 100 && page.exceededTransferLimit !== true) break;
  }
  const text = JSON.stringify({ layer: meta.name, features });
  writeFileSync(RAW, text);
  writeFileSync(RECEIPT, JSON.stringify({
    url: LAYER,
    layer: meta.name,
    dataLastEdit: meta.editingInfo?.dataLastEditDate === undefined ? null : new Date(meta.editingInfo.dataLastEditDate).toISOString(),
    retrievedAt: new Date().toISOString(),
    features: features.length,
    sha256: createHash("sha256").update(text).digest("hex"),
  }, null, 2));
  console.log(`downloaded ${features.length} feature(s) from ${LAYER}`);
}

if (process.argv.includes("--download")) await download();
if (!existsSync(RAW) || !existsSync(RECEIPT)) throw new Error(`${RAW} is missing: run with --download first`);
const receipt = JSON.parse(readFileSync(RECEIPT, "utf8")) as { url: string; layer: string; dataLastEdit: string | null; retrievedAt: string; features: number; sha256: string };
const raw = JSON.parse(readFileSync(RAW, "utf8")) as { features: EsriFeature[] };

/* The Arizona special-district Census units, by their exact name. */
const units = (JSON.parse(readFileSync(join(process.cwd(), "data", "derived", "census-unit-zips.json"), "utf8")) as {
  units: { pid6: string; name: string; type: string; state: string }[];
}).units.filter((u) => u.state === "AZ" && u.type === "SPECIAL DISTRICT");
const norm = (s: string): string => s.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").trim();

const districts = raw.features.filter((f) => f.attributes.TYPE_ === "District" && f.geometry !== undefined && f.geometry.rings.length > 0);
const indexed = districts.map((f) => {
  const rings = f.geometry!.rings;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) for (const [x, y] of ring) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const bbox: [number, number, number, number] = [minX, minY, maxX, maxY];
  return { f, bbox, poly: indexPolygon(rings, bbox) };
});
const grid = buildGrid(indexed.map((d) => d.bbox));
const [azMinX, azMinY, azMaxX, azMaxY] = indexed.reduce(
  ([a, b, c, d], x) => [Math.min(a, x.bbox[0]), Math.min(b, x.bbox[1]), Math.max(c, x.bbox[2]), Math.max(d, x.bbox[3])],
  [Infinity, Infinity, -Infinity, -Infinity],
);

const tigerCache = arg("tiger-cache") ?? join(process.cwd(), ".cache", "tiger");
const zctaPath = join(tigerCache, ZCTA_FILE);
if (!existsSync(zctaPath)) throw new Error(`${zctaPath} is missing: run pnpm tiger:fetch, or pass --tiger-cache`);
const zctas = readBoundaryZip(readFileSync(zctaPath)).features.filter((z) => {
  const [minX, minY, maxX, maxY] = z.bbox;
  return maxX >= azMinX && minX <= azMaxX && maxY >= azMinY && minY <= azMaxY;
});

const shares = new Map<number, Map<string, number>>();
let tooSmall = 0;
for (const z of zctas) {
  const zip = z.properties.ZCTA5CE20 ?? z.properties.GEOID20 ?? "";
  const [minX, minY, maxX, maxY] = z.bbox;
  const zpoly = indexPolygon(z.rings, z.bbox);
  let total = 0;
  const hits = new Map<number, number>();
  for (let y = Math.ceil(minY / SAMPLE_RES) * SAMPLE_RES; y <= maxY; y += SAMPLE_RES) {
    for (let x = Math.ceil(minX / SAMPLE_RES) * SAMPLE_RES; x <= maxX; x += SAMPLE_RES) {
      if (!containsPoint(zpoly, x, y)) continue;
      total += 1;
      for (const i of candidatesAt(grid, x, y)) if (containsPoint(indexed[i]!.poly, x, y)) hits.set(i, (hits.get(i) ?? 0) + 1);
    }
  }
  if (total === 0) {
    tooSmall += 1;
    continue;
  }
  for (const [i, n] of hits) {
    const own = shares.get(i) ?? new Map<string, number>();
    own.set(zip, Math.round((n / total) * 10_000) / 10_000);
    shares.set(i, own);
  }
}

const matched: unknown[] = [];
const unmatched: unknown[] = [];
indexed.forEach((d, i) => {
  const name = d.f.attributes.NAME;
  const same = units.filter((u) => norm(u.name) === norm(name));
  const zctaShares = Object.fromEntries([...(shares.get(i) ?? new Map<string, number>())].sort(([a], [b]) => (a < b ? -1 : 1)));
  const row = { name, county: d.f.attributes.County, status: d.f.attributes.STATUS, zctas: zctaShares };
  if (same.length === 1) matched.push({ ...row, pid6: same[0]!.pid6, unitName: same[0]!.name });
  else unmatched.push({ ...row, why: same.length === 0 ? "no Arizona special-district Census unit carries this exact name" : `${same.length} Arizona Census units carry this name` });
});
const byName = (a: unknown, b: unknown): number => ((a as { name: string }).name < (b as { name: string }).name ? -1 : 1);

writeFileSync(OUT, `${JSON.stringify({
  kind: "az-fire-district-territory",
  formatVersion: 1,
  provenance: {
    source: `${receipt.layer}: the Arizona Department of Forestry and Fire Management's "Arizona Fire Districts" layer, via the AZGeo Data Hub`,
    url: receipt.url,
    dataLastEdit: receipt.dataLastEdit,
    retrievedAt: receipt.retrievedAt,
    features: receipt.features,
    sha256: receipt.sha256,
    approximate: "APPROXIMATE: the publisher's own disclaimer calls these boundaries approximate and their purpose wildfire dispatch. Read ONLY to decide where a Send creates discovery work; never for a reader-facing governance claim.",
  },
  method: {
    zcta: `${ZCTA_FILE} (TIGER cartographic boundary, 2020), Arizona's ZCTAs`,
    latticeDegrees: SAMPLE_RES,
    share: "a district's lattice samples in the ZCTA over the ZCTA's lattice samples, by the even-odd ray cast of lib/geo/point-in-polygon.ts",
    zctasTooSmallForTheLattice: tooSmall,
    districtsOfTypeDistrict: indexed.length,
  },
  districts: matched.sort(byName),
  unmatched: unmatched.sort(byName),
}, null, 1)}\n`);
console.log(`wrote ${OUT}: ${matched.length} matched, ${unmatched.length} unmatched, ${zctas.length} ZCTAs sampled, ${tooSmall} too small for the lattice`);
