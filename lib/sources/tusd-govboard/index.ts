/**
 * @freshness-reads-here — `collectedAt` is taken at the moment of the fetch.
 */
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import {
  CONCLUDED_LOOKBACK_DAYS,
  UPCOMING_HORIZON_DAYS,
} from "../../meetings/constants.ts";
import { isPlacelessLocation, resolveVenue } from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { decodeEntities } from "../http.ts";
import { accountedNormalize, type Accounted } from "../normalize-account.ts";
import { makePermissionGate, permittedText } from "../permission-gate.ts";
import { saysCanceled, sittingStatus } from "../sitting-status.ts";
import { parseBoardActions } from "./board-actions.ts";
import type {
  Meeting,
  MeetingQuery,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";

/**
 * A school district's own Governing Board site: the board calendar and the
 * Board Actions record. The calendar parser is also used by
 * lib/sources/diligent/schedule-union.ts.
 *
 * The Meeting-Calendar page renders nothing to a plain client; its inline
 * script loads the month from the site's own endpoint,
 *
 *   `/inflow/xti/inCal.aspx?PID=<page>&C=0&D=<YYYY-MM-DD>&V=12`
 *
 * which answers a server-rendered month fragment: one modal per sitting with
 * the title, `Date & Time: MM/DD/YYYY h:mmpm - h:mmpm`, and the district's own
 * details sentence ("… meetings are held at <building> … in the Multipurpose
 * Room", "Committee meetings are held via Zoom", "Committee meeting location
 * TBD"). It carries the Governing Board AND its committees.
 *
 * `/Actions` lists, per Governing Board sitting, a Board Actions PDF (see
 * `board-actions.ts`), carried as a CONCLUDED sitting's agenda document.
 *
 * Place comes from the sitting's own details sentence or not at all:
 * `venueMatch:<phrase>` config keys map a printed phrase to a reviewed venue
 * spelling; "via Zoom" is kept placeless; a sentence no phrase places is
 * published with no pin and our own place-not-recorded gap, counted as
 * `unknownVenue`.
 */

const SOURCE_NAME = "tusd-govboard";
const DAY_MS = 86_400_000;

export interface CalendarFragment {
  readonly url: string;
  readonly html: string;
}

export interface TusdGovboardRaw {
  wiring: BodySourceWiring;
  collectedAt: string;
  months: CalendarFragment[];
  actions: { url: string; html: string } | null;
}

export interface CalendarSitting {
  readonly modalId: string;
  readonly title: string;
  readonly date: { y: number; m: number; d: number };
  readonly h: number;
  readonly mi: number;
  readonly details: string;
}

function text(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Every sitting modal in one month fragment. */
export function parseCalendarFragment(html: string): CalendarSitting[] {
  const out: CalendarSitting[] = [];
  for (const modal of html.matchAll(/<div class="modal fade" id="([^"]+)"[\s\S]*?<div class="modal-footer">/gi)) {
    const block = modal[0];
    const title = /<h4 class="modal-title">([\s\S]*?)<\/h4>/i.exec(block);
    const when = /Date & Time:\s*<\/div>\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([ap])m/i.exec(block);
    if (!title || !when) continue;
    let h = Number(when[4]) % 12;
    if (when[6].toLowerCase() === "p") h += 12;
    const details = /<div id="modalDescription">([\s\S]*?)<\/div>\s*<\/div>\s*<div class="modal-footer">/i.exec(block);
    out.push({
      modalId: modal[1],
      title: text(title[1]),
      date: { y: Number(when[3]), m: Number(when[1]), d: Number(when[2]) },
      h,
      mi: Number(when[5]),
      details: details ? text(details[1]).replace(/^Event Details:\s*/i, "") : "",
    });
  }
  return out;
}

export { parseBoardActions };

/** The months a window touches, as `YYYY-MM-01`. */
export function monthsInWindow(now: Date): string[] {
  const start = new Date(now.getTime() - CONCLUDED_LOOKBACK_DAYS * DAY_MS);
  const end = new Date(now.getTime() + UPCOMING_HORIZON_DAYS * DAY_MS);
  const out: string[] = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth() + 1;
  while (y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth() + 1)) {
    out.push(`${y}-${String(m).padStart(2, "0")}-01`);
    m += 1;
    if (m === 13) { m = 1; y += 1; }
  }
  return out;
}

/** The body a calendar title names: "Audit Committee Meeting - via Zoom" → "Audit Committee". */
export function bodyNameOf(title: string): string {
  return title.replace(/\s*-\s*via Zoom$/i, "").replace(/\s+Meeting$/i, "").trim();
}

/** The month fragment URL the Meeting-Calendar page itself requests. */
export function calendarFragmentUrl(base: string, pid: string, month: string): string {
  return `${base}/inflow/xti/inCal.aspx?PID=${pid}&C=0&D=${month}&V=12`;
}

export function makeTusdGovboardSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<TusdGovboardRaw> {
  const normalizeWithDrops = (
    raw: TusdGovboardRaw[],
    now: Date = new Date(),
  ): Accounted<{ meetings: Meeting[]; drops: NormalizeDropCounts }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 };
    let considered = 0;
    let keptButPlaceless = 0;
    let outOfWindow = 0;
    let duplicates = 0;
    const lower = now.getTime() - CONCLUDED_LOOKBACK_DAYS * DAY_MS;
    const upper = now.getTime() + UPCOMING_HORIZON_DAYS * DAY_MS;

    for (const { wiring, collectedAt, months, actions } of raw) {
      const cfg = wiring.config;
      const actionsByDay = actions ? parseBoardActions(actions.html, actions.url) : new Map<string, string>();
      const seen = new Set<string>();
      for (const fragment of months) {
        for (const s of parseCalendarFragment(fragment.html)) {
          considered += 1;
          const day = `${s.date.y}-${String(s.date.m).padStart(2, "0")}-${String(s.date.d).padStart(2, "0")}`;
          const key = `${day}-${s.modalId}`;
          if (seen.has(key)) {
            duplicates += 1;
            continue;
          }
          seen.add(key);
          const startsAt = toZonedIso(s.date.y, s.date.m, s.date.d, s.h, s.mi, wiring.timeZone);
          const at = Date.parse(startsAt);
          if (at < lower || at > upper) {
            outOfWindow += 1;
            continue;
          }
          const statement = `${s.title} ${s.details}`;
          // The join link is carried only when the district's own sentence
          // publishes one for THIS sitting.
          const joinUrl = /https:\/\/[a-z0-9.-]*zoom\.us\/j\/[^\s"<]+/i.exec(s.details)?.[0] ?? null;
          const online = /via zoom/i.test(statement) || isPlacelessLocation(s.details)
            ? { label: "Via Zoom", joinUrl }
            : null;
          const phrase = Object.keys(cfg)
            .filter((k) => k.startsWith("venueMatch:"))
            .find((k) => statement.toLowerCase().includes(k.slice("venueMatch:".length).toLowerCase()));
          const venue = !online && phrase
            ? resolveVenue(cfg.venueSourceId ?? SOURCE_NAME, wiring.ocdId, cfg[phrase], cfg.venueTenant ?? null)
            : undefined;
          if (!online && !venue) {
            // Kept with no pin and our own place-not-recorded gap, counted.
            drops.unknownVenue += 1;
            keptButPlaceless += 1;
          }
          if (online) {
            drops.placeless += 1;
            keptButPlaceless += 1;
          }
          const status = sittingStatus(startsAt, saysCanceled(s.title), now);
          const isBoardSitting = /^Governing Board Meeting/i.test(s.title);
          meetings.push({
            id: `${SOURCE_NAME}:${cfg.slug}:${key}`,
            ocdId: wiring.ocdId,
            bodyId: wiring.bodyId,
            bodyName: bodyNameOf(s.title),
            title: s.title,
            startsAt,
            timeZone: wiring.timeZone,
            location: venue ? { name: venue.name, address: venue.address, lat: venue.lat, lng: venue.lng } : null,
            ...(online ? { online } : {}),
            agendaUrl: isBoardSitting && status === "CONCLUDED" ? actionsByDay.get(day) ?? null : null,
            jurisdiction: wiring.jurisdiction,
            status,
            provenance: { sourceUrl: fragment.url, sourceOrg: wiring.publishingOrg, collectedAt, verifiedAt: null },
          });
        }
      }
    }
    return accountedNormalize(SOURCE_NAME, raw, { meetings, drops }, {
      logicalInput: considered,
      countedButProduced: keptButPlaceless,
      outOfWindow,
      duplicates,
    });
  };

  return {
    name: SOURCE_NAME,
    async fetch(query?: MeetingQuery): Promise<TusdGovboardRaw[]> {
      const out: TusdGovboardRaw[] = [];
      for (const wiring of wiringRows) {
        const cfg = wiring.config;
        const gate = makePermissionGate({ fetchImpl, signal: query?.signal });
        const http = { fetchImpl, signal: query?.signal };
        const months: CalendarFragment[] = [];
        for (const month of monthsInWindow(new Date())) {
          const url = calendarFragmentUrl(cfg.base, cfg.calendarPid, month);
          months.push({ url, html: await permittedText(gate, url, http) });
        }
        const actionsUrl = cfg.actionsUrl ?? null;
        out.push({
          wiring,
          collectedAt: new Date().toISOString(),
          months,
          actions: actionsUrl ? { url: actionsUrl, html: await permittedText(gate, actionsUrl, http) } : null,
        });
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
