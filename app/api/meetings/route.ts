import { readerRoute } from "@/lib/api/reader-route";
import { matching, numeric, numericInRange, refuse, rejectUnknown } from "@/lib/api/params";
import { stageTimer } from "@/lib/api/server-timing";
import { DEFAULT_RADIUS_KM, MAX_RADIUS_KM } from "@/lib/meetings/constants";
import { readerLocation, readerTerritory, territoryBodies } from "@/lib/reader/location";
import { readStatePackage } from "@/lib/reader/state";
import { readPlacePackageHttp as readPlacePackage } from "@/lib/reader/place";
import { stateCoverage } from "@/lib/reader/coverage";
import { meetingBodyIds, searchMeetingsFromSource as searchMeetings } from "@/lib/meetings/query";
import { snapshotSourceFor } from "@/lib/meetings/snapshot-source";
import { wireSnapshot } from "@/lib/meetings/freshness";
import { readReaderMeetingSettings } from "@/lib/meetings/reader-settings";
import { readerMeetingScope } from "@/lib/meetings/reader-scope";
import { meetingListingIdentity } from "@/lib/meetings/listing-identity";
import { canonicalBodyIdentity } from "@/lib/ask/body-identity";
import { withRegistryRuntimeProjection } from "@/lib/registry/runtime-read-model";
import { bindGovernmentBodies } from "@/lib/registration/listings";
import { readerCacheHeaders } from "@/lib/reader/cache";
import { attemptsByFamily } from "@/lib/registry/attempt-families";
import {readerStateResponse} from "@/lib/reader/state-response";
import { lookupZcta } from "@/lib/geo/zcta";
import { publicOfficePoints } from "@/lib/reader/office-points";
import type { ReaderStateResponse } from "@/lib/reader/client";
import { encodeReaderValue } from "@/lib/reader/wire";

export const runtime = "nodejs";

export const GET = readerRoute("/api/meetings", async function GET(request: Request) {
  const timing = stageTimer(), params = new URL(request.url).searchParams;
  const unknown = rejectUnknown(params, ["lat", "lng", "radiusKm", "zip", "include"]);
  if (!unknown.ok) return refuse(unknown.error);
  if (params.has("include") && params.get("include")!=="state") return refuse("include must be state");
  const zipRead = matching(params, "zip", /^\d{5}$/, { default: null });
  if (!zipRead.ok) return refuse(zipRead.error);
  if (zipRead.value && !params.has("lat") && !params.has("lng")) {
    const location = lookupZcta(zipRead.value);
    if (!location) return refuse("That ZIP could not be located");
    params.set("lat", String(location.lat)); params.set("lng", String(location.lng));
  }
  const latRead = numericInRange(params, "lat", -90, 90, "refuse");
  if (!latRead.ok) return refuse(latRead.error);
  const lngRead = numericInRange(params, "lng", -180, 180, "refuse");
  if (!lngRead.ok) return refuse(lngRead.error);
  const radiusRead = numeric(params, "radiusKm", { default: DEFAULT_RADIUS_KM });
  if (!radiusRead.ok) return refuse(radiusRead.error);
  if (radiusRead.value <= 0) return refuse(`radiusKm must be greater than 0, received ${radiusRead.value}`);
  const lat = latRead.value, lng = lngRead.value, radiusKm = Math.min(radiusRead.value, MAX_RADIUS_KM);
  const stateAnswerRead = params.get("include")==="state" && zipRead.value ? readerStateResponse(request).then(async response=>{
    const value=await response.json() as ReaderStateResponse;
    const officePoints=response.ok ? await timing.time("offices",()=>publicOfficePoints(value)) : {};
    return {status:response.status,headers:[...response.headers],value:Object.keys(officePoints).length ? {...value,officePoints} : value};
  }).catch(()=>
    ({status:503,headers:[["cache-control","no-store"]],value:{error:"The state's information could not be loaded"}})) : Promise.resolve(null);
  try {
    const location = await readerLocation(lat, lng, zipRead.value);
    // A map movement has one state read and one place read in this handler.
    // ZIP entry already starts its independent state endpoint before this read.
    const stateRead = zipRead.value ? Promise.resolve(null) : timing.time("state", () => readStatePackage(location.state));
    const territoryRead = readerTerritory(location.state);
    const fringe = zipRead.value ? location.fringe : [];
    const placeRead = timing.time("place", async () => readPlacePackage({ state: location.state, divisionIds: location.divisionIds,
      bodyIds: territoryBodies(lat, lng, await territoryRead), namedDivisionIds: fringe }));
    const [state, place, territory, settings] = await Promise.all([
      stateRead, placeRead, territoryRead, readReaderMeetingSettings(),
    ]);
    if (!place.registry) throw new Error("The place's government records could not be loaded");
    const point = zipRead.value ? null : await (await import("@/lib/registry/server")).divisionsAt(lat, lng);
    const ids = point?.map(division => division.ocdId) ?? location.divisionIds;
    const divisionIds = new Set(ids);
    const registry = state?.registry ?? place.registry;
    const bodies = registry.registry.bodies;
    const selectedBodyIds = new Set([...meetingBodyIds(bodies, divisionIds), ...territoryBodies(lat, lng, territory)]);
    const result = await searchMeetings(lat, lng, radiusKm, new Date(), divisionIds, snapshotSourceFor(place.snapshot), settings,
      selectedBodyIds, new Set(bodies.map(body => body.id)));
    const localIds = state ? ids : ids.filter(id => !/\/(?:cd|sldu|sldl):/.test(id));
    const coverage = stateCoverage(state ?? { state: location.state, registry, version: place.snapshot.generatedAt },
      localIds, lat, lng, place.meetings, place.bodies, place.divisions, territory, result.meetings.length);
    coverage.governments = bindGovernmentBodies(place.governments, bodies);
    coverage.governmentInventoryUnavailableStates = place.registrationHeld ? [] : [location.state];
    coverage.fringeDivisions = fringe.flatMap(ocdId => place.divisions.filter(division => division.ocdId === ocdId).map(division => ({ ocdId, label: division.label })));
    coverage.bodies = coverage.bodies.map(body => ({ ...body,
      publicationAttempts: attemptsByFamily(place.publicationAttempts.filter(attempt => attempt.bodyId === body.bodyId)) }));
    const partial = new Set(location.partial);
    if (zipRead.value) coverage.bodies = coverage.bodies.map(body => body.ocdId && partial.has(body.ocdId) ? { ...body, couldGovern: true } : body);
    const listingIdentity = withRegistryRuntimeProjection(registry, [location.state], () => meetingListingIdentity(result.meetings, canonicalBodyIdentity));
    const stateAnswer = await stateAnswerRead;
    return Response.json(encodeReaderValue({
      ...result, coverage, listingIdentity, ...(stateAnswer ? {stateResponse:stateAnswer} : {}),
      readerScope: readerMeetingScope({ heldMeetings: place.meetings, bodies: coverage.bodies, ownDivisionIds: divisionIds,
        now: new Date(), listingIdentity: meetingListingIdentity(place.meetings, canonicalBodyIdentity) }),
      commentAccess: place.bodies.flatMap(body => body.comment ?? []), commentAccessDataState: "PROMOTED",
      everydayRouting: place.everydayRouting,
      everydayRoutingDataState: place.everydayRouting ? "PROMOTED" : "NOT_RECORDED",
      snapshot: wireSnapshot(place.snapshotHeldAt, place.snapshot.sources),
      nearZip: location.zip, governingOcdIds: ids, partialOcdIds: zipRead.value ? [...partial] : null,
    }), { headers: { ...(stateAnswer && stateAnswer.status>=400 ? {"Cache-Control":"no-store"} : readerCacheHeaders({ states: [location.state], places: ids })),
      "Netlify-Vary": "query=lat|lng|radiusKm|zip|include", "Server-Timing": timing.header() } });
  } catch (error) {
    console.error("READER_PLACE_LOAD_FAILED", error);
    const stateAnswer = await stateAnswerRead;
    return Response.json({ error: "The place's information could not be loaded", dataState: "STORE_UNREACHABLE", ...(stateAnswer ? {stateResponse:stateAnswer} : {}) },
      { status: 503, headers: { "Cache-Control": "no-store", "Server-Timing": timing.header() } });
  }
});
