import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { decodeEntities, politeGetJson } from "../http.ts";
import type {
  Meeting,
  MeetingStatus,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";

/**
 * Apptegy / Thrillshare meeting source.
 *
 * The district website's own events API — the JSON the page itself renders
 * from (`/api/v4/o/<org>/cms/events`), found by reading the embedded page
 * state on Vail's Governing Board page and RTSD's site. First-party in the
 * strong sense: the venue string **and the coordinates** are published by the
 * district itself, so nothing here needs the venue cache — the feed is its
 * own citation.
 *
 * A district calendar is mostly not board meetings (open houses, half days,
 * conferences); only events whose title matches the wiring row's
 * `titleMatch` — the feed's own published title — are meetings, and the rest
 * count as `notConfigured`.
 */

const SOURCE_NAME = "apptegy";

/** Pages to walk before stopping. 20 events per page; a district's forward
 * calendar fits comfortably, and this is a runaway stop, not a coverage cap. */
const MAX_PAGES = 5;

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
}

function statusOf(startsAt: string, now: Date): MeetingStatus {
  return Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
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
  ): { meetings: Meeting[]; drops: NormalizeDropCounts } => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };
    const seen = new Set<string>();

    for (const { wiring, events, collectedAt } of raw) {
      const titleMatch = wiring.config.titleMatch ?? "";

      for (const event of events) {
        const title = (event.title ?? "").trim();
        if (!titleMatch || !title.includes(titleMatch)) {
          drops.notConfigured++;
          continue;
        }

        const id = `${SOURCE_NAME}:${wiring.config.slug}:${event.id}`;
        // The API repeats events across pages at the boundary; one event is
        // one meeting regardless of how many pages carried it.
        if (seen.has(id)) continue;

        if (!event.start_at || Number.isNaN(Date.parse(event.start_at))) {
          drops.unplaceableInTime++;
          continue;
        }

        const lat = Number(event.latitude);
        const lng = Number(event.longitude);
        const venueName = (event.venue ?? "").trim();
        if (!venueName || !Number.isFinite(lat) || !Number.isFinite(lng)) {
          drops.unknownVenue++;
          continue;
        }

        seen.add(id);
        meetings.push({
          id,
          ocdId: wiring.ocdId,
          bodyName: title,
          title,
          startsAt: new Date(event.start_at).toISOString(),
          timeZone: wiring.timeZone,
          location: {
            name: venueName,
            // The venue string is the district's own published address text.
            address: venueName,
            lat,
            lng,
          },
          agendaUrl: agendaLinkFrom(event.description),
          jurisdiction: wiring.jurisdiction,
          status: statusOf(event.start_at, now),
          provenance: {
            sourceUrl: `${wiring.config.apiBase}/cms/events?locale=en&page_no=1`,
            sourceOrg: wiring.publishingOrg,
            collectedAt,
            verifiedAt: null,
          },
        });
      }
    }

    return { meetings, drops };
  };

  return {
    name: SOURCE_NAME,

    async fetch(): Promise<ApptegyRaw[]> {
      const collected: ApptegyRaw[] = [];
      for (const wiring of wiringRows) {
        const events: ApptegyEvent[] = [];
        let url: string | null =
          `${wiring.config.apiBase}/cms/events?locale=en&page_no=1`;
        for (let page = 0; url && page < MAX_PAGES; page++) {
          const body: ApptegyResponse = await politeGetJson<ApptegyResponse>(
            url,
            { fetchImpl },
          );
          events.push(...(body.events ?? []));
          url = body.meta?.links?.next ?? null;
        }
        collected.push({
          wiring,
          events,
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
