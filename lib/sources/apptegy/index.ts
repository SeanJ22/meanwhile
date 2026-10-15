// @freshness-reads-here
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { isPlacelessLocation, unplacedVenueGap } from "../../meetings/venue-cache.ts";
import { decodeEntities, politeGetJson } from "../http.ts";

export function apptegyCalendarUrl(wiring: BodySourceWiring, startsAfter?: string): string {
  const first = new URL(`${wiring.config.apiBase}/cms/events`);
  first.searchParams.set("locale", "en"); first.searchParams.set("page_no", "1");
  if (startsAfter) first.searchParams.set("start_date", startsAfter.slice(0, 10));
  return first.href;
}
import type {
  Meeting,
  MeetingQuery,
  MeetingStatus,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";
import {
  accountedNormalize,
  type Accounted,
} from "../normalize-account.ts";


const SOURCE_NAME = "apptegy";

const MAX_PAGES = 12;

export class ApptegyPaginationError extends Error {
  readonly pagesFetched: number;
  readonly eventsFetched: number;
  readonly nextUrl: string;

  constructor(org: string, pagesFetched: number, eventsFetched: number, nextUrl: string) {
    super(
      `apptegy: ${org} reached the ${pagesFetched}-page safety cap with the API still ` +
        `advertising a next page. ${eventsFetched} event(s) were read and an unknown ` +
        `number were left unretrieved at ${nextUrl}. A safety cap is a failure ` +
        "boundary, never an implicit end of data (A-006).",
    );
    this.name = "ApptegyPaginationError";
    this.pagesFetched = pagesFetched;
    this.eventsFetched = eventsFetched;
    this.nextUrl = nextUrl;
  }
}

export interface ApptegyEvent {
  id: number;
  title: string | null;
  start_at: string | null;
  venue: string | null;
  latitude: string | null;
  longitude: string | null;
  description: string | null;
}

interface ApptegyResponse {
  events: ApptegyEvent[];
  meta?: { links?: { next?: string | null } };
}

export interface ApptegyRaw {
  wiring: BodySourceWiring;
  events: ApptegyEvent[];
  collectedAt: string;
  /** The exact first-page URL these events were read from — the citation
   *  the record carries. Optional so recorded fixtures keep working. */
  sourceUrl?: string;
}

function statusOf(startsAt: string, now: Date): MeetingStatus {
  return Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

export function isCancelled(event: {
  title?: string | null;
  description?: string | null;
}): boolean {
  return /\bcancell?ed\b/i.test(`${event.title ?? ""} ${event.description ?? ""}`);
}

/** First href in the event description, decoded — observed, never built. */
export function agendaLinkFrom(description: string | null): string | null {
  if (!description) return null;
  const m = /href=\\?"(https?:[^"\\]+)/.exec(description);
  return m ? decodeEntities(m[1]) : null;
}

export function makeApptegySource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<ApptegyRaw> {
  const normalizeWithDrops = (
    raw: ApptegyRaw[],
    now: Date = new Date(),
  ): Accounted<{ meetings: Meeting[]; drops: NormalizeDropCounts }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };
    const seen = new Set<string>();
    // The count of logical records considered. One raw row is one API page, so the unit is the event.
    let considered = 0;
    let duplicates = 0;
    // `placeless` and `unknownVenue` tally sittings that are still produced, so neither is a drop.
    let keptButPlaceless = 0;

    for (const { wiring, events, collectedAt, sourceUrl } of raw) {
      const titleMatch = wiring.config.titleMatch ?? "";

      for (const event of events) {
        considered += 1;
        const title = (event.title ?? "").trim();
        if (!titleMatch || !title.includes(titleMatch)) {
          drops.notConfigured++;
          continue;
        }

        const id = `${SOURCE_NAME}:${wiring.config.slug}:${event.id}`;
        // The API repeats events across pages at the boundary; one event is
        // one meeting regardless of how many pages carried it.
        if (seen.has(id)) {
          // Counted, so every record is either produced or dropped with a reason.
          duplicates += 1;
          continue;
        }

        if (!event.start_at || Number.isNaN(Date.parse(event.start_at))) {
          drops.unplaceableInTime++;
          continue;
        }

        // A blank coordinate is no coordinate: `Number("")` and `Number(null)`
        // are both 0, and a pin at 0°, 0° is a fabricated place.
        const coordinate = (value: string | null) =>
          value == null || String(value).trim() === "" ? Number.NaN : Number(value);
        const lat = coordinate(event.latitude);
        const lng = coordinate(event.longitude);
        const venueName = (event.venue ?? "").trim();
        const placed = Boolean(venueName) && Number.isFinite(lat) && Number.isFinite(lng);
        const online = !placed && venueName && isPlacelessLocation(venueName)
          ? { label: venueName, joinUrl: null }
          : null;
        const venueGap = !placed && !online ? unplacedVenueGap(venueName, wiring.publishingOrg) : null;
        if (online) {
          drops.placeless++;
          keptButPlaceless += 1;
        }
        if (venueGap) {
          drops.unknownVenue++;
          keptButPlaceless += 1;
        }

        seen.add(id);
        meetings.push({
          id,
          ocdId: wiring.ocdId,
          /* NH-RC4: the body, from the wiring row that produced this meeting. */
          bodyId: wiring.bodyId,
          bodyName: title,
          title,
          startsAt: new Date(event.start_at).toISOString(),
          timeZone: wiring.timeZone,
          location: placed
            ? {
                name: venueName,
                // The venue string is the district's own published address text.
                address: venueName,
                lat,
                lng,
              }
            : null,
          ...(online ? { online } : {}),
          ...(venueGap ? { venueGap } : {}),
          agendaUrl: agendaLinkFrom(event.description),
          jurisdiction: wiring.jurisdiction,
          status: isCancelled(event)
            ? "CANCELED"
            : statusOf(event.start_at, now),
          provenance: {
            sourceUrl:
              sourceUrl ??
              `${wiring.config.apiBase}/cms/events?locale=en&page_no=1`,
            sourceOrg: wiring.publishingOrg,
            collectedAt,
            verifiedAt: null,
          },
        });
      }
    }

    return accountedNormalize(SOURCE_NAME, raw, { meetings, drops }, {
      logicalInput: considered,
      duplicates,
      countedButProduced: keptButPlaceless,
    });
  };

  return {
    name: SOURCE_NAME,

    async fetch(query: MeetingQuery): Promise<ApptegyRaw[]> {
      // Ask for the recent past as well as the future: the feed defaults to upcoming-only, and `?start_date=`
      // is honoured through its own `meta.links.next`. The query's `startsAfter` is the window.
      const horizonMs = query.startsBefore ? Date.parse(query.startsBefore) : NaN;

      const collected: ApptegyRaw[] = [];
      for (const wiring of wiringRows) {
        const events: ApptegyEvent[] = [];
        const first = apptegyCalendarUrl(wiring, query.startsAfter);
        let url: string | null = first;
        // A-006 · told apart from running out of pages, because only one of
        // the two is an end of data.
        let stoppedAtHorizon = false;
        let pagesFetched = 0;
        for (let page = 0; url && page < MAX_PAGES; page++) {
          pagesFetched += 1;
          const body: ApptegyResponse = await politeGetJson<ApptegyResponse>(
            url,
            { fetchImpl, signal: query.signal },
          );
          const batch = body.events ?? [];
          events.push(...batch);

          const last = batch[batch.length - 1]?.start_at;
          if (last && Number.isFinite(horizonMs) && Date.parse(last) > horizonMs) {
            stoppedAtHorizon = true;
            break;
          }
          url = body.meta?.links?.next ?? null;
        }
        // The loop ends at the server's last page, at the query's horizon, or at the safety cap; only the first
        // two are an end of data.
        if (!stoppedAtHorizon && url && pagesFetched >= MAX_PAGES) {
          throw new ApptegyPaginationError(
            wiring.config.slug,
            pagesFetched,
            events.length,
            url,
          );
        }
        collected.push({
          wiring,
          events,
          collectedAt: new Date().toISOString(),
          sourceUrl: first.toString(),
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
