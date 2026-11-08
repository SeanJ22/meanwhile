import { readStateGeometryText } from "../geo/state-geometry.ts";
import { readZipPlace, readPointPlace } from "../place-map/reader.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import type { BodyTerritory, BodyTerritoryFile } from "../registry/body-territory.ts";
import { bodyIdsAtPoint } from "../registry/body-territory.ts";
import { readPlacesForStates, type PlacePackage } from "./place.ts";
import type { PlaceEntry } from "../place-map/reader.ts";

let territory: Promise<BodyTerritoryFile> | undefined;
export function readerTerritory(state: string): Promise<BodyTerritoryFile | null> {
  if (state !== "AZ") return Promise.resolve(null);
  return territory ??= readStateGeometryText("az", "body-territories.geojson")
    .then(text => JSON.parse(text) as BodyTerritoryFile).catch(error => { territory = undefined; throw error; });
}

/** What a place entry says of where a reader is: its first state, every state it lies in, and its divisions. */
export function locationFromEntry(entry: PlaceEntry | null | undefined, zip?: string | null) {
  const state = entry?.states?.[0];
  if (!entry || !state) throw new Error("The state's location could not be identified");
  return { state, states: entry.states ?? [state], zip: zip ?? null, divisionIds: entry.ids, partial: entry.partial, fringe: entry.fringe ?? [] };
}

/** The exact map point and typed ZIP use the same selected place map. */
export async function readerLocation(lat: number, lng: number, zip?: string | null) {
  const selected = currentReaderSelection();
  const same = selected?.point?.[0] === lng && selected.point[1] === lat && (selected.zip ?? null) === (zip ?? null);
  return locationFromEntry(same && selected.place ? selected.place : zip ? await readZipPlace(zip) : await readPointPlace(lat, lng), zip);
}

/** The saved pages of the places a location lies over, as the meetings answer and the published ZIP answer both read them. */
export async function readLocationPlace(location: Awaited<ReturnType<typeof readerLocation>>, lat: number, lng: number, territory: BodyTerritoryFile | null): Promise<PlacePackage> {
  const zip = location.zip;
  return readPlacesForStates(location.states, { divisionIds: location.divisionIds, bodyIds: territoryBodies(lat, lng, territory),
    namedDivisionIds: zip ? location.fringe : [], ...(zip ? { placeId: `zip:${zip}` } : {}) });
}

export function territoryBodies(lat: number, lng: number, territory: BodyTerritory | null): readonly string[] {
  return [...bodyIdsAtPoint([lng, lat], territory)];
}
