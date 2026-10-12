/**
 * @freshness-reads-here — `collectedAt` is taken at the moment of the fetch.
 */
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import {
  CONCLUDED_LOOKBACK_DAYS,
  UPCOMING_HORIZON_DAYS,
} from "../../meetings/constants.ts";
import { isPlacelessLocation, resolveVenue, unplacedVenueGap } from "../../meetings/venue-cache.ts";
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
 * ParentSquare SmartSites — a school district's own calendar, read from the
 * JSON its calendar component already fetches. `calendarApiUrl` is also reused
 * by lib/sources/diligent/schedule-union.ts.
 *
 * A SmartSites home page carries a "calendar-events" component configured by a
 * JSON block in the page (`<script type="application/json"
 * data-view-data-events-sliders="…">`, carrying `"calendarApiID"`), whose
 * bundle calls
 *
 *   `<site>/api/calendars/<calendarApiID>/events?start_date=&end_date=&view_source=`
 *
 * on the district's own origin. The tenant's file host
 * (`files.smartsites.parentsquare.com`) is never read.
 *
 * - **The wall clock is right and the offset may not be.** A tenant can be
 *   configured in the wrong zone, so `start_date` + `start_time` are read as a
 *   wall clock in the body's own zone (`wiring.timeZone`) and the payload's
 *   offset is never applied.
 * - **A board event may state no place.** A district's standing "meetings take
 *   place at …" sentence is a habit, not a statement about the sitting, so it
 *   never places one. An unplaced sitting is published with no pin and its gap
 *   named, counted as `unknownVenue`; an address with no reviewed spelling is
 *   published the same way, in the district's own words.
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
        // No reviewed place never suppresses the sitting: published with no
        // pin and its gap named (the event's `address` verbatim, or the
        // district's silence), counted as `unknownVenue`.
        const venueGap = !online && !venue ? unplacedVenueGap(address, wiring.publishingOrg) : null;
        if (venueGap) {
          drops.unknownVenue += 1;
          keptButPlaceless += 1;
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
          ...(venueGap ? { venueGap } : {}),
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
