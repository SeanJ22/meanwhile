import type { PlaceFilter } from "./types.ts";
import type { ZipPlaces } from "./slice.ts";
import { readZipPlace, readStateZipPlaces, type PlaceEntry } from "../../place-map/reader.ts";

export interface PlaceIndex {
  readonly of: (zips: readonly string[]) => Promise<ReadonlyMap<string, ZipPlaces>>;
  readonly zipsIn: (place: PlaceFilter) => Promise<readonly string[] | null>;
}

const COUNTY = /^(ocd-division\/country:us\/state:[a-z]{2}\/county:[^/]+)(?:\/|$)/;

/** Data slices use the same selected map memberships as their public places. */
export function placeIndex(
  readCode: (zip: string) => Promise<PlaceEntry | null> = readZipPlace,
  readState: (state: string) => Promise<ReadonlyMap<string, PlaceEntry>> = readStateZipPlaces,
): PlaceIndex {
  return {
    async of(zips) {
      const out = new Map<string, ZipPlaces>();
      for (const zip of new Set(zips)) {
        const entry = await readCode(zip);
        if (!entry) continue;
        out.set(zip, { state: entry.states?.[0]?.toLowerCase() ?? null,
          counties: [...new Set(entry.ids.flatMap(id => COUNTY.exec(id)?.[1] ?? []))].sort() });
      }
      return out;
    },
    async zipsIn(place) {
      if (place.kind !== "state" && place.kind !== "county") return null;
      const state = place.kind === "state" ? place.id : /\/state:([a-z]{2})/.exec(place.id)?.[1];
      if (!state) return null;
      try {
        return [...await readState(state)].filter(([, entry]) => place.kind === "state" || entry.ids.includes(place.id)).map(([zip]) => zip);
      } catch { return null; }
    },
  };
}

export const liveZipPlaceIndex = placeIndex();
