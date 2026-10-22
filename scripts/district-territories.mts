#!/usr/bin/env node
/**
 * Who lives in each division a ZIP touches, and which special districts and tribal areas they live in, for every
 * state, from Census blocks. Committed outputs:
 *
 *   data/derived/zip-divisions/NN.json        each ZIP's divisions with the 2020 residents living in each
 *   data/derived/registration/<st>.json       special districts on their own territory; tribal areas
 *   data/states/<st>/geo/district-NN.geojson  special-district polygons for map and address lookups
 *
 * Sources, all read here: the 2020 Census redistricting (PL 94-171) block records (population, internal point and
 * every Census code a block carries), the Census 2020 ZCTA-to-block relationship file, the Census 2020 AIANNH code
 * list, and every boundary layer in data/reference/geography/district-boundary-sources.json.
 *
 *   node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/district-territories.mts [--states az,ak] [--cache DIR]
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { pointInRings, type Ring } from "../lib/geo/polygon.ts";
import { readCensusGovernmentFacts } from "../lib/registration/jurisdictions.ts";
import { readBoundaryZip } from "../lib/geo/shapefile.ts";
import type { ReferenceDivision, ReferenceGovernment, RegistrationReference } from "../lib/registration/reference.ts";
import { DISTRICT_SOURCES_FILE, districtNameKey, type DistrictBoundarySource, type DistrictBoundarySources } from "../lib/registration/district-sources.ts";

const ROOT = process.cwd();
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const CACHE = arg("--cache") ?? join(tmpdir(), "meanwhile-district-territories");
const ONLY = arg("--states")?.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const READ_AT = new Date().toISOString().slice(0, 10);

const PL = "https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171";
const ZCTA_BLOCKS = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tabblock20_natl.txt";
const AIANNH_CODES = "https://www2.census.gov/geo/docs/reference/codes2020/national_aiannh2020.txt";
const AIANNH_SHAPES = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_aiannh_500k.zip";

for (const dir of ["blocks", "zcta", "sources"]) mkdirSync(join(CACHE, dir), { recursive: true });

async function fetchText(url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: { "user-agent": "Meanwhile civic data (district territories)" }, signal: AbortSignal.timeout(120_000) }).catch(error => error as Error);
    if (response instanceof Response && response.ok) return response.text();
    const retry = response instanceof Response ? response.status === 429 || response.status >= 500 : true;
    if (!retry || attempt >= 4) throw new Error(`FETCH_FAILED ${url}: ${response instanceof Response ? response.status : response.message}`);
    await new Promise(resolve => setTimeout(resolve, 2000 * 2 ** attempt));
  }
}

/** The PL directory names each state in words; the postal code names the archive inside it. */
async function plStateDirectories(): Promise<Map<string, string>> {
  const html = await fetchText(`${PL}/`);
  const out = new Map<string, string>();
  for (const [, dir] of html.matchAll(/href="([A-Z][A-Za-z_]+)\/"/g)) {
    if (dir === "National") continue;
    const page = await fetchText(`${PL}/${dir}/`);
    const zip = /href="([a-z]{2})2020\.pl\.zip"/.exec(page)?.[1];
    if (zip) out.set(zip, dir);
  }
  return out;
}

/** One state's populated blocks: geocode|county|cousub|place|aianhh|sdelm|sdsec|sduni|pop|lat|lon. */
async function blocksFile(st: string, dirs: () => Promise<Map<string, string>>): Promise<string> {
  const path = join(CACHE, "blocks", `${st}.txt`);
  if (existsSync(path)) return path;
  const dir = (await dirs()).get(st);
  if (!dir) throw new Error(`PL_STATE_NOT_PUBLISHED ${st}`);
  const archive = join(CACHE, "blocks", `${st}2020.pl.zip`);
  const response = await fetch(`${PL}/${dir}/${st}2020.pl.zip`);
  if (!response.ok) throw new Error(`PL_FETCH_FAILED ${st}: ${response.status}`);
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  // The geographic header's block rows (summary level 750) carry POP100, the internal point and every code.
  const header = execFileSync("unzip", ["-p", archive, `${st}geo2020.pl`], { maxBuffer: 1 << 30 }).toString("latin1");
  const rows: string[] = [];
  for (const line of header.split("\n")) {
    const f = line.split("|");
    if (f[2] !== "750" || !(Number(f[90]) > 0)) continue;
    rows.push([f[9], f[14], f[17], f[29], f[35], f[80], f[81], f[82], f[90], f[92], f[93]].join("|"));
  }
  writeFileSync(`${path}.tmp`, `${rows.join("\n")}\n`);
  renameSync(`${path}.tmp`, path);
  return path;
}

/** The national ZCTA-block relationship, split once into one block→ZCTA file per state FIPS. */
async function zctaFiles(): Promise<void> {
  if (existsSync(join(CACHE, "zcta", "done"))) return;
  const response = await fetch(ZCTA_BLOCKS);
  if (!response.ok || !response.body) throw new Error(`ZCTA_BLOCKS_FETCH_FAILED ${response.status}`);
  const out = new Map<string, string[]>();
  const flush = (fips: string) => { const rows = out.get(fips)!; writeFileSync(join(CACHE, "zcta", `${fips}.txt`), `${rows.join("\n")}\n`, { flag: "a" }); out.set(fips, []); };
  let rest = "", header = true;
  const decoder = new TextDecoder();
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (header) { header = false; continue; }
      const f = line.split("|");
      if (!f[1] || !f[9]) continue;
      const fips = f[9].slice(0, 2);
      const rows = out.get(fips) ?? [];
      rows.push(`${f[9]}|${f[1]}`);
      out.set(fips, rows);
      if (rows.length >= 50_000) flush(fips);
    }
  }
  for (const fips of out.keys()) flush(fips);
  writeFileSync(join(CACHE, "zcta", "done"), READ_AT);
}

async function* lines(path: string): AsyncGenerator<string> {
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) if (line) yield line;
}

/* Boundary sources */

interface DistrictFeature {
  readonly key: string;
  readonly name: string;
  readonly kind: string;
  readonly polygons: Ring[][];
  readonly rings: Ring[];
  readonly bbox: [number, number, number, number];
  readonly source: DistrictBoundarySource;
}

const signedArea = (ring: Ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]); return a / 2; };

/** Esri rings, outer rings clockwise and holes counter-clockwise, become GeoJSON polygons. */
function esriPolygons(rings: Ring[]): Ring[][] {
  const outers: Ring[][] = [], holes: Ring[] = [];
  for (const ring of rings) {
    if (signedArea(ring) > 0) outers.push([ring]);
    else holes.push(ring);
  }
  if (!outers.length) return rings.map(ring => [ring]);
  for (const hole of holes) {
    const home = outers.find(poly => pointInRings(hole[0][0], hole[0][1], [poly[0]])) ?? outers[0];
    home.push(hole);
  }
  return outers;
}

function bboxOf(rings: readonly Ring[]): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
  return [a, b, c, d];
}

async function arcgisFeatures(source: DistrictBoundarySource): Promise<{ attributes: Record<string, unknown>; rings: Ring[] }[]> {
  const cached = join(CACHE, "sources", `${source.id}.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
  const templated = [...(source.nameTemplate ?? "").matchAll(/\{(\w+)\}/g)].map(m => m[1]);
  const fields = [...new Set([source.nameField, source.idField, source.kindField, ...templated].filter((f): f is string => Boolean(f)))].join(",");
  const where = encodeURIComponent(source.where ?? "1=1");
  const ids = JSON.parse(await fetchText(`${source.url}/query?where=${where}&returnIdsOnly=true&f=json`)) as { objectIds?: number[]; objectIdFieldName?: string; error?: unknown };
  if (ids.error || !ids.objectIds) throw new Error(`ARCGIS_IDS_FAILED ${source.id}: ${JSON.stringify(ids.error ?? ids).slice(0, 200)}`);
  const out: { attributes: Record<string, unknown>; rings: Ring[] }[] = [];
  const sorted = [...ids.objectIds].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += 50) {
    const batch = sorted.slice(i, i + 50).join(",");
    const page = JSON.parse(await fetchText(`${source.url}/query?objectIds=${batch}&outFields=${encodeURIComponent(fields)}&returnGeometry=true&outSR=4326&geometryPrecision=6&maxAllowableOffset=0.00005&f=json`)) as
      { features?: { attributes: Record<string, unknown>; geometry?: { rings?: Ring[] } }[]; error?: unknown };
    if (page.error || !page.features) throw new Error(`ARCGIS_QUERY_FAILED ${source.id}: ${JSON.stringify(page.error ?? page).slice(0, 200)}`);
    for (const f of page.features) if (f.geometry?.rings?.length) out.push({ attributes: f.attributes, rings: f.geometry.rings });
  }
  writeFileSync(cached, JSON.stringify(out));
  return out;
}

async function geojsonFeatures(source: DistrictBoundarySource): Promise<{ attributes: Record<string, unknown>; rings: Ring[]; polygons: Ring[][] }[]> {
  const cached = join(CACHE, "sources", `${source.id}.geojson`);
  const text = existsSync(cached) ? readFileSync(cached, "utf8") : await fetchText(source.url);
  if (!existsSync(cached)) writeFileSync(cached, text);
  const parsed = JSON.parse(text) as { features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } | null }[] };
  return parsed.features.flatMap(f => {
    if (!f.geometry) return [];
    const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates as Ring[]] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates as Ring[][] : [];
    return polygons.length ? [{ attributes: f.properties, rings: polygons.flat(), polygons }] : [];
  });
}

async function sourceFeatures(source: DistrictBoundarySource): Promise<DistrictFeature[]> {
  const raw = source.format === "geojson" ? await geojsonFeatures(source) : (await arcgisFeatures(source)).map(f => ({ ...f, polygons: esriPolygons(f.rings) }));
  return raw.flatMap((f, index) => {
    const name = (source.nameTemplate ? source.nameTemplate.replace(/\{(\w+)\}/g, (_, field: string) => String(f.attributes[field] ?? "")) : String(f.attributes[source.nameField] ?? "")).trim();
    const kindValue = source.kindField ? String(f.attributes[source.kindField] ?? "").trim() : null;
    const kind = kindValue === null ? source.kinds[0] : source.kindValues?.[kindValue] ?? null;
    if (!name || !kind || PLACEHOLDER.test(name.replace(/^.*\bcounty\s+/i, ""))) return [];
    const id = ((source.idField ? String(f.attributes[source.idField] ?? "").trim() : "") || String(index)).replace(/[^A-Za-z0-9_-]+/g, "_");
    return [{ key: `${source.id}#${id}`, name, kind, polygons: f.polygons, rings: f.rings, bbox: bboxOf(f.rings), source }];
  });
}

/* Simplified display geometry for the map and address lookups */

function simplify(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 8) return ring.map(([x, y]) => [round(x), round(y)]);
  // A closed ring starts and ends on one point, so it is split at the point farthest from it.
  let far = 1;
  for (let i = 1; i < ring.length - 1; i++) if (Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]) > Math.hypot(ring[far][0] - ring[0][0], ring[far][1] - ring[0][1])) far = i;
  const keep = new Uint8Array(ring.length); keep[0] = keep[far] = keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, far], [far, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = 0, at = -1;
    const [ax, ay] = ring[a], [bx, by] = ring[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * ring[i][0] - dx * ring[i][1] + bx * ay - by * ax) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tolerance && at > 0) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  const out = ring.filter((_, i) => keep[i]).map(([x, y]) => [round(x), round(y)] as [number, number]);
  return out.length >= 4 ? out : ring.map(([x, y]) => [round(x), round(y)]);
}
const round = (value: number) => Math.round(value * 1e5) / 1e5;

/* One state */

const slug = (value: string) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

interface StateResult {
  /** zip → ocdId → residents */
  readonly residents: Map<string, Map<string, number>>;
  readonly zipResidents: Map<string, number>;
  /** Divisions this state's blocks can measure; any other division in a ZIP is unmeasured, never zero. */
  readonly measured: Set<string>;
}

async function buildState(st: string, sources: readonly DistrictBoundarySource[], aiannhNames: Map<string, string>, aiannhShapes: Map<string, Ring[][]>,
  dirs: () => Promise<Map<string, string>>): Promise<StateResult> {
  const fips = Object.entries(FIPS_TO_STATE).find(([, s]) => s.postal.toLowerCase() === st)![0];
  const refPath = join(ROOT, "data", "derived", "registration", `${st}.json`);
  const reference = JSON.parse(readFileSync(refPath, "utf8")) as RegistrationReference & { divisions: ReferenceDivision[]; governments: ReferenceGovernment[]; boundarySources?: Record<string, unknown> };
  const stateOcd = reference.divisions[0][0];

  // Earlier runs' additions are rebuilt from their sources, never carried.
  const keptDivisions = reference.divisions.filter(d => d[1] !== "district" && d[1] !== "aiannh");
  const remap = new Map(reference.divisions.map((d, i) => [i, keptDivisions.indexOf(d)]));
  const governments: ReferenceGovernment[] = reference.governments.filter(g => g[5] !== "AIANNH_CODE" && g[5] !== "BOUNDARY_SOURCE_ONLY").map(g => {
    const [pid, jid, name, type, division, how, alternate] = g;
    const unpaired = how === "BOUNDARY_SOURCE" || how === "COUNTY_NAMED";
    return [pid, jid, name, type, unpaired ? -1 : remap.get(division) ?? division, unpaired ? "NO_CENSUS_GEOGRAPHY" : how, remap.get(alternate) ?? alternate] as ReferenceGovernment;
  });
  const divisions: ReferenceDivision[] = [...keptDivisions];
  const byCode = new Map<string, string>();
  for (const [ocdId, layer, geoid] of divisions) byCode.set(`${layer}:${geoid}`, ocdId);
  const census = readCensusGovernmentFacts(ROOT, [st.toUpperCase()]).byPid;

  // A county-wide kind of district named for its own county ("Morris County Soil Conservation District") serves that county.
  // A numbered one ("Canyon County Drainage District 3") is one of several inside it, and a risk pool or joint powers
  // agency serves governments, not residents.
  governments.forEach((g, i) => {
    if (g[3] !== "SPECIAL DISTRICT" || g[4] >= 0 || /\d/.test(g[2]) || !COUNTY_WIDE.test(g[2]) || /\b(RISK|INSURANCE|POOL|JOINT|JPA|EMPLOYEE|RETIREMENT|PENSION)\b/.test(g[2])) return;
    const facts = census.get(g[0]), county = facts?.countyFips ? divisions.findIndex(d => d[1] === "county" && d[2] === facts.countyFips) : -1;
    if (county < 0) return;
    const countyName = divisions[county][3].toUpperCase().replace(/\s+(COUNTY|PARISH|BOROUGH|CENSUS AREA|MUNICIPALITY|CITY AND BOROUGH)$/, "");
    if (new RegExp(`(^|\\b)${countyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (COUNTY|PARISH|BOROUGH)\\b`).test(g[2].toUpperCase()))
      governments[i] = [g[0], g[1], g[2], g[3], county, "COUNTY_NAMED", -1] as ReferenceGovernment;
  });

  // Special districts: each boundary feature tied to the one Census special district it names, inside its county.
  const specials = governments.map((g, index) => ({ g, index })).filter(({ g }) => g[3] === "SPECIAL DISTRICT");
  const features: (DistrictFeature & { ocdId: string })[] = [];
  const boundarySources: Record<string, { url: string; title: string; publisher: string; officialPage: string | null; readAt: string }> = {};
  const usedIds = new Set(divisions.map(d => d[0]));
  const taken = new Map<number, string>();
  for (const source of sources.filter(s => s.state.toLowerCase() === st)) {
    let rows: DistrictFeature[];
    try { rows = await sourceFeatures(source); } catch (error) { console.error(`  ${source.id}: ${(error as Error).message}`); continue; }
    boundarySources[source.id] = { url: source.url, title: source.title, publisher: source.publisher, officialPage: source.officialPage ?? null, readAt: READ_AT };
    // Several features of one district (parcels, annexations) are one territory.
    const grouped = new Map<string, DistrictFeature[]>();
    for (const row of rows) {
      const key = `${row.kind}|${districtNameKey(row.name, row.kind)}`;
      grouped.set(key, [...grouped.get(key) ?? [], row]);
    }
    let matched = 0, listed = 0;
    for (const group of grouped.values()) {
      const first = group[0];
      const key = districtNameKey(first.name, first.kind);
      if (!key) continue;
      // The Census records a district at its office's county, and a district can reach across a county line.
      const named = specials.filter(({ g }) => districtNameKey(g[2], first.kind) === key && districtKindOf(g[2]).includes(first.kind));
      const inCounty = source.countyFips ? named.filter(({ g }) => census.get(g[0])?.countyFips === source.countyFips) : named;
      const candidates = inCounty.length ? inCounty : named;
      const government = candidates.length === 1 ? candidates[0] : null;
      if (!government && source.unmatched !== "list") continue;
      const listedName = districtKindOf(first.name).includes(first.kind) ? first.name : `${first.name} (${source.title})`;
      const label = government ? titleCase(government.g[2]) : listedName;
      let ocdId = `${stateOcd}/special_district:${slug(government ? government.g[1].split(":").at(-1)! : `${first.name}_${first.kind}`)}`;
      if (government && taken.has(government.index)) ocdId = taken.get(government.index)!;
      else if (usedIds.has(ocdId)) ocdId = `${ocdId}_${slug(first.key)}`;
      const polygons = group.flatMap(f => f.polygons), rings = group.flatMap(f => f.rings);
      features.push({ ...first, polygons, rings, bbox: bboxOf(rings), ocdId });
      if (!usedIds.has(ocdId)) {
        usedIds.add(ocdId);
        divisions.push([ocdId, "district", first.key, label, first.kind] as unknown as ReferenceDivision);
      }
      const divisionIndex = divisions.findIndex(d => d[0] === ocdId);
      if (government) {
        matched++;
        taken.set(government.index, ocdId);
        const g = government.g;
        governments[government.index] = [g[0], g[1], g[2], g[3], divisionIndex, "BOUNDARY_SOURCE", -1] as ReferenceGovernment;
      } else {
        listed++;
        let pid = first.key.replace("#", "-");
        for (let n = 2; governments.some(g => g[0] === pid); n++) pid = `${first.key.replace("#", "-")}-${n}`;
        governments.push([pid, `${st}:special:${slug(first.name).replace(/_/g, "-")}-${first.kind}`, listedName, "SPECIAL DISTRICT",
          divisionIndex, "BOUNDARY_SOURCE_ONLY", -1] as ReferenceGovernment);
      }
    }
    console.error(`  ${source.id}: ${rows.length} features, ${grouped.size} districts, ${matched} tied to Census special districts, ${listed} listed from the source`);
  }

  // Grid index of district polygons for the block sweep.
  const CELL = 0.25, grid = new Map<string, number[]>();
  features.forEach((f, i) => {
    for (let x = Math.floor(f.bbox[0] / CELL); x <= Math.floor(f.bbox[2] / CELL); x++)
      for (let y = Math.floor(f.bbox[1] / CELL); y <= Math.floor(f.bbox[3] / CELL); y++) {
        const k = `${x}:${y}`; grid.set(k, [...grid.get(k) ?? [], i]);
      }
  });

  const zctaOf = new Map<string, string>();
  for await (const line of lines(join(CACHE, "zcta", `${fips}.txt`))) { const [block, zcta] = line.split("|"); zctaOf.set(block, zcta); }

  const residents = new Map<string, Map<string, number>>(), zipResidents = new Map<string, number>(), measured = new Set<string>();
  const aiannhSeen = new Map<string, number>();
  const add = (zip: string, id: string, pop: number) => {
    let row = residents.get(zip);
    if (!row) { row = new Map(); residents.set(zip, row); }
    row.set(id, (row.get(id) ?? 0) + pop);
  };
  for await (const line of lines(await blocksFile(st, dirs))) {
    const [block, county, cousub, place, aianhh, sdelm, sdsec, sduni, popText, latText, lonText] = line.split("|");
    const zip = zctaOf.get(block);
    if (!zip) continue;
    const pop = Number(popText), lat = Number(latText), lon = Number(lonText);
    zipResidents.set(zip, (zipResidents.get(zip) ?? 0) + pop);
    const codes = [`county:${fips}${county}`, `cousub:${fips}${county}${cousub}`, place !== "99999" ? `place:${fips}${place}` : "",
      sdelm !== "99999" ? `elsd:${fips}${sdelm}` : "", sdsec !== "99999" ? `scsd:${fips}${sdsec}` : "", sduni !== "99999" ? `unsd:${fips}${sduni}` : ""];
    for (const code of codes) {
      const id = code && byCode.get(code);
      if (!id) continue;
      measured.add(id);
      add(zip, id, pop);
    }
    if (aianhh && aianhh !== "9999" && aiannhNames.has(aianhh)) {
      const id = `ocd-division/country:us/aiannh:${aianhh}`;
      measured.add(id); add(zip, id, pop);
      aiannhSeen.set(aianhh, (aiannhSeen.get(aianhh) ?? 0) + pop);
    }
    // Two layers can draw one district; a block counts once for it.
    const inside = new Set<string>();
    for (const i of grid.get(`${Math.floor(lon / CELL)}:${Math.floor(lat / CELL)}`) ?? []) {
      const f = features[i];
      if (inside.has(f.ocdId) || lon < f.bbox[0] || lon > f.bbox[2] || lat < f.bbox[1] || lat > f.bbox[3] || !pointInRings(lon, lat, f.rings)) continue;
      inside.add(f.ocdId); measured.add(f.ocdId); add(zip, f.ocdId, pop);
    }
  }
  for (const f of features) measured.add(f.ocdId);

  // Tribal areas: every AIANNH area with residents in the state is a division and a listed government.
  for (const code of [...aiannhSeen.keys()].sort()) {
    const ocdId = `ocd-division/country:us/aiannh:${code}`;
    divisions.push([ocdId, "aiannh", code, aiannhNames.get(code)!] as ReferenceDivision);
    governments.push([`aiannh:${code}`, `${st}:tribal:${slug(aiannhNames.get(code)!).replace(/_/g, "-")}`, aiannhNames.get(code)!, "TRIBAL AREA",
      divisions.length - 1, "AIANNH_CODE", -1] as ReferenceGovernment);
  }

  const next = { ...reference, divisions, governments, ...(Object.keys(boundarySources).length ? { boundarySources } : {}) };
  if (!Object.keys(boundarySources).length) delete (next as { boundarySources?: unknown }).boundarySources;
  writeFileSync(refPath, `${JSON.stringify(next)}\n`);

  // Display geometry for the point resolver: special districts, and the tribal areas the state's residents live in.
  const geoDir = join(ROOT, "data", "states", st, "geo");
  const writeGeometry = (name: string, byId: Map<string, Ring[][]>) => {
    if (!byId.size) return;
    mkdirSync(geoDir, { recursive: true });
    writeFileSync(join(geoDir, `${name}-${fips}.geojson`), `${JSON.stringify({ type: "FeatureCollection", features: [...byId].map(([ocdId, polygons]) => ({
      type: "Feature", properties: { ocdId },
      geometry: { type: "MultiPolygon", coordinates: polygons.map(poly => poly.map(ring => simplify(ring, 0.0005))) },
    })) })}\n`);
  };
  const districtShapes = new Map<string, Ring[][]>();
  for (const f of features) districtShapes.set(f.ocdId, [...districtShapes.get(f.ocdId) ?? [], ...f.polygons]);
  writeGeometry("district", districtShapes);
  writeGeometry("aiannh", new Map([...aiannhSeen.keys()].flatMap(code => aiannhShapes.has(code) ? [[`ocd-division/country:us/aiannh:${code}`, aiannhShapes.get(code)!] as const] : [])));
  console.error(`${st}: ${zipResidents.size} ZIPs, ${features.length} district territories, ${aiannhSeen.size} tribal areas`);
  return { residents, zipResidents, measured };
}

const COUNTY_WIDE = /\b(SOIL|CONSERVATION|LIBRARY|HOUSING|TRANSIT|TRANSPORTATION|AIRPORT|E ?911|EMERGENCY COMMUNICATIONS?|PUBLIC BUILDING|HEALTH|HOSPITAL|PARKS?|MOSQUITO|SOLID WASTE|DEVELOPMENT|PORT|FINANCE|UTILITY|UTILITIES|WATER AUTHORITY|STADIUM|REGIONAL)\b/;
/** A layer's placeholder for land no district covers. */
const PLACEHOLDER = /^(?:unprotected|no (?:fire )?district|none|not in (?:a )?district|outside|out|unassigned|n\/?a|null|\W*)$|\bunprotected\b|\bno (?:fire )?district\b/i;
const KIND_OF_NAME: Record<string, RegExp> = {
  fire: /\bFIRE\b|\bEMERGENCY SERVICES?\b|\bESD\b|\bRESCUE\b/, water: /\bWATER\b|\bMUNICIPAL UTILITY\b|\bMUD\b|\bUTILITY\b|\bAQUEDUCT\b/,
  sewer: /\bSEWER|\bSANITA|\bWASTEWATER\b|\bRECLAMATION\b/, library: /\bLIBRARY\b/, park: /\bPARK|\bRECREATION\b/,
  hospital: /\bHOSPITAL\b|\bHEALTH\b/, cemetery: /\bCEMETERY\b/, irrigation: /\bIRRIGATION\b|\bDITCH\b|\bCANAL\b/,
  drainage: /\bDRAINAGE\b|\bLEVEE\b|\bFLOOD\b/, transit: /\bTRANSIT\b|\bTRANSPORTATION\b/, conservation: /\bCONSERVATION\b|\bNATURAL RESOURCES?\b|\bWATERSHED\b/,
  facilities: /\bFACILITIES\b|\bIMPROVEMENT\b|\bMETROPOLITAN\b|\bSPECIAL TAXING\b/, mosquito: /\bMOSQUITO\b|\bVECTOR\b|\bABATEMENT\b/,
  airport: /\bAIRPORT\b|\bPORT\b/, housing: /\bHOUSING\b/, other: /./,
};
function districtKindOf(name: string): string[] {
  return Object.entries(KIND_OF_NAME).filter(([, test]) => test.test(name.toUpperCase())).map(([kind]) => kind);
}
const titleCase = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());

/* Shards */

const stateOf = (id: string) => /\/(?:state|territory|district):([a-z]{2})(?:\/|$)/.exec(id)?.[1] ?? null;

/** A run of some states keeps every other state's held counts in a ZIP that crosses a state line. */
function writeShards(results: Map<string, StateResult>, newDivisionsByZip: Map<string, Set<string>>): void {
  const built = new Set(results.keys());
  const dir = join(ROOT, "data", "derived", "zip-divisions");
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  const allResidents = new Map<string, Map<string, number>>(), allTotals = new Map<string, number>(), measured = new Set<string>();
  for (const result of results.values()) {
    for (const [zip, row] of result.residents) {
      const held = allResidents.get(zip) ?? new Map<string, number>();
      for (const [id, n] of row) held.set(id, (held.get(id) ?? 0) + n);
      allResidents.set(zip, held);
    }
    for (const [zip, n] of result.zipResidents) allTotals.set(zip, (allTotals.get(zip) ?? 0) + n);
    for (const id of result.measured) measured.add(id);
  }
  const files = readdirSync(dir).filter(f => /^\d{2}\.json$/.test(f)).sort();
  for (const file of files) {
    const shard = JSON.parse(readFileSync(join(dir, file), "utf8")) as { formatVersion: number; divisions: string[]; zips: Record<string, number[]>; partial: Record<string, number[]>;
      zipSamples: Record<string, number>; residents?: Record<string, number[]>; zipResidents?: Record<string, number> };
    const divisions = [...shard.divisions];
    const position = new Map(divisions.map((id, i) => [id, i]));
    const residents: Record<string, number[]> = { ...shard.residents }, zipResidents: Record<string, number> = { ...shard.zipResidents };
    let changed = false;
    for (const zip of Object.keys(shard.zips)) {
      let total = allTotals.get(zip);
      if (total === undefined) continue;
      changed = true;
      const counts = new Map(allResidents.get(zip) ?? []);
      const held = new Map((shard.zips[zip] ?? []).map((i, k) => [divisions[i], shard.residents?.[zip]?.[k] ?? -1] as const));
      for (const [id, n] of held) {
        const st = stateOf(id);
        if (n < 0 || (st ? built.has(st) : counts.has(id))) continue;
        counts.set(id, n); measured.add(id);
        if (/\/county:[^/]+$/.test(id)) total += n;
      }
      // Earlier runs' district and tribal edges are replaced by this run's.
      const refs = shard.zips[zip].filter(i => !/\/(?:special_district:|aiannh:)/.test(divisions[i]) || !built.has(stateOf(divisions[i]) ?? ""));
      for (const id of newDivisionsByZip.get(zip) ?? []) {
        let at = position.get(id);
        if (at === undefined) { at = divisions.length; divisions.push(id); position.set(id, at); }
        if (!refs.includes(at)) refs.push(at);
      }
      shard.zips[zip] = refs;
      residents[zip] = refs.map(i => {
        const id = divisions[i];
        if (/^ocd-division\/country:us(?:\/(?:state|territory|district):[a-z]{2})?$/.test(id)) return total;
        return measured.has(id) ? counts.get(id) ?? 0 : -1;
      });
      zipResidents[zip] = total;
    }
    if (!changed) continue;
    const used = new Set(Object.values(shard.zips).flat());
    const keep = divisions.map((_, i) => used.has(i));
    const renumber = new Map<number, number>(); let n = 0;
    keep.forEach((k, i) => { if (k) renumber.set(i, n++); });
    const out = { formatVersion: 2, divisions: divisions.filter((_, i) => keep[i]),
      zips: Object.fromEntries(Object.entries(shard.zips).map(([z, refs]) => [z, refs.map(i => renumber.get(i)!)])),
      partial: {}, zipSamples: shard.zipSamples, residents, zipResidents };
    writeFileSync(join(dir, file), `${JSON.stringify(out)}\n`);
  }
  index.formatVersion = 2;
  index.residents = "2020 Census redistricting (PL 94-171) block populations, joined to ZCTAs by the Census 2020 ZCTA-to-block relationship file; -1 marks a division the blocks do not measure";
  writeFileSync(join(dir, "index.json"), `${JSON.stringify(index, null, 1)}\n`);
}

/* Main */

const registry = JSON.parse(readFileSync(join(ROOT, DISTRICT_SOURCES_FILE), "utf8")) as DistrictBoundarySources;
const aiannhNames = new Map((await fetchText(AIANNH_CODES)).trim().split("\n").slice(1).map(line => line.split("|")).map(f => [f[0], f[2]] as [string, string]));
const aiannhShapes = new Map<string, Ring[][]>();
{
  const response = await fetch(AIANNH_SHAPES);
  if (!response.ok) throw new Error(`AIANNH_SHAPES_FETCH_FAILED ${response.status}`);
  for (const feature of readBoundaryZip(Buffer.from(await response.arrayBuffer())).features)
    aiannhShapes.set(feature.properties.AIANNHCE, [...aiannhShapes.get(feature.properties.AIANNHCE) ?? [], ...esriPolygons(feature.rings as Ring[])]);
}
let dirsRead: Promise<Map<string, string>> | null = null;
const dirs = () => dirsRead ??= plStateDirectories();
await zctaFiles();
const states = (ONLY ?? readdirSync(join(ROOT, "data", "derived", "registration")).filter(f => /^[a-z]{2}\.json$/.test(f)).map(f => f.slice(0, 2)))
  .filter(st => Object.values(FIPS_TO_STATE).some(s => s.postal.toLowerCase() === st));
// Every layer is read up front, several at once; a layer that fails is reported and its state builds without it.
{
  const queue = registry.sources.filter(source => states.includes(source.state.toLowerCase()));
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let source = queue.shift(); source; source = queue.shift())
      await sourceFeatures(source).catch(error => console.error(`  ${source!.id}: ${(error as Error).message}`));
  }));
}
const results = new Map<string, StateResult>();
for (const st of states) {
  try { results.set(st, await buildState(st, registry.sources, aiannhNames, aiannhShapes, dirs)); } catch (error) { console.error(`${st}: ${(error as Error).message}`); }
}
const newDivisionsByZip = new Map<string, Set<string>>();
for (const result of results.values()) for (const [zip, row] of result.residents) for (const [id, n] of row)
  if (n > 0 && /\/(?:special_district:|aiannh:)/.test(id)) { const s = newDivisionsByZip.get(zip) ?? new Set<string>(); s.add(id); newDivisionsByZip.set(zip, s); }
writeShards(results, newDivisionsByZip);

// The registration index binds each state file's exact bytes.
const regIndexPath = join(ROOT, "data", "derived", "registration", "index.json");
const regIndex = JSON.parse(readFileSync(regIndexPath, "utf8")) as { counts: { governments: number; byTypeAndPairing: Record<string, number> };
  states: Record<string, { sha256: string; divisions: number; governments: number; paired: number; generatedAt?: string }> };
const byTypeAndPairing: Record<string, number> = {};
let governmentRows = 0;
for (const st of Object.keys(regIndex.states)) {
  const text = readFileSync(join(ROOT, "data", "derived", "registration", `${st}.json`), "utf8");
  const reference = JSON.parse(text) as { divisions: unknown[]; governments: ReferenceGovernment[] };
  for (const g of reference.governments) byTypeAndPairing[`${g[3]}:${g[5]}`] = (byTypeAndPairing[`${g[3]}:${g[5]}`] ?? 0) + 1;
  governmentRows += reference.governments.length;
  const sha = createHash("sha256").update(text).digest("hex");
  if (regIndex.states[st].sha256 !== sha) regIndex.states[st] = { ...regIndex.states[st], sha256: sha, divisions: reference.divisions.length,
    governments: reference.governments.length, paired: reference.governments.filter(g => g[4] >= 0).length, generatedAt: READ_AT };
}
regIndex.counts.governments = governmentRows;
regIndex.counts.byTypeAndPairing = Object.fromEntries(Object.entries(byTypeAndPairing).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(regIndexPath, `${JSON.stringify(regIndex, null, 1)}\n`);
