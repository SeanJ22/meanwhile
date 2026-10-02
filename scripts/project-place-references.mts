import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { parseCsv } from "../lib/reference/index.ts";
import type { StateReference } from "../lib/control-plane/expansion/state-references.ts";

const root = process.cwd();
const out = join(root, "data", "derived", "place-reference");
const shards = new Map<string, StateReference>();
function shardFor(state: string): StateReference {
  const key = state.toUpperCase();
  let shard = shards.get(key);
  if (!shard) {
    shard = { formatVersion: 1, state: key, units: [], zips: {}, adjacency: {}, facts: {}, censusSource: "" };
    shards.set(key, shard);
  }
  return shard;
}
for (const state of Object.values(FIPS_TO_STATE)) shardFor(state.postal);
const units = JSON.parse(readFileSync(join(root, "data", "derived", "census-unit-zips.json"), "utf8")) as { units: StateReference["units"] };
for (const unit of units.units) if (shards.has(unit.state.toUpperCase())) shardFor(unit.state).units.push(unit);
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
  shard.adjacency = Object.fromEntries([...adjacent].map(([key, neighbors]) => [key, [...neighbors].sort()]));
  shard.censusSource = sources.join(" and ");
  writeFileSync(join(out, `${shard.state.toLowerCase()}.json`), `${JSON.stringify(shard)}\n`);
}
writeFileSync(join(out, "index.json"), `${JSON.stringify({ states: [...shards.keys()].sort() })}\n`);
console.log(`Projected held place references into ${shards.size} state files.`);
