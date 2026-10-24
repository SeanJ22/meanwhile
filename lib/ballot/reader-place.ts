import { currentReaderSelection } from "../db/reader-route.ts";
import { registryJurisdictions } from "../civic-data/state-scopes.ts";
import { resolveZipLocation } from "../place-map/locations.ts";
import { currentRepresentationSelection, type GeographySelection } from "../census-geography/selection.ts";
import { readZipPlace, readPointPlace } from "../place-map/reader.ts";
import { US_JURISDICTIONS } from "../coverage/states.ts";
import { stateName } from "../facts/entity-read.ts";
import type { ZctaCentroid } from "../geo/zcta-core.ts";

export interface BallotPlace {
  readonly zip: string | null;
  readonly centroid: ZctaCentroid | { lat: number; lng: number } | null;
  /** Set only when the map point, not a ZIP, names the place. */
  readonly state: { readonly code: string; readonly name: string; readonly ocdId: string } | null;
}

/** A ZIP names the place unless the named state says the reader is elsewhere; then the map point does. */
export async function ballotPlaceFromParams(params: { zip?: string; state?: string; lat?: string; lng?: string }): Promise<BallotPlace> {
  const zip = params.zip && /^\d{5}$/.test(params.zip) ? params.zip : null;
  const resolution = zip ? await resolveZipLocation(zip) : null;
  const jurisdiction = US_JURISDICTIONS.find(row => row.usps === params.state?.toUpperCase());
  const lat = params.lat ? Number(params.lat) : NaN, lng = params.lng ? Number(params.lng) : NaN;
  const point = Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180 ? { lat, lng } : null;
  if (jurisdiction && point && !(zip && (await readZipPlace(zip))?.states?.includes(jurisdiction.usps))) {
    const selected = currentReaderSelection();
    const place = selected?.point?.[0] === lng && selected.point[1] === lat && !selected.zip && selected.place
      ? selected.place : await readPointPlace(lat,lng);
    const actual = US_JURISDICTIONS.find(row => row.usps === place.states?.[0]);
    if (!actual) return {zip:null,centroid:null,state:null};
    return { zip: null, centroid: point, state: { code: actual.usps, name: stateName(actual.usps)!,
      ocdId: `ocd-division/country:us/${actual.prefix}:${actual.slug}` } };
  }
  return { zip, centroid: resolution?.ok ? resolution.centroid : null, state: null };
}

/** The divisions a map point sits in, from the named state's own geometry: each hit and every division containing it. */
export async function ballotPointStateDivisions(state: NonNullable<BallotPlace["state"]>, lat: number, lng: number): Promise<string[]> {
  const ids = new Set([state.ocdId]);
  for (const hit of await ballotPointDivisions([state.code], lat, lng)) {
    const parts = hit.split("/");
    for (; parts.length > 2; parts.pop()) ids.add(parts.join("/"));
  }
  return [...ids];
}

export async function ballotPlaceDivisions(place: {
  divisions?: readonly string[];
  zip?: unknown;
  lat?: unknown;
  lng?: unknown;
}): Promise<string[]> {
  const supplied = Array.isArray(place.divisions) ? place.divisions.filter(id => typeof id === "string" && /^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}(?:\/[^\s]+)?$/.test(id)) : [];
  if (supplied.length) return [...new Set(supplied)];
  const zip = typeof place.zip === "string" && /^\d{5}$/.test(place.zip) ? place.zip : null;
  if (zip) return [...(await readZipPlace(zip))?.ids ?? []];
  if (typeof place.lat !== "number" || !Number.isFinite(place.lat) || typeof place.lng !== "number" || !Number.isFinite(place.lng)) return [];
  const selected = currentReaderSelection();
  if (selected?.point?.[0] === place.lng && selected.point[1] === place.lat && selected.divisions) return [...selected.divisions];
  return [...(await readPointPlace(place.lat, place.lng)).ids];
}

export function ballotPlaceFromRequest(request: Request): Promise<string[]> {
  const url = new URL(request.url), query = url.searchParams;
  const selection = currentReaderSelection();
  const explicit = query.getAll("division");
  const keys = [...selection?.keys ?? [], decodeURIComponent(url.pathname)];
  const states = new Set(keys.flatMap(key => registryJurisdictions(key).concat(
    [...key.matchAll(/(?:^|\/)statewide:([a-z]{2})(?=[:/]|$)/gi)].map(match => match[1].toUpperCase()))));
  const divisions = explicit.length ? explicit : query.has("zip") || query.has("lat") ? [] :
    [...selection?.divisions ?? [], ...states].map(key => /^[A-Z]{2}$/.test(key)
      ? `ocd-division/country:us/${key === "DC" ? "district" : "state"}:${key.toLowerCase()}` : key);
  return ballotPlaceDivisions({ divisions, zip: query.get("zip"),
    lat: query.has("lat") ? Number(query.get("lat")) : undefined,
    lng: query.has("lng") ? Number(query.get("lng")) : undefined });
}


export async function ballotPointDivisions(states: readonly string[], lat: number, lng: number,
  selection: GeographySelection = currentRepresentationSelection()): Promise<string[]> {
  const result = await readPointPlace(lat, lng, selection);
  return result.ids.filter(id => !states.length || registryJurisdictions(id).some(state => states.includes(state)) || id === "ocd-division/country:us");
}
