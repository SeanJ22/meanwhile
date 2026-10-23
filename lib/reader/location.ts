import { readStateGeometryText } from "../geo/state-geometry.ts";
import { nearestZcta } from "../geo/zcta.ts";
import { postalArea } from "../geo/postal.ts";
import { readZipPlace } from "./national.ts";
import type { BodyTerritoryFile } from "../registry/body-territory.ts";
import { bodyIdsAtPoint } from "../registry/body-territory.ts";
import { haversineKm } from "../geo/distance.ts";

let territory: Promise<BodyTerritoryFile> | undefined;
export function readerTerritory(state: string): Promise<BodyTerritoryFile | null> {
  if (state !== "AZ") return Promise.resolve(null);
  return territory ??= readStateGeometryText("az", "body-territories.geojson")
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
