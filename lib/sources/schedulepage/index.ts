/**
 * @freshness-reads-here — the freshness date is taken at the moment of the
 * fetch, by the code path that performs the read.
 */
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import {
  MEETING_HELD_HORIZON_DAYS,
  MEETING_HELD_LOOKBACK_DAYS,
} from "../../meetings/constants.ts";
import { resolveVenue, unplacedVenueGap } from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { decodeEntities, politeGetText } from "../http.ts";
import {
  DESTINY_AHEAD_DAYS,
  destinyMonthUrl,
  destinyMonthsBetween,
  joinDestinyRows,
  parseDestinyMonth,
  type DestinyMonth,
} from "./destiny-agenda.ts";
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
 * The body's own page: not a vendor but a family of shapes, for a body that
 * publishes its own sittings on its own site with no portal in the path.
 *
 * 1. `weekday-list` — the whole year as `Monday, January 26, 2026` lines with
 *    one sentence underneath naming the time and the room.
 * 2. `month-table` — a two-column table, month in the left cell (carrying the
 *    year), one sitting per row in the right cell with its own words beside
 *    the date: `Apr 2 Staff Nominations`, `September 10 - Budget
 *    Presentations`.
 * 3. `dated-list` — a plain dated list with per-row times, `August 11, 2026 -
 *    6:00pm`, and a sentence naming the venue.
 * 4. `agenda-list` — the document listing *is* the schedule: one row per
 *    sitting, each carrying a machine-readable `dc:date` and a link to that
 *    sitting's agenda or minutes.
 *
 * A row may declare more than one shape (`shapes: "dated-list,agenda-list"`);
 * the sittings are unioned by date, a stated time beats a date-only row, and
 * a document link is carried across from whichever shape found it.
 *
 * The time comes off the page, never from a default: a page that dates a
 * sitting without timing it ships `startPrecision: "DAY"`.
 *
 * Every row is read as the project's own identity (`lib/sources/http.ts`):
 * Node's client first, then the same name through `curl`. A refusal of that is
 * a wall; access controls are never bypassed.
 */

const SOURCE_NAME = "schedulepage";

const WINDOW_FORWARD_DAYS = MEETING_HELD_HORIZON_DAYS;
const WINDOW_BACK_DAYS = MEETING_HELD_LOOKBACK_DAYS;

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

/** `Apr` and `Sept` as well as `April` and `September`. */
function monthIndex(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, "");
  const exact = MONTHS.indexOf(w);
  if (exact >= 0) return exact + 1;
  if (w.length < 3) return 0;
  const prefixed = MONTHS.findIndex((m) => m.startsWith(w));
  return prefixed >= 0 ? prefixed + 1 : 0;
}

/**
 * Rows a schedule page carries that are not sittings of the body (filing
 * deadlines, an election day) written in exactly a meeting row's shape. They
 * are dropped and counted.
 */
const NOT_A_SITTING = /\blast day\b|\belection day\b|\bdeadline\b|\bpolls? open\b/i;

/** The body itself says so, in its own link text or row text. */
const CANCELED = /\bcancell?ed\b/i;

export type ScheduleShape =
  | "weekday-list"
  | "month-table"
  | "dated-list"
  | "agenda-list"
  /**
   * A MONTH GRID whose every event carries its own full date and time in a
   * tooltip block:
   *
   * ```html
   * <div class="eventTip">
   *   <div class="tipTitle">Board of Selectmen - 5:30 PM - Town Hall</div>
   *   Thursday, August 20, 2026 at 5:30 PM
   * </div>
   * ```
   *
   * It is one town-wide calendar, so a row must carry `titleMatch` naming the
   * body. It serves ONE MONTH; `monthsAhead` on the row walks the `&month=&year=`
   * navigation and the count is stated per run.
   */
  | "event-tip"
  /**
   * A body's own RSS feed of public notices: one item per sitting, whose text
   * states the day, the time and the room. The feed also carries programs and
   * job posts, so a row must carry `titleMatch`.
   */
  | "notice-feed"
  /**
   * A body's own "Next Meeting Date:" line, e.g. "Next Meeting Date: (tentative
   * date) October 21, 2026 4pm Town Offices Meeting Room". One sitting per read.
   */
  | "next-meeting-line";

export interface SchedulePageRaw {
  wiring: BodySourceWiring;
  /** The schedule page's HTML. */
  schedule: string;
  /**
   * The publisher's own day files for the scheduled dates inside the serving window (`dayJson` on the row):
   * one request per scheduled date, never a daily crawl. A date whose file was not read is absent here, and
   * its sitting stays date-only.
   */
  days?: readonly { readonly date: string; readonly url: string; readonly json: string }[];
  /** The documents page's HTML, where the row wires one. */
  documents?: string;
  /**
   * The body's Destiny Agenda month lists (`destinyAgenda` on the row), keyed `YYYY-MM`. A month not read is
   * absent, and its sittings carry no document links; they are never unpublished for it.
   */
  destiny?: readonly { readonly month: string; readonly url: string; readonly html: string }[];
  collectedAt: string;
  /**
   * This ROW's retrieval was refused, and `schedule` is empty. The other rows
   * still ship, and the failure is carried to the snapshot so the reader is
   * told which bodies we could not reach.
   */
  error?: string;
}

/** One sitting a page publishes, in whatever shape it published it. */
export interface ScheduledSitting {
  /** `YYYY-MM-DD`, from the page's own date text. */
  date: string;
  /** The date as the page printed it — kept for the card's title. */
  printed: string;
  /** The body's own words beside the date, where it wrote any. */
  note: string | null;
  /** The row's own stated start time. Null means the page did not state one. */
  time: { hour: number; minute: number } | null;
  /** The document this row links, as published (may be relative). */
  href: string | null;
  /** The page says this sitting was called off. */
  canceled: boolean;
  /** The room the row itself names, in its own words, where it names one. */
  place?: string | null;
}

/** What a shape parser saw and could not turn into a sitting. */
export interface ParseCounts {
  /** Rows the page carried that are not sittings of this body. */
  notSittings: number;
  /** Rows with text this parser could not date. */
  undated: number;
}

function stripMarkup(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, "\n"),
  );
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The element carrying `className`, with its nesting respected, so a dated-list
 * parser scoped to the body's own block never reads a news teaser's or a
 * document's date as a meeting.
 */
export function sliceSection(html: string, className: string): string {
  const at = html.indexOf(className);
  if (at < 0) return "";
  const open = html.lastIndexOf("<", at);
  const tag = /^<([a-z]+)/i.exec(html.slice(open))?.[1];
  if (!tag) return "";

  const openRe = new RegExp(`<${tag}\\b`, "gi");
  const closeRe = new RegExp(`</${tag}>`, "gi");
  openRe.lastIndex = open + 1;
  closeRe.lastIndex = open + 1;

  let depth = 1;
  let cursor = open + 1;
  while (depth > 0) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return html.slice(open);
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + 1;
      continue;
    }
    depth -= 1;
    cursor = nextClose.index + 1;
    if (depth === 0) return html.slice(open, nextClose.index + nextClose[0].length);
  }
  return html.slice(open);
}

/** `6:30 P.M.` / `7:00pm` / `9:00 AM`, wherever a row states one. */
export function parseClockTime(
  text: string,
): { hour: number; minute: number } | null {
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s*[Mm]\.?/.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  if (hour < 1 || hour > 12) return null;
  const minute = m[2] ? Number(m[2]) : 0;
  const pm = m[3].toLowerCase() === "p";
  if (hour === 12) hour = 0;
  if (pm) hour += 12;
  return { hour, minute };
}

/**
 * The start time the page states for every sitting, as `{ hour, minute }`, or
 * null when the body published dates and no hour.
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

function emptySitting(date: string, printed: string): ScheduledSitting {
  return { date, printed, note: null, time: null, href: null, canceled: false };
}

/**
 * Shape 1 — every `Weekday, Month D, YYYY` the page publishes. Strict about the
 * weekday prefix, because a bare date also appears in footers and teasers.
 */
export function parseSchedule(html: string): ScheduledSitting[] {
  const byDate = new Map<string, ScheduledSitting>();
  const text = stripMarkup(html);

  const re =
    /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})([^\n]*)/g;
  for (const m of text.matchAll(re)) {
    const month = monthIndex(m[1]);
    if (month === 0) continue;
    const date = `${m[3]}-${String(month).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
    if (byDate.has(date)) continue;
    const trailing = m[4].trim();
    byDate.set(date, {
      ...emptySitting(date, `${m[1]} ${Number(m[2])}, ${m[3]}`),
      note: trailing || null,
    });
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Shape 2 — the two-column month table. The left cell carries the month and,
 * on the row that opens a year, the year (`April, 2026`, then bare `May`…). A
 * cell that states a year sets it; a month whose ordinal goes backwards
 * without one rolls it forward.
 */
export function parseMonthTable(html: string): {
  sittings: ScheduledSitting[];
  counts: ParseCounts;
} {
  const byDate = new Map<string, ScheduledSitting>();
  const counts: ParseCounts = { notSittings: 0, undated: 0 };

  const table = /<table[\s\S]*?<\/table>/i.exec(html)?.[0] ?? "";
  let year: number | null = null;
  let prevMonth: number | null = null;

  for (const row of table.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    // The header row is not a sitting it failed to date; it is not counted.
    if (/<th\b/i.test(row[0])) continue;
    const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      cellText(c[1]),
    );
    if (cells.length < 2) continue;

    const stated = /\b(20\d{2})\b/.exec(cells[0]);
    if (stated) {
      year = Number(stated[1]);
      prevMonth = null;
    }

    const text = cells[1];
    if (!text) continue;
    if (NOT_A_SITTING.test(text)) {
      counts.notSittings += 1;
      continue;
    }

    const dated = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})\b(.*)$/.exec(text);
    if (!dated) {
      counts.undated += 1;
      continue;
    }
    const month = monthIndex(dated[1]);
    if (month === 0 || year === null) {
      counts.undated += 1;
      continue;
    }
    if (prevMonth !== null && month < prevMonth) year += 1;
    prevMonth = month;

    const day = Number(dated[2]);
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (byDate.has(date)) continue;
    const note = dated[3].trim() || null;
    byDate.set(date, {
      ...emptySitting(date, `${dated[1]} ${day}, ${year}`),
      note,
      time: note ? parseClockTime(note) : null,
      canceled: CANCELED.test(text),
    });
  }

  return {
    sittings: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    counts,
  };
}

/**
 * Shape 3 — a plain dated list, `August 11, 2026 - 6:00pm`, one per line,
 * scoped to a section by the caller (`sectionMatch`). Pages put two dates in
 * one paragraph and drop the space after a comma, so the scan is per match,
 * not per line.
 */
export function parseDatedList(html: string): {
  sittings: ScheduledSitting[];
  counts: ParseCounts;
} {
  const byDate = new Map<string, ScheduledSitting>();
  const counts: ParseCounts = { notSittings: 0, undated: 0 };
  const text = stripMarkup(html).replace(/\s+/g, " ");

  const re = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})\s*(?:[-–—]\s*)?([^A-Za-z]*[apAP]\.?[mM]\.?)?/g;
  for (const m of text.matchAll(re)) {
    const month = monthIndex(m[1]);
    if (month === 0) continue;
    const day = Number(m[2]);
    if (day < 1 || day > 31) continue;
    const date = `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (NOT_A_SITTING.test(tail) || NOT_A_SITTING.test(m[0])) {
      counts.notSittings += 1;
      continue;
    }
    if (byDate.has(date)) continue;
    byDate.set(date, {
      ...emptySitting(date, `${m[1]} ${day}, ${m[3]}`),
      time: m[4] ? parseClockTime(m[4]) : null,
    });
  }

  return {
    sittings: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    counts,
  };
}

/**
 * Shape 5 — a month grid whose every event states its own date and time:
 *
 * ```html
 * <div class="eventTip">
 *   <div class="tipTitle">Board of Selectmen - 5:30 PM - Town Hall</div>
 *   Thursday, August 20, 2026 at 5:30 PM
 * </div>
 * ```
 *
 * The grid never has to be understood: each event is self-describing.
 *
 * `titleMatch` is REQUIRED: it is the whole town's calendar, so without it a
 * concert becomes a sitting of the Planning Board. Rows whose title does not
 * carry the match are counted as `notSittings`. It is a comma-separated list of
 * the body's own spellings, compared with apostrophes set aside on both sides.
 */
export function parseEventTips(
  html: string,
  titleMatch: string,
): { sittings: ScheduledSitting[]; counts: ParseCounts } {
  const byDate = new Map<string, ScheduledSitting>();
  const counts: ParseCounts = { notSittings: 0, undated: 0 };
  const fold = (value: string) => value.toLowerCase().replace(/['’‘`]/g, "");
  const needles = titleMatch.split(",").map((t) => fold(t.trim())).filter(Boolean);
  if (needles.length === 0) return { sittings: [], counts };

  const blocks = html.matchAll(
    /<div class="tipTitle">([\s\S]*?)<\/div>([\s\S]*?)<\/div>/g,
  );

  for (const block of blocks) {
    const title = cellText(block[1]);
    const when = cellText(block[2]);
    const folded = fold(title);
    if (!needles.some((needle) => folded.includes(needle))) {
      counts.notSittings += 1;
      continue;
    }
    if (NOT_A_SITTING.test(title)) {
      counts.notSittings += 1;
      continue;
    }

    // `Thursday, August 20, 2026 at 5:30 PM` — the weekday is decoration and
    // the year is on the line, so nothing has to be carried from the grid.
    const m =
      /([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})(?:\s+at\s+([0-9:]+\s*[APap]\.?[Mm]\.?))?/.exec(
        when,
      );
    if (!m) {
      counts.undated += 1;
      continue;
    }
    const month = monthIndex(m[1]);
    const day = Number(m[2]);
    if (month === 0 || day < 1 || day > 31) {
      counts.undated += 1;
      continue;
    }
    const date = `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (byDate.has(date)) continue;

    byDate.set(date, {
      ...emptySitting(date, `${m[1]} ${day}, ${m[3]}`),
      note: title,
      time: m[4] ? parseClockTime(m[4]) : null,
      canceled: CANCELED.test(title),
    });
  }

  return {
    sittings: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    counts,
  };
}

/** One sitting a publisher's day file states, with its own start and place. */
export interface DaySitting {
  /** The publisher's own id for the event. */
  readonly nid: string;
  readonly title: string;
  readonly time: { hour: number; minute: number } | null;
  /** The street address as printed; null when the file states none. */
  readonly address: string | null;
  /** The event's own page on the publisher's host. */
  readonly pageUrl: string | null;
}

/**
 * A Drupal calendar's day file (`/rest/events/day/YYYYMMDD`): every event the city posted for that day, each
 * with its own start (`date_event`, e.g. `202609146:00pm`), its title as a link to its own page, and its street
 * address. It is the city's whole calendar, so `titleMatch` is required. An item whose `date_event` does not
 * name the day asked for is counted, never moved to another day.
 */
export function parseDayEvents(
  json: string,
  date: string,
  titleMatch: string,
  origin: string,
): { sittings: DaySitting[]; counts: ParseCounts } {
  const counts: ParseCounts = { notSittings: 0, undated: 0 };
  if (!titleMatch) return { sittings: [], counts };
  let items: unknown;
  try {
    items = JSON.parse(json);
  } catch {
    return { sittings: [], counts };
  }
  if (!Array.isArray(items)) return { sittings: [], counts };
  const needle = titleMatch.toLowerCase();
  const day = date.replace(/-/g, "");
  const sittings: DaySitting[] = [];
  for (const raw of items) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const titleHtml = typeof item.title === "string" ? item.title : "";
    const title = cellText(titleHtml);
    if (!title.toLowerCase().includes(needle) || NOT_A_SITTING.test(title)) {
      counts.notSittings += 1;
      continue;
    }
    const when = /^(\d{8})(\d{1,2}):(\d{2})\s*([ap])m$/i.exec(typeof item.date_event === "string" ? item.date_event.trim() : "");
    if (!when || when[1] !== day) {
      counts.undated += 1;
      continue;
    }
    let hour = Number(when[2]);
    if (hour === 12) hour = 0;
    if (when[4].toLowerCase() === "p") hour += 12;
    const href = /href="([^"]+)"/.exec(titleHtml)?.[1] ?? null;
    const address = typeof item.field_address_address_line1 === "string" ? cellText(item.field_address_address_line1) : "";
    sittings.push({
      nid: typeof item.nid === "string" || typeof item.nid === "number" ? String(item.nid) : title,
      title,
      time: { hour, minute: Number(when[3]) },
      address: address === "" ? null : address,
      pageUrl: href === null ? null : new URL(href, origin).toString(),
    });
  }
  return { sittings: sittings.sort((a, b) => (a.time!.hour * 60 + a.time!.minute) - (b.time!.hour * 60 + b.time!.minute) || a.nid.localeCompare(b.nid)), counts };
}

/**
 * Which of a day's sittings is the one the schedule table names: the Regular Meeting, else the Study Session,
 * else the day's first. It keeps the date's own meeting id, so a date the table published before the city
 * posted its events gains its time and place rather than a second sitting.
 */
export function scheduledOfDay(sittings: readonly DaySitting[]): DaySitting | null {
  return sittings.find((x) => /\bregular meeting\b/i.test(x.title)) ?? sittings.find((x) => /\bstudy session\b/i.test(x.title)) ?? sittings[0] ?? null;
}

/**
 * Shape 4 — the document listing *is* the schedule.
 *
 * A Drupal site publishes one row per sitting carrying a machine-readable
 * `<span property="dc:date" content="2026-08-18T19:00:00-04:00">` and, just
 * ahead of it, the link to that sitting's agenda, minutes or event page. No
 * time is ever inferred: the offset-bearing timestamp is the town's own.
 *
 * `pathPrefix` binds the rows to **one board**. The town's page templates put
 * every board's blocks in the same markup, and a prefix-free parser would file
 * the Zoning Board's Thursday under the Planning Board.
 *
 * A row timed at exactly local midnight is the town dating a document without
 * timing the sitting — that ships `DAY` precision. Where a board
 * publishes both an agenda and minutes for one date, the agenda wins: it is
 * the document a reader wants before a meeting they can still attend.
 */
export function parseAgendaList(
  html: string,
  pathPrefix: string,
): { sittings: ScheduledSitting[]; counts: ParseCounts } {
  const byDate = new Map<string, { sitting: ScheduledSitting; rank: number }>();
  const counts: ParseCounts = { notSittings: 0, undated: 0 };

  for (const m of html.matchAll(
    /property="dc:date"[^>]*content="([^"]+)"/gi,
  )) {
    const iso = m[1];
    const parsed = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso);
    if (!parsed) {
      counts.undated += 1;
      continue;
    }

    const before = html.slice(Math.max(0, m.index - 900), m.index);
    const links = [...before.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]{0,160}?)<\/a>/gi)];
    const link = links[links.length - 1];
    const href = link?.[1] ?? "";
    if (!href.startsWith(pathPrefix)) {
      counts.notSittings += 1;
      continue;
    }
    const label = link ? cellText(link[2]) : "";

    const hour = Number(parsed[2]);
    const minute = Number(parsed[3]);
    const midnight = hour === 0 && minute === 0;
    // Agenda beats event page beats minutes, for the same date.
    const rank = href.includes("/agenda/") ? 3 : href.includes("/minutes/") ? 1 : 2;

    const existing = byDate.get(parsed[1]);
    if (existing && existing.rank >= rank) continue;
    byDate.set(parsed[1], {
      rank,
      sitting: {
        date: parsed[1],
        printed: parsed[1],
        // The link's text names the DOCUMENT, not the sitting, so it never
        // titles the card. It is read only for a cancellation the body writes
        // into it ("April Meeting is Cancelled").
        note: null,
        time: midnight ? null : { hour, minute },
        href,
        canceled: CANCELED.test(label),
      },
    });
  }

  return {
    sittings: [...byDate.values()]
      .map((v) => v.sitting)
      .sort((a, b) => a.date.localeCompare(b.date)),
    counts,
  };
}

/**
 * Documents on a second page, keyed by the date in their own link text
 * ("August 17, 2026 - Regular Meeting"), never by a filename.
 */
export function parseDocuments(html: string): Map<string, string> {
  const byDate = new Map<string, string>();
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]{0,160}?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const label = cellText(m[2]);
    const d = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s+(\d{4})/.exec(label);
    if (!d) continue;
    const month = monthIndex(d[1]);
    if (month === 0) continue;
    const date = `${d[3]}-${String(month).padStart(2, "0")}-${String(Number(d[2])).padStart(2, "0")}`;
    // First wins: the page lists agendas above minutes, and an agenda is the
    // document a reader wants before a meeting they can still attend.
    if (!byDate.has(date)) byDate.set(date, m[1]);
  }
  return byDate;
}

const WEEKDAY = String.raw`(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day`;

/** "on Tuesday September 8th, 5pm at the Public Library" and its kin. */
const NOTICE_SITTING = new RegExp(
  String.raw`\bon\s+(?:${WEEKDAY},?\s+)?([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\s*,?\s*(?:at\s+)?(\d{1,2}(?::\d{2})?\s*[AaPp]\.?\s*[Mm]\.?)?(?:\s+at\s+(?:the\s+)?([^.<]{3,80}))?`,
  "i",
);

/** "Next Meeting Date: (tentative date) October 21, 2026 4pm Town Offices Meeting Room". */
const NEXT_MEETING_LINE = new RegExp(
  String.raw`\bNext Meeting(?: Date)?\s*:\s*(\([^)]{1,40}\))?\s*(?:${WEEKDAY},?\s+)?([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})\s*(?:at\s+)?(\d{1,2}(?::\d{2})?\s*[AaPp]\.?\s*[Mm]\.?)?\s*([^.|<]{0,60})?`,
  "i",
);

/** One RSS field's text, CDATA unwrapped and markup stripped. */
function feedField(item: string, name: string): string {
  const inner = new RegExp(String.raw`<${name}\b[^>]*>([\s\S]*?)<\/${name}>`, "i").exec(item)?.[1] ?? "";
  return cellText(inner.replace(/<!\[CDATA\[|\]\]>/g, ""));
}

/**
 * Shape 6 — a body's own feed of public notices. An item is a sitting only when
 * its title or text carries `titleMatch` AND its text states a day ("on Tuesday
 * September 8th, 5pm"); every other item is counted as `notSittings`. A notice
 * that names a day but no year takes the year that puts the day nearest after
 * the notice's own `pubDate`.
 */
export function parseNoticeFeed(xml: string, titleMatch: string): {
  sittings: ScheduledSitting[];
  counts: ParseCounts;
} {
  const byDate = new Map<string, ScheduledSitting>();
  const counts: ParseCounts = { notSittings: 0, undated: 0 };
  const needles = titleMatch.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  for (const item of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = feedField(item[1], "title");
    const text = (feedField(item[1], "content:encoded") || feedField(item[1], "description")).replace(/\s+/g, " ");
    const haystack = `${title} ${text}`.toLowerCase();
    if (needles.length === 0 || !needles.some((needle) => haystack.includes(needle))) {
      counts.notSittings += 1;
      continue;
    }
    const m = NOTICE_SITTING.exec(text);
    const month = m ? monthIndex(m[1]) : 0;
    const day = m ? Number(m[2]) : 0;
    const posted = Date.parse(feedField(item[1], "pubDate"));
    if (!m || month === 0 || day < 1 || day > 31 || (!m[3] && !Number.isFinite(posted))) {
      counts.undated += 1;
      continue;
    }
    let year = m[3] ? Number(m[3]) : new Date(posted).getUTCFullYear();
    if (!m[3] && Date.UTC(year, month - 1, day) < posted - 31 * 86_400_000) year += 1;
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (byDate.has(date)) continue;
    byDate.set(date, {
      ...emptySitting(date, `${m[1]} ${day}, ${year}`),
      time: m[4] ? parseClockTime(m[4]) : null,
      canceled: CANCELED.test(title) || CANCELED.test(text),
      place: m[5]?.replace(/\s+/g, " ").trim() || null,
    });
  }
  return { sittings: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), counts };
}

/**
 * Shape 7 — a body's own "Next Meeting Date:" line. The qualifier ("(tentative
 * date)") is kept as the note. A line the parser cannot date is counted as
 * `undated`.
 */
export function parseNextMeetingLine(html: string): {
  sittings: ScheduledSitting[];
  counts: ParseCounts;
} {
  const counts: ParseCounts = { notSittings: 0, undated: 0 };
  const text = stripMarkup(html).replace(/\s+/g, " ");
  const m = NEXT_MEETING_LINE.exec(text);
  const month = m ? monthIndex(m[2]) : 0;
  const day = m ? Number(m[3]) : 0;
  if (!m || month === 0 || day < 1 || day > 31) {
    if (/\bNext Meeting(?: Date)?\s*:/i.test(text)) counts.undated += 1;
    return { sittings: [], counts };
  }
  const date = `${m[4]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    sittings: [{
      ...emptySitting(date, `${m[2]} ${day}, ${m[4]}`),
      note: m[1] ?? null,
      time: m[5] ? parseClockTime(m[5]) : null,
      place: m[6]?.replace(/\s+/g, " ").trim() || null,
    }],
    counts,
  };
}

/**
 * The sitting's own name, where the body wrote one beside the date ("Budget
 * Presentations"). A note that is nothing but a parenthetical falls back to the
 * body's name, and a leading weekday parenthetical is stripped.
 */
export function sittingTitle(note: string | null, bodyName: string): string {
  if (!note) return bodyName;
  let text = note
    .replace(/^[-–—\s]+/, "")
    .replace(/\*.*$/, "")
    .trim()
    .replace(
      /^\((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\)\s*/i,
      "",
    )
    .replace(/^[-–—\s]+/, "")
    .trim();
  if (/^\(.*\)$/.test(text)) return bodyName;
  text = text.replace(/\s+/g, " ");
  if (text.replace(/[^A-Za-z]/g, "").length < 3) return bodyName;
  return text;
}

/** Union the shapes a row declares. A stated time beats a date-only row. */
function mergeSittings(lists: ScheduledSitting[][]): ScheduledSitting[] {
  const byDate = new Map<string, ScheduledSitting>();
  for (const list of lists) {
    for (const sitting of list) {
      const existing = byDate.get(sitting.date);
      if (!existing) {
        byDate.set(sitting.date, { ...sitting });
        continue;
      }
      byDate.set(sitting.date, {
        date: sitting.date,
        printed: existing.printed,
        note: existing.note ?? sitting.note,
        time: existing.time ?? sitting.time,
        href: existing.href ?? sitting.href,
        canceled: existing.canceled || sitting.canceled,
        place: existing.place ?? sitting.place ?? null,
      });
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function statusOf(startsAt: string, now: Date): MeetingStatus {
  return Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

function shapesOf(wiring: BodySourceWiring): ScheduleShape[] {
  const raw = wiring.config.shapes ?? "weekday-list";
  return raw.split(",").map((s) => s.trim()) as ScheduleShape[];
}

/** One month page of a calendar that serves one month per view. */
export interface MonthPage {
  year: number;
  /** 1–12, as the page's own `&month=` query names it. */
  month: number;
}

/**
 * Every month page a one-month calendar must be walked for besides the default
 * view (the current month): every month overlapping `[startsAfter,
 * startsBefore]`, behind as well as ahead, with `monthsAhead` as a floor for a
 * row fetched without a window. Months are read off UTC components.
 */
export function monthPagesToWalk(input: {
  now: Date;
  startsAfter?: string;
  startsBefore?: string;
  monthsAhead: number;
}): MonthPage[] {
  const key = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
  const current = key(input.now);

  const after = input.startsAfter ? Date.parse(input.startsAfter) : Number.NaN;
  const before = input.startsBefore ? Date.parse(input.startsBefore) : Number.NaN;
  const from = Number.isFinite(after)
    ? key(new Date(after))
    : key(new Date(input.now.getTime() - WINDOW_BACK_DAYS * 86_400_000));
  const toWindow = Number.isFinite(before)
    ? key(new Date(before))
    : key(new Date(input.now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000));
  const ahead = Number.isFinite(input.monthsAhead) ? Math.max(0, Math.floor(input.monthsAhead)) : 0;
  const to = Math.max(toWindow, current + ahead);

  const pages: MonthPage[] = [];
  for (let k = Math.min(from, current); k <= to; k++) {
    if (k === current) continue;
    pages.push({ year: Math.floor(k / 12), month: (k % 12) + 1 });
  }
  return pages;
}

export function makeSchedulePageSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<SchedulePageRaw> {
  const normalizeWithDrops = (
    raw: SchedulePageRaw[],
    now: Date = new Date(),
  ): Accounted<{
    meetings: Meeting[];
    drops: NormalizeDropCounts;
    /** Divisions whose own page refused this run — see `SchedulePageRaw.error`. */
    unreachableOcdIds: string[];
  }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };
    /** Divisions whose own page refused us this run — see `SchedulePageRaw.error`. */
    const unreachable = new Set<string>();

    const windowStart = now.getTime() - WINDOW_BACK_DAYS * 86_400_000;
    const windowEnd = now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000;

    /*
     * The logical record is a SITTING; one raw row is one body's page carrying
     * many. A refused row is counted as one record, dropped into `notConfigured`.
     */
    let considered = 0;
    let duplicates = 0;
    let outOfWindow = 0;
    // `unknownVenue` tallies a sitting that is then PRODUCED with no place, so it is not a drop.
    let keptUnplaced = 0;

    for (const row of raw) {
      const { wiring, schedule, documents, collectedAt, error } = row;
      /* The Destiny month lists read for this row, keyed `YYYY-MM`; a month not read is absent. */
      const destinyMonths = new Map<string, DestinyMonth>(
        (row.destiny ?? []).map((m) => [m.month, parseDestinyMonth(m.html, m.url)] as const),
      );
      // A refused row publishes nothing this run and is counted in
      // `notConfigured`; its division is reported through `unreachableOcdIds`
      // so the reader's card names the gap.
      if (error) {
        considered += 1;
        drops.notConfigured += 1;
        // A division-less body has no division to attribute the gap to.
        if (wiring.ocdId) unreachable.add(wiring.ocdId);
        continue;
      }
      const shapes = shapesOf(wiring);
      const section = wiring.config.sectionMatch
        ? sliceSection(schedule, wiring.config.sectionMatch)
        : schedule;

      const lists: ScheduledSitting[][] = [];
      // Rows the SHAPE PARSERS rejected before a sitting ever existed. They go
      // into `drops` below one shape at a time; this keeps the same total so
      // they can be added back into what the pass considered.
      let parseDropped = 0;
      for (const shape of shapes) {
        if (shape === "weekday-list") {
          lists.push(parseSchedule(section));
        } else if (shape === "month-table") {
          const { sittings, counts } = parseMonthTable(section);
          lists.push(sittings);
          drops.notConfigured += counts.notSittings;
          drops.unplaceableInTime += counts.undated;
          parseDropped += counts.notSittings + counts.undated;
        } else if (shape === "dated-list") {
          const { sittings, counts } = parseDatedList(section);
          lists.push(sittings);
          drops.notConfigured += counts.notSittings;
          drops.unplaceableInTime += counts.undated;
          parseDropped += counts.notSittings + counts.undated;
        } else if (shape === "agenda-list") {
          const { sittings, counts } = parseAgendaList(
            schedule,
            wiring.config.pathPrefix ?? "/",
          );
          lists.push(sittings);
          drops.notConfigured += counts.notSittings;
          drops.unplaceableInTime += counts.undated;
          parseDropped += counts.notSittings + counts.undated;
        } else if (shape === "notice-feed") {
          const { sittings, counts } = parseNoticeFeed(schedule, wiring.config.titleMatch ?? "");
          lists.push(sittings);
          drops.notConfigured += counts.notSittings;
          drops.unplaceableInTime += counts.undated;
          parseDropped += counts.notSittings + counts.undated;
        } else if (shape === "next-meeting-line") {
          const { sittings, counts } = parseNextMeetingLine(section);
          lists.push(sittings);
          drops.unplaceableInTime += counts.undated;
          parseDropped += counts.undated;
        } else if (shape === "event-tip") {
          const { sittings, counts } = parseEventTips(
            schedule,
            wiring.config.titleMatch ?? "",
          );
          lists.push(sittings);
          drops.notConfigured += counts.notSittings;
          drops.unplaceableInTime += counts.undated;
          parseDropped += counts.notSittings + counts.undated;
        }
      }

      /*
       * `mergeSittings` unions the shapes a row declares, keyed on the date, so
       * a sitting a page states twice collapses to one; that is counted.
       */
      const rawSittings = lists.reduce((n, l) => n + l.length, 0);
      const mergedSittings = mergeSittings(lists);
      considered += rawSittings + parseDropped;
      duplicates += rawSittings - mergedSittings.length;

      // The blanket sentence ("All meetings begin at 6:30 P.M.") applies to
      // every row that did not state its own time, and to none that did.
      const stated = parseStatedTime(section);
      const venueMatch = wiring.config.venueMatch ?? "";
      const venue = resolveVenue(SOURCE_NAME, wiring.ocdId, venueMatch);
      const docs = documents ? parseDocuments(documents) : new Map();
      const bodyName = wiring.config.bodyName ?? wiring.publishingOrg;
      const otherVenues = (wiring.config.otherVenueMarkers ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      /*
       * A scheduled date whose day file was read becomes the day's own sittings of this body, each with the
       * time and street address the city stated for it; the date's own meeting id stays with the one the
       * table names. A date whose file was not read, or states none, stays date-only.
       */
      const dayFiles = new Map((row.days ?? []).map((f) => [f.date, f] as const));
      const expanded: (ScheduledSitting & { id: string; address: string | null; pageUrl: string | null })[] = [];
      for (const sitting of mergedSittings) {
        const file = dayFiles.get(sitting.date);
        const day = file ? parseDayEvents(file.json, sitting.date, wiring.config.titleMatch ?? "", new URL(file.url).origin) : null;
        if (day !== null) {
          considered += day.counts.undated;
          drops.unplaceableInTime += day.counts.undated;
        }
        const primary = day === null ? null : scheduledOfDay(day.sittings);
        if (day === null || primary === null) {
          expanded.push({ ...sitting, id: `${SOURCE_NAME}:${wiring.config.slug}:${sitting.date}`, address: null, pageUrl: null });
          continue;
        }
        considered += day.sittings.length - 1;
        for (const x of day.sittings) {
          expanded.push({
            ...sitting,
            id: x === primary ? `${SOURCE_NAME}:${wiring.config.slug}:${sitting.date}` : `${SOURCE_NAME}:${wiring.config.slug}:${sitting.date}:${x.nid}`,
            note: x.title,
            time: x.time,
            canceled: sitting.canceled || CANCELED.test(x.title),
            address: x.address,
            pageUrl: x.pageUrl,
          });
        }
      }

      for (const sitting of expanded) {
        const [y, mo, d] = sitting.date.split("-").map(Number);
        const time = sitting.time ?? stated;
        // With no stated time, local midnight is an ordering position, never a claim.
        const startsAt = toZonedIso(
          y,
          mo,
          d,
          time?.hour ?? 0,
          time?.minute ?? 0,
          wiring.timeZone,
        );
        const t = Date.parse(startsAt);
        if (t < windowStart || t > windowEnd) {
          // A deliberate clip is still a disposition and is counted.
          outOfWindow += 1;
          continue;
        }

        // A row naming a different room than the page's sentence is resolved on
        // its own string, never placed at an inherited address. A day file's own
        // street address is the sitting's own place; otherwise a room the
        // sitting's note or stated place names.
        const marker = sitting.address ?? otherVenues.find((v) =>
          (sitting.note ? sitting.note.includes(v) : false) ||
          (sitting.place ? sitting.place.includes(v) : false),
        );
        const rowVenue = marker
          ? resolveVenue(SOURCE_NAME, wiring.ocdId, marker)
          : venue;
        /*
         * No reviewed place never suppresses the sitting: it is published with
         * no pin, counted `unknownVenue`. A row that names its own room renders
         * it in its own words (`STATED_NOT_PLACED`); a row inheriting the page's
         * sentence keeps our own place-not-recorded gap, because `venueMatch` is
         * our key for that sentence and not a quotation of it.
         */
        const venueGap = !rowVenue && marker ? unplacedVenueGap(marker, wiring.publishingOrg) : null;
        if (!rowVenue) {
          drops.unknownVenue += 1;
          keptUnplaced += 1;
        }

        const href = sitting.href ?? docs.get(sitting.date) ?? null;
        const base =
          wiring.config.documentsPage ?? wiring.config.schedulePage;
        /*
         * The Destiny list's row for this sitting: a day-file sitting joins on its date and the name the city
         * printed for it; a date-only sitting joins only a date the list gives one row. The city's own link,
         * where the page carries one, is kept ahead of it.
         */
        const destinyJoin = joinDestinyRows(destinyMonths, sitting.date, sitting.pageUrl ? (sitting.note ?? null) : null);
        const destinyRow = destinyJoin !== null && destinyJoin !== "EMPTY" ? destinyJoin : null;
        const agendaUrl = href ? new URL(href, base).toString() : (destinyRow?.agendaUrl ?? null);
        meetings.push({
          id: sitting.id,
          ocdId: wiring.ocdId,
          bodyId: wiring.bodyId,
          bodyName,
          title: sittingTitle(sitting.note, bodyName),
          startsAt,
          ...(time ? {} : { startPrecision: "DAY" as const }),
          timeZone: wiring.timeZone,
          location: rowVenue
            ? {
                name: rowVenue.name,
                address: rowVenue.address,
                lat: rowVenue.lat,
                lng: rowVenue.lng,
              }
            : null,
          ...(venueGap ? { venueGap } : {}),
          ...(destinyRow && destinyRow.links.length > 0 ? { publishedLinks: [...destinyRow.links] } : {}),
          agendaUrl,
          // The publisher's own agenda list for the month was read and names nothing on this date.
          ...(agendaUrl === null && destinyJoin === "EMPTY" ? { agendaSlotObservedEmpty: true } : {}),
          jurisdiction: wiring.jurisdiction,
          status: sitting.canceled ? "CANCELED" : statusOf(startsAt, now),
          provenance: {
            sourceUrl: sitting.pageUrl ?? wiring.config.schedulePage,
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
      { meetings, drops, unreachableOcdIds: [...unreachable] },
      { logicalInput: considered, duplicates, outOfWindow, countedButProduced: keptUnplaced },
    );
  };

  return {
    name: SOURCE_NAME,

    /**
     * Serialized across bodies and isolated per body: one host's refusal never
     * empties another body's calendar. A failed row is returned with its error
     * so `normalizeWithDrops` can attribute the gap to the right division.
     */
    async fetch(query?: MeetingQuery): Promise<SchedulePageRaw[]> {
      const collected: SchedulePageRaw[] = [];
      for (const wiring of wiringRows) {
        try {
          const { text } = await politeGetText(wiring.config.schedulePage, {
            fetchImpl,
            accept: "text/html",
            signal: query?.signal,
          });
          /*
           * A month grid serves one month. `monthsAhead` marks a row whose
           * page publishes `&month=&year=` navigation; the months walked are
           * `monthPagesToWalk`'s, concatenated onto the same HTML, since every
           * event in this shape states its own full date.
           */
          let schedule = text;
          const ahead = Number(wiring.config.monthsAhead ?? 0);
          if (Number.isFinite(ahead) && ahead > 0) {
            const base = new URL(wiring.config.schedulePage);
            const pages = monthPagesToWalk({
              now: new Date(),
              startsAfter: query?.startsAfter,
              startsBefore: query?.startsBefore,
              monthsAhead: ahead,
            });
            for (const page of pages) {
              const next = new URL(
                wiring.config.monthPagePath ?? base.pathname,
                base.origin,
              );
              for (const [k, v] of new URLSearchParams(
                wiring.config.monthPageQuery ?? "",
              )) {
                next.searchParams.set(k, v);
              }
              next.searchParams.set("month", String(page.month));
              next.searchParams.set("year", String(page.year));
              try {
                const monthPage = await politeGetText(next.toString(), {
                  fetchImpl,
                  accept: "text/html",
                  signal: query?.signal,
                });
                schedule += monthPage.text;
              } catch {
                // One month refused is not the body's calendar refused; the
                // shortfall shows in this run's count.
              }
            }
          }
          /*
           * `dayJson` names the publisher's day-file route. Only the dates the schedule itself states, inside the
           * serving window, are asked for: one request each. A day that fails keeps its sitting date-only.
           */
          const days: { date: string; url: string; json: string }[] = [];
          if (wiring.config.dayJson) {
            const section = wiring.config.sectionMatch ? sliceSection(text, wiring.config.sectionMatch) : text;
            const now = Date.now();
            const from = query?.startsAfter ? Date.parse(query.startsAfter) : now - WINDOW_BACK_DAYS * 86_400_000;
            const to = query?.startsBefore ? Date.parse(query.startsBefore) : now + WINDOW_FORWARD_DAYS * 86_400_000;
            for (const sitting of parseDatedList(section).sittings) {
              const at = Date.parse(`${sitting.date}T12:00:00Z`);
              if (!(at >= from - 86_400_000 && at <= to + 86_400_000)) continue;
              const url = `${wiring.config.dayJson}${sitting.date.replace(/-/g, "")}`;
              try {
                const day = await politeGetText(url, { fetchImpl, accept: "application/json", signal: query?.signal });
                days.push({ date: sitting.date, url, json: day.text });
              } catch {
                // One day refused is not the body's calendar refused: that sitting stays date-only.
              }
            }
          }
          /*
           * `destinyAgenda` names the body's Destiny Agenda list: one request per calendar month from the
           * window's start to DESTINY_AHEAD_DAYS ahead. A month refused leaves its sittings without links,
           * never unpublished.
           */
          const destiny: { month: string; url: string; html: string }[] = [];
          if (wiring.config.destinyAgenda) {
            const now = Date.now();
            const from = query?.startsAfter ? Date.parse(query.startsAfter) : now - WINDOW_BACK_DAYS * 86_400_000;
            const until = query?.startsBefore ? Date.parse(query.startsBefore) : now + WINDOW_FORWARD_DAYS * 86_400_000;
            for (const { year, month } of destinyMonthsBetween(from, Math.min(until, now + DESTINY_AHEAD_DAYS * 86_400_000))) {
              const url = destinyMonthUrl(wiring.config.destinyAgenda, year, month);
              try {
                const page = await politeGetText(url, { fetchImpl, accept: "text/html", signal: query?.signal });
                destiny.push({ month: `${year}-${String(month).padStart(2, "0")}`, url, html: page.text });
              } catch {
                // One month refused is not the body's schedule refused.
              }
            }
          }
          let documents: string | undefined;
          if (wiring.config.documentsPage) {
            const page = await politeGetText(wiring.config.documentsPage, {
              fetchImpl,
              accept: "text/html",
              signal: query?.signal,
            });
            documents = page.text;
          }
          collected.push({
            wiring,
            schedule,
            ...(days.length > 0 ? { days } : {}),
            ...(destiny.length > 0 ? { destiny } : {}),
            documents,
            collectedAt: new Date().toISOString(),
          });
        } catch (error) {
          collected.push({
            wiring,
            schedule: "",
            collectedAt: new Date().toISOString(),
            error: String((error as Error)?.message ?? error),
          });
        }
      }

      // Every row refused is the whole source refused and still reads as a
      // source failure; only a PARTIAL refusal is isolated per body.
      if (collected.length > 0 && collected.every((row) => row.error)) {
        throw new Error(collected[0].error);
      }
      return collected;
    },

    normalize(raw, now: Date = new Date()): Meeting[] {
      return normalizeWithDrops(raw, now).meetings;
    },

    normalizeWithDrops,

    async upsert(meetings: Meeting[]) {
      // Persistence is the promotion door's; nothing to write here.
      return { inserted: 0, updated: meetings.length };
    },
  };
}
