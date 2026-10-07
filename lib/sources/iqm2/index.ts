/**
 * @freshness-reads-here
 *
 * The clock stamps in this file are minted by the code path that performs the read: the freshness date
 * is taken at the moment of the fetch.
 */
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import {
  MEETING_HELD_HORIZON_DAYS,
  MEETING_HELD_LOOKBACK_DAYS,
} from "../../meetings/constants.ts";
import {
  isPlacelessLocation,
  resolveVenue,
  unplacedVenueGap,
} from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { politeGetText } from "../http.ts";
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
 * Granicus IQM2 meeting source. `/Citizens/Calendar.aspx?From=&To=` is fully server-rendered, future
 * meetings included, and each row's `title` tooltip carries the board, the meeting type, the status, and
 * the venue with its full street address; agenda links (`FileOpen.aspx?Type=14`) appear where an agenda
 * is published. The `/Services/RSS.aspx?Feed=Calendar` pseudo-feed lists only published documents and is
 * not used.
 */

const SOURCE_NAME = "iqm2";

/** The fetch window is the served window, derived from the serving constants so the two cannot drift. */
const WINDOW_FORWARD_DAYS = MEETING_HELD_HORIZON_DAYS;
const WINDOW_BACK_DAYS = MEETING_HELD_LOOKBACK_DAYS;

export interface Iqm2Raw {
  wiring: BodySourceWiring;
  html: string;
  collectedAt: string;
}

interface Iqm2Row {
  detailId: string;
  board: string;
  type: string;
  status: string;
  /** Venue lines from the tooltip, joined — the venue-cache key. */
  location: string;
  /** e.g. "AUGUST 12, 2026  5:00 PM" (weekday stripped). */
  when: string;
  agendaHref: string | null;
}

/** Decode the numeric and named entities IQM2 puts in title attributes. */
function decodeTitle(value: string): string {
  return value
    .replace(/&#0?13;/g, "\n")
    .replace(/&#0?9;/g, "\t")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** "AUGUST 12, 2026  5:00 PM" → zoned ISO, or null when it does not parse. */
function parseWhen(when: string, timeZone: string): string | null {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(
    when,
  );
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  let hour = Number(m[4]) % 12;
  if (m[6].toUpperCase() === "PM") hour += 12;
  return toZonedIso(Number(m[3]), month, Number(m[2]), hour, Number(m[5]), timeZone);
}

/**
 * Pull the meeting rows out of the calendar page.
 *
 * Each row is a `Row MeetingRow` div holding a Detail_Meeting link whose
 * tooltip states everything, plus the download links. Parsed with anchored
 * patterns rather than a DOM because the page is rigidly repetitive ASP.NET
 * output — and the parse is covered by a recorded fixture, so a template
 * change fails a test instead of silently returning zero rows.
 */
export function parseCalendarRows(html: string): Iqm2Row[] {
  const rows: Iqm2Row[] = [];
  const chunks = html.split(/class="Row MeetingRow/).slice(1);

  for (const chunk of chunks) {
    const link = /<a href="\/Citizens\/Detail_Meeting\.aspx\?ID=(\d+)" title="([^"]*)"/.exec(
      chunk,
    );
    if (!link) continue;

    const tooltip = decodeTitle(link[2]);
    const lines = tooltip.split("\n").map((l) => l.trim());
    const when = (lines[0] ?? "").replace(/^[A-Za-z]+,\s*/, "");
    const board = lines.find((l) => l.startsWith("Board:"))?.slice(6).trim() ?? "";
    const type = lines.find((l) => l.startsWith("Type:"))?.slice(5).trim() ?? "";
    const status = lines.find((l) => l.startsWith("Status:"))?.slice(7).trim() ?? "";
    // Venue lines: everything after the blank line that follows Status.
    const statusIdx = lines.findIndex((l) => l.startsWith("Status:"));
    const location = lines
      .slice(statusIdx + 1)
      .filter((l) => l.length > 0)
      .join(", ");

    // An agenda link is real only when its href is non-empty — unpublished
    // documents render the same anchor with class HiddenDocumentLink and no
    // href, and matching those as agendas would fabricate a citation.
    const agenda = /<a href='(FileOpen\.aspx\?Type=14&(?:amp;)?ID=\d+[^']*)'[^>]*>Agenda<\/a>/.exec(
      chunk,
    );

    rows.push({
      detailId: link[1],
      board,
      type,
      status,
      location,
      when,
      agendaHref: agenda ? agenda[1].replace(/&amp;/g, "&") : null,
    });
  }

  return rows;
}

function usDate(date: Date): string {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
}

export function makeIqm2Source(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<Iqm2Raw> {
  const normalizeWithDrops = (
    raw: Iqm2Raw[],
    now: Date = new Date(),
  ): Accounted<{ meetings: Meeting[]; drops: NormalizeDropCounts }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };

    // A-002 · counted in the unit the disposition happens in. One raw row is
    // one calendar page and carries many rows.
    let considered = 0;
    // `placeless` and `unknownVenue` tally sittings that are then produced, so neither is a drop.
    let keptButPlaceless = 0;

    for (const { wiring, html, collectedAt } of raw) {
      for (const row of parseCalendarRows(html)) {
        considered += 1;
        // Only rows for the wired board; the same tenant can host others.
        if (
          wiring.config.boardMatch &&
          row.board !== wiring.config.boardMatch
        ) {
          drops.notConfigured++;
          continue;
        }

        const startsAt = parseWhen(row.when, wiring.timeZone);
        if (!startsAt) {
          drops.unplaceableInTime++;
          continue;
        }

        // No place never suppresses the sitting; each case is kept with no pin and counted:
        // - a tooltip venue naming no building is online, counted `placeless`;
        // - a venue with no reviewed row renders as the county's own words (`STATED_NOT_PLACED`), counted
        //   `unknownVenue`;
        // - a row stating no venue is the county's own gap (`NOT_STATED_BY_PUBLISHER`), counted `unknownVenue`.
        const online = row.location && isPlacelessLocation(row.location)
          ? { label: row.location, joinUrl: null }
          : null;
        if (online) {
          drops.placeless++;
          keptButPlaceless += 1;
        }
        const venue = online || !row.location
          ? null
          : resolveVenue(SOURCE_NAME, wiring.ocdId, row.location) ?? null;
        const venueGap = !online && !venue ? unplacedVenueGap(row.location, wiring.publishingOrg) : null;
        if (venueGap) {
          drops.unknownVenue++;
          keptButPlaceless += 1;
        }

        const detailUrl = `${wiring.config.base}/Citizens/Detail_Meeting.aspx?ID=${row.detailId}`;
        const canceled = /cancell?ed/i.test(row.status);

        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.slug}:${row.detailId}`,
          ocdId: wiring.ocdId,
          /* NH-RC4: the body, from the wiring row that produced this meeting. */
          bodyId: wiring.bodyId,
          bodyName: row.board,
          title: row.type ? `${row.board} - ${row.type}` : row.board,
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
          agendaUrl: row.agendaHref
            ? `${wiring.config.base}/Citizens/${row.agendaHref}`
            : null,
          jurisdiction: wiring.jurisdiction,
          status: canceled
            ? "CANCELED"
            : ((Date.parse(startsAt) < now.getTime()
                ? "CONCLUDED"
                : "SCHEDULED") satisfies MeetingStatus),
          provenance: {
            sourceUrl: detailUrl,
            sourceOrg: wiring.publishingOrg,
            collectedAt,
            verifiedAt: null,
          },
        });
      }
    }

    return accountedNormalize(SOURCE_NAME, raw, { meetings, drops }, {
      logicalInput: considered,
      // Every `placeless` and `unknownVenue` here tallies a sitting that is then produced.
      countedButProduced: keptButPlaceless,
    });
  };

  return {
    name: SOURCE_NAME,

    async fetch(query?: MeetingQuery): Promise<Iqm2Raw[]> {
      const now = Date.now();
      const from = usDate(new Date(now - WINDOW_BACK_DAYS * 86_400_000));
      const to = usDate(new Date(now + WINDOW_FORWARD_DAYS * 86_400_000));

      const collected: Iqm2Raw[] = [];
      for (const wiring of wiringRows) {
        const url = `${wiring.config.base}/Citizens/Calendar.aspx?From=${from}&To=${to}`;
        const { text } = await politeGetText(url, {
          fetchImpl,
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
