/**
 * @freshness-reads-here — the freshness date is taken at the moment of the
 * fetch, by the code path that performs the read.
 */
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { resolveVenue } from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { decodeEntities, politeGetText } from "../http.ts";
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
 * Hyland OnBase Agenda Online meeting source.
 *
 * Server-rendered ASP.NET: the landing page carries the whole upcoming
 * meeting list as plain table rows (`<tr id="meeting-<id>-row">`), each with
 * the meeting name, type, a wall-clock date string, a ViewMeeting permalink
 * and a direct agenda-PDF download. One GET per ingest.
 *
 * The list carries no location field, so venue resolution keys on the meeting
 * NAME via the venue cache. Unlike other adapters, an unmatched name is
 * dropped (counted) rather than published with a venue gap: the tenant lists
 * every body's meetings on one page, and the name key is also the only thing
 * that says a row is the wired body's sitting.
 */

const SOURCE_NAME = "onbase";

export interface OnBaseRaw {
  wiring: BodySourceWiring;
  html: string;
  collectedAt: string;
}

export interface OnBaseRow {
  meetingId: string;
  name: string;
  meetingType: string;
  /** As printed: `8/18/2026 1:30:00 PM`. */
  dateText: string;
  /** Absolute agenda PDF URL, when the row carries one. */
  agendaPdfUrl: string | null;
}

const ROW_PATTERN =
  /<tr id="meeting-(\d+)-row"[\s\S]*?data-sortable-type="mtgName">([^<]*)<\/td>\s*<td[^>]*data-sortable-type="mtgType">([^<]*)<\/td>\s*<td[^>]*data-sortable-type="mtgTime"[^>]*>([^<]*)<\/td>([\s\S]*?)<\/tr>/g;

export function parseOnBaseRows(html: string, baseUrl: string): OnBaseRow[] {
  const rows: OnBaseRow[] = [];
  for (const m of html.matchAll(ROW_PATTERN)) {
    const tail = m[5];
    const pdf = /href="([^"]*\/Documents\/Downloadfile\/[^"]*documentType=1[^"]*)"/.exec(
      tail,
    );
    rows.push({
      meetingId: m[1],
      name: decodeEntities(m[2].trim()),
      meetingType: decodeEntities(m[3].trim()),
      dateText: m[4].trim(),
      agendaPdfUrl: pdf ? new URL(decodeEntities(pdf[1]), baseUrl).href : null,
    });
  }
  return rows;
}

/** `M/D/YYYY h:mm:ss AM/PM` → parts, or null. */
function wallClock(
  text: string,
): { y: number; mo: number; d: number; h: number; mi: number } | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):\d{2}\s*(AM|PM)$/i.exec(
    text.trim(),
  );
  if (!m) return null;
  const rawHour = Number(m[4]);
  if (rawHour < 1 || rawHour > 12) return null;
  return {
    y: Number(m[3]),
    mo: Number(m[1]),
    d: Number(m[2]),
    h: (rawHour % 12) + (m[6].toUpperCase() === "PM" ? 12 : 0),
    mi: Number(m[5]),
  };
}

function statusOf(startsAt: string, now: Date): MeetingStatus {
  // OnBase exposes no cancellation signal; claiming CANCELED from nothing
  // would keep someone at home. Time is the only honest axis here.
  return Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

export function makeOnBaseSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<OnBaseRaw> {
  const normalizeWithDrops = (
    raw: OnBaseRaw[],
    now: Date = new Date(),
  ): Accounted<{ meetings: Meeting[]; drops: NormalizeDropCounts }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };

    // Counted per landing page, which carries the whole upcoming list.
    let considered = 0;

    for (const { wiring, html, collectedAt } of raw) {
      const baseUrl = wiring.config.baseUrl;

      for (const row of parseOnBaseRows(html, baseUrl)) {
        considered += 1;
        const clock = wallClock(row.dateText);
        if (!clock) {
          drops.unplaceableInTime++;
          continue;
        }
        const startsAt = toZonedIso(
          clock.y,
          clock.mo,
          clock.d,
          clock.h,
          clock.mi,
          wiring.timeZone,
        );

        // No location field exists in this system; the meeting name is the
        // only observed string that distinguishes venues.
        const venue = resolveVenue(SOURCE_NAME, wiring.ocdId, row.name);
        if (!venue) {
          drops.unknownVenue++;
          continue;
        }

        // "Mayor & Council - Regular" → the body is the part before the dash;
        // a name with no dash is used whole. Published text either way.
        const bodyName = row.name.split(" - ")[0].trim() || row.name;

        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.slug ?? "tucson"}:${row.meetingId}`,
          ocdId: wiring.ocdId,
          bodyId: wiring.bodyId,
          bodyName,
          title: row.name,
          startsAt,
          timeZone: wiring.timeZone,
          location: {
            name: venue.name,
            address: venue.address,
            lat: venue.lat,
            lng: venue.lng,
          },
          agendaUrl: row.agendaPdfUrl,
          jurisdiction: wiring.jurisdiction,
          status: statusOf(startsAt, now),
          provenance: {
            // The ViewMeeting permalink, in the form the page itself links.
            sourceUrl: `${baseUrl}/Meetings/ViewMeeting?id=${row.meetingId}&doctype=1`,
            sourceOrg: wiring.publishingOrg,
            collectedAt,
            verifiedAt: null,
          },
        });
      }
    }

    return accountedNormalize(SOURCE_NAME, raw, { meetings, drops }, {
      logicalInput: considered,
    });
  };

  return {
    name: SOURCE_NAME,

    async fetch(query?: MeetingQuery): Promise<OnBaseRaw[]> {
      const collected: OnBaseRaw[] = [];
      for (const wiring of wiringRows) {
        const { text } = await politeGetText(wiring.config.baseUrl, {
          fetchImpl,
          accept: "text/html",
          signal: query?.signal,
        });
        collected.push({
          wiring,
          html: text,
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
