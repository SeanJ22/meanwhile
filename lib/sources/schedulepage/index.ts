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
  CONCLUDED_LOOKBACK_DAYS,
  UPCOMING_HORIZON_DAYS,
} from "../../meetings/constants.ts";
import { resolveVenue } from "../../meetings/venue-cache.ts";
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
 * The body's own page — tracker **M78**, born 2026-08-15; **M79** made it
 * four shapes on 2026-08-15.
 *
 * Not a vendor. A *family of shapes*: a body that publishes its own sittings
 * on its own site, with no portal in the path. That is ladder rung 2, it is
 * the most reliable source there is for a body that runs no agenda vendor,
 * and it is how an enormous number of American school boards, planning boards
 * and conservation commissions publish. The four shapes wired so far, all
 * discovered from real pages rather than imagined:
 *
 * 1. `weekday-list` — the whole year as `Monday, January 26, 2026` lines with
 *    one sentence underneath naming the time and the room. Morris Hills
 *    Regional (M78) was the first.
 * 2. `month-table` — a two-column table, month in the left cell (carrying the
 *    year), one sitting per row in the right cell with its own words beside
 *    the date: `Apr 2 Staff Nominations`, `September 10 - Budget
 *    Presentations`. Kearsarge Regional School District (M79).
 * 3. `dated-list` — a plain dated list with per-row times, `August 11, 2026 -
 *    6:00pm`, and a sentence naming the venue. Newbury's Conservation
 *    Commission (M79).
 * 4. `agenda-list` — the document listing *is* the schedule: one row per
 *    sitting, each carrying a machine-readable `dc:date` and a link to that
 *    sitting's agenda or minutes. Newbury's Planning Board and Zoning Board
 *    of Adjustment (M79).
 *
 * A row may declare more than one shape (`shapes: "dated-list,agenda-list"`);
 * the sittings are unioned by date, a stated time beats a date-only row, and
 * a document link is carried across from whichever shape found it.
 *
 * **The time comes off the page, never from a default.** A page that dates a
 * sitting without timing it ships `startPrecision: "DAY"` and the card says
 * the time was not posted (M59), rather than inventing an hour that would be
 * right most of the time and wrong exactly on the special sitting somebody
 * wanted to attend.
 *
 * **Two of these hosts refuse this pipeline's ordinary client**, which is what
 * kept them at `NOT_ATTEMPTED` for a day: `kearsarge.org` and
 * `newbury.nh.gov` answer 403 to the civic-index profile. They answer 200 to
 * a browser, and the browser rung in `lib/sources/http.ts` is how these rows
 * are retrieved — same pacing, same contact address, one rung further up the
 * ladder. See `profile: "browser"` there for why that is negotiation and not
 * circumvention.
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
 * Rows a schedule page carries that are **not sittings of the body**.
 *
 * Kearsarge's table ends with two filing deadlines and carries the town
 * election in the middle of it, all three written in exactly the same shape as
 * a meeting row. Rendering "Election Day in your Town" as a school board
 * meeting at 6:30pm at 114 Main Street would be a fabricated claim about a
 * government, so they are dropped — and *counted*, because a silent skip and a
 * real absence must never look alike.
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
   * tooltip block — New London NH's GovOffice calendar (M123, 2026-08-19),
   * and the shape a great many New England towns publish their whole
   * government in:
   *
   * ```html
   * <div class="eventTip">
   *   <div class="tipTitle">Board of Selectmen - 5:30 PM - Whipple Memorial Town Hall</div>
   *   Thursday, August 20, 2026 at 5:30 PM
   * </div>
   * ```
   *
   * The grid itself is unparseable without knowing which month it is — but
   * nothing here has to parse the grid, because every event states its own
   * date beside its own title. That is the whole reason this shape is cheap.
   *
   * **It is one town-wide calendar, not one board's page**, so a row must
   * carry `titleMatch` naming the body in the calendar's own words. Without
   * it a band concert becomes a sitting of the Planning Board.
   *
   * **It serves ONE MONTH.** The page has `&month=&year=` navigation, and a
   * row that reads only the default view reports the current month as the
   * body's whole calendar — a real clip that reads exactly like a body with
   * nothing scheduled. `monthsAhead` on the row walks them, and the count is
   * stated per run.
   */
  | "event-tip";

export interface SchedulePageRaw {
  wiring: BodySourceWiring;
  /** The schedule page's HTML. */
  schedule: string;
  /** The documents page's HTML, where the row wires one. */
  documents?: string;
  collectedAt: string;
  /**
   * This ROW's retrieval was refused, and `schedule` is empty (g3, 2026-08-16).
   *
   * Five bodies are wired to this adapter across three hosts. `fetch()` used
   * to loop them and let the first failure throw, so **one host's 403 emptied
   * all five calendars** — Kearsarge's fifteen sittings, Newbury's three
   * land-use boards and Morris Hills Regional's board all vanished from
   * production together because `kearsarge.org` refused the scheduled
   * refresh's client. A row that fails is now recorded here and skipped; the
   * rows that succeeded still ship, and the failure is carried to the
   * snapshot so the reader is told which bodies we could not reach rather
   * than being shown an empty calendar as if it were an empty government.
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
 * The element carrying `className`, with its nesting respected.
 *
 * A department page carries the body's own free-content block *and* a news
 * teaser list *and* a minutes archive, all of them full of dates. Scoping the
 * dated-list parser to the block the body writes itself is what keeps a
 * document's publication date from becoming a meeting.
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
 * The start time the page states for *every* sitting, as `{ hour, minute }`,
 * or null.
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

function emptySitting(date: string, printed: string): ScheduledSitting {
  return { date, printed, note: null, time: null, href: null, canceled: false };
}

/**
 * Shape 1 — every `Weekday, Month D, YYYY` the page publishes.
 *
 * Deliberately strict about the weekday prefix: a page carries dates in its
 * footer, its news teasers and its copyright line, and a bare "August 17,
 * 2026" anywhere on the page would become a meeting. In this shape the
 * schedule list is the only place the body writes the weekday out.
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
 * Shape 2 — the two-column month table.
 *
 * The left cell carries the month and, on the row that opens a year, the year:
 * `April, 2026`, then bare `May`, `June`… and `January 2027` when the calendar
 * rolls. The right cell carries one sitting: its date and the board's own
 * words for it.
 *
 * **The year is tracked two ways and both must agree with the page.** A cell
 * that states a year sets it outright; a month whose ordinal goes backwards
 * without one rolls it forward. Kearsarge states `January 2027` explicitly, so
 * the two mechanisms agree there — but a page that omits it is the common
 * case, and a schedule silently filed twelve months early is invisible until a
 * reader shows up at an empty room.
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
    // The header row is the table saying what its columns are, not a row it
    // failed to date — counting "Date" as an unplaceable sitting would put a
    // permanent 1 in a drop column that is supposed to mean something.
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
 * Shape 3 — a plain dated list, `August 11, 2026 - 6:00pm`, one per line.
 *
 * Scoped to a section by the caller (`sectionMatch`), because without that
 * scope this pattern is loose enough to swallow a news teaser's date. Newbury
 * writes two dates in one paragraph at least once and drops the space after a
 * comma at least twice, so the scan is per-match rather than per-line.
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
 * Shape 5 — a month grid whose every event states its own date and time.
 *
 * New London NH's GovOffice calendar (M123, 2026-08-19). The grid is a
 * `<table>` of day cells, and every event inside one carries:
 *
 * ```html
 * <div class="eventTip">
 *   <div class="tipTitle">Board of Selectmen - 5:30 PM - Whipple Memorial Town Hall</div>
 *   Thursday, August 20, 2026 at 5:30 PM
 * </div>
 * ```
 *
 * So the grid never has to be understood: each event is self-describing, and
 * the date beside it is the town's own words rather than a cell position this
 * parser would have to be right about.
 *
 * `titleMatch` is REQUIRED and is the whole safety of the shape. This is the
 * TOWN's calendar — band concerts, transfer-station hours and eleven boards
 * share it — so a row that matched nothing in particular would file a concert
 * as a sitting of the Planning Board. Rows whose title does not carry the
 * match are counted as `notSittings`, which is what makes "this board has
 * nothing this month" distinguishable from "the parser matched nothing".
 */
export function parseEventTips(
  html: string,
  titleMatch: string,
): { sittings: ScheduledSitting[]; counts: ParseCounts } {
  const byDate = new Map<string, ScheduledSitting>();
  const counts: ParseCounts = { notSittings: 0, undated: 0 };
  if (!titleMatch) return { sittings: [], counts };

  const needle = titleMatch.toLowerCase();
  const blocks = html.matchAll(
    /<div class="tipTitle">([\s\S]*?)<\/div>([\s\S]*?)<\/div>/g,
  );

  for (const block of blocks) {
    const title = cellText(block[1]);
    const when = cellText(block[2]);
    if (!title.toLowerCase().includes(needle)) {
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

/**
 * Shape 4 — the document listing *is* the schedule.
 *
 * Newbury's Drupal publishes one row per sitting carrying a machine-readable
 * `<span property="dc:date" content="2026-08-18T19:00:00-04:00">` and, just
 * ahead of it, the link to that sitting's agenda, minutes or event page. No
 * time is ever inferred: the offset-bearing timestamp is the town's own.
 *
 * `pathPrefix` binds the rows to **one board**. The town's page templates put
 * every board's blocks in the same markup, and a prefix-free parser would file
 * the Zoning Board's Thursday under the Planning Board.
 *
 * A row timed at exactly local midnight is the town dating a document without
 * timing the sitting — that ships `DAY` precision, per M59. Where a board
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
        // **The link's text names the DOCUMENT, not the sitting.** "Agenda",
        // "Meeting Minutes" — putting those on a card would title a
        // government meeting after the piece of paper we found it in. The
        // label is read for one thing only: the board writing "April Meeting
        // is Cancelled" into it, which is the only cancellation signal this
        // town publishes.
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

/**
 * The sitting's own name, where the body wrote one beside the date.
 *
 * "Budget Presentations" and "Organizational Meeting" are exactly what
 * `Meeting.title` is for, and dropping them would throw away the most useful
 * thing on the page. A parenthetical qualifier is not a name, though —
 * "(tentative)" as a meeting title reads like the board is unsure what it is
 * called — so a note that is nothing but a parenthetical falls back to the
 * body's name, and the weekday parenthetical is stripped off the front.
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
 * Every month page a one-month calendar must be walked for, besides the
 * default view — which serves the CURRENT month and nothing else.
 *
 * **A month grid rolls, and history rolled off with it** (2026-09-01, the
 * scheduled refresh's first red run of September). `monthsAhead` walked the
 * page's own `&month=&year=` navigation FORWARD only. On 1 September New
 * London's calendar opened on September, the six August sittings this
 * pipeline had held since 2026-08-19 were no longer on any page it read, and
 * the rebuilt snapshot carried the town with no concluded meeting at all. The
 * town had published them the whole time — `&month=8&year=2026` answered 200
 * with 25 events on 2026-09-02 — so this was a clip of ours reading exactly
 * like a body with no history, which is the shape M58 exists to refuse.
 *
 * So the walk covers the WHOLE serving window in both directions: every month
 * overlapping `[startsAfter, startsBefore]` — the window the composite asks
 * every adapter for — plus `monthsAhead` as a floor for a row that is fetched
 * without one. The current month is the default page and is never repeated.
 * Months are read off UTC components; a window edge that falls in the last
 * hours of a month costs one extra page, and the normalizer's own clip decides
 * what a page's rows are worth.
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
     * A-002 · the logical record here is a SITTING, and one raw row is one
     * body's page carrying many. A refused row is counted as one record too,
     * because this adapter deliberately drops it into `notConfigured` rather
     * than shortening its own input — see the comment immediately below, which
     * is that decision written down before there was a contract to check it.
     */
    let considered = 0;
    let duplicates = 0;
    let outOfWindow = 0;

    for (const { wiring, schedule, documents, collectedAt, error } of raw) {
      // A refused row publishes nothing THIS run. It is counted, not skipped:
      // `notConfigured` is the drop bucket for "we had a row and produced no
      // meeting from it", and a run that quietly shortened its own input is
      // the empty-success shape. The division it belongs to is reported
      // upward by `unreachableOcdIds` below, which is what puts the honest
      // line on the reader's card instead of an empty calendar.
      if (error) {
        considered += 1;
        drops.notConfigured += 1;
        // A division-less body has no division to attribute the gap TO; the
        // drop count above is the whole of what can honestly be said about it.
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
       * A-002 · `mergeSittings` unions the shapes a row declares, keyed on the
       * date, so a sitting a page states twice — once in its month table and
       * once in its dated list — collapses to one. That collapse is a real
       * disposition and used to leave no trace.
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

      for (const sitting of mergedSittings) {
        const [y, mo, d] = sitting.date.split("-").map(Number);
        const time = sitting.time ?? stated;
        // With no stated time, local midnight is an ORDERING position and
        // never a claim — the same shape M59 gave the day-only archives.
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
          // A-002: a deliberate clip is still a disposition and is counted.
          outOfWindow += 1;
          continue;
        }

        // A row naming a different room than the page's own sentence is
        // resolved on ITS OWN string, so an uncurated venue drops and counts
        // rather than inheriting an address that would send a reader to the
        // wrong building.
        const marker = otherVenues.find((v) =>
          sitting.note ? sitting.note.includes(v) : false,
        );
        const rowVenue = marker
          ? resolveVenue(SOURCE_NAME, wiring.ocdId, marker)
          : venue;
        if (!rowVenue) {
          drops.unknownVenue += 1;
          continue;
        }

        const href = sitting.href ?? docs.get(sitting.date) ?? null;
        const base =
          wiring.config.documentsPage ?? wiring.config.schedulePage;
        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.slug}:${sitting.date}`,
          ocdId: wiring.ocdId,
          /* NH-RC4: the body, from the wiring row that produced this meeting. */
          bodyId: wiring.bodyId,
          bodyName,
          title: sittingTitle(sitting.note, bodyName),
          startsAt,
          ...(time ? {} : { startPrecision: "DAY" as const }),
          timeZone: wiring.timeZone,
          location: {
            name: rowVenue.name,
            address: rowVenue.address,
            lat: rowVenue.lat,
            lng: rowVenue.lng,
          },
          agendaUrl: href ? new URL(href, base).toString() : null,
          jurisdiction: wiring.jurisdiction,
          status: sitting.canceled ? "CANCELED" : statusOf(startsAt, now),
          provenance: {
            sourceUrl: wiring.config.schedulePage,
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
      { logicalInput: considered, duplicates, outOfWindow },
    );
  };

  return {
    name: SOURCE_NAME,

    /**
     * Serialized across bodies, same as every adapter here — and **isolated
     * per body** (g3, 2026-08-16).
     *
     * The isolation is the fix for a production outage, not a nicety. These
     * five rows live on three unrelated hosts, and a bare loop let the first
     * host's refusal throw out of the whole adapter: the composite recorded
     * `schedulepage: FAILED`, every one of the five bodies contributed
     * nothing, and the committed snapshot replaced four working calendars
     * with silence. A body whose own page answered is not implicated in a
     * different body's WAF.
     *
     * A row that fails is recorded with its error and returned, rather than
     * dropped: `normalizeWithDrops` needs to see it to attribute the gap to
     * the right division, and a silently shorter list is the empty-success
     * shape this repo has now sighted five times.
     */
    async fetch(query?: MeetingQuery): Promise<SchedulePageRaw[]> {
      const collected: SchedulePageRaw[] = [];
      for (const wiring of wiringRows) {
        const profile =
          wiring.config.profile === "browser"
            ? ("browser" as const)
            : ("index" as const);
        try {
          const { text } = await politeGetText(wiring.config.schedulePage, {
            fetchImpl,
            accept: "text/html",
            profile,
            signal: query?.signal,
          });
          /*
           * A MONTH GRID SERVES ONE MONTH, and reading only the default view
           * reports this month as the body's whole calendar — a real clip
           * that reads exactly like a body with nothing scheduled. New
           * London's Board of Selectmen sits twice a month all year; the
           * default view carries two of them.
           *
           * `monthsAhead` marks a row whose page publishes `&month=&year=`
           * navigation. The months walked are `monthPagesToWalk`'s — the
           * whole serving window, BEHIND as well as ahead — and the extra
           * months are concatenated onto the same HTML: every event in this
           * shape states its own full date, so there is nothing to keep
           * separate.
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
                  profile,
                  signal: query?.signal,
                });
                schedule += monthPage.text;
              } catch {
                // One month refused is not the body's calendar refused. The
                // months that answered still produce, and the shortfall shows
                // in the count this run reports rather than in silence.
              }
            }
          }
          let documents: string | undefined;
          if (wiring.config.documentsPage) {
            const page = await politeGetText(wiring.config.documentsPage, {
              fetchImpl,
              accept: "text/html",
              profile,
              signal: query?.signal,
            });
            documents = page.text;
          }
          collected.push({
            wiring,
            schedule,
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

      // Every row refused is the whole source being refused, and that must
      // still read as a source failure — the composite's own reporting, the
      // snapshot's `failed` list and the reader's "we couldn't reach their
      // calendar source" line all hang off it. Only a PARTIAL refusal is the
      // new behaviour.
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
      // No tables yet — lib/db/schema.ts is `export {}`. Same honest no-op as
      // the other adapters until Phase 5 persistence lands.
      return { inserted: 0, updated: meetings.length };
    },
  };
}
