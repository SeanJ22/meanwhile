import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import {
  CONCLUDED_LOOKBACK_DAYS,
  UPCOMING_HORIZON_DAYS,
} from "../../meetings/constants.ts";
import { resolveVenue } from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { decodeEntities, politeGetText } from "../http.ts";
import type {
  Meeting,
  MeetingStatus,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";

/**
 * The published annual schedule — tracker **M78**, born 2026-08-15.
 *
 * Not a vendor. A *shape*: a body that publishes its whole year of meeting
 * dates as a list on one page, with a single sentence underneath naming the
 * time and the room —
 *
 *   Monday, January 26, 2026
 *   Monday, February 23, 2026
 *   …
 *   All meetings begin at 6:30 P.M. and are held in the Board of Education -
 *   Board Conference Room.
 *
 * This is how a very large number of American school boards publish, and no
 * portal is involved: it is the body's own page, ladder rung 2, and it is the
 * most reliable source there is for a district that runs no agenda vendor.
 * Morris Hills Regional (07866's high school district) is the first wired.
 *
 * **The time comes off the page, never from a default.** The sentence is
 * parsed; if the page does not carry one, the row ships `startPrecision:
 * "DAY"` and the card says the time was not posted (M59) rather than
 * inventing an hour that would be right most of the time and wrong exactly
 * on the special sitting somebody wanted to attend.
 *
 * Agendas and minutes are joined from a second page by the date in the link
 * text, where the row wires one. A sitting with no document keeps
 * `agendaUrl: null` — never a constructed URL.
 */

const SOURCE_NAME = "schedulepage";

const WINDOW_FORWARD_DAYS = UPCOMING_HORIZON_DAYS;
const WINDOW_BACK_DAYS = CONCLUDED_LOOKBACK_DAYS;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

export interface SchedulePageRaw {
  wiring: BodySourceWiring;
  /** The schedule page's HTML. */
  schedule: string;
  /** The documents page's HTML, where the row wires one. */
  documents?: string;
  collectedAt: string;
}

/** One sitting the schedule page publishes. */
export interface ScheduledSitting {
  /** `YYYY-MM-DD`, from the page's own date text. */
  date: string;
  /** The date as the page printed it — kept for the card's title. */
  printed: string;
  /** True when the page flags this row (an asterisk, "Reorg", "Special"). */
  note: string | null;
}

function stripMarkup(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, "\n"),
  );
}

/**
 * Every `Weekday, Month D, YYYY` the page publishes, deduplicated by date.
 *
 * Deliberately strict about the weekday prefix: a page carries dates in its
 * footer, its news teasers and its copyright line, and a bare "August 17,
 * 2026" anywhere on the page would become a meeting. The schedule list is
 * the only place a body writes the weekday out.
 */
export function parseSchedule(html: string): ScheduledSitting[] {
  const byDate = new Map<string, ScheduledSitting>();
  const text = stripMarkup(html);

  const re =
    /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})([^\n]*)/g;
  for (const m of text.matchAll(re)) {
    const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    if (month === 0) continue;
    const date = `${m[3]}-${String(month).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
    if (byDate.has(date)) continue;
    const trailing = m[4].trim();
    byDate.set(date, {
      date,
      printed: `${m[1]} ${Number(m[2])}, ${m[3]}`,
      note: trailing || null,
    });
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The start time the page states, as `{ hour, minute }`, or null.
 *
 * Null is a real answer and is why `startPrecision` exists: it means the body
 * published dates and not an hour, which NH's RSA 91-A:2 explicitly permits
 * and plenty of districts do anyway.
 */
export function parseStatedTime(
  html: string,
): { hour: number; minute: number } | null {
  const text = stripMarkup(html);
  const m =
    /\b(?:begin|start|convene)[a-z]*\s+at\s+(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s*[Mm]\.?/.exec(
      text,
    );
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const pm = m[3].toLowerCase() === "p";
  if (hour === 12) hour = 0;
  if (pm) hour += 12;
  return { hour, minute };
}

/**
 * Documents on a second page, keyed by the date in their own link text.
 *
 * The link text is what the body wrote ("August 17, 2026 - Regular Meeting"),
 * so the date is published rather than derived from a filename that may or
 * may not be the meeting's date.
 */
export function parseDocuments(html: string): Map<string, string> {
  const byDate = new Map<string, string>();
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]{0,160}?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const label = decodeEntities(m[2].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    const d = /([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/.exec(label);
    if (!d) continue;
    const month = MONTHS.indexOf(d[1].toLowerCase()) + 1;
    if (month === 0) continue;
    const date = `${d[3]}-${String(month).padStart(2, "0")}-${String(Number(d[2])).padStart(2, "0")}`;
    // First wins: the page lists agendas above minutes, and an agenda is the
    // document a reader wants before a meeting they can still attend.
    if (!byDate.has(date)) byDate.set(date, m[1]);
  }
  return byDate;
}

function statusOf(startsAt: string, now: Date): MeetingStatus {
  return Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

export function makeSchedulePageSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<SchedulePageRaw> {
  const normalizeWithDrops = (
    raw: SchedulePageRaw[],
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

    for (const { wiring, schedule, documents, collectedAt } of raw) {
      const stated = parseStatedTime(schedule);
      const venueMatch = wiring.config.venueMatch ?? "";
      const venue = resolveVenue(SOURCE_NAME, wiring.ocdId, venueMatch);
      const docs = documents ? parseDocuments(documents) : new Map();
      const bodyName = wiring.config.bodyName ?? wiring.publishingOrg;

      for (const sitting of parseSchedule(schedule)) {
        const [y, mo, d] = sitting.date.split("-").map(Number);
        // With no stated time, local midnight is an ORDERING position and
        // never a claim — the same shape M59 gave the day-only archives.
        const startsAt = toZonedIso(
          y,
          mo,
          d,
          stated?.hour ?? 0,
          stated?.minute ?? 0,
          wiring.timeZone,
        );
        const t = Date.parse(startsAt);
        if (t < windowStart || t > windowEnd) continue;

        if (!venue) {
          drops.unknownVenue += 1;
          continue;
        }

        const href = docs.get(sitting.date) ?? null;
        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.slug}:${sitting.date}`,
          ocdId: wiring.ocdId,
          bodyName,
          title: bodyName,
          startsAt,
          ...(stated ? {} : { startPrecision: "DAY" as const }),
          timeZone: wiring.timeZone,
          location: {
            name: venue.name,
            address: venue.address,
            lat: venue.lat,
            lng: venue.lng,
          },
          agendaUrl: href
            ? new URL(href, wiring.config.documentsPage ?? wiring.config.schedulePage).toString()
            : null,
          jurisdiction: wiring.jurisdiction,
          status: statusOf(startsAt, now),
          provenance: {
            sourceUrl: wiring.config.schedulePage,
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

    async fetch(): Promise<SchedulePageRaw[]> {
      const collected: SchedulePageRaw[] = [];
      // Serialized across bodies, same as every adapter here.
      for (const wiring of wiringRows) {
        const { text } = await politeGetText(wiring.config.schedulePage, {
          fetchImpl,
          accept: "text/html",
        });
        let documents: string | undefined;
        if (wiring.config.documentsPage) {
          const page = await politeGetText(wiring.config.documentsPage, {
            fetchImpl,
            accept: "text/html",
          });
          documents = page.text;
        }
        collected.push({
          wiring,
          schedule: text,
          documents,
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
