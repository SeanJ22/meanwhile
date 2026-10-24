import { createReadStream } from "node:fs";
import { join } from "node:path";
import { csvRows } from "../reference/csv.ts";

export interface GeographicDistrict {
  readonly pid: string;
  readonly name: string;
  readonly countyFips: string;
  readonly governmentId?: string;
}

/** Mailing addresses do not establish territory. Stream Census records and
 * retain only districts whose geographic FIPS belongs to this state. */
export async function geographicSpecialDistricts(root: string, fips: string): Promise<GeographicDistrict[]> {
  let quoted = false, record = "", header: string[] | undefined;
  const result: GeographicDistrict[] = [];
  const consume = () => {
    const row = csvRows(record).next().value as string[] | undefined;
    record = "";
    if (!row) return;
    if (!header) { header = row; return; }
    const value = (name: string) => row[header!.indexOf(name)] ?? "";
    if (value("gov_type") !== "SPECIAL DISTRICT" || value("fips_state").padStart(2, "0") !== fips) return;
    const county = value("fips_county").padStart(3, "0");
    if (!/^\d{3}$/.test(county) || county === "000") throw new Error(`Census district has no host county: ${value("census_id_pid6")}`);
    result.push({ pid: value("census_id_pid6"), name: value("unit_name"), countyFips: fips + county });
  };
  for await (const chunk of createReadStream(join(root, "data/reference/census_govt_units_2022.csv"), { encoding: "utf8" })) {
    for (const char of chunk) {
      record += char;
      if (char === '"') quoted = !quoted;
      if (char === "\n" && !quoted) consume();
    }
  }
  if (quoted) throw new Error("Census CSV ends inside a quoted record");
  if (record.trim()) consume();
  if (!header?.includes("fips_state") || !header.includes("fips_county")) throw new Error("Census geographic county columns are missing");
  return result;
}
