import { readerRoute } from "@/lib/api/reader-route";
import { compressedJson } from "@/lib/api/compressed-json";
import { matching, numeric, numericInRange, refuse, rejectUnknown } from "@/lib/api/params";
import { stageTimer } from "@/lib/api/server-timing";
import { DEFAULT_RADIUS_KM, MAX_RADIUS_KM } from "@/lib/meetings/constants";
import { locationFromEntry, readerLocation, readerTerritory, readLocationPlace, territoryBodies } from "@/lib/reader/location";
import { readStatePackage } from "@/lib/reader/state";
import { placePageCacheIds, readPlacesForStates } from "@/lib/reader/place";
import { stateCoverage, withPlaceRegistry } from "@/lib/reader/coverage";
import { meetingBodyIds, searchMeetingsFromSource as searchMeetings } from "@/lib/meetings/query";
import { snapshotSourceFor } from "@/lib/meetings/snapshot-source";
import { wireSnapshot } from "@/lib/meetings/freshness";
import { readReaderMeetingSettings } from "@/lib/meetings/reader-settings";
import { readerMeetingScope } from "@/lib/meetings/reader-scope";
import { meetingListingIdentity } from "@/lib/meetings/listing-identity";
import { canonicalBodyIdentity } from "@/lib/ask/body-identity";
import { withRegistryRuntimeProjection } from "@/lib/registry/runtime-read-model";
import { bindGovernmentBodies } from "@/lib/registration/listings";
import { readerCacheHeaders,readerPlaceCacheHeaders,withReaderZipTag } from "@/lib/reader/cache";
import { readZipAnswer, type ZipAnswer } from "@/lib/reader/zip-answer";
import { attemptsByFamily } from "@/lib/registry/attempt-families";
import {readerStateResponseFor} from "@/lib/reader/state-response";
import { readZipLocation } from "@/lib/place-map/locations";
import type { ReaderStateResponse } from "@/lib/reader/client";

export const runtime = "nodejs";

/**
 * A ZIP whose answer is published is answered from its file: the places, point and saved pages are read from it, and only the
 * meetings (which depend on the clock) are composed now. A request naming a point whose territory boards differ is answered the long way.
 */
async function publishedAnswer(request: Request): Promise<ZipAnswer | null> {
  const params = new URL(request.url).searchParams, zips = params.getAll("zip");
  if (zips.length !== 1 || !/^\d{5}$/.test(zips[0]) || !rejectUnknown(params, ["lat", "lng", "radiusKm", "zip", "include"]).ok
    || params.has("include") && params.get("include") !== "state") return null;
  const published = await readZipAnswer(zips[0]);
  if (!published || !params.has("lat") && !params.has("lng")) return published;
  const lat = numericInRange(params, "lat", -90, 90, "refuse"), lng = numericInRange(params, "lng", -180, 180, "refuse");
  if (!lat.ok || !lng.ok || !params.has("lat") || !params.has("lng")) return null;
  let here: readonly string[];
  try { here = territoryBodies(lat.value, lng.value, await readerTerritory(published.place.states?.[0] ?? "")); } catch { return null; }
  return here.length === published.territoryBodyIds.length && here.every((id, index) => id === published.territoryBodyIds[index]) ? published : null;
}

// A ZIP with no published answer is read from the database; this goes once every ZIP is published.
const unpublished = readerRoute("/api/meetings", (request: Request) => answer(request, null));
export async function GET(request: Request): Promise<Response> {
  const published = await publishedAnswer(request);
  return published ? answer(request, published) : unpublished(request);
}

async function answer(request: Request, published: ZipAnswer | null): Promise<Response> {
  const timing = stageTimer(), params = new URL(request.url).searchParams;
  const unknown = rejectUnknown(params, ["lat", "lng", "radiusKm", "zip", "include"]);
  if (!unknown.ok) return refuse(unknown.error);
  if (params.has("include") && params.get("include")!=="state") return refuse("include must be state");
  const zipRead = matching(params, "zip", /^\d{5}$/, { default: null });
  if (!zipRead.ok) return refuse(zipRead.error);
  const zipPoint = zipRead.value ? published ? published.point : await readZipLocation(zipRead.value) : null;
  if (zipRead.value && !params.has("lat") && !params.has("lng")) {
    if (!zipPoint) return refuse("That ZIP could not be located");
    params.set("lat", String(zipPoint.lat)); params.set("lng", String(zipPoint.lng));
  }
  const latRead = numericInRange(params, "lat", -90, 90, "refuse");
  if (!latRead.ok) return refuse(latRead.error);
  const lngRead = numericInRange(params, "lng", -180, 180, "refuse");
  if (!lngRead.ok) return refuse(lngRead.error);
  const radiusRead = numeric(params, "radiusKm", { default: DEFAULT_RADIUS_KM });
  if (!radiusRead.ok) return refuse(radiusRead.error);
  if (radiusRead.value <= 0) return refuse(`radiusKm must be greater than 0, received ${radiusRead.value}`);
  const lat = latRead.value, lng = lngRead.value, radiusKm = Math.min(radiusRead.value, MAX_RADIUS_KM);
  const stateAnswerRead = params.get("include")==="state" && zipRead.value ? readerStateResponseFor(request, published).then(async response=>{
    const value=await response.json() as ReaderStateResponse;
    return {status:response.status,headers:[...response.headers],value};
  }).catch(()=>
    ({status:503,headers:[["cache-control","no-store"]],value:{error:"The state's information could not be loaded"}})) : Promise.resolve(null);
  try {
    const location = published ? locationFromEntry(published.place, zipRead.value) : await readerLocation(lat, lng, zipRead.value);
    // A map movement has one state read and one place read in this handler.
    // ZIP entry already starts its independent state endpoint before this read.
    const stateRead = zipRead.value ? Promise.resolve(null) : timing.time("state", () => readStatePackage(location.state));
    const fringe = zipRead.value ? location.fringe : [];
    const territoryRead = readerTerritory(location.state);
    const placeRead = published ? Promise.resolve(published.package) : timing.time("place", async () => zipRead.value
      ? readLocationPlace(location, lat, lng, await territoryRead)
      : readPlacesForStates(location.states, { divisionIds: location.divisionIds, bodyIds: territoryBodies(lat, lng, await territoryRead), namedDivisionIds: fringe }));
    const [state, place, settings] = await Promise.all([
      stateRead, placeRead, readReaderMeetingSettings(),
    ]);
    if (!place.registry) throw new Error("The place's government records could not be loaded");
    const territory = await territoryRead;
    const ids = location.divisionIds;
    const divisionIds = new Set(ids);
    const registry = place.registry;
    const bodies = registry.registry.bodies;
    const territoryBodyIds = territoryBodies(lat, lng, territory);
    const selectedBodyIds = new Set([...meetingBodyIds(bodies, divisionIds), ...territoryBodyIds]);
    const result = await searchMeetings(lat, lng, radiusKm, new Date(), divisionIds, snapshotSourceFor(place.snapshot), settings,
      selectedBodyIds, new Set(bodies.map(body => body.id)));
    const localIds = state ? ids : ids.filter(id => !/\/(?:cd|sldu|sldl):/.test(id));
    const coverage = stateCoverage(state ? withPlaceRegistry(state, registry) : { state: location.state, registry, version: place.snapshot.generatedAt },
      localIds, lat, lng, place.meetings, place.bodies, place.divisions, territory, result.meetings.length);
    coverage.governments = bindGovernmentBodies(place.governments, bodies);
    coverage.governmentInventoryUnavailableStates = place.registrationHeld ? [] : [location.state];
    coverage.fringeDivisions = fringe.flatMap(ocdId => place.divisions.filter(division => division.ocdId === ocdId).map(division => ({ ocdId, label: division.label })));
    coverage.bodies = coverage.bodies.map(body => ({ ...body,
      publicationAttempts: attemptsByFamily(place.publicationAttempts.filter(attempt => attempt.bodyId === body.bodyId)) }));
    const partial = new Set(location.partial);
    if (zipRead.value) coverage.bodies = coverage.bodies.map(body => body.ocdId && partial.has(body.ocdId) ? { ...body, couldGovern: true } : body);
    const listingIdentity = withRegistryRuntimeProjection(registry, location.states, () => meetingListingIdentity(result.meetings, canonicalBodyIdentity));
    const pageIds = published ? published.pageIds : placePageCacheIds(place);
    const cachePlaces = pageIds.length ? pageIds : [...ids, ...fringe, ...territoryBodyIds];
    const stateAnswer = await stateAnswerRead;
    return await compressedJson(request, {
      ...result, coverage, listingIdentity, ...(stateAnswer ? {stateResponse:stateAnswer} : {}),
      readerScope: readerMeetingScope({ heldMeetings: place.meetings, bodies: coverage.bodies, ownDivisionIds: divisionIds,
        now: new Date(), listingIdentity: meetingListingIdentity(place.meetings, canonicalBodyIdentity) }),
      commentAccess: place.bodies.flatMap(body => body.comment ?? []), commentAccessDataState: "PROMOTED",
      everydayRouting: place.everydayRouting,
      everydayRoutingDataState: place.everydayRouting ? "PROMOTED" : "NOT_RECORDED",
      snapshot: wireSnapshot(place.snapshotHeldAt, place.snapshot.sources),
      nearZip: location.zip, governingOcdIds: ids, partialOcdIds: zipRead.value ? [...partial] : null,
    }, { headers: { ...(stateAnswer && stateAnswer.status>=400 ? {"Cache-Control":"no-store"}
      : zipRead.value ? withReaderZipTag(stateAnswer ? readerCacheHeaders({states:location.states,places:cachePlaces}) : readerPlaceCacheHeaders(cachePlaces), zipRead.value)
      : stateAnswer ? readerCacheHeaders({states:location.states,places:cachePlaces})
      : readerPlaceCacheHeaders(cachePlaces)),
      "Netlify-Vary": "query=lat|lng|radiusKm|zip|include", "Server-Timing": timing.header() } });
  } catch (error) {
    console.error("READER_PLACE_LOAD_FAILED", error);
    const stateAnswer = await stateAnswerRead;
    return Response.json({ error: "The place's information could not be loaded", dataState: "STORE_UNREACHABLE", ...(stateAnswer ? {stateResponse:stateAnswer} : {}) },
      { status: 503, headers: { "Cache-Control": "no-store", "Server-Timing": timing.header() } });
  }
}
