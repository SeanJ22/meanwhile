/**
 * @freshness-reads-here
 *
 * The clock stamps in this file are minted by the code path that performs the read: the freshness date
 * is taken at the moment of the fetch.
 */
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import {
  isPlacelessLocation,
  resolveVenue,
  soleVenueForBody,
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
 * CivicPlus / CivicEngage meeting source: the municipality's own iCal and RSS feeds, first-party and
 * machine-readable. Both URL patterns are CivicPlus-wide, so another CivicPlus municipality is a
 * meeting door, not code. The iCal category feed mixes civic events with sittings; only events
 * whose SUMMARY matches the row's `summaryMatch` are this body's meetings, and the rest count as
 * `notConfigured`.
 */

const SOURCE_NAME = "civicplus";

export interface CivicPlusRaw {
  wiring: BodySourceWiring;
  ical: string;
  /** The AgendaCenter page's HTML, when the row wires one. */
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
 * Sittings archived under one AgendaCenter category. CivicPlus renders each category as
 * `<div class="listing" id="cat<N>">` and every document as
 * `/AgendaCenter/ViewFile/<Agenda|Minutes>/_MMDDYYYY-<id>`; the date is read from the href. The category
 * id is required and never guessed: one page hosts several bodies.
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
 * Whether the feed is announcing a cancellation. CivicPlus cancels by editing the SUMMARY text, not by
 * setting iCal `STATUS`, so a `summaryMatch` prefix still matches it. A cancelled meeting is kept; it
 * never says SCHEDULED. Both spellings are accepted.
 */
export function isCancelledSummary(summary: string): boolean {
  return /\bcancell?ed\b/i.test(summary);
}

/**
 * The venue string, with a cancellation notice the publisher pasted into `LOCATION` removed. Never
 * supplies a venue that was not published.
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
  ): Accounted<{ meetings: Meeting[]; drops: NormalizeDropCounts }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };

    // A-002 · counted in the unit the disposition happens in. One raw row is
    // one town's feed plus its archive page, and both expand into many events.
    let considered = 0;
    let duplicates = 0;
    let keptButPlaceless = 0;

    for (const { wiring, ical, agendaCenter, collectedAt } of raw) {
      const summaryMatch = wiring.config.summaryMatch ?? "";
      // The body's own published name, where the feed's SUMMARY is a sitting
      // label rather than a body ("Planning Board Meeting"). Read off the
      // township's own page and cited on the wiring row; never minted.
      const bodyName =
        wiring.config.bodyName || summaryMatch || wiring.publishingOrg;
      // Scoped to this row, not the division: several bodies can share one ocdId, and one body's sitting must
      // not suppress another's on the same day.
      const rowDates = new Map<string, Meeting[]>();

      for (const event of parseIcalEvents(ical)) {
        considered += 1;
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
        // A meeting held online is kept: no building means no pin, but it is a real public meeting. The label is
        // the published string verbatim; no join link is published, so `joinUrl` is null.
        const online = isPlacelessLocation(eventLocation)
          ? { label: eventLocation, joinUrl: null }
          : null;
        if (online) {
          drops.placeless++;
          // A-002: this TALLIES a meeting that is then PRODUCED below (D18),
          // so it is not a drop and must not be summed as one.
          keptButPlaceless += 1;
        }
        const venue = online
          ? null
          : resolveVenue(SOURCE_NAME, wiring.ocdId, eventLocation) ?? null;
        // No reviewed venue never suppresses the sitting: it is published with no pin and its gap named (the
        // feed's `LOCATION` verbatim, or its silence), counted as `unknownVenue`.
        const venueGap = !online && !venue ? unplacedVenueGap(eventLocation, wiring.publishingOrg) : null;
        if (venueGap) {
          drops.unknownVenue++;
          keptButPlaceless += 1;
        }

        const feedDay = startsAt.slice(0, 10);

        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.slug}:${event.uid}`,
          ocdId: wiring.ocdId,
          /* NH-RC4: the body, from the wiring row that produced this meeting. */
          bodyId: wiring.bodyId,
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
          ...(venueGap ? { venueGap } : {}),
          // The feed carries no per-meeting agenda link; never a constructed AgendaCenter URL. The archive's own
          // link for the same date is attached below.
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
        rowDates.set(feedDay, [...(rowDates.get(feedDay) ?? []), meetings[meetings.length - 1]!]);
      }

      // The AgendaCenter archive. The iCal feed is upcoming-only; the archive lists past sittings as dated
      // agenda and minutes documents with no start time, hence `startPrecision: "DAY"`.
      const categoryId = wiring.config.agendaCenterCategoryId;
      if (!agendaCenter || !categoryId) continue;

      const venue = soleVenueForBody(SOURCE_NAME, wiring.ocdId);
      const archiveUrl = `${wiring.config.agendaCenterUrl}`;

      for (const sitting of parseAgendaCenter(agendaCenter, categoryId)) {
        considered += 1;
        // The feed's own row for a date, with its real time, always wins —
        // for THIS body. `rowDates` is per wiring row, not per division.
        const feedRows = rowDates.get(sitting.date);
        if (feedRows) {
          // A-002: the feed already produced this sitting; the archive row is
          // the same logical record arriving a second way.
          duplicates += 1;
          // The archive row is the only representation carrying the agenda: the feed row keeps its real time and
          // gains the archive's link.
          if (sitting.agendaHref) {
            const agendaUrl = new URL(sitting.agendaHref, archiveUrl).toString();
            for (const row of feedRows) if (row.agendaUrl === null) row.agendaUrl = agendaUrl;
          }
          continue;
        }
        if (!venue) {
          // The archive states no place for any sitting and this body has no one reviewed venue, so the sitting is
          // published with our own place-not-recorded gap, counted as `unknownVenue`.
          drops.unknownVenue++;
          keptButPlaceless += 1;
        }

        const [y, m, d] = sitting.date.split("-").map(Number);
        // Local midnight: an ordering position, not a claim.
        const startsAt = toZonedIso(y, m, d, 0, 0, wiring.timeZone);

        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.slug}:archive:${sitting.date}`,
          ocdId: wiring.ocdId,
          /* NH-RC4: the body, from the wiring row that produced this meeting. */
          bodyId: wiring.bodyId,
          bodyName,
          title: bodyName,
          startsAt,
          startPrecision: "DAY",
          timeZone: wiring.timeZone,
          location: venue
            ? {
                name: venue.name,
                address: venue.address,
                lat: venue.lat,
                lng: venue.lng,
              }
            : null,
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

    return accountedNormalize(
      SOURCE_NAME,
      raw,
      { meetings, drops },
      { logicalInput: considered, duplicates, countedButProduced: keptButPlaceless },
    );
  };

  return {
    name: SOURCE_NAME,

    // The AgendaCenter rung emits every dated sitting the archive lists and clips nothing, so this source's
    // lookback is the publisher's, not the app's serving window; carry-forward must judge its rows that
    // way.
    publishedLookbackDays: null,

    async fetch(query?: MeetingQuery): Promise<CivicPlusRaw[]> {
      const collected: CivicPlusRaw[] = [];
      // Serialized across bodies, same as every adapter here.
      for (const wiring of wiringRows) {
        const { text } = await politeGetText(wiring.config.icalUrl, {
          fetchImpl,
          accept: "text/calendar",
          signal: query?.signal,
        });
        // M59: one extra GET, only where a row wires an archive.
        let agendaCenter: string | undefined;
        if (wiring.config.agendaCenterUrl) {
          const archive = await politeGetText(wiring.config.agendaCenterUrl, {
            fetchImpl,
            accept: "text/html",
            signal: query?.signal,
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
