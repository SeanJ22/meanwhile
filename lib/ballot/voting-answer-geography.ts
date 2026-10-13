import { parseCensusPoint } from "../geo/census-geocoder.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { Division } from "../registry/types.ts";
import type { VotingReaderPlace } from "./voting-answer.ts";
import type { VotingAddressInput } from "./voting-source-types.ts";

const strings = (values: (string | undefined | null)[]) => [...new Set(values.filter((v): v is string => !!v))];
const stateId = (id: string) => /\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(id)?.[1]?.toUpperCase();

/** Exact address fields for government forms; kept only in the active request. */
export function censusVotingAddressFields(address: string, payload: unknown): VotingAddressInput {
  const matches = (payload as { result?: { addressMatches?: { addressComponents?: Record<string, unknown> }[] } })?.result?.addressMatches;
  if (matches?.length !== 1) return { address };
  const parts = matches[0].addressComponents ?? {};
  const field = (name: string) => typeof parts[name] === "string" ? parts[name] as string : "";
  return { address, streetNumber: /^\s*(\d+[a-zA-Z]?(?:-\d+)?)(?:\s|$)/.exec(address)?.[1],
    street: ["preDirection", "preType", "streetName", "suffixType", "suffixDirection"].map(field).filter(Boolean).join(" ") || undefined,
    city: field("city") || undefined, state: field("state") || undefined, zip: field("zip") || undefined };
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
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    const point = parseCensusPoint(payload);
    return point ? { point, payload } : null;
  } catch { return null; }
}

/** The fallback is fixed to the 2020 vintage, never an unlabeled current district. */
export async function census2020VotingDistricts(point: { lat: number; lng: number }, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/geographies/coordinates");
  url.search = new URLSearchParams({ x: String(point.lng), y: String(point.lat), benchmark: "Public_AR_Census2020", vintage: "Census2020_Census2020", layers: "all", format: "json" }).toString();
  try {
    const response = await fetchImpl(url, { cache: "no-store", signal: AbortSignal.timeout(900), headers: { accept: "application/json" } });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}
