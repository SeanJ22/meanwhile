/** Pure scope reference: dependent systems use the same Census/LEAID join as independent school districts. */
import { readFileSync, writeFileSync } from "node:fs";
import { readTable } from "../lib/reference/index.ts";
import { censusSchoolLeaIds, censusSchoolTerritory } from "../lib/geo/census-school-territory.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
const held = JSON.parse(readFileSync("data/derived/zip-governments.json", "utf8")) as { zips: Record<string, { layer: string; id: string }[]> };
const territories = new Map<string, string[]>();
for (const [zip, edges] of Object.entries(held.zips)) for (const edge of edges) {
  const key = `${edge.layer}:${edge.id}`;
  const list = territories.get(key) ?? [];
  list.push(zip); territories.set(key, list);
}
const leaIds = censusSchoolLeaIds(readFileSync("data/derived/census-nces-crosswalk.csv", "utf8"));
const table = readTable("census_govt_units_2022_dependent_school_systems");
const units = table.rows.map(row => {
  const at = (column: string) => row[table.header.indexOf(column)] ?? "";
  const pid6 = at("census_id_pid6");
  return { pid6, name: at("unit_name"), type: at("gov_type"), state: at("state"), ...censusSchoolTerritory(leaIds.get(pid6), territories) };
});
const path = "lib/control-plane/expansion/reference/census-dependent-school-territories.json";
const count = floored("held Census dependent systems", "census_govt_units_2022_dependent_school_systems", table.rows.length, units.length);
writeFileSync(path, JSON.stringify({ source: "census_govt_units_2022_dependent_school_systems + census-nces-crosswalk + zip-governments", units }, null, 2) + "\n");
console.log(`WROTE ${path}: ${floorLine(count)}, no network or clock`);
