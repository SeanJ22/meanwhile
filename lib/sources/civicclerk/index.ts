/**
 * @freshness-reads-here
 *
 * RULING 107 — the clock stamps here are minted by the code path that performs
 * the read: `collectedAt` is taken at the moment of the fetch.
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
 * **CivicClerk** — the meeting portal behind an embed script, reached at its
 * own public OData API. (2026-08-27, the 85641 detective session.)
 *
 * ## How it was found, because the route is the reusable part
 *
 * The Central Arizona Water Conservation District taxes every parcel in Pima
 * County and so governs ZIP 85641. Its own meetings page renders no meeting:
 * 222,565 bytes of served markup carrying no dated link and no iCalendar feed.
 * What it does carry, in a `<script>` block, is
 *
 * ```js
 * window.clerkEmbedProps = { "tenant": "capaz", "categoryIds": "26,27,…" };
 * ```
 *
 * followed by CivicClerk's embed bundle. **The tenant slug is in the page.**
 * With it, the portal's own API answers a plain unauthenticated GET:
 *
 *   https://<tenant>.api.civicclerk.com/v1/Events
 *
 * It is OData, so `$filter`, `$orderby` and `$top` all work, and it returns
 * the date, start time, body name, category, venue with a street address, and
 * flags for whether an agenda and minutes are published.
 *
 * That is ladder rung 7 — the page's own calls — and the generalisation is the
 * point: **any CivicClerk tenant is one `clerkEmbedProps` read away**, and the
 * vendor serves councils, districts and boards well beyond this one.
 *
 * ## Why a new AgendaSourceType rather than reusing one
 *
 * CivicClerk is a distinct product to a clerk, and its wire format is neither
 * Diligent's WCF service nor IQM2's. `CIVICPLUS` is a different product from
 * the same corporate family and must not be conflated: a reader following a
 * CivicPlus agenda link would not arrive here.
 *
 * ## What it refuses to do
 *
 * The API returns the whole archive back to 2018, oldest first. This clips to
 * the SERVING window the app actually renders, derived from the constants
 * rather than written as literals — M76's defect was two adapters holding
 * their own copies of a window that then moved.
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
 * The venue string, assembled from the published address parts.
 *
 * Nothing is invented: a row whose location object carries no usable part
 * yields an empty string and is counted as an unknown venue — kept, with the
 * portal's own silence as its named gap, rather than pinned to a guess (the
 * venue-gap class, 2026-09-23).
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
 * The BODY this sitting belongs to.
 *
 * CivicClerk files every sitting under a category that IS the body — "Board
 * Meeting", "Finance, Audit and Power Committee", "Public Policy Committee" —
 * so the category is the body name and the event name is the sitting's title.
 * Where the tenant sends no category the event name stands in, and where it
 * sends neither the row is dropped rather than filed under the district at
 * large: a committee sitting rendered as a board meeting is a false claim
 * about which body met.
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
        /*
         * No reviewed venue never suppresses the sitting (the venue-gap class,
         * 2026-09-23): it is published with no pin and its gap named — the
         * published address parts verbatim, or the portal's silence where the
         * row carries none — and counted as `unknownVenue`, kept. Both cases
         * used to `continue`.
         */
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
        /*
         * OData, clipped at the SERVER. The archive reaches back to 2018 and
         * the default page is oldest-first, so an unfiltered read would spend
         * its whole page on meetings from seven years ago and return nothing
         * a reader can attend.
         */
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
