import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { nearestZcta } from "../geo/zcta.ts";
import { postalArea } from "../geo/postal.ts";
import { readZipPlace } from "./national.ts";
import type { BodyTerritoryFile } from "../registry/body-territory.ts";
import { bodyIdsAtPoint } from "../registry/body-territory.ts";
import type { ReaderStatePackage } from "./state.ts";
import { withCensusDistricts, divisionsFromZipDistricts } from "../geo/zip-census-districts.ts";
import { zipNeedsAddress } from "../geo/postal.ts";
import { isTownOrCountyDivision } from "../geo/postal-core.ts";
import { haversineKm } from "../geo/distance.ts";

let territory: Promise<BodyTerritoryFile> | undefined;
export function readerTerritory(state: string): Promise<BodyTerritoryFile | null> {
  if (state !== "AZ") return Promise.resolve(null);
  return territory ??= readFile(join(process.cwd(), "data", "states", "az", "geo", "body-territories.geojson"), "utf8")
    .then(text => JSON.parse(text) as BodyTerritoryFile).catch(error => { territory = undefined; throw error; });
}

/** Postal state and the national place index are available before a state's records arrive. */
export async function readerLocation(lat: number, lng: number, zip?: string | null) {
  const nearest = zip ? null : nearestZcta(lat, lng);
  const state = postalArea(zip ?? nearest?.zip ?? "")?.state;
  if (!state) throw new Error("The state's location could not be identified");
  const near = zip ?? (nearest && haversineKm(lat, lng, nearest.lat, nearest.lng) <= 60 ? nearest.zip : null);
  const entry = near ? await readZipPlace(postalArea(near)?.zcta ?? near) : undefined;
  return { state, zip: near, divisionIds: entry?.ids ?? [], partial: entry?.partial ?? [], fringe: entry?.fringe ?? [] };
}

export function territoryBodies(lat: number, lng: number, territory: BodyTerritoryFile | null): readonly string[] {
  return [...bodyIdsAtPoint([lng, lat], territory)];
}

export async function stateZipLocation(state: ReaderStatePackage, zip: string) {
  const raw = await readZipPlace(postalArea(zip)?.zcta ?? zip) ?? { ids: [], partial: [], samples: 0 };
  if (zipNeedsAddress(zip)) return { entry: { ...raw, ids: raw.ids.filter(isTownOrCountyDivision) }, divisions: [] };
  const districts = state.districts;
  if (districts.kind !== "HELD") return { entry: raw, divisions: [] };
  const slice = { ...districts, value: { ...districts.value, known: true } };
  return { entry: withCensusDistricts(raw, slice, zip), divisions: divisionsFromZipDistricts(zip, slice) };
}
