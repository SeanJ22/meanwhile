import { readerRoute } from "@/lib/api/reader-route";
import { matching, numeric, numericInRange, refuse, rejectUnknown } from "@/lib/api/params";
import { stageTimer } from "@/lib/api/server-timing";
import { DEFAULT_RADIUS_KM, MAX_RADIUS_KM } from "@/lib/meetings/constants";
import { readerLocation, readerTerritory, territoryBodies, stateZipLocation } from "@/lib/reader/location";
import { readStatePackage } from "@/lib/reader/state";
import { readPlacePackage } from "@/lib/reader/place";
import { stateCoverage } from "@/lib/reader/coverage";
import { meetingBodyIds, searchMeetings } from "@/lib/meetings/query";
import { snapshotSourceFor } from "@/lib/meetings/snapshot-source";
import { readReaderMeetingSettings } from "@/lib/meetings/reader-settings";
import { readerMeetingScope } from "@/lib/meetings/reader-scope";
import { meetingListingIdentity } from "@/lib/meetings/listing-identity";
import { canonicalBodyIdentity } from "@/lib/ask/body-identity";
import { withRegistryRuntimeProjection } from "@/lib/registry/runtime-read-model";
import { bindGovernmentBodies } from "@/lib/registration/listings";
import { readPublicBodyAttempts } from "@/lib/registry/body-attempt-read";
import { attemptsByFamily } from "@/lib/registry/attempt-families";
import { lookupZcta } from "@/lib/geo/zcta";

export const runtime = "nodejs";

export const GET = readerRoute("/api/meetings", async function GET(request: Request) {
  const timing = stageTimer(), params = new URL(request.url).searchParams;
  const unknown = rejectUnknown(params, ["lat", "lng", "radiusKm", "zip"]);
  if (!unknown.ok) return refuse(unknown.error);
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
  try {
    const location = await readerLocation(lat, lng, zipRead.value);
    const stateRead = timing.time("state", () => readStatePackage(location.state));
    const attemptsRead = readPublicBodyAttempts();
    const territoryRead = readerTerritory(location.state);
    const placeRead = timing.time("place", async () => readPlacePackage({ state: location.state, divisionIds: location.divisionIds,
      bodyIds: territoryBodies(lat, lng, await territoryRead) }));
    const [state, place, territory, settings, attempts] = await Promise.all([
      stateRead, placeRead, territoryRead, readReaderMeetingSettings(), attemptsRead,
    ]);
    const everyday = state.everyday;
    const qualified = zipRead.value ? await stateZipLocation(state, zipRead.value) : null;
    const point = zipRead.value ? null : await (await import("@/lib/registry/server")).divisionsAt(lat, lng);
    const ids = point?.map(division => division.ocdId) ?? qualified?.entry.ids ?? location.divisionIds;
    const divisionIds = new Set(ids);
    const bodies = state.registry.registry.bodies;
    const selectedBodyIds = new Set([...meetingBodyIds(bodies, divisionIds), ...territoryBodies(lat, lng, territory)]);
    const result = await searchMeetings(lat, lng, radiusKm, new Date(), divisionIds, snapshotSourceFor(place.snapshot), settings,
      selectedBodyIds, new Set(bodies.map(body => body.id)));
    const coverage = stateCoverage(state, ids, lat, lng, place.meetings, place.bodies, [...place.divisions, ...qualified?.divisions ?? []], territory, result.meetings.length);
    coverage.governments = bindGovernmentBodies(place.governments, state.registry.registry.bodies);
    coverage.governmentInventoryUnavailableStates = place.registrationHeld ? [] : [state.state];
    if (attempts.kind === "HELD") coverage.bodies = coverage.bodies.map(body => ({ ...body,
      publicationAttempts: attemptsByFamily(attempts.rows.filter(attempt => attempt.bodyId === body.bodyId)) }));
    const partial = new Set(qualified?.entry.partial ?? location.partial);
    if (zipRead.value) coverage.bodies = coverage.bodies.map(body => body.ocdId && partial.has(body.ocdId) ? { ...body, couldGovern: true } : body);
    const listingIdentity = withRegistryRuntimeProjection(state.registry, [state.state], () => meetingListingIdentity(result.meetings, canonicalBodyIdentity));
    return Response.json({
      ...result, coverage, listingIdentity,
      readerScope: readerMeetingScope({ heldMeetings: place.meetings, bodies: coverage.bodies, ownDivisionIds: divisionIds,
        now: new Date(), listingIdentity: meetingListingIdentity(place.meetings, canonicalBodyIdentity) }),
      commentAccess: place.bodies.flatMap(body => body.comment ?? []), commentAccessDataState: "PROMOTED",
      everydayRouting: everyday?.kind === "PROMOTED" || everyday?.kind === "BOOTSTRAP" ? everyday.value : null,
      everydayRoutingDataState: everyday?.kind ?? "STORE_UNREACHABLE",
      snapshot: { version: 2, generatedAt: place.snapshot.generatedAt, failed: place.snapshot.sources.filter(source => !source.ok)
        .map(source => ({ source: source.source, ocdIds: source.unreachableOcdIds ?? [] })) },
      nearZip: location.zip, governingOcdIds: ids, partialOcdIds: zipRead.value ? [...partial] : null,
    }, { headers: { "Cache-Control": "public, max-age=0, must-revalidate",
      "Netlify-CDN-Cache-Control": "public, s-maxage=30", "Netlify-Vary": "query", "Server-Timing": timing.header() } });
  } catch (error) {
    console.error("READER_PLACE_LOAD_FAILED", error);
    return Response.json({ error: "The place's information could not be loaded", dataState: "STORE_UNREACHABLE" },
      { status: 503, headers: { "Cache-Control": "no-store", "Server-Timing": timing.header() } });
  }
});
