/**
 * @freshness-reads-here
 *
 * RULING 107 — the clock stamps in this file are minted by the code path that
 * performs the read: the freshness date is taken at the moment of the fetch,
 * which is what the ruling asks for rather than what it forbids. Verified
 * 2026-08-23 by reading each stamp site against the retrieval it sits in.
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
 * unmatched venue is never guessed (§0c), and never suppresses the sitting: it
 * is published with no pin and the row's own venue words as its named gap,
 * counted as `unknownVenue` (the venue-gap class, 2026-09-23).
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
const WINDOW_FORWARD_DAYS = MEETING_HELD_HORIZON_DAYS;
const WINDOW_BACK_DAYS = MEETING_HELD_LOOKBACK_DAYS;

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
  ): Accounted<{ meetings: Meeting[]; drops: NormalizeDropCounts }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };

    const windowStart = now.getTime() - WINDOW_BACK_DAYS * 86_400_000;
    const windowEnd = now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000;

    // A-002 · counted in the unit the disposition happens in. One raw row is
    // one organization page and carries the body's whole archive.
    let considered = 0;
    let outOfWindow = 0;
    let keptButPlaceless = 0;

    for (const { wiring, html, collectedAt } of raw) {
      const orgUrl = `${BASE}/Public/Organization/${wiring.config.orgId}`;
      const { rows, undated } = parseOrganizationPage(html);
      drops.unplaceableInTime += undated;
      considered += rows.length + undated;

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
        if (t < windowStart || t > windowEnd) {
          // A-002: a deliberate clip is still a disposition and is counted.
          outOfWindow += 1;
          continue;
        }

        const location = row.locationName ?? "";
        /*
         * A meeting held online is KEPT (D18). No building means no
         * coordinates and no pin, but it is a real public meeting a reader
         * could attend, and dropping it applied the map's constraint to the
         * reader. The label is the published string verbatim; nothing here
         * publishes a join link, so joinUrl is null and renders as the gap
         * it is rather than as some other URL dressed up as a way in.
         */
        const online = location && isPlacelessLocation(location)
          ? { label: location, joinUrl: null }
          : null;
        if (online) {
          drops.placeless += 1;
          // A-002: `placeless` TALLIES a meeting that is then PRODUCED just
          // below (D18 keeps online-only sittings), so it is not a drop and
          // must not be summed as one.
          keptButPlaceless += 1;
        }
        const venue = online || !location ? null : resolveVenue(SOURCE_NAME, wiring.ocdId, location) ?? null;
        /*
         * No reviewed venue never suppresses the sitting (the venue-gap class,
         * 2026-09-23). It is published with no pin and its gap named: the
         * row's own three venue spans (name, street, city-state-zip) in the
         * portal's order, or the portal's silence where the row prints none.
         * Counted as `unknownVenue`, and produced. Both cases used to
         * `continue`.
         */
        const venueGap = !online && !venue
          ? unplacedVenueGap(
              [row.locationName, row.addressLine, row.cityStateZip].filter(Boolean).join(", "),
              wiring.publishingOrg,
            )
          : null;
        if (venueGap) {
          drops.unknownVenue += 1;
          keptButPlaceless += 1;
        }

        const bodyName = wiring.config.bodyName ?? wiring.jurisdiction;
        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.orgId}:${row.meetingId ?? `${row.y}-${row.mo}-${row.d}`}`,
          ocdId: wiring.ocdId,
          /* NH-RC4: the body, from the wiring row that produced this meeting. */
          bodyId: wiring.bodyId,
          bodyName,
          // The portal's own header line, e.g. "REGULAR PUBLIC MEETING".
          title: row.title,
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

    return accountedNormalize(
      SOURCE_NAME,
      raw,
      { meetings, drops },
      { logicalInput: considered, outOfWindow, countedButProduced: keptButPlaceless },
    );
  };

  return {
    name: SOURCE_NAME,

    async fetch(query?: MeetingQuery): Promise<BoardBookRaw[]> {
      const collected: BoardBookRaw[] = [];
      for (const wiring of wiringRows) {
        const url = `${BASE}/Public/Organization/${wiring.config.orgId}`;
        const { text } = await politeGetText(url, {
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
