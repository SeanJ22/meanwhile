import { publicFetch } from "../hunt/public-transport.ts";
import { parseCensusPoint, parseCensusZip, CENSUS_BENCHMARK } from "./census-geocoder.ts";
import { selectGeographyVersion, type GeographySelection } from "../census-geography/selection.ts";
import { censusWorkDivision } from "../census-geography/division-id.ts";
import type { CodeSlice, Slice } from "../control-plane/admin-view/promoted-slices.ts";
import { countyIdentity, placeIdentity, schoolIdentity, subdivisionIdentity } from "../ocd/divisions.ts";
import type { Sample } from "./address-resolution.ts";

export type AddressGeographies = Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
export type AddressGeographyLookup =
  | { kind: "MATCHED"; geographies: AddressGeographies | null }
  | { kind: "OTHER_ZIP"; zip: string };
const ENDPOINT = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";
const text = (value: unknown) => typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";

/** One Census match. Exact coordinates are validated and discarded in this function. */
export async function lookupAddressGeographies(address: string, zip: string, options: {
  fetchImpl?: typeof fetch; signal?: AbortSignal;
} = {}): Promise<AddressGeographyLookup | null> {
  const query = new URLSearchParams({ address, benchmark: CENSUS_BENCHMARK, vintage: "Current_Current", layers: "all", format: "json" });
  try {
    const response = await (options.fetchImpl ?? publicFetch)(`${ENDPOINT}?${query}`, {
      cache: "no-store", headers: { accept: "application/json" },
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(2500)]) : AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const matchedZip = parseCensusZip(payload);
    if (!parseCensusPoint(payload) || !matchedZip) return null;
    if (matchedZip !== zip) return { kind: "OTHER_ZIP", zip: matchedZip };
    const value: unknown = payload?.result?.addressMatches?.[0]?.geographies;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "MATCHED", geographies: null };
    return { kind: "MATCHED", geographies: Object.fromEntries(Object.entries(value).filter((row): row is [string, Record<string, unknown>[]] =>
      Array.isArray(row[1]) && row[1].every(item => item && typeof item === "object" && !Array.isArray(item)))) };
  } catch { return null; }
}

/** The layer version must answer for the requested purpose/date. A newer number alone proves nothing. */
export function addressDivisions(geographies: AddressGeographies, held: Slice<CodeSlice>, selection: GeographySelection): Sample {
  const out: Sample[number][] = [];
  if (held.kind === "HELD") for (const [type, level, pattern] of [
    ["congressional_district", "cd", /^(\d+)(?:st|nd|rd|th) Congressional Districts$/],
    ["state_leg_upper", "sldu", /^(\d{4}) State Legislative Districts - Upper$/],
    ["state_leg_lower", "sldl", /^(\d{4}) State Legislative Districts - Lower$/],
  ] as const) {
    const version = selectGeographyVersion(held.value.scopes.map(scope => ({ ...scope, key: scope.version })), type, selection);
    if (!version) continue;
    const layers = Object.keys(geographies).filter(name => `${level}:${pattern.exec(name)?.[1]}` === version.key);
    if (layers.length !== 1) continue;
    const rows = geographies[layers[0]];
    const divisions = rows.map(row => held.value.containers.find(container => container.ref.type === type &&
      container.ref.version === version.key && container.ref.geoid === text(row.GEOID)));
    // A partially mapped level remains unresolved; it cannot exclude another contest.
    if (!rows.length || divisions.some(row => !row || !censusWorkDivision(row.ref))) continue;
    for (const row of divisions) out.push({ ocdId: censusWorkDivision(row!.ref)!, divisionType: level, label: row!.ref.label });
  }
  // Current_Current establishes current local geography, not historical/election applicability.
  if (selection.purpose === "representation" && selection.asOf === new Date().toISOString().slice(0, 10)) {
    const counties = new Map((geographies.Counties ?? []).map(row => [text(row.GEOID), text(row.NAME)]));
    for (const [name, rows] of Object.entries(geographies)) for (const row of rows) {
      const geoid = text(row.GEOID), state = text(row.STATE) || geoid.slice(0, 2);
      let identity = null;
      let divisionType: Sample[number]["divisionType"] = "place";
      if (name === "Counties") { identity = countyIdentity(state, text(row.BASENAME) || text(row.NAME)); divisionType = "county"; }
      else if (name === "Incorporated Places") identity = placeIdentity(state, text(row.BASENAME) || text(row.NAME));
      else if (name === "County Subdivisions" && ["A", "B", "C", "G"].includes(text(row.FUNCSTAT))) {
        identity = subdivisionIdentity(state, counties.get(geoid.slice(0, 5)) ?? "", text(row.NAME));
      } else if (/^(Unified|Elementary|Secondary) School Districts$/.test(name)) {
        identity = schoolIdentity(state, text(row.NAME)); divisionType = "school_district";
      }
      if (identity) out.push({ ocdId: identity.ocdId, divisionType, label: text(row.NAME) || identity.label });
    }
  }
  return [...new Map(out.map(row => [row.ocdId, row])).values()];
}
