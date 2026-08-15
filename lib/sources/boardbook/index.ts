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
import { decodeEntities, politeGetText } from "../http.ts";
import type {
  Meeting,
  MeetingStatus,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";

/**
 * BoardBook Premier (Sparq Data Solutions) — the school-board agenda portal
 * behind `meetings.boardbook.org/Public/Organization/<orgId>`.
 *
 * One server-rendered page carries the organization's whole meeting archive
 * (Amphitheater's reaches back to 2018 — 401 rows at first fetch) as
 * `<tr class=" row-for-board">` rows, each with the date-time-title line,
 * the meeting type, the venue as three labeled spans (name, street, city
 * -state-zip), and public links (`/Public/Agenda/<org>?meeting=<id>`,
 * `/Public/PublicNotice/...`). Everything is plain GET, no auth, no
 * client-side rendering — ladder rung 2, the page itself.
 *
 * The portal posts each meeting's notice days ahead (Amphitheater's Aug 11
 * sitting released Aug 10), so between postings the upcoming window can
 * honestly be empty while the concluded tier still carries recent sittings.
 * The wiring row's `meetingCadence` (the body's own published schedule) is
 * the reader's answer to "when do they usually meet".
 *
 * The feed publishes venue name AND address per row; coordinates still come
 * from the venue cache so every pin carries a citable geocoder call — an
 * unmatched venue drops the meeting, counted, never guessed (§0c).
 */

const SOURCE_NAME = "boardbook";

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

const BASE = "https://meetings.boardbook.org";

export interface BoardBookRaw {
  wiring: BodySourceWiring;
  html: string;
  collectedAt: string;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export interface BoardBookRow {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  title: string;
  meetingType: string | null;
  locationName: string | null;
  addressLine: string | null;
  cityStateZip: string | null;
  meetingId: string | null;
  hasAgenda: boolean;
}

/** Parse every `row-for-board` block; a row this parser cannot date is
 *  returned in `undated` so the caller can count it. */
export function parseOrganizationPage(html: string): {
  rows: BoardBookRow[];
  undated: number;
} {
  const blocks = html.split(/<tr class=" row-for-board">/).slice(1);
  const rows: BoardBookRow[] = [];
  let undated = 0;

  for (const block of blocks) {
    const header =
      /([A-Z][a-z]+) (\d{1,2}), (\d{4}) at (\d{1,2}):(\d{2}) ([AP]M)\s*-\s*([^<]+)/.exec(
        block,
      );
    if (!header) {
      undated += 1;
      continue;
    }
    const month = MONTHS[header[1].toLowerCase()];
    if (!month) {
      undated += 1;
      continue;
    }
    const rawHour = Number(header[4]) % 12;
    const type = /Meeting Type:<\/b>\s*([A-Za-z][A-Za-z ]*)/.exec(block);
    const locationName = /-description'>([^<]*)</.exec(block);
    const addressLine = /-line1'>([^<]*)</.exec(block);
    const cityStateZip = /-csz'>([^<]*)</.exec(block);
    const meetingId = /meeting=(\d+)/.exec(block);

    rows.push({
      y: Number(header[3]),
      mo: month,
      d: Number(header[2]),
      h: rawHour + (header[6] === "PM" ? 12 : 0),
      mi: Number(header[5]),
      title: decodeEntities(header[7].trim()),
      meetingType: type ? type[1].trim() : null,
      locationName: locationName ? decodeEntities(locationName[1].trim()) : null,
      addressLine: addressLine ? decodeEntities(addressLine[1].trim()) : null,
      cityStateZip: cityStateZip ? decodeEntities(cityStateZip[1].trim()) : null,
      meetingId: meetingId ? meetingId[1] : null,
      hasAgenda: />\s*Agenda\s*</.test(block),
    });
  }

  return { rows, undated };
}

function statusOf(startsAt: string, now: Date): MeetingStatus {
  return Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

export function makeBoardBookSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<BoardBookRaw> {
  const normalizeWithDrops = (
    raw: BoardBookRaw[],
    now: Date = new Date(),
  ): { meetings: Meeting[]; drops: NormalizeDropCounts } => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };

    const windowStart = now.getTime() - WINDOW_BACK_DAYS * 86_400_000;
    const windowEnd = now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000;

    for (const { wiring, html, collectedAt } of raw) {
      const orgUrl = `${BASE}/Public/Organization/${wiring.config.orgId}`;
      const { rows, undated } = parseOrganizationPage(html);
      drops.unplaceableInTime += undated;

      for (const row of rows) {
        const startsAt = toZonedIso(
          row.y,
          row.mo,
          row.d,
          row.h,
          row.mi,
          wiring.timeZone,
        );
        const t = Date.parse(startsAt);
        // The archive reaches back years; only the cascade's window ships.
        // An out-of-window row is a deliberate clip, not a drop to count.
        if (t < windowStart || t > windowEnd) continue;

        const location = row.locationName ?? "";
        if (!location) {
          drops.unknownVenue += 1;
          continue;
        }
        if (isPlacelessLocation(location)) {
          drops.placeless += 1;
          continue;
        }
        const venue = resolveVenue(SOURCE_NAME, wiring.ocdId, location);
        if (!venue) {
          drops.unknownVenue += 1;
          continue;
        }

        const bodyName = wiring.config.bodyName ?? wiring.jurisdiction;
        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.orgId}:${row.meetingId ?? `${row.y}-${row.mo}-${row.d}`}`,
          ocdId: wiring.ocdId,
          bodyName,
          // The portal's own header line, e.g. "REGULAR PUBLIC MEETING".
          title: row.title,
          startsAt,
          timeZone: wiring.timeZone,
          location: {
            name: venue.name,
            address: venue.address,
            lat: venue.lat,
            lng: venue.lng,
          },
          agendaUrl:
            row.hasAgenda && row.meetingId
              ? `${BASE}/Public/Agenda/${wiring.config.orgId}?meeting=${row.meetingId}`
              : null,
          jurisdiction: wiring.jurisdiction,
          status: /cancel/i.test(row.title)
            ? "CANCELED"
            : statusOf(startsAt, now),
          provenance: {
            sourceUrl: orgUrl,
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

    async fetch(): Promise<BoardBookRaw[]> {
      const collected: BoardBookRaw[] = [];
      for (const wiring of wiringRows) {
        const url = `${BASE}/Public/Organization/${wiring.config.orgId}`;
        const { text } = await politeGetText(url, {
          fetchImpl,
          accept: "text/html",
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
