import { currentReaderSelection } from "../db/reader-route.ts";
import { registryJurisdictions } from "../civic-data/state-scopes.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { contains, type GeoFeature } from "../registry/resolve.ts";
import { requireBallotState } from "../civic-data/state-scopes.ts";
import { zipDivisionEntry } from "../geo/zip-division-index.ts";
import { resolveZip } from "../geo/zcta.ts";
import { censusVintageFor, divisionsFromCensusGeographies, type CensusGeographies } from "../geo/census-geographies.ts";
import { currentRepresentationSelection } from "../census-geography/selection.ts";
import { divisionIdsForZipArea, POINT_GEOMETRY_PLANS } from "./zip-divisions.ts";

export async function ballotPlaceDivisions(place: {
  divisions?: readonly string[];
  zip?: unknown;
  lat?: unknown;
  lng?: unknown;
}): Promise<string[]> {
  const supplied = Array.isArray(place.divisions) ? place.divisions.filter(id => typeof id === "string" && /^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}(?:\/[^\s]+)?$/.test(id)) : [];
  if (supplied.length) return [...new Set(supplied)];
  const zip = typeof place.zip === "string" && /^\d{5}$/.test(place.zip) ? place.zip : null;
  if (zip) {
    const indexed = await zipDivisionEntry(zip);
    if (indexed?.ids.length) return [...indexed.ids];
  }
  const resolved = zip ? resolveZip(zip) : null;
  const point = typeof place.lat === "number" && Number.isFinite(place.lat) && Math.abs(place.lat) <= 90 &&
    typeof place.lng === "number" && Number.isFinite(place.lng) && Math.abs(place.lng) <= 180
    ? { lat: place.lat, lng: place.lng } : resolved?.ok ? resolved.centroid : null;
  if (!point) return [];
  const selection = currentRepresentationSelection();
  const url = new URL("https://geocoding.geo.census.gov/geocoder/geographies/coordinates");
  url.search = new URLSearchParams({ x: String(point.lng), y: String(point.lat), benchmark: "Public_AR_Current",
    vintage: censusVintageFor(selection), layers: "all", format: "json" }).toString();
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2200) });
  if (!response.ok) throw new Error("Place geography could not be read");
  const payload = await response.json() as { result?: { geographies?: CensusGeographies } };
  const rows = divisionsFromCensusGeographies(payload.result?.geographies ?? {}, selection, url.href, new Date().toISOString());
  const divisions = [...new Set(rows.flatMap(row => {
    const state = /^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}/.exec(row.ocdId)?.[0];
    return state ? [row.ocdId, state] : [row.ocdId];
  }))];
  return zip ? divisionIdsForZipArea(zip, divisions, undefined, POINT_GEOMETRY_PLANS) : divisions;
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


const stateGeometry = new Map<string, Promise<GeoFeature[]>>();
let geometryManifest: Promise<{ files: string[] }> | null = null;

export async function ballotPointDivisions(states: readonly string[], lat: number, lng: number): Promise<string[]> {
  const hits = await Promise.all([...new Set(states.map(requireBallotState))].map(async state => {
    let held = stateGeometry.get(state);
    if (!held) {
      held = (async () => {
        geometryManifest ??= readFile(join(process.cwd(), "data", "derived", "resolver-geometry.json"), "utf8").then(text => JSON.parse(text));
        const prefix = `data/states/${state.toLowerCase()}/geo/`;
        const names = (await geometryManifest)!.files.filter(name => name.startsWith(prefix));
        const files = await Promise.all(names.map(async name => {
          const filename = name.slice(prefix.length);
          if (!/^[a-z0-9][a-z0-9.-]*\.geojson$/.test(filename)) throw new Error("Invalid state geometry path");
          return JSON.parse(await readFile(join(process.cwd(), "data", "states", state.toLowerCase(), "geo", filename), "utf8")) as { features: GeoFeature[] };
        }));
        return files.flatMap(file => file.features);
      })();
      stateGeometry.set(state, held);
      held.catch(() => stateGeometry.delete(state));
      while (stateGeometry.size > 8) stateGeometry.delete(stateGeometry.keys().next().value!);
    }
    return (await held).filter(feature => contains([lng, lat], feature)).map(feature => feature.properties.ocdId);
  }));
  return [...new Set(hits.flat())];
}
