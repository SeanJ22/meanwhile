import { parseCensusPoint } from "../geo/census-geocoder.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { Division } from "../registry/types.ts";
import type { VotingReaderPlace } from "./voting-answer.ts";
import { recordVotingFailure } from "./voting-errors.ts";
import countyTimeZones from "../../data/reference/national_county_time_zones.json" with { type: "json" };

const strings = (values: (string | undefined | null)[]) => [...new Set(values.filter((v): v is string => !!v))];
const stateId = (id: string) => /\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(id)?.[1]?.toUpperCase();

/** Local ZIP membership needs no representation, officeholder, or government lookup. */
export function votingPlaceFromZip(ids: readonly string[]): VotingReaderPlace {
  const countyNames = strings(ids.map(id => /\/county:([^/]+)/.exec(id)?.[1]?.replaceAll("_", " ")));
  const states = strings(ids.map(stateId));
  const key = (name: string) => name.toLowerCase().replace(/\s+(?:county|parish|borough|municipality|census area)$/, "").replace(/[^a-z0-9]/g, "");
  const countyFips = countyTimeZones.counties.filter(row => states.includes(row[1] as string) && countyNames.some(name => key(name) === key(row[2] as string))).map(row => row[0] as string);
  return { precision: "ZIP", point: null, divisionIds: [...ids], states, countyFips, countyNames,
    countySubdivisionGeoids: [], towns: strings(ids.map(id => /\/(?:place|cousub):([^/]+)$/.exec(id)?.[1]?.replaceAll("_", " "))),
    wards: [], aiannhGeoids: [], precincts: [] };
}

/** A failed street match can still show the published sites for a supplied ZIP. */
export function votingInputZip(address: string): string | null {
  return /(?:^|[,\s])(\d{5})(?:-\d{4})?\s*$/.exec(address)?.[1] ?? null;
}

export function votingPlaceFromDivisions(divisions: readonly Division[], precision: VotingReaderPlace["precision"], point: VotingReaderPlace["point"]): VotingReaderPlace {
  return {
    precision, point, divisionIds: divisions.map(d => d.ocdId), states: strings(divisions.flatMap(d => [d.state?.toUpperCase(), stateId(d.ocdId)])),
    countyFips: strings(divisions.filter(d => d.divisionType === "county").map(d => d.geoid)),
    countyNames: strings(divisions.filter(d => d.divisionType === "county").map(d => d.label)),
    countySubdivisionGeoids: strings(divisions.filter(d => ["cousub", "county_subdivision"].includes(d.divisionType)).map(d => d.geoid)),
    towns: strings(divisions.filter(d => ["place", "cousub", "county_subdivision"].includes(d.divisionType)).map(d => d.label)),
    wards: strings(divisions.filter(d => d.divisionType === "ward").map(d => d.label)),
    aiannhGeoids: strings(divisions.filter(d => /aiannh|tribal/.test(d.divisionType)).map(d => d.geoid)), precincts: [],
  };
}

/** Only geographic attributes survive; the matched address and range endpoints do not. */
export function addCensusVotingGeographies(place: VotingReaderPlace, payload: unknown, vintage: "CURRENT" | "CENSUS_2020" = "CURRENT"): VotingReaderPlace {
  const result = (payload as { result?: { addressMatches?: { geographies?: unknown }[]; geographies?: unknown } })?.result;
  const geography = result?.addressMatches?.length === 1 ? result.addressMatches[0].geographies : result?.geographies;
  if (!geography || typeof geography !== "object") return place;
  const next = { ...place, states: [...place.states], countyFips: [...place.countyFips], countyNames: [...(place.countyNames ?? [])], countySubdivisionGeoids: [...place.countySubdivisionGeoids], towns: [...place.towns], aiannhGeoids: [...place.aiannhGeoids], precincts: [...place.precincts] };
  for (const [layer, rows] of Object.entries(geography)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows as Record<string, unknown>[]) {
      const geoid = typeof row.GEOID === "string" ? row.GEOID : "";
      const name = typeof row.NAME === "string" ? row.NAME : "";
      const state = typeof row.STATE === "string" ? FIPS_TO_STATE[row.STATE]?.postal : undefined;
      if (state && !next.states.includes(state)) next.states.push(state);
      if (/^counties$/i.test(layer) && geoid) { next.countyFips.push(geoid); if (name) next.countyNames.push(name); }
      if (/county subdivisions/i.test(layer) && geoid) { next.countySubdivisionGeoids.push(geoid); if (name) next.towns.push(name); }
      if (/american indian|alaska native|native hawaiian|aiannh/i.test(layer) && geoid) next.aiannhGeoids.push(geoid);
      if (vintage === "CENSUS_2020" && /voting districts/i.test(layer) && name) next.precincts.push({ name,
        countyFips: geoid.length >= 5 ? geoid.slice(0, 5) : undefined, kind: "CENSUS_2020_VTD",
        source: { publisher: "U.S. Census Bureau", url: "https://www.census.gov/geographies/mapping-files/2020/geo/tiger-line-file.html", title: "2020 voting districts" } });
    }
  }
  next.countyFips = strings(next.countyFips); next.countySubdivisionGeoids = strings(next.countySubdivisionGeoids);
  next.towns = strings(next.towns); next.aiannhGeoids = strings(next.aiannhGeoids);
  return next;
}

export async function censusVotingAddress(address: string, fetchImpl: typeof fetch = fetch): Promise<{ point: { lat: number; lng: number }; payload: unknown } | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress");
  url.search = new URLSearchParams({ address, benchmark: "Public_AR_Current", vintage: "Current_Current", layers: "all", format: "json" }).toString();
  try {
    const response = await fetchImpl(url, { cache: "no-store", signal: AbortSignal.timeout(2200), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Census geocoder returned HTTP ${response.status}`);
    const payload: unknown = await response.json();
    const point = parseCensusPoint(payload);
    if (!point) recordVotingFailure({ stage: "geocode", precision: "ADDRESS" }, new Error("Census returned no unique address match"));
    return point ? { point, payload } : null;
  } catch (error) { recordVotingFailure({ stage: "geocode", precision: "ADDRESS" }, error, address); return null; }
}
