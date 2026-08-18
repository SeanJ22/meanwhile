import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import {
  isPlacelessLocation,
  resolveVenue,
  soleVenueForBody,
} from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { politeGetText } from "../http.ts";
import type {
  Meeting,
  MeetingStatus,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";

/**
 * CivicPlus / CivicEngage meeting source — tracker **D21**.
 *
 * The best-behaved source on the board: the municipality publishes iCal and
 * RSS feeds through its own website, so this is rung 2 of the ladder —
 * first-party, machine-readable, no vendor portal in the path. Both URL
 * patterns are CivicPlus-wide, so wiring another CivicPlus municipality is a
 * `SOURCE_WIRING` row, not code.
 *
 * The iCal category feed mixes civic events in with council sittings
 * (Rockaway's carries a yard sale and an open house alongside the council).
 * Only events whose SUMMARY matches the row's `summaryMatch` — the feed's own
 * published text — are this body's meetings; the rest count as
 * `notConfigured`, never silently vanish.
 */

const SOURCE_NAME = "civicplus";

export interface CivicPlusRaw {
  wiring: BodySourceWiring;
  ical: string;
  /**
   * The AgendaCenter page's HTML, when the row wires one (M59). Optional so a
   * CivicPlus municipality without an archive stays a wiring row and not a
   * code change.
   */
  agendaCenter?: string;
  collectedAt: string;
}

/** A sitting the AgendaCenter archives: a date, and documents filed under it. */
export interface ArchivedSitting {
  /** `YYYY-MM-DD`, from the document href's own `MMDDYYYY` token. */
  date: string;
  /** Site-relative hrefs, agenda first where both exist. */
  agendaHref: string | null;
}

/**
 * Sittings archived under one AgendaCenter category (M59, 2026-08-15).
 *
 * CivicPlus renders each category as `<div class="listing" id="cat<N>">` and
 * every document as `/AgendaCenter/ViewFile/<Agenda|Minutes>/_MMDDYYYY-<id>`.
 * The date is in the href, so this reads dates the township itself published
 * rather than parsing a display string that varies by template.
 *
 * **The category id is required and is not guessed.** Rockaway's page hosts
 * five bodies — Board of Adjustment, Planning Board, Environmental
 * Commission and two more — and taking every document on the page would file
 * the Planning Board's meetings under the Township Council. The id is the
 * value of the category's own filter checkbox, recorded on the wiring row.
 */
export function parseAgendaCenter(
  html: string,
  categoryId: string,
): ArchivedSitting[] {
  const block = new RegExp(
    `<div class="listing[^"]*" id="cat${categoryId}">([\\s\\S]*?)(?=<div class="listing|<\\/main|<footer)`,
  ).exec(html);
  if (!block) return [];

  const byDate = new Map<string, { agenda?: string; other?: string }>();
  for (const m of block[1].matchAll(
    /\/AgendaCenter\/ViewFile\/(Agenda|Minutes)\/_?(\d{2})(\d{2})(\d{4})-(\d+)/g,
  )) {
    const date = `${m[4]}-${m[2]}-${m[3]}`;
    const entry = byDate.get(date) ?? {};
    if (m[1] === "Agenda") entry.agenda = m[0];
    else entry.other = m[0];
    byDate.set(date, entry);
  }

  return [...byDate]
    .map(([date, hrefs]) => ({ date, agendaHref: hrefs.agenda ?? hrefs.other ?? null }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

interface IcalEvent {
  uid: string;
  summary: string;
  location: string;
  /** Wall-clock start: YYYYMMDDTHHMMSS, with the TZID it was published in. */
  dtstart: string;
  tzid: string | null;
}

/** Unfold RFC 5545 folded lines (CRLF followed by a space or tab). */
function unfoldIcal(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

export function parseIcalEvents(text: string): IcalEvent[] {
  const events: IcalEvent[] = [];
  let current: Partial<IcalEvent> | null = null;

  for (const line of unfoldIcal(text)) {
    if (line.startsWith("BEGIN:VEVENT")) {
      current = {};
      continue;
    }
    if (line.startsWith("END:VEVENT")) {
      if (current?.uid && current.summary && current.dtstart) {
        events.push({
          uid: current.uid,
          summary: current.summary,
          location: current.location ?? "",
          dtstart: current.dtstart,
          tzid: current.tzid ?? null,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const rawName = line.slice(0, colon);
    const value = line.slice(colon + 1).trim();
    const [name, ...params] = rawName.split(";");

    switch (name) {
      case "UID":
        current.uid = value;
        break;
      case "SUMMARY":
        current.summary = value;
        break;
      case "LOCATION":
        current.location = value;
        break;
      case "DTSTART": {
        current.dtstart = value;
        const tz = params.find((p) => p.startsWith("TZID="));
        current.tzid = tz ? tz.slice("TZID=".length) : null;
        break;
      }
    }
  }

  return events;
}

function statusOf(startsAt: string, now: Date): MeetingStatus {
  return Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

/**
 * Whether the feed is announcing a cancellation (2026-08-15).
 *
 * **CivicPlus cancels a meeting by editing the SUMMARY text**, not by setting
 * the iCal `STATUS` property — Rockaway's feed carries `"Board of Adjustment
 * Meeting Cancelled 8/18/26"` as a live VEVENT with a real DTSTART. A
 * `summaryMatch` prefix therefore matches it, and without this it would
 * render as a sitting that is going to happen. A canceled meeting is itself
 * news and is kept; it is just never allowed to say SCHEDULED.
 *
 * Both spellings, because the township uses the British one and the next
 * township will not.
 */
export function isCancelledSummary(summary: string): boolean {
  return /\bcancell?ed\b/i.test(summary);
}

/**
 * The venue string, with a notice block written into it removed (2026-08-15).
 *
 * The same cancellation the SUMMARY announces is also pasted into `LOCATION`
 * as an HTML paragraph in front of the address:
 *
 *   `<p>BOARD OF ADJUSTMENT MEETING CANCELLED AUGUST 18, 2026. …</p> -   Rockaway NJ 07866`
 *
 * The address after it is the same string every other sitting of that body
 * carries and resolves through the venue cache; without this, both canceled
 * sittings dropped as `unknownVenue`. This trims a notice the publisher put
 * in the wrong field — it never supplies a venue that was not published.
 */
export function locationWithoutNotice(location: string): string {
  const close = location.lastIndexOf("</p>");
  return close >= 0 ? location.slice(close + "</p>".length) : location;
}

export function makeCivicPlusSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<CivicPlusRaw> {
  const normalizeWithDrops = (
    raw: CivicPlusRaw[],
    now: Date = new Date(),
  ): { meetings: Meeting[]; drops: NormalizeDropCounts } => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };

    for (const { wiring, ical, agendaCenter, collectedAt } of raw) {
      const summaryMatch = wiring.config.summaryMatch ?? "";
      // The body's own published name, where the feed's SUMMARY is a sitting
      // label rather than a body ("Planning Board Meeting"). Read off the
      // township's own page and cited on the wiring row; never minted.
      const bodyName =
        wiring.config.bodyName || summaryMatch || wiring.publishingOrg;
      // Scoped to THIS row, not to the division. Three Rockaway bodies now
      // share one ocdId, and a set keyed on the division would let the
      // council's Tuesday suppress the planning board's Tuesday — a body's
      // meeting vanishing because a different body met the same day.
      const rowDates = new Set<string>();

      for (const event of parseIcalEvents(ical)) {
        if (summaryMatch && !event.summary.includes(summaryMatch)) {
          drops.notConfigured++;
          continue;
        }

        const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(event.dtstart);
        if (!m) {
          drops.unplaceableInTime++;
          continue;
        }
        const startsAt = toZonedIso(
          Number(m[1]),
          Number(m[2]),
          Number(m[3]),
          Number(m[4]),
          Number(m[5]),
          event.tzid ?? wiring.timeZone,
        );

        const eventLocation = locationWithoutNotice(event.location);
        /*
         * A meeting held online is KEPT (D18). No building means no
         * coordinates and no pin, but it is a real public meeting a reader
         * could attend, and dropping it applied the map's constraint to the
         * reader. The label is the published string verbatim; nothing here
         * publishes a join link, so joinUrl is null and renders as the gap
         * it is rather than as some other URL dressed up as a way in.
         */
        const online = isPlacelessLocation(eventLocation)
          ? { label: eventLocation, joinUrl: null }
          : null;
        if (online) drops.placeless++;
        const venue = online
          ? null
          : resolveVenue(SOURCE_NAME, wiring.ocdId, eventLocation);
        if (!online && !venue) {
          drops.unknownVenue++;
          continue;
        }

        rowDates.add(startsAt.slice(0, 10));

        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.slug}:${event.uid}`,
          ocdId: wiring.ocdId,
          bodyName,
          title: event.summary,
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
          // The feed carries no per-meeting agenda link; the RSS channel lists
          // agendas for other township boards only, as observed. Null is the
          // honest value — never a constructed AgendaCenter URL.
          agendaUrl: null,
          jurisdiction: wiring.jurisdiction,
          status: isCancelledSummary(event.summary)
            ? "CANCELED"
            : statusOf(startsAt, now),
          provenance: {
            sourceUrl: wiring.config.icalUrl,
            sourceOrg: wiring.publishingOrg,
            collectedAt,
            verifiedAt: null,
          },
        });
      }

      // ── M59: the AgendaCenter archive ────────────────────────────────────
      // The iCal category feed is upcoming-only — proven, not assumed: the
      // wired feed and the same feed with startDate/endDate and from/to
      // parameters all returned byte-identical bodies whose only past
      // DTSTARTs were VTIMEZONE boilerplate. The township's AgendaCenter does
      // archive the sittings, as dated agenda and minutes documents, and it
      // publishes no start time with them. Hence `startPrecision: "DAY"`
      // rather than the 7pm the regular meetings happen to use — a default
      // that would be right most of the time and wrong exactly when it
      // mattered, on the special sitting somebody wanted to attend.
      const categoryId = wiring.config.agendaCenterCategoryId;
      if (!agendaCenter || !categoryId) continue;

      const venue = soleVenueForBody(SOURCE_NAME, wiring.ocdId);
      const archiveUrl = `${wiring.config.agendaCenterUrl}`;

      for (const sitting of parseAgendaCenter(agendaCenter, categoryId)) {
        // The feed's own row for a date, with its real time, always wins —
        // for THIS body. `rowDates` is per wiring row, not per division.
        if (rowDates.has(sitting.date)) continue;
        if (!venue) {
          drops.unknownVenue++;
          continue;
        }

        const [y, m, d] = sitting.date.split("-").map(Number);
        // Local midnight: an ordering position, not a claim.
        const startsAt = toZonedIso(y, m, d, 0, 0, wiring.timeZone);

        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.slug}:archive:${sitting.date}`,
          ocdId: wiring.ocdId,
          bodyName,
          title: bodyName,
          startsAt,
          startPrecision: "DAY",
          timeZone: wiring.timeZone,
          location: {
            name: venue.name,
            address: venue.address,
            lat: venue.lat,
            lng: venue.lng,
          },
          agendaUrl: sitting.agendaHref
            ? new URL(sitting.agendaHref, archiveUrl).toString()
            : null,
          jurisdiction: wiring.jurisdiction,
          status:
            Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED",
          provenance: {
            sourceUrl: archiveUrl,
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

    async fetch(): Promise<CivicPlusRaw[]> {
      const collected: CivicPlusRaw[] = [];
      // Serialized across bodies, same as every adapter here.
      for (const wiring of wiringRows) {
        const { text } = await politeGetText(wiring.config.icalUrl, {
          fetchImpl,
          accept: "text/calendar",
        });
        // M59: one extra GET, only where a row wires an archive.
        let agendaCenter: string | undefined;
        if (wiring.config.agendaCenterUrl) {
          const archive = await politeGetText(wiring.config.agendaCenterUrl, {
            fetchImpl,
            accept: "text/html",
          });
          agendaCenter = archive.text;
        }
        collected.push({
          wiring,
          ical: text,
          agendaCenter,
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
      // No tables yet — lib/db/schema.ts is `export {}`. Same honest no-op as
      // the other adapters until Phase 5 persistence lands.
      return { inserted: 0, updated: meetings.length };
    },
  };
}
