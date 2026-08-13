import type { BodySourceWiring } from "../../registry/source-wiring.ts";
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
  collectedAt: string;
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

    for (const { wiring, ical, collectedAt } of raw) {
      const summaryMatch = wiring.config.summaryMatch ?? "";

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

        if (isPlacelessLocation(event.location)) {
          drops.placeless++;
          continue;
        }
        const venue = resolveVenue(SOURCE_NAME, wiring.ocdId, event.location);
        if (!venue) {
          drops.unknownVenue++;
          continue;
        }

        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.slug}:${event.uid}`,
          ocdId: wiring.ocdId,
          bodyName: summaryMatch || event.summary,
          title: event.summary,
          startsAt,
          timeZone: wiring.timeZone,
          location: {
            name: venue.name,
            address: venue.address,
            lat: venue.lat,
            lng: venue.lng,
          },
          // The feed carries no per-meeting agenda link; the RSS channel lists
          // agendas for other township boards only, as observed. Null is the
          // honest value — never a constructed AgendaCenter URL.
          agendaUrl: null,
          jurisdiction: wiring.jurisdiction,
          status: statusOf(startsAt, now),
          provenance: {
            sourceUrl: wiring.config.icalUrl,
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
        collected.push({
          wiring,
          ical: text,
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
