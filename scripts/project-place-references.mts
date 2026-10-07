import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, writeSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { parseCsv } from "../lib/reference/index.ts";
import type { StateReference, StateReferenceIndex } from "../lib/control-plane/expansion/state-references.ts";
import dependentSchools from "../lib/control-plane/expansion/reference/census-dependent-school-territories.json" with { type: "json" };
import { unitShareKey } from "../lib/control-plane/expansion/membership.ts";
import { ruledDistrictTerritory, DISTRICT_TERRITORIES } from "../lib/control-plane/expansion/district-territory.ts";

const root = process.cwd();
const out = join(root, "data", "derived", "place-reference");
const shards = new Map<string, StateReference>();
function shardFor(state: string): StateReference {
  const key = state.toUpperCase();
  let shard = shards.get(key);
  if (!shard) {
    shard = { formatVersion: 1, state: key, units: [], zips: {}, facts: {}, censusSource: "", exactShares: {} };
    shards.set(key, shard);
  }
  return shard;
}
for (const state of Object.values(FIPS_TO_STATE)) shardFor(state.postal);
const units = JSON.parse(readFileSync(join(root, "data", "derived", "census-unit-zips.json"), "utf8")) as { units: StateReference["units"] };
const ids = new Set(units.units.map(unit => unit.pid6));
for (const unit of [...units.units, ...dependentSchools.units.filter(unit => !ids.has(unit.pid6))]) {
  if (shards.has(unit.state.toUpperCase())) shardFor(unit.state).units.push(unit);
}
const samples = JSON.parse(readFileSync(join(root, "data", "derived", "zip-governments.json"), "utf8")) as {
  zips: Record<string, StateReference["zips"][string]["edges"]>;
};
for (const [zip, edges] of Object.entries(samples.zips)) {
  const total = edges.filter(edge => edge.layer === "county").reduce((sum, edge) => sum + edge.samples, 0);
  for (const edge of edges) {
    const state = FIPS_TO_STATE[edge.id.slice(0, 2)]?.postal;
    if (state) (shardFor(state).zips[zip] ??= { total, edges: [] }).edges.push(edge);
  }
}
const sourceIndex = JSON.parse(readFileSync(join(root, "data", "derived", "registration", "index.json"), "utf8")) as { source: string };
const sources: string[] = [];
for (const file of ["census_govt_units_2022.csv", "census_govt_units_2022_dependent_school_systems.csv"]) {
  const text = readFileSync(join(root, "data", "reference", file), "utf8");
  const source = `${file} (sha256 ${createHash("sha256").update(text).digest("hex")})`;
  if (!sourceIndex.source.includes(source)) throw new Error(`REGISTRATION_CENSUS_FILE_DRIFT:${file}`);
  sources.push(`data/reference/${source}`);
  const [header = [], ...rows] = parseCsv(text);
  const pid = header.indexOf("census_id_pid6"), web = header.indexOf("web_address"), county = header.indexOf("county_area_name"), state = header.indexOf("state");
  if ([pid, web, county, state].some(index => index < 0)) throw new Error(`REGISTRATION_CENSUS_FILE_SHAPE:${file}`);
  for (const row of rows) if (row[pid] && shards.has(row[state].toUpperCase())) shardFor(row[state]).facts[row[pid]] = { web: (row[web] ?? "").trim(), county: (row[county] ?? "").trim() };
}
mkdirSync(out, { recursive: true });
for (const shard of shards.values()) {
  const adjacent = new Map<string, Set<string>>();
  for (const { edges } of Object.values(shard.zips)) {
    const keys = edges.map(edge => `${edge.layer}:${edge.id}`);
    for (const key of keys) {
      const neighbors = adjacent.get(key) ?? new Set<string>();
      for (const other of keys) if (other !== key) neighbors.add(other);
      adjacent.set(key, neighbors);
    }
  }
  shard.censusSource = sources.join(" and ");
  const fd = openSync(join(out, `${shard.state.toLowerCase()}.jsonl`), "w");
  let offset = 0;
  const write = (value: unknown): [number, number] => {
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
    const span: [number, number] = [offset, bytes.length];
    let written = 0;
    while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written);
    offset += bytes.length;
    return span;
  };
  try {
    const index: StateReferenceIndex = { formatVersion: 2, state: shard.state, censusSource: shard.censusSource,
      units: shard.units.map(write), byZip: {}, byDivision: {}, shares: {}, facts: write(shard.facts) };
    const byDivision = new Map<string, number[]>();
    for (const [i, unit] of shard.units.entries()) {
      const key = unitShareKey(unit);
      if (key) { const rows = byDivision.get(key) ?? []; rows.push(i); byDivision.set(key, rows); }
      for (const zip of unit.zips) (index.byZip[zip] ??= []).push(i);
    }
    index.byDivision = Object.fromEntries(byDivision);
    for (const [zip, row] of Object.entries(shard.zips)) {
      const seeds = row.edges.map(edge => `${edge.layer}:${edge.id}`);
      const ring = new Set(seeds.flatMap(key => [key, ...(adjacent.get(key) ?? [])]));
      index.byZip[zip] = [...new Set([...(index.byZip[zip] ?? []), ...[...ring].flatMap(key => byDivision.get(key) ?? [])])];
    }
    const byPid = new Map(shard.units.map(unit => [`${shard.state}:${unit.pid6}`, unit]));
    const positions = new Map(shard.units.map((unit, i) => [unit.pid6, i]));
    for (const [i, unit] of shard.units.entries()) {
      if (unit.zips.length) continue;
      const ruled = ruledDistrictTerritory(unit, byPid, () => undefined, unitShareKey, DISTRICT_TERRITORIES);
      if (!ruled || "unplaced" in ruled) continue;
      const rule = DISTRICT_TERRITORIES.find(row => row.state === shard.state && row.pid6 === unit.pid6)?.rule;
      const dependencies = rule?.kind === "MEMBER_UNION" ? rule.members.flatMap(member => positions.get(member.pid6) ?? [])
        : rule?.kind === "COUNTY" ? byDivision.get(`county:${rule.countyGeoid}`) ?? [] : [];
      for (const zip of ruled.zctas) index.byZip[zip] = [...new Set([...(index.byZip[zip] ?? []), i, ...dependencies])];
    }
    const divisionRows = new Map<string, { zips: StateReference["zips"]; exact: Record<string, number> }>();
    for (const [zip, row] of Object.entries(shard.zips)) for (const edge of row.edges) {
      const key = `${edge.layer}:${edge.id}`;
      const value = divisionRows.get(key) ?? { zips: {}, exact: shard.exactShares[key] ?? {} };
      (value.zips[zip] ??= { total: row.total, edges: [] }).edges.push(edge);
      divisionRows.set(key, value);
    }
    for (const [key, exact] of Object.entries(shard.exactShares)) if (!divisionRows.has(key)) divisionRows.set(key, { zips: {}, exact });
    for (const [key, rows] of divisionRows) index.shares[key] = write(rows);
    writeFileSync(join(out, `${shard.state.toLowerCase()}.json`), `${JSON.stringify(index)}\n`);
  } finally { closeSync(fd); }
}
console.log(`Projected held place references into ${shards.size} state indexes and seekable data files.`);
