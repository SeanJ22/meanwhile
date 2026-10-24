import { readStateGeometryText } from "../geo/state-geometry.ts";
import { readZipPlace, readPointPlace } from "../place-map/reader.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import type { BodyTerritoryFile } from "../registry/body-territory.ts";
import { bodyIdsAtPoint } from "../registry/body-territory.ts";

let territory: Promise<BodyTerritoryFile> | undefined;
export function readerTerritory(state: string): Promise<BodyTerritoryFile | null> {
  if (state !== "AZ") return Promise.resolve(null);
  return territory ??= readStateGeometryText("az", "body-territories.geojson")
    .then(text => JSON.parse(text) as BodyTerritoryFile).catch(error => { territory = undefined; throw error; });
}

/** The exact map point and typed ZIP use the same selected place map. */
export async function readerLocation(lat: number, lng: number, zip?: string | null) {
  const selected = currentReaderSelection();
  const same = selected?.point?.[0] === lng && selected.point[1] === lat && (selected.zip ?? null) === (zip ?? null);
  const entry = same && selected.place ? selected.place : zip ? await readZipPlace(zip) : await readPointPlace(lat, lng);
  const state = entry?.states?.[0];
  if (!state) throw new Error("The state's location could not be identified");
  return { state, states: entry.states ?? [state], zip: zip ?? null, divisionIds: entry.ids, partial: entry.partial, fringe: entry.fringe ?? [] };
}

export function territoryBodies(lat: number, lng: number, territory: BodyTerritoryFile | null): readonly string[] {
  return [...bodyIdsAtPoint([lng, lat], territory)];
}
