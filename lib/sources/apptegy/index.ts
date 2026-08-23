/**
 * @freshness-reads-here
 *
 * RULING 107 — the clock stamps in this file are minted by the code path that
 * performs the read: the freshness date is taken at the moment of the fetch,
 * which is what the ruling asks for rather than what it forbids. Verified
 * 2026-08-23 by reading each stamp site against the retrieval it sits in.
 */
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { decodeEntities, politeGetJson } from "../http.ts";
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

/**
 * Pages to walk before stopping. 20 events per page, and this is a runaway
 * stop, not a coverage cap — the walk normally ends when a page runs past the
 * query's forward horizon.
 *
 * Raised from 5 to 12 with the history fix (M58): starting the walk 90 days
 * back means paging through a term's worth of a district calendar before
 * reaching the future, and RTSD's is dense — it took 7 pages to reach October
 * from mid-May. Five pages would have silently clipped the upcoming meetings
 * this adapter already served, which is the wrong way to fix a gap.
 */
const MAX_PAGES = 12;

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

/**
 * Is this Apptegy event announcing a cancellation? (Item 6b, 2026-08-15 —
 * the author: "zero canceled meetings at Tucson AND Vail is implausible.")
 *
 * Diagnosed before changing anything, and the answer has two halves.
 *
 * **Apptegy's event schema carries no status field at all.** Probed live
 * 2026-08-15 against Vail USD (org 8164) and Rockaway Township schools (org
 * 4707): thirty fields per event — id, title, venue, address, description,
 * start/end, recurrence, formatting — and not one of them is a status. So a
 * cancellation can only ever reach us as TEXT the district typed, exactly
 * the way CivicPlus announces one by editing its SUMMARY.
 *
 * **And in this window neither district has cancelled anything.** Zero of
 * the twenty events returned per org mention "cancel" in any field. So the
 * zero the author saw is a real zero rather than a dropped signal — but the
 * adapter was not LOOKING, which meant the first cancellation either
 * district ever published would have rendered as a meeting going ahead.
 * That is the failure worth closing, and this closes it.
 *
 * Deliberately narrow, for the reason the Legistar adapter states: a
 * meeting wrongly marked cancelled keeps someone at home.
 */
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

    for (const { wiring, events, collectedAt, sourceUrl } of raw) {
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

    return accountedNormalize(SOURCE_NAME, raw, { meetings, drops });
  };

  return {
    name: SOURCE_NAME,

    async fetch(query: MeetingQuery): Promise<ApptegyRaw[]> {
      // M58 (2026-08-15): ask for the recent past as well as the future.
      //
      // The feed defaults to upcoming-only, and this adapter took the default
      // — so Vail and Rockaway Township's school board were the only wired
      // jurisdictions that could never show a concluded meeting, and the
      // Concluded filter there was empty by construction rather than by fact.
      // "Not found" is a claim: the ladder rung that earns it here is
      // `?start_date=`, which the events API honours and carries through its
      // own `meta.links.next` (probed live 2026-08-15 — 2026-05-17 returned
      // four concluded board meetings for each org). The query's own
      // `startsAfter` is the window; the adapter does not invent one.
      const startDate = query.startsAfter?.slice(0, 10);
      const horizonMs = query.startsBefore ? Date.parse(query.startsBefore) : NaN;

      const collected: ApptegyRaw[] = [];
      for (const wiring of wiringRows) {
        const events: ApptegyEvent[] = [];
        const first = new URL(`${wiring.config.apiBase}/cms/events`);
        first.searchParams.set("locale", "en");
        first.searchParams.set("page_no", "1");
        if (startDate) first.searchParams.set("start_date", startDate);

        let url: string | null = first.toString();
        for (let page = 0; url && page < MAX_PAGES; page++) {
          const body: ApptegyResponse = await politeGetJson<ApptegyResponse>(
            url,
            { fetchImpl },
          );
          const batch = body.events ?? [];
          events.push(...batch);

          // The feed runs forward in time, so once a page ends past the
          // window there is nothing further to want. Stopping here is what
          // keeps a 90-day lookback from turning into a walk to next May.
          const last = batch[batch.length - 1]?.start_at;
          if (last && Number.isFinite(horizonMs) && Date.parse(last) > horizonMs) {
            break;
          }
          url = body.meta?.links?.next ?? null;
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
