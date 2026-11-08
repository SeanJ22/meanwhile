import { readerRoute } from "../api/reader-route.ts";
import { readZipPlace, withPlaceMapReads, type PlaceEntry } from "../place-map/reader.ts";
import { readZipLocation, zipLocationAnswer } from "../place-map/locations.ts";
import { readLocationPlace, readerLocation, readerTerritory, territoryBodies } from "./location.ts";
import { nationalEverydayRouting } from "./national.ts";
import { placePageCacheIds } from "./place.ts";
import { composeStateAnswer } from "./state-response.ts";
import type { StateMirror } from "./state-mirror.ts";
import { withStateSeam } from "./state-seam.ts";
import type { ZipAnswer, ZipStateAnswer } from "./zip-answer.ts";

/** The part of a ZIP's answer the saved pages decide: what the meetings answer reads, read the way that route reads it, under the selection a typed ZIP's request makes. */
export type ZipMeetings = Pick<ZipAnswer, "place" | "point" | "territoryBodyIds" | "pageIds" | "package">;

const meetingsInputs = readerRoute("/api/meetings", async (_request: Request, zip: string): Promise<ZipMeetings | null> => {
  const entry = await readZipPlace(zip), point = await readZipLocation(zip);
  if (!entry?.states?.length || !point) return null;
  const location = await readerLocation(point.lat, point.lng, zip);
  const territory = await readerTerritory(location.state);
  const place = await readLocationPlace(location, point.lat, point.lng, territory);
  return { place: entry, point, territoryBodyIds: [...territoryBodies(point.lat, point.lng, territory)], package: place, pageIds: placePageCacheIds(place) };
});

export const buildZipMeetings = (zip: string): Promise<ZipMeetings | null> => meetingsInputs(new Request(`https://zip-answers.invalid/api/meetings?zip=${zip}`), zip);

/** The body `/api/location/zip` returns. */
export const buildZipLocation = (zip: string): Promise<Record<string, unknown>> => withPlaceMapReads(() => zipLocationAnswer(zip));

/** The state's answer as `/api/reader/state?zip=Z` composes it, outside any selection like that route. Given a copy of the state, it reads the copy. */
export function buildZipStateBody(state: string, zip: string, entry: PlaceEntry, copy?: StateMirror): Promise<ZipStateAnswer> {
  const compose = () => withPlaceMapReads(() => composeStateAnswer(state, zip, entry));
  return copy ? withStateSeam(copy.seam, compose) : compose();
}

/** The national routing record every ZIP shows, as the saved pages' reader reads it. */
export const buildNationalRouting = (): ReturnType<typeof nationalEverydayRouting> => nationalEverydayRouting();

/**
 * Everything the three ZIP answers read, composed by the functions the routes call, so a published answer is the database answer by
 * construction. Null when the ZIP has no place or point to answer from; a failed read throws and the ZIP keeps its last answer.
 */
export async function buildZipAnswer(zip: string): Promise<ZipAnswer | null> {
  const meetings = await buildZipMeetings(zip);
  if (!meetings) return null;
  const states: Record<string, ZipStateAnswer> = {};
  for (const state of meetings.place.states!) states[state] = await buildZipStateBody(state, zip, meetings.place);
  return { zip, location: await buildZipLocation(zip), states, ...meetings };
}
