import type { Meeting } from "../sources/types.ts";
import { bodyDisplayName } from "../text/reader-names.ts";
import type { CoveredBody } from "../registry/coverage.ts";
import type { MeetingListingIdentityReadback } from "./listing-identity.ts";
import { readerMeetingCount } from "./reader-listing-count.ts";

export interface PlaceGovernmentMeetings {
  readonly bodyId: string;
  readonly name: string;
  readonly upcoming: number;
  readonly agendasLinked: number;
}
export interface ReaderMeetingScope {
  readonly widened: boolean;
  readonly nearbyMeetingIds: readonly string[];
  readonly governments: readonly PlaceGovernmentMeetings[] | null;
}

/** Counts the held calendar, apart from the radius search and agenda availability. */
export function readerMeetingScope(input: {
  heldMeetings: readonly Meeting[];
  shownMeetings: readonly Meeting[];
  bodies: readonly CoveredBody[];
  ownDivisionIds: ReadonlySet<string> | null;
  radiusKm: number;
  requestedRadiusKm: number;
  now: Date;
  listingIdentity?: MeetingListingIdentityReadback;
}): ReaderMeetingScope {
  const widened = input.radiusKm > input.requestedRadiusKm;
  const own = input.ownDivisionIds;
  return {
    widened,
    nearbyMeetingIds: widened ? input.shownMeetings.filter(meeting => !own || !meeting.ocdId || !own.has(meeting.ocdId)).map(meeting => meeting.id) : [],
    governments: own ? input.bodies.filter(body => body.ocdId !== null && own.has(body.ocdId)).map(body => {
      const upcoming = input.heldMeetings.filter(meeting => meeting.bodyId === body.bodyId && meeting.status === "SCHEDULED" && Date.parse(meeting.startsAt) >= input.now.getTime());
      return { bodyId: body.bodyId, name: bodyDisplayName(body),
        upcoming: readerMeetingCount(upcoming, input.listingIdentity).count,
        agendasLinked: readerMeetingCount(upcoming.filter(meeting => meeting.agendaUrl !== null), input.listingIdentity).count };
    }) : null,
  };
}
