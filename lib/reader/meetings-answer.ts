import { meetingBodyIds, searchMeetingsFromSource as searchMeetings } from "../meetings/query.ts";
import { snapshotSourceFor } from "../meetings/snapshot-source.ts";
import { wireSnapshot } from "../meetings/freshness.ts";
import { readerMeetingScope } from "../meetings/reader-scope.ts";
import { meetingListingIdentity } from "../meetings/listing-identity.ts";
import type { MeetingSettings } from "../meetings/settings.ts";
import { canonicalBodyIdentity } from "../ask/body-identity.ts";
import { withRegistryRuntimeProjection } from "../registry/runtime-read-model.ts";
import { bindGovernmentBodies } from "../registration/listings.ts";
import { attemptsByFamily } from "../registry/attempt-families.ts";
import type { BodyTerritoryFile } from "../registry/body-territory.ts";
import { stateCoverage, withPlaceRegistry } from "./coverage.ts";
import { territoryBodies, type ReaderLocation } from "./location.ts";
import { placePageCacheIds, type PlacePackage } from "./place.ts";
import type { ReaderStatePackage } from "./state.ts";
import type { Meeting } from "../sources/types.ts";

export interface MeetingsAnswerInput {
  readonly location: ReaderLocation;
  readonly lat: number;
  readonly lng: number;
  readonly radiusKm: number;
  readonly now: Date;
  readonly place: PlacePackage;
  /** The state's package when the answer is for a map view; a ZIP's answer takes its state from its own response. */
  readonly state: ReaderStatePackage | null;
  readonly settings: MeetingSettings;
  readonly territory: BodyTerritoryFile | null;
  /** The state's answer for the ZIP, carried inside it. */
  readonly stateResponse?: unknown;
}

/** Everything the meetings answer says of a place, made from its saved pages. The database route and the published ZIP answer both end here. */
export async function composeMeetingsAnswer(input: MeetingsAnswerInput): Promise<{ readonly answer: Record<string, unknown>; readonly cachePlaces: readonly string[] }> {
  const { location, lat, lng, place, state, now } = input, zip = location.zip;
  if (!place.registry) throw new Error("The place's government records could not be loaded");
  const ids = location.divisionIds, divisionIds = new Set(ids), registry = place.registry, bodies = registry.registry.bodies;
  const fringe = zip ? location.fringe : [];
  const territoryBodyIds = territoryBodies(lat, lng, input.territory);
  const selectedBodyIds = new Set([...meetingBodyIds(bodies, divisionIds), ...territoryBodyIds]);
  const result = await searchMeetings(lat, lng, input.radiusKm, now, divisionIds, snapshotSourceFor(place.snapshot), input.settings,
    selectedBodyIds, new Set(bodies.map(body => body.id)));
  const localIds = state ? ids : ids.filter(id => !/\/(?:cd|sldu|sldl):/.test(id));
  const coverage = stateCoverage(state ? withPlaceRegistry(state, registry) : { state: location.state, registry, version: place.snapshot.generatedAt },
    localIds, lat, lng, place.meetings, place.bodies, place.divisions, input.territory, result.meetings.length);
  coverage.governments = bindGovernmentBodies(place.governments, bodies);
  coverage.governmentInventoryUnavailableStates = place.registrationHeld ? [] : [location.state];
  coverage.fringeDivisions = fringe.flatMap(ocdId => place.divisions.filter(division => division.ocdId === ocdId).map(division => ({ ocdId, label: division.label })));
  coverage.bodies = coverage.bodies.map(body => ({ ...body,
    publicationAttempts: attemptsByFamily(place.publicationAttempts.filter(attempt => attempt.bodyId === body.bodyId)) }));
  const partial = new Set(location.partial);
  if (zip) coverage.bodies = coverage.bodies.map(body => body.ocdId && partial.has(body.ocdId) ? { ...body, couldGovern: true } : body);
  const identityOf = (meetings: readonly Meeting[]) => withRegistryRuntimeProjection(registry, location.states, () => meetingListingIdentity(meetings, canonicalBodyIdentity));
  const listingIdentity = identityOf(result.meetings);
  const pageIds = placePageCacheIds(place);
  return {
    cachePlaces: pageIds.length ? pageIds : [...ids, ...fringe, ...territoryBodyIds],
    answer: {
      ...result, coverage, listingIdentity, ...(input.stateResponse ? { stateResponse: input.stateResponse } : {}),
      readerScope: readerMeetingScope({ heldMeetings: place.meetings, bodies: coverage.bodies, ownDivisionIds: divisionIds,
        now, listingIdentity: identityOf(place.meetings) }),
      commentAccess: place.bodies.flatMap(body => body.comment ?? []), commentAccessDataState: "PROMOTED",
      everydayRouting: place.everydayRouting,
      everydayRoutingDataState: place.everydayRouting ? "PROMOTED" : "NOT_RECORDED",
      snapshot: wireSnapshot(place.snapshotHeldAt, place.snapshot.sources),
      nearZip: location.zip, governingOcdIds: ids, partialOcdIds: zip ? [...partial] : null,
    },
  };
}
