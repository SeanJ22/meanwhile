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
 * The Tucson City Clerk's boards application — tracker **D29**.
 *
 * `clerksboards.tucsonaz.gov/boards/?board=<id>` server-renders one page per
 * board, committee or commission with numbered sections the Clerk maintains:
 * the current agenda (title carries the meeting date, and "(Canceled)" when
 * it is), the meeting location as published, and the meeting schedule —
 * either the year's dates enumerated or an "Nth weekday of each month" rule.
 * Found as the embedded frame behind the directory at tucsonaz.gov, which
 * renders nothing to a plain client; the frame's own host serves everything.
 * (The main site's bot wall admits this project's identified User-Agent and
 * refuses anonymous crawlers — the polite UA is load-bearing here.)
 *
 * **Meeting instances come from the body's own published schedule.** The
 * schedule on this page is the Clerk's notice of when the body meets — the
 * same content as the statutory annual Public Notice Statement — so an
 * instance expanded from it is a sourced claim citing the page. A schedule
 * this parser cannot read produces zero instances and a counted drop, never
 * a guess; a location that is virtual-only is placeless and drops counted
 * (D18); a location the venue cache cannot cite drops counted.
 *
 * Cancellation is claimed only from the Clerk's own published signal: a
 * current-agenda title containing "(Canceled)" cancels exactly the instance
 * whose date the title names.
 */

const SOURCE_NAME = "clerksboards";

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

export interface ClerksBoardsRaw {
  wiring: BodySourceWiring;
  html: string;
  collectedAt: string;
}

/** One text segment of the page after tags become separators. */
function pageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, "|")
    .replace(/\|+/g, "|")
    .replace(/\s+/g, " ");
}

function section(text: string, label: string): string | null {
  const m = text.match(new RegExp(label + "\\|(?:\\s*\\|)*([^|]{2,})"));
  return m ? decodeEntities(m[1].trim()) : null;
}

export interface ParsedBoardPage {
  boardName: string | null;
  location: string | null;
  scheduleText: string | null;
  /** The current agenda link text and PDF URL, when one is posted. */
  agendaTitle: string | null;
  agendaPdfUrl: string | null;
}

export function parseBoardPage(html: string): ParsedBoardPage {
  const text = pageText(html);
  const name = text.match(/\|([^|]{3,110})\|(?:\s*\|)*1\) Documentation/);
  const pdf = html.match(
    /Current Agenda:[\s\S]{0,800}?href="\s*(https:\/\/assets[^"]*)"/,
  );
  return {
    boardName: name ? decodeEntities(name[1].trim()) : null,
    location: section(text, "4\\) Meeting Location"),
    scheduleText: section(text, "5\\) Meeting Time"),
    agendaTitle: section(text, "Current Agenda:"),
    agendaPdfUrl: pdf ? decodeEntities(pdf[1].trim()) : null,
  };
}

/** `@ 6:00 p.m.` / `; at 5:30 pm` → 24h parts, or null. */
function scheduleTime(text: string): { h: number; mi: number } | null {
  const m = /(?:@|\bat)\s*(\d{1,2}):(\d{2})\s*([ap])\.?\s*\.?m\b/i.exec(text);
  if (!m) return null;
  const raw = Number(m[1]);
  if (raw < 1 || raw > 12) return null;
  return {
    h: (raw % 12) + (m[3].toLowerCase() === "p" ? 12 : 0),
    mi: Number(m[2]),
  };
}

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** Calendar date of the Nth <weekday> of a month, as UTC parts. */
function nthWeekdayOf(year: number, month: number, weekday: number, nth: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= days ? { y: year, mo: month, d: day } : null;
}

export interface ScheduleInstance {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

/**
 * Expand the published schedule text into concrete dates.
 *
 * Two grammars the Clerk actually uses, nothing looser:
 *  A. Enumerated dates — `1/28, 2/25, …, 12/30/2026, 1/27/2027; @ 12:30 p.m.`
 *     A date without a year takes the year of the next entry that has one,
 *     which is how the page itself reads.
 *  B. Recurrence — `1st Wednesday of each month @ 8:00 a.m.` (also `; at`).
 *
 * Anything else — "Meets as required", "Quarterly", a novel format — returns
 * null so the caller counts the drop. Never guessed.
 */
export function expandSchedule(
  scheduleText: string,
  windowStart: Date,
  windowEnd: Date,
): ScheduleInstance[] | null {
  const time = scheduleTime(scheduleText);
  if (!time) return null;

  const inWindow = (inst: ScheduleInstance) => {
    const t = Date.UTC(inst.y, inst.mo - 1, inst.d);
    return t >= windowStart.getTime() - 86_400_000 && t <= windowEnd.getTime();
  };

  const recur = new RegExp(
    "(1st|2nd|3rd|4th|5th)\\s+(" + WEEKDAYS.join("|") + ")\\s+of\\s+each\\s+month",
    "i",
  ).exec(scheduleText);
  if (recur) {
    const nth = Number(recur[1][0]);
    const weekday = WEEKDAYS.indexOf(recur[2].toLowerCase());
    const out: ScheduleInstance[] = [];
    const cursor = new Date(windowStart);
    cursor.setUTCDate(1);
    for (let i = 0; i < 5; i++) {
      const inst = nthWeekdayOf(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth() + 1,
        weekday,
        nth,
      );
      if (inst && inWindow({ ...inst, ...time })) out.push({ ...inst, ...time });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return out;
  }

  // Grammar A: the datelist half is everything before the time marker.
  const dateHalf = scheduleText.split(/[;@]|\bat\b/i)[0];
  const entries = [
    ...dateHalf.matchAll(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g),
  ];
  if (entries.length === 0) return null;

  // Assign years right-to-left: an explicit year covers the entries before
  // it. The Clerk writes both `12/2/2026` and `12/18/26`.
  const dated: ScheduleInstance[] = [];
  let year: number | null = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const [, mo, d, y] = entries[i];
    if (y) year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
    if (year === null) return null; // a list with no year anywhere is unusable
    dated.unshift({ y: year, mo: Number(mo), d: Number(d), ...time });
  }
  return dated.filter(inWindow);
}

/** `08-12-26` or `08-12-2026` in an agenda title → date parts. */
function agendaTitleDate(
  title: string,
): { y: number; mo: number; d: number } | null {
  const m = /(\d{1,2})-(\d{1,2})-(\d{2,4})\b/.exec(title);
  if (!m) return null;
  const rawYear = Number(m[3]);
  return {
    y: rawYear < 100 ? 2000 + rawYear : rawYear,
    mo: Number(m[1]),
    d: Number(m[2]),
  };
}

function statusOf(startsAt: string, now: Date): MeetingStatus {
  return Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

export function makeClerksBoardsSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<ClerksBoardsRaw> {
  const normalizeWithDrops = (
    raw: ClerksBoardsRaw[],
    now: Date = new Date(),
  ): { meetings: Meeting[]; drops: NormalizeDropCounts } => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };

    const windowStart = new Date(now.getTime() - WINDOW_BACK_DAYS * 86_400_000);
    const windowEnd = new Date(now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000);

    for (const { wiring, html, collectedAt } of raw) {
      const page = parseBoardPage(html);
      const boardUrl = `https://clerksboards.tucsonaz.gov/boards/?board=${wiring.config.boardId}`;

      if (!page.scheduleText) {
        drops.unplaceableInTime++;
        continue;
      }
      const instances = expandSchedule(page.scheduleText, windowStart, windowEnd);
      if (instances === null) {
        // "Meets as required", or a format this parser does not know. One
        // counted drop stands in for the unknowable number of sittings.
        drops.unplaceableInTime++;
        continue;
      }

      const location = page.location?.trim() ?? "";
      if (!location) {
        drops.unknownVenue += instances.length;
        continue;
      }
      /*
       * A meeting held online is KEPT (D18). No building means no coordinates
       * and no pin, but it is a real public meeting a reader could attend.
       * Tucson's Clerk publishes "Microsoft Teams (Virtual)" for bodies that
       * meet this way and no join link beside it, so joinUrl is null and
       * renders as the gap it is.
       */
      const online = isPlacelessLocation(location)
        ? { label: location, joinUrl: null }
        : null;
      if (online) drops.placeless += instances.length;
      const venue = online ? null : resolveVenue(SOURCE_NAME, wiring.ocdId, location);
      if (!online && !venue) {
        drops.unknownVenue += instances.length;
        continue;
      }

      const canceled =
        page.agendaTitle && /canceled|cancelled/i.test(page.agendaTitle)
          ? agendaTitleDate(page.agendaTitle)
          : null;
      const agendaDate = page.agendaTitle ? agendaTitleDate(page.agendaTitle) : null;

      const bodyName = (page.boardName ?? wiring.jurisdiction).replace(
        /\s*\([^)]*\)\s*$/,
        "",
      );

      for (const inst of instances) {
        const startsAt = toZonedIso(
          inst.y,
          inst.mo,
          inst.d,
          inst.h,
          inst.mi,
          wiring.timeZone,
        );
        const sameDay = (d: { y: number; mo: number; d: number } | null) =>
          d !== null && d.y === inst.y && d.mo === inst.mo && d.d === inst.d;

        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.boardId}:${inst.y}-${String(inst.mo).padStart(2, "0")}-${String(inst.d).padStart(2, "0")}`,
          ocdId: wiring.ocdId,
          bodyName,
          title: bodyName,
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
          // The Clerk posts one current agenda; it belongs to the instance
          // whose date its title names, and to no other.
          agendaUrl:
            sameDay(agendaDate) && page.agendaPdfUrl ? page.agendaPdfUrl : null,
          jurisdiction: wiring.jurisdiction,
          status: sameDay(canceled) ? "CANCELED" : statusOf(startsAt, now),
          provenance: {
            sourceUrl: boardUrl,
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

    async fetch(): Promise<ClerksBoardsRaw[]> {
      const collected: ClerksBoardsRaw[] = [];
      for (const wiring of wiringRows) {
        const url = `https://clerksboards.tucsonaz.gov/boards/?board=${wiring.config.boardId}`;
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
