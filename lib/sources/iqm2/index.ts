import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import {
  CONCLUDED_LOOKBACK_DAYS,
  UPCOMING_HORIZON_DAYS,
} from "../../meetings/constants.ts";
import {
  isPlacelessLocation,
  resolveVenue,
} from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { politeGetText } from "../http.ts";
import type {
  Meeting,
  MeetingStatus,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";
import {
  accountedNormalize,
  type Accounted,
} from "../normalize-account.ts";

/**
 * Granicus IQM2 meeting source — the Morris County half of the 07866 hunt.
 *
 * The ladder recorded `/Services/RSS.aspx?Feed=Calendar` as the machine
 * channel, but that pseudo-feed lists *published documents* (mostly the recent
 * past). The better rung, found this session and written back to the ladder:
 * **`/Citizens/Calendar.aspx?From=&To=` is fully server-rendered**, future
 * meetings included, and each row's `title` tooltip carries the board, the
 * meeting type, the status, and the venue with its full street address —
 * which also resolved the venue-citation errand the county's Akamai-fronted
 * site had blocked. Verified live 2026-08-13 on morriscountynj.iqm2.com:
 * BOC work sessions and regular meetings through December, agenda links
 * (`FileOpen.aspx?Type=14`) present exactly where an agenda is published.
 */

const SOURCE_NAME = "iqm2";

/**
 * The fetch window IS the served window (M76, 2026-08-15).
 *
 * These were literal 60 and 30 with a comment claiming they matched the
 * cascade. The served lookback moved 30 -> 90 and the adapters did not, so
 * every source quietly dropped sixty days of published, retrievable history
 * at the fetch — invisible to every count check, because each adapter
 * honestly reported what it had asked for. Deriving them is what makes the
 * drift impossible rather than merely noticed.
 */
const WINDOW_FORWARD_DAYS = UPCOMING_HORIZON_DAYS;
const WINDOW_BACK_DAYS = CONCLUDED_LOOKBACK_DAYS;

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

    for (const { wiring, html, collectedAt } of raw) {
      for (const row of parseCalendarRows(html)) {
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

        if (!row.location) {
          drops.unknownVenue++;
          continue;
        }
        if (isPlacelessLocation(row.location)) {
          drops.placeless++;
          continue;
        }
        const venue = resolveVenue(SOURCE_NAME, wiring.ocdId, row.location);
        if (!venue) {
          drops.unknownVenue++;
          continue;
        }

        const detailUrl = `${wiring.config.base}/Citizens/Detail_Meeting.aspx?ID=${row.detailId}`;
        const canceled = /cancell?ed/i.test(row.status);

        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.slug}:${row.detailId}`,
          ocdId: wiring.ocdId,
          bodyName: row.board,
          title: row.type ? `${row.board} - ${row.type}` : row.board,
          startsAt,
          timeZone: wiring.timeZone,
          location: {
            name: venue.name,
            address: venue.address,
            lat: venue.lat,
            lng: venue.lng,
          },
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

    return accountedNormalize(SOURCE_NAME, raw, { meetings, drops });
  };

  return {
    name: SOURCE_NAME,

    async fetch(): Promise<Iqm2Raw[]> {
      const now = Date.now();
      const from = usDate(new Date(now - WINDOW_BACK_DAYS * 86_400_000));
      const to = usDate(new Date(now + WINDOW_FORWARD_DAYS * 86_400_000));

      const collected: Iqm2Raw[] = [];
      for (const wiring of wiringRows) {
        const url = `${wiring.config.base}/Citizens/Calendar.aspx?From=${from}&To=${to}`;
        const { text } = await politeGetText(url, { fetchImpl });
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
