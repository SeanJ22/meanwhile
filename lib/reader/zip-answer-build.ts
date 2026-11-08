import { readerRoute } from "../api/reader-route.ts";
import { readZipPlace, withPlaceMapReads, type PlaceEntry } from "../place-map/reader.ts";
import { readZipLocation, zipLocationAnswer } from "../place-map/locations.ts";
import { readLocationPlace, readerLocation, readerTerritory, territoryBodies } from "./location.ts";
import { placePageCacheIds } from "./place.ts";
import { composeStateAnswer } from "./state-response.ts";
import type { ZipAnswer } from "./zip-answer.ts";

/** What the meetings answer reads for a ZIP, read the way that route reads it: under the selection a typed ZIP's request makes. */
const meetingsInputs = readerRoute("/api/meetings", async (_request: Request, zip: string) => {
  const entry = await readZipPlace(zip), point = await readZipLocation(zip);
  if (!entry?.states?.length || !point) return null;
  const location = await readerLocation(point.lat, point.lng, zip);
  const territory = await readerTerritory(location.state);
  const place = await readLocationPlace(location, point.lat, point.lng, territory);
  return { entry, point, territoryBodyIds: [...territoryBodies(point.lat, point.lng, territory)], place, pageIds: placePageCacheIds(place) };
});

/** The state's answer as `/api/reader/state?zip=Z` composes it, outside any selection like that route. */
const stateAnswers = (state: string, zip: string, entry: PlaceEntry) => withPlaceMapReads(() => composeStateAnswer(state, zip, entry));

/**
 * Everything the three ZIP answers read, composed by the functions the routes call, so a published answer is the database answer by
 * construction. Null when the ZIP has no place or point to answer from; a failed read throws and the ZIP keeps its last answer.
 */
export async function buildZipAnswer(zip: string): Promise<ZipAnswer | null> {
  const inputs = await meetingsInputs(new Request(`https://zip-answers.invalid/api/meetings?zip=${zip}`), zip);
  if (!inputs) return null;
  const location = await withPlaceMapReads(() => zipLocationAnswer(zip));
  const states: Record<string, { version: string; body: Record<string, unknown> }> = {};
  for (const state of inputs.entry.states!) states[state] = await stateAnswers(state, zip, inputs.entry);
  return { zip, location, states, place: inputs.entry, point: inputs.point, territoryBodyIds: inputs.territoryBodyIds, pageIds: inputs.pageIds, package: inputs.place };
}
