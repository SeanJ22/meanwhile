/**
 * @freshness-reads-here
 *
 * The clock stamps here are minted by the code path that performs the read: `collectedAt` is taken at
 * the moment of the fetch.
 */
import {
  MEETING_HELD_HORIZON_DAYS,
  MEETING_HELD_LOOKBACK_DAYS,
} from "../../meetings/constants.ts";
import {
  isPlacelessLocation,
  resolveVenue,
  unplacedVenueGap,
} from "../../meetings/venue-cache.ts";
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { politeGetJson } from "../http.ts";
import {
  accountedNormalize,
  type Accounted,
} from "../normalize-account.ts";
import type {
  Meeting,
  MeetingQuery,
  MeetingStatus,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";

/**
 * CivicClerk: the meeting portal behind an embed script, read through its own public OData API. The
 * host page carries the tenant slug in a script block:
 *
 * ```js
 * window.clerkEmbedProps = { "tenant": "<slug>", "categoryIds": "26,27,…" };
 * ```
 *
 * With it the portal answers a plain unauthenticated GET at `https://<tenant>.api.civicclerk.com/v1/Events`
 * (OData: `$filter`, `$orderby`, `$top`), returning date, start time, body name, category, venue with
 * street address, and agenda/minutes flags. Any CivicClerk tenant is one `clerkEmbedProps` read away.
 *
 * Distinct from `CIVICPLUS`, a different product. Reads are clipped to the serving window derived from
 * the serving constants.
 */

const SOURCE_NAME = "civicclerk";

const WINDOW_FORWARD_DAYS = MEETING_HELD_HORIZON_DAYS;
const WINDOW_BACK_DAYS = MEETING_HELD_LOOKBACK_DAYS;

/** The subset of the OData row this adapter reads. The API sends ~90 fields. */
export interface CivicClerkEvent {
  id: number;
  eventName: string | null;
  eventDate: string | null;
  startDateTime: string | null;
  eventCategoryName?: string | null;
  categoryName?: string | null;
  hasAgenda?: boolean;
  isDeleted?: boolean;
  isPublished?: boolean;
  eventLocation?: {
    locationName?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
  } | null;
}

export interface CivicClerkRaw {
  wiring: BodySourceWiring;
  events: CivicClerkEvent[];
  collectedAt: string;
}

function statusOf(startsAt: string, now: Date): MeetingStatus {
  return Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

/**
 * The venue string, assembled from the published address parts. A row with no usable part yields an
 * empty string and is counted as an unknown venue: kept, with the portal's silence as its named gap.
 */
function locationTextOf(e: CivicClerkEvent): string {
  const L = e.eventLocation;
  if (!L) return "";
  return [L.locationName, L.address1, L.address2, L.city, L.state, L.zipCode]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ")
    .trim();
}

/**
 * The body this sitting belongs to. CivicClerk files every sitting under a category that is the body,
 * so the category is the body name and the event name is the sitting's title. Where the tenant sends no
 * category the event name stands in; where it sends neither the row is dropped rather than filed under
 * the district at large.
 */
function bodyNameFor(e: CivicClerkEvent): string {
  return (
    e.eventCategoryName?.trim() ||
    e.categoryName?.trim() ||
    e.eventName?.trim() ||
    ""
  );
}

export function makeCivicClerkSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<CivicClerkRaw> {
  const normalizeWithDrops = (
    raw: CivicClerkRaw[],
    now: Date = new Date(),
  ): Accounted<{ meetings: Meeting[]; drops: NormalizeDropCounts }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };

    let considered = 0;
    let keptButPlaceless = 0;

    for (const { wiring, events, collectedAt } of raw) {
      considered += events.length;
      for (const e of events) {
        if (e.isDeleted) {
          drops.notConfigured++;
          continue;
        }

        /*
         * `startDateTime` carries the wall clock the portal displays. It is
         * read as local wall time in the body's zone rather than trusted as
         * an instant, because the API also ships secondaryIanaTimeZone and a
         * row that is off by an hour puts a reader outside a meeting.
         */
        const clock = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(
          e.startDateTime ?? e.eventDate ?? "",
        );
        if (!clock) {
          drops.unplaceableInTime++;
          continue;
        }
        const startsAt = toZonedIso(
          Number(clock[1]),
          Number(clock[2]),
          Number(clock[3]),
          Number(clock[4]),
          Number(clock[5]),
          wiring.timeZone,
        );

        const bodyName = bodyNameFor(e);
        if (wiring.config.bodyMatch && bodyName?.trim().toLowerCase() !== wiring.config.bodyMatch.trim().toLowerCase()) {
          drops.notConfigured++;
          continue;
        }
        if (!bodyName) {
          drops.notConfigured++;
          continue;
        }

        const location = locationTextOf(e);

        /* A meeting held online is KEPT (D18) — it is a real public meeting. */
        const online = location && isPlacelessLocation(location)
          ? { label: location, joinUrl: null }
          : null;
        if (online) {
          drops.placeless++;
          keptButPlaceless += 1;
        }
        const venue = online || !location
          ? null
          : resolveVenue(SOURCE_NAME, wiring.ocdId, location, wiring.config.slug) ?? null;
        // No reviewed venue never suppresses the sitting: it is published with no pin and its gap named (the
        // published address parts verbatim, or the portal's silence), counted as `unknownVenue`.
        const venueGap = !online && !venue ? unplacedVenueGap(location, wiring.publishingOrg) : null;
        if (venueGap) {
          drops.unknownVenue++;
          keptButPlaceless += 1;
        }

        /* The portal's own permalink for one event. */
        const meetingUrl = `${wiring.config.portalBase}/event/${e.id}`;

        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.slug}:${e.id}`,
          ocdId: wiring.ocdId,
          /* NH-RC4: the body, from the wiring row that produced this meeting. */
          bodyId: wiring.bodyId,
          bodyName,
          title: (e.eventName ?? bodyName).trim(),
          startsAt,
          timeZone: wiring.timeZone,
          location: venue
            ? {
                name: venue.name,
                address: venue.address,
                lat: venue.lat,
                lng: venue.lng,
              }
            : null,
          ...(online ? { online } : {}),
          ...(venueGap ? { venueGap } : {}),
          /* `hasAgenda` is the portal's own flag for a published agenda. */
          agendaUrl: e.hasAgenda ? meetingUrl : null,
          jurisdiction: wiring.jurisdiction,
          status: statusOf(startsAt, now),
          provenance: {
            sourceUrl: meetingUrl,
            sourceOrg: wiring.publishingOrg,
            collectedAt,
            verifiedAt: null,
          },
        });
      }
    }

    return accountedNormalize(
      SOURCE_NAME,
      raw,
      { meetings, drops },
      { logicalInput: considered, countedButProduced: keptButPlaceless },
    );
  };

  return {
    name: SOURCE_NAME,

    async fetch(meetingQuery?: MeetingQuery): Promise<CivicClerkRaw[]> {
      const now = Date.now();
      const from = new Date(now - WINDOW_BACK_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 19);
      const to = new Date(now + WINDOW_FORWARD_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 19);

      const collected: CivicClerkRaw[] = [];
      for (const wiring of wiringRows) {
        // OData, clipped at the server: the archive is oldest-first, so an unfiltered read would spend its page
        // on years-old meetings.
        const query = new URLSearchParams({
          $filter: `eventDate ge ${from}Z and eventDate le ${to}Z`,
          $orderby: "eventDate asc",
          $top: "200",
        });
        const url = `${wiring.config.apiBase}/v1/Events?${query}`;
        const body = await politeGetJson<{ value?: CivicClerkEvent[] }>(url, {
          fetchImpl,
          signal: meetingQuery?.signal,
        });
        collected.push({
          wiring,
          events: Array.isArray(body?.value) ? body.value : [],
          collectedAt: new Date().toISOString(),
        });
      }
      return collected;
    },

    normalize(raw, now: Date = new Date()): Meeting[] {
      return normalizeWithDrops(raw, now).meetings;
    },

    normalizeWithDrops,

    async upsert(meetings: Meeting[]) {
      return { inserted: 0, updated: meetings.length };
    },
  };
}
