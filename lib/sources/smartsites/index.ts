/**
 * @freshness-reads-here
 *
 * RULING 107 — `collectedAt` is taken at the moment of the fetch.
 */
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import {
  CONCLUDED_LOOKBACK_DAYS,
  UPCOMING_HORIZON_DAYS,
} from "../../meetings/constants.ts";
import { isPlacelessLocation, resolveVenue } from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { accountedNormalize, type Accounted } from "../normalize-account.ts";
import { makePermissionGate, permittedText } from "../permission-gate.ts";
import { saysCanceled, sittingStatus } from "../sitting-status.ts";
import type {
  Meeting,
  MeetingQuery,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";

/**
 * **ParentSquare SmartSites — a school district's own calendar, read from the
 * JSON its calendar component already fetches.** (2026-09-23, the Pima
 * school-agenda routes session. Built and recorded; NOT wired.)
 *
 * ## The route, because the route is the reusable part
 *
 * A SmartSites district home page carries a "calendar-events" component whose
 * configuration is a JSON block in the page itself
 * (`<script type="application/json" data-view-data-events-sliders="…">`,
 * `"calendarApiID": 150042` on Sunnyside's), and whose bundle
 * (`/dist/assets/EventsRepository-*.js`) calls
 *
 *   `<site>/api/calendars/<calendarApiID>/events?start_date=&end_date=&view_source=`
 *
 * on the district's own origin. Ladder rung 7 — the page's own call — on a
 * host whose robots.txt disallows only `/admin`, `/*lesson_plan` and
 * `/userFiles` (read 2026-09-23). Every SmartSites district is one page read
 * away from this, which is why it is an adapter and not a Sunnyside script.
 * (The tenant's FILE host, `files.smartsites.parentsquare.com`, is
 * `Disallow: /` and is never read.)
 *
 * ## Two facts the payload gets wrong or leaves out, handled rather than trusted
 *
 * - **The wall clock is right and the offset is not.** Sunnyside's tenant is
 *   configured `America/Denver`, so `start_datetime` carries `-06:00` in summer
 *   for a 4:30 pm Arizona sitting; the event page prints "4:30 PM … MT". The
 *   district's clock is the one it typed, so `start_date` + `start_time` are
 *   read as a wall clock in the body's own zone (`wiring.timeZone`), and the
 *   payload's offset is never applied. Verified against the district's
 *   Diligent record of the same sittings (16:30 and 18:30 Phoenix).
 * - **A board event states no place.** `address` is empty on every Governing
 *   Board event read; the district's standing sentence ("take place at the
 *   District Administration Building … unless otherwise noted") is a habit, and
 *   its agenda platform marks two upcoming sittings VIRTUAL that this calendar
 *   does not. So a sitting whose own event states no place is DROPPED as
 *   `unknownVenue` and counted — never placed by the standing sentence.
 *
 * ## Configuration
 *
 * `slug`, `siteBase`, `calendarApiId`, `titlePattern` (a sitting of THIS body),
 * `titleExcludePattern` (another body sharing the calendar), `bodyName`,
 * `venueSourceId`, `venueTenant`, and `venue:<address as printed>` → the
 * reviewed venue spelling.
 */

const SOURCE_NAME = "smartsites";
const DAY_MS = 86_400_000;

export interface SmartSitesEvent {
  id: string;
  title: string;
  start_date: string;
  start_time: string | null;
  end_date?: string | null;
  end_time?: string | null;
  all_day?: boolean;
  description?: string | null;
  address?: string | null;
  link?: string | null;
  calendar_name?: string | null;
}

export interface SmartSitesRaw {
  wiring: BodySourceWiring;
  url: string;
  collectedAt: string;
  events: SmartSitesEvent[];
}

export function calendarApiUrl(cfg: Record<string, string>, from: Date, to: Date): string {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return (
    `${cfg.siteBase}/api/calendars/${cfg.calendarApiId}/events` +
    `?start_date=${day(from)}&end_date=${day(to)}&view_source=event-slider`
  );
}

export function makeSmartSitesSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<SmartSitesRaw> {
  const normalizeWithDrops = (
    raw: SmartSitesRaw[],
    now: Date = new Date(),
  ): Accounted<{ meetings: Meeting[]; drops: NormalizeDropCounts }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 };
    let considered = 0;
    let keptButPlaceless = 0;
    let outOfWindow = 0;
    const lower = now.getTime() - CONCLUDED_LOOKBACK_DAYS * DAY_MS;
    const upper = now.getTime() + UPCOMING_HORIZON_DAYS * DAY_MS;

    for (const { wiring, url, collectedAt, events } of raw) {
      const cfg = wiring.config;
      const include = new RegExp(cfg.titlePattern, "i");
      const exclude = cfg.titleExcludePattern ? new RegExp(cfg.titleExcludePattern, "i") : null;
      considered += events.length;
      for (const e of events) {
        if (!include.test(e.title) || (exclude && exclude.test(e.title))) {
          drops.notConfigured += 1;
          continue;
        }
        const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.start_date ?? "");
        const clock = /^(\d{2}):(\d{2})/.exec(e.start_time ?? "");
        if (!day || !clock || e.all_day) {
          drops.unplaceableInTime += 1;
          continue;
        }
        const startsAt = toZonedIso(Number(day[1]), Number(day[2]), Number(day[3]), Number(clock[1]), Number(clock[2]), wiring.timeZone);
        const at = Date.parse(startsAt);
        if (at < lower || at > upper) {
          outOfWindow += 1;
          continue;
        }
        const address = (e.address ?? "").trim();
        const virtualTitle = /\bvirtual\b/i.test(e.title);
        const online = virtualTitle
          ? { label: "Virtual", joinUrl: null }
          : address && isPlacelessLocation(address)
            ? { label: address, joinUrl: null }
            : null;
        const spelling = !online && address ? cfg[`venue:${address}`] ?? null : null;
        const venue = spelling
          ? resolveVenue(cfg.venueSourceId ?? SOURCE_NAME, wiring.ocdId, spelling, cfg.venueTenant ?? cfg.slug)
          : undefined;
        if (!online && !venue) {
          drops.unknownVenue += 1;
          continue;
        }
        if (online) {
          drops.placeless += 1;
          keptButPlaceless += 1;
        }
        meetings.push({
          id: `${SOURCE_NAME}:${cfg.slug}:${e.id}`,
          ocdId: wiring.ocdId,
          bodyId: wiring.bodyId,
          bodyName: cfg.bodyName,
          title: e.title.trim(),
          startsAt,
          timeZone: wiring.timeZone,
          location: venue ? { name: venue.name, address: venue.address, lat: venue.lat, lng: venue.lng } : null,
          ...(online ? { online } : {}),
          agendaUrl: null,
          jurisdiction: wiring.jurisdiction,
          status: sittingStatus(startsAt, saysCanceled(e.title), now),
          provenance: {
            sourceUrl: e.link ? new URL(e.link, cfg.siteBase).toString() : url,
            sourceOrg: wiring.publishingOrg,
            collectedAt,
            verifiedAt: null,
          },
        });
      }
    }
    return accountedNormalize(SOURCE_NAME, raw, { meetings, drops }, {
      logicalInput: considered,
      countedButProduced: keptButPlaceless,
      outOfWindow,
    });
  };

  return {
    name: SOURCE_NAME,
    async fetch(query?: MeetingQuery): Promise<SmartSitesRaw[]> {
      const out: SmartSitesRaw[] = [];
      const now = Date.now();
      for (const wiring of wiringRows) {
        const url = calendarApiUrl(
          wiring.config,
          new Date(now - CONCLUDED_LOOKBACK_DAYS * DAY_MS),
          new Date(now + UPCOMING_HORIZON_DAYS * DAY_MS),
        );
        const gate = makePermissionGate({ fetchImpl, signal: query?.signal });
        const text = await permittedText(gate, url, { fetchImpl, signal: query?.signal, accept: "application/json" });
        const body = JSON.parse(text) as { success?: boolean; data?: { events?: SmartSitesEvent[] }; error?: string | null };
        if (body.success !== true || !Array.isArray(body.data?.events)) {
          throw new Error(`${url} answered without a success envelope: ${body.error ?? "no events array"}`);
        }
        out.push({ wiring, url, collectedAt: new Date().toISOString(), events: body.data!.events! });
      }
      return out;
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
