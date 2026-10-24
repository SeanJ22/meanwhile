import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { csvRows } from "../reference/csv.ts";
import type { RegistrationReference } from "../registration/reference.ts";
import type { GeoFeature } from "../registry/resolve.ts";
import type { PlaceBoundary } from "./types.ts";

/** The source catalog and its acquired district boundary file share the held
 * OCD identity; a source's feature key is not necessarily unique. */
export async function heldSpecialDistrictBoundaries(root: string, registration: RegistrationReference): Promise<PlaceBoundary[]> {
  const fips = registration.divisions.find(d => d[1] === "state")?.[2];
  if (!fips) throw new Error(`No state FIPS for ${registration.state}`);
  const special = new Map(registration.divisions.filter(d => d[1] === "district").map(d => [d[0], d]));
  let features: GeoFeature[] = [];
  try { features = (JSON.parse(await readFile(join(root, "data/states", registration.state, "geo", `territory-${fips}.geojson`), "utf8")) as { features: GeoFeature[] }).features; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const boundaries = new Map<string, PlaceBoundary>();
  for (const feature of features) {
    const division = special.get(feature.properties.ocdId);
    if (!division) continue;
    const source = registration.boundarySources?.[division[2].split("#")[0]];
    if (!source) throw new Error(`District source missing for ${division[0]}`);
    const previous = boundaries.get(division[0])?.geometry;
    const parts = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const held = previous ? previous.type === "Polygon" ? [previous.coordinates] : previous.coordinates : [];
    boundaries.set(division[0], { placeId: division[0], boundaryYear: 2022, layer: "district", version: "district:2022",
      geometry: { type: "MultiPolygon", coordinates: [...held, ...parts] }, countyAttachment: false, hostCountyId: null, sourceUrls: [source.url], checkedAt: source.readAt });
  }
  return [...boundaries.values()];
}

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
