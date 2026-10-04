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
 * a guess; a location that is virtual-only is kept online, counted placeless
 * (D18); a location the venue cache cannot cite, or a blank one, is kept with
 * no pin and its gap named, counted as unknownVenue (the venue-gap class,
 * 2026-09-23).
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
  /**
   * The board's own Past Agendas list (`?run=pastagenda&board=<id>`), read
   * only when the published schedule places no sitting in the served window.
   * See `concludedSittingsFromPastAgendas`.
   */
  pastAgendaHtml?: string;
  collectedAt: string;
}

const BOARD_PAGE = "https://clerksboards.tucsonaz.gov/boards/";

export function boardPageUrl(boardId: string): string {
  return `${BOARD_PAGE}?board=${boardId}`;
}

/** The Past Agendas list every board page links from its Documentation table. */
export function pastAgendaListUrl(boardId: string): string {
  return `${BOARD_PAGE}?run=pastagenda&board=${boardId}`;
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

const MONTH_NAMES = [
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

/**
 * The month set inside a quarterly rule's parenthetical, as 1-12.
 *
 * `(Jan, Apr, Jul, and Oct)` → `[1, 4, 7, 10]`. Returns null when the
 * parenthetical names no months, so grammar C declines rather than guessing
 * a quarter offset — "quarterly" alone does not say WHICH quarter.
 */
function monthsInParens(text: string): number[] | null {
  const paren = /\(([^)]*)\)/.exec(text);
  if (!paren) return null;
  // An EXCEPTION parenthetical also names months, and they mean the
  // opposite: not "these are the months" but "these months move". Reading
  // one as a month set would restrict a monthly board to two sittings a
  // year. (D67, 2026-08-19.)
  if (/except/i.test(paren[1])) return null;
  const months: number[] = [];
  for (const token of paren[1].toLowerCase().split(/[^a-z]+/)) {
    if (!token) continue;
    const idx = MONTH_NAMES.findIndex((m) => m.startsWith(token) && token.length >= 3);
    if (idx >= 0 && !months.includes(idx + 1)) months.push(idx + 1);
  }
  return months.length > 0 ? months.sort((a, b) => a - b) : null;
}

/**
 * **A season restriction on a recurrence** — `2nd Tuesday of each month
 * September through May @ 6:00 p.m.` (board 40). Returns the 1-12 months the
 * rule actually covers, or null when no restriction is written.
 *
 * D67, fixed 2026-08-19 (g20). The parser read past this clause entirely, so
 * a board that publishes nine sittings a year would have been given twelve —
 * June, July and August dates the body never scheduled, printed under its
 * name. It produced no wrong date in the serving window only because the
 * recurrence loop walks five months from the window start; the defect was
 * one window widening away from being visible, which is not the same as
 * being absent.
 *
 * The range WRAPS. September through May is nine months across a year
 * boundary, and reading it as an ascending span would return nothing at all.
 */
function monthRestriction(text: string): Set<number> | null {
  const span = new RegExp(
    "\\b(" +
      MONTH_NAMES.join("|") +
      ")\\b\\s*(?:through|thru|to|—|–|-)\\s*\\b(" +
      MONTH_NAMES.join("|") +
      ")\\b",
    "i",
  ).exec(text);
  if (!span) return null;
  const from = MONTH_NAMES.indexOf(span[1].toLowerCase()) + 1;
  const to = MONTH_NAMES.indexOf(span[2].toLowerCase()) + 1;
  if (from < 1 || to < 1) return null;
  const months = new Set<number>();
  for (let m = from, guard = 0; guard < 12; guard += 1) {
    months.add(m);
    if (m === to) break;
    m = (m % 12) + 1;
  }
  return months;
}

/**
 * **A per-month date override** — `1st Thursday of each month @ 9:00 a.m.
 * (except January it will be 01/08/26 and July will be 07/09/26)` (boards 58
 * and 59). Returns month → the published date for that month.
 *
 * The other half of D67, and a different shape from the restriction above:
 * this does not remove a sitting, it MOVES one. Reading past it printed the
 * ordinary Nth-weekday date for January and July — two dates a year, on both
 * boards, that the Clerk had explicitly said were different.
 *
 * Only read out of a parenthetical containing "except", so an ordinary date
 * elsewhere in the text cannot be mistaken for an exception.
 */
function monthOverrides(text: string): Map<number, { y: number; mo: number; d: number }> {
  const out = new Map<number, { y: number; mo: number; d: number }>();
  for (const paren of text.matchAll(/\(([^)]*)\)/g)) {
    const inner = paren[1];
    if (!/except/i.test(inner)) continue;
    const pairs = inner.matchAll(
      new RegExp(
        "\\b(" + MONTH_NAMES.join("|") + ")\\b[^0-9]{0,40}(\\d{1,2})/(\\d{1,2})/(\\d{2,4})",
        "gi",
      ),
    );
    for (const p of pairs) {
      const month = MONTH_NAMES.indexOf(p[1].toLowerCase()) + 1;
      const mo = Number(p[2]);
      const d = Number(p[3]);
      const rawYear = Number(p[4]);
      const y = rawYear < 100 ? 2000 + rawYear : rawYear;
      // The named month and the date's own month must agree. "except
      // January it will be 07/09/26" is not something to interpret; it is
      // something to decline, and dropping it here means the ordinary rule
      // stands for January — which `unreadableQualifier` then catches.
      if (month >= 1 && mo === month && d >= 1 && d <= 31) out.set(month, { y, mo, d });
    }
  }
  return out;
}

/**
 * **Does this text carry a qualifier we did not read?**
 *
 * The rule that makes the two functions above safe rather than merely
 * better. A grammar that silently ignores a clause it does not understand
 * emits dates the body never published — which is D67 exactly. So a
 * recurrence carrying the WORDS of a restriction or an exception, from which
 * we extracted neither, is DECLINED: it returns null, the caller counts the
 * drop, and the board renders as one whose schedule we could not read rather
 * than as one with sittings it never scheduled.
 *
 * Declining costs us a board. Guessing costs a reader a wrong date under a
 * government's name, and this product's order of trade has been settled.
 */
function unreadableQualifier(
  text: string,
  restriction: Set<number> | null,
  overrides: Map<number, unknown>,
): boolean {
  const hasRestrictionWords =
    /\b(?:through|thru)\b/i.test(text) ||
    new RegExp("\\b(" + MONTH_NAMES.join("|") + ")\\b\\s*(?:to|—|–)\\s*\\b(" + MONTH_NAMES.join("|") + ")\\b", "i").test(text);
  const hasExceptWords = /\bexcept\b/i.test(text);
  if (hasRestrictionWords && !restriction) return true;
  if (hasExceptWords && overrides.size === 0) return true;
  return false;
}

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

/** What `expandSchedule` set aside, counted, so a schedule whose dates have all passed is never a silent zero. */
export interface ScheduleTally {
  /** Published dates outside the served window. */
  outsideWindow: number;
  /** Months the body named with no day ("July … TBD"): a sitting told of, never dated. */
  tbdMonths: number;
}

/**
 * Expand the published schedule text into concrete dates.
 *
 * Two grammars the Clerk actually uses, nothing looser:
 *  A. Enumerated dates — `1/28, 2/25, …, 12/30/2026, 1/27/2027; @ 12:30 p.m.`
 *     A date without a year takes the year of the next entry that has one,
 *     which is how the page itself reads.
 *  B. Recurrence — `1st Wednesday of each month @ 8:00 a.m.` (also `; at`,
 *     and `of the month`, which one board writes and which is the same rule).
 *  C. A month-restricted Nth-weekday rule — `Quarterly basis: every 3 months
 *     on the 3rd Monday (Jan, Apr, Jul, and Oct) @ 5:30 p.m.` The months come
 *     from the parenthetical; "quarterly" with no months named is declined,
 *     because the word alone does not place a date.
 *  D. Dates written with month NAMES — `January 22, April 16, 2026 and July
 *     and October 2026 TBD @ 9:30 a.m.` A month with no day is a sitting the
 *     body has not scheduled yet: it yields no date and is never rounded.
 *
 * Anything else — "Meets as required", "Quarterly", a novel format — returns
 * null so the caller counts the drop. Never guessed.
 */
export function expandSchedule(
  scheduleText: string,
  windowStart: Date,
  windowEnd: Date,
  /**
   * What the expansion set aside, counted (2026-09-25): published dates that
   * fall outside the window, and months the body named with no day ("July and
   * October 2026 TBD"). Without it a board whose every published date had
   * passed returned `[]` with nothing counted, and the pass read as a failed
   * extraction — Tucson's Industrial Development Authority ("… 5/21, 6/18/2026")
   * and Convention Center Commission ("January 22, April 16, 2026 and July and
   * October 2026 TBD") failed every read that way until the Past Agendas
   * fallback, and would again once those agendas age out of the lookback.
   */
  tally?: ScheduleTally,
): ScheduleInstance[] | null {
  const time = scheduleTime(scheduleText);
  if (!time) return null;

  const inWindowRaw = (inst: ScheduleInstance) => {
    const t = Date.UTC(inst.y, inst.mo - 1, inst.d);
    return t >= windowStart.getTime() - 86_400_000 && t <= windowEnd.getTime();
  };
  const inWindow = (inst: ScheduleInstance) => {
    const inside = inWindowRaw(inst);
    if (!inside && tally) tally.outsideWindow += 1;
    return inside;
  };

  const recur = new RegExp(
    "(1st|2nd|3rd|4th|5th)\\s+(" + WEEKDAYS.join("|") + ")\\s+of\\s+(?:each|the)\\s+month",
    "i",
  ).exec(scheduleText);
  if (recur) {
    // D67 (2026-08-19, g20). A recurrence may carry a SEASON — "September
    // through May" — and per-month DATE OVERRIDES — "(except January it will
    // be 01/08/26...)". Both were read past, so the expansion was broader
    // than what the body published. A qualifier we cannot read declines the
    // whole board rather than expanding around it.
    const restriction = monthRestriction(scheduleText);
    const overrides = monthOverrides(scheduleText);
    if (unreadableQualifier(scheduleText, restriction, overrides)) return null;

    const nth = Number(recur[1][0]);
    const weekday = WEEKDAYS.indexOf(recur[2].toLowerCase());
    const out: ScheduleInstance[] = [];
    const cursor = new Date(windowStart);
    cursor.setUTCDate(1);
    /*
     * Walk the WINDOW, not a fixed five months (D67, 2026-08-19).
     *
     * The old loop walked exactly five iterations, which happens to match
     * today's window — 90 days back plus 60 forward. That coincidence is
     * what hid this whole defect: a season restriction being read past could
     * not produce a wrong date while the loop never reached June. Bounding
     * the walk by the window instead makes the restriction observable, keeps
     * the output identical at today's window, and stops the fix from being
     * one constant change away from useless. The 24 is a runaway guard, the
     * same one grammar C uses.
     */
    for (let i = 0; i < 24; i++) {
      const y = cursor.getUTCFullYear();
      const mo = cursor.getUTCMonth() + 1;
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      if (Date.UTC(y, mo - 1, 1) > windowEnd.getTime()) break;
      // Outside the published season: the body said it does not sit.
      if (restriction && !restriction.has(mo)) continue;
      // The Clerk named this month's date explicitly. It wins over the rule.
      //
      // An override is written for ONE year ("01/08/26"). In a later year we
      // know only that the ordinary rule does not hold for that month and
      // not what replaces it, so the month yields NOTHING rather than the
      // rule's date — the same reasoning as a TBD month in grammar D.
      const override = overrides.get(mo);
      if (override && override.y !== y) continue;
      const inst = override ?? nthWeekdayOf(y, mo, weekday, nth);
      if (inst && inWindow({ ...inst, ...time })) out.push({ ...inst, ...time });
    }
    return out;
  }

  // Grammar C: a quarterly (or any month-restricted) Nth-weekday rule —
  // `Quarterly basis: every 3 months on the 3rd Monday (Jan, Apr, Jul, and
  // Oct) @ 5:30 p.m.` (board 128). This is grammar B with the months named
  // instead of "each month", and it is fully determined: the parenthetical
  // says which months, so nothing is inferred about where a quarter starts.
  // A rule that says "quarterly" WITHOUT naming the months still returns
  // null — the word alone does not place a single date.
  const nthAny = new RegExp(
    "(1st|2nd|3rd|4th|5th)\\s+(" + WEEKDAYS.join("|") + ")",
    "i",
  ).exec(scheduleText);
  if (nthAny && !recur) {
    const months = monthsInParens(scheduleText);
    if (months) {
      const nth = Number(nthAny[1][0]);
      const weekday = WEEKDAYS.indexOf(nthAny[2].toLowerCase());
      const out: ScheduleInstance[] = [];
      // Walk the window month by month and keep the named months only.
      const cursor = new Date(windowStart);
      cursor.setUTCDate(1);
      for (let i = 0; i < 24; i++) {
        const y = cursor.getUTCFullYear();
        const mo = cursor.getUTCMonth() + 1;
        if (months.includes(mo)) {
          const inst = nthWeekdayOf(y, mo, weekday, nth);
          if (inst && inWindow({ ...inst, ...time })) out.push({ ...inst, ...time });
        }
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        if (Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1) > windowEnd.getTime())
          break;
      }
      return out;
    }
  }

  // Grammar D: dates written with month NAMES — `January 22, April 16, 2026
  // and July and October 2026 TBD @ 9:30 a.m.` (board 15). Same right-to-left
  // year assignment as grammar A, because the Clerk writes the year once at
  // the end of a run.
  //
  // The day group must be followed by a non-digit: without that, "October
  // 2026" parsed as day 20 and left the year unset — a date the body never
  // published, invented by a greedy quantifier.
  //
  // **A month with no day is a month the body has not scheduled yet.** It
  // contributes NO date and is not rounded to the 1st — "July 2026 TBD" means
  // the body has told us it will meet and has not said when, which is a
  // different thing from a date we could print. Silently dropping it would
  // read as a body that meets twice a year; see `tbdMonths` on the result.
  const named = [
    ...scheduleText.matchAll(
      new RegExp(
        "\\b(" +
          MONTH_NAMES.join("|") +
          ")\\b\\s*(?:(\\d{1,2})(?!\\d))?(?:\\s*,?\\s*(\\d{4}))?",
        "gi",
      ),
    ),
  ];
  if (named.length > 0 && named.some((n) => n[2])) {
    const parsed: { mo: number; d: number | null; y: number | null }[] = named.map(
      (n) => ({
        mo: MONTH_NAMES.indexOf(n[1].toLowerCase()) + 1,
        d: n[2] ? Number(n[2]) : null,
        y: n[3] ? Number(n[3]) : null,
      }),
    );
    let year: number | null = null;
    const out: ScheduleInstance[] = [];
    for (let i = parsed.length - 1; i >= 0; i--) {
      const e = parsed[i];
      if (e.y) year = e.y;
      if (e.d === null) {
        // TBD month — carries no date, by design, and is counted.
        if (tally) tally.tbdMonths += 1;
        continue;
      }
      if (year === null) return null;
      const inst = { y: year, mo: e.mo, d: e.d, ...time };
      if (inWindow(inst)) out.unshift(inst);
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

export interface PastAgendaEntry {
  /** The link text as the Clerk wrote it: `IDA Agenda (Revised) 08-20-26`. */
  title: string;
  pdfUrl: string;
}

/** Every document link in a board's Past Agendas list, newest first as published. */
export function parsePastAgendaList(html: string): PastAgendaEntry[] {
  const start = html.indexOf("Past Agendas:");
  if (start < 0) return [];
  const out: PastAgendaEntry[] = [];
  for (const m of html.slice(start).matchAll(/<a\b[^>]*\bhref="\s*(https:\/\/assets\.tucsonaz\.gov\/[^"\s]+)\s*"[^>]*>([^<]+)<\/a>/g)) {
    out.push({ pdfUrl: decodeEntities(m[1]), title: decodeEntities(m[2]).replace(/\s+/g, " ").trim() });
  }
  return out;
}

export interface PastAgendaSitting {
  y: number;
  mo: number;
  d: number;
  /** The parenthetical the Clerk put on the agenda, e.g. `Special Meeting`; null for a plain agenda. */
  qualifier: string | null;
  canceled: boolean;
  pdfUrl: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function localDateKey(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/**
 * **A BOARD WHOSE SCHEDULE PLACES NOTHING STILL PUBLISHES WHEN IT MET.**
 * (2026-09-25, R8.)
 *
 * Tucson's Industrial Development Authority (board 43) publishes a schedule
 * that ends 6/18/2026, and the Convention Center Commission (board 15) one
 * whose July and October dates are "TBD". Inside the served window both
 * expand to zero sittings, so both bodies showed none — while each board's
 * Past Agendas list dates the sittings it actually held: `IDA Agenda 07-16-26`,
 * `IDA Agenda (Special Meeting) 07-28-26`, `TCCC Agenda 07-16-26`.
 *
 * Each concluded sitting here is dated by the Clerk's own agenda title and
 * cites that agenda PDF. Only the BODY'S OWN agendas count: the title must be
 * `<the board's abbreviation or name> Agenda [(qualifier)] <date>`, so
 * `IDA Property Committee Agenda` and `IDA Finance Subcommittee Agenda` — other
 * bodies — and `IDA Public Notice` — not an agenda — are not sittings of the
 * board. Where one date carries several agendas the newest-listed wins (a
 * revision or a cancellation is posted after the original), and "(Canceled)"
 * cancels exactly that date. The list carries no start time, so none is
 * claimed: the sitting is `DAY` precision (M59). Only dates before today,
 * inside the served lookback, are emitted — the list is a record of meetings
 * held, not a schedule.
 */
export function concludedSittingsFromPastAgendas(
  entries: readonly PastAgendaEntry[],
  boardName: string | null,
  windowStart: Date,
  now: Date,
  timeZone: string,
): PastAgendaSitting[] {
  if (!boardName) return [];
  const abbreviation = /\(([^)]+)\)\s*$/.exec(boardName)?.[1]?.trim();
  const name = boardName.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const prefixes = [abbreviation, name].filter((p): p is string => Boolean(p)).map(escapeRegExp);
  if (prefixes.length === 0) return [];
  const own = new RegExp(
    `^(?:${prefixes.join("|")})\\s+Agenda(?:\\s*\\(([^)]+)\\))?\\s+(\\d{1,2})-(\\d{1,2})-(\\d{2,4})$`,
    "i",
  );
  const today = localDateKey(now, timeZone);
  const earliest = localDateKey(windowStart, timeZone);
  const byDate = new Map<string, PastAgendaSitting>();
  for (const entry of entries) {
    const m = own.exec(entry.title);
    if (!m) continue;
    const rawYear = Number(m[4]);
    const sitting: PastAgendaSitting = {
      y: rawYear < 100 ? 2000 + rawYear : rawYear,
      mo: Number(m[2]),
      d: Number(m[3]),
      qualifier: m[1]?.trim() ?? null,
      canceled: /cancel+ed/i.test(m[1] ?? ""),
      pdfUrl: entry.pdfUrl,
    };
    if (sitting.mo < 1 || sitting.mo > 12 || sitting.d < 1 || sitting.d > 31) continue;
    const key = `${sitting.y}-${String(sitting.mo).padStart(2, "0")}-${String(sitting.d).padStart(2, "0")}`;
    if (key >= today || key < earliest) continue;
    if (!byDate.has(key)) byDate.set(key, sitting); // newest-listed wins
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, sitting]) => sitting);
}

export function makeClerksBoardsSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
  /** The fetch-time clock that decides whether a schedule places a sitting; injectable for tests. */
  clock: () => Date = () => new Date(),
): ReportingMeetingSource<ClerksBoardsRaw> {
  const normalizeWithDrops = (
    raw: ClerksBoardsRaw[],
    now: Date = new Date(),
  ): Accounted<{ meetings: Meeting[]; drops: NormalizeDropCounts }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };

    const windowStart = new Date(now.getTime() - WINDOW_BACK_DAYS * 86_400_000);
    const windowEnd = new Date(now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000);
    let keptButPlaceless = 0;

    /*
     * A-002 · THIS ADAPTER IS THE ONE THAT CANNOT ALWAYS COUNT, and it is why
     * `COULD_NOT_ASSERT` exists rather than being a formality.
     *
     * The logical record here is a SCHEDULE INSTANCE — a sitting expanded out
     * of "the third Tuesday of each month". Where the schedule expands, the
     * count is exact. Where the Clerk writes "Meets as required", or writes a
     * rule this parser does not know, ONE counted drop stands in for an
     * unknowable number of sittings, and the comment below has said so since
     * the adapter was written.
     *
     * An unknowable number cannot be conserved against. Guessing one would be
     * worse than saying so, so the pass records that it could not assert a
     * count — RULING 100's second state — and the report carries that rather
     * than a number nobody measured.
     */
    let considered = 0;
    let outOfWindow = 0;
    let cannotAssert = false;

    for (const { wiring, html, pastAgendaHtml, collectedAt } of raw) {
      const page = parseBoardPage(html);
      const boardUrl = boardPageUrl(wiring.config.boardId);

      const tally: ScheduleTally = { outsideWindow: 0, tbdMonths: 0 };
      const expanded = page.scheduleText ? expandSchedule(page.scheduleText, windowStart, windowEnd, tally) : null;
      if (expanded !== null) {
        // What the schedule published and this window does not serve, counted
        // rather than silently absent (2026-09-25).
        considered += tally.outsideWindow + tally.tbdMonths;
        outOfWindow += tally.outsideWindow;
        drops.unplaceableInTime += tally.tbdMonths;
      }
      // A schedule that places nothing in the window falls back to the
      // sittings the board's own Past Agendas list dates (R8, 2026-09-25).
      const pastSittings = (expanded === null || expanded.length === 0) && pastAgendaHtml !== undefined
        ? concludedSittingsFromPastAgendas(parsePastAgendaList(pastAgendaHtml), page.boardName, windowStart, now, wiring.timeZone)
        : [];
      if (expanded === null) {
        // No schedule, "Meets as required", or a format this parser does not
        // know. One counted drop stands in for the unknowable number of
        // FORWARD sittings, even where the past agendas date the held ones.
        drops.unplaceableInTime++;
        cannotAssert = true;
        if (pastSittings.length === 0) continue;
      }
      const instances = expanded ?? [];
      const sittingCount = instances.length + pastSittings.length;
      considered += sittingCount;

      const location = page.location?.trim() ?? "";
      /*
       * A meeting held online is KEPT (D18). No building means no coordinates
       * and no pin, but it is a real public meeting a reader could attend.
       * Tucson's Clerk publishes "Microsoft Teams (Virtual)" for bodies that
       * meet this way and no join link beside it, so joinUrl is null and
       * renders as the gap it is.
       */
      const online = location && isPlacelessLocation(location)
        ? { label: location, joinUrl: null }
        : null;
      if (online) {
        drops.placeless += sittingCount;
        // A-002: these instances are all PRODUCED below (D18), so the tally is
        // not a drop and must not be summed as one.
        keptButPlaceless += sittingCount;
      }
      const venue = online || !location ? null : resolveVenue(SOURCE_NAME, wiring.ocdId, location) ?? null;
      /*
       * No reviewed venue never suppresses a sitting (the venue-gap class,
       * 2026-09-23): every instance is published with no pin and its gap
       * named — the page's own "Meeting Location" text verbatim, or the page's
       * silence where it states none — and counted as `unknownVenue`, kept.
       * Both cases used to `continue` past every instance of the body.
       */
      const venueGap = !online && !venue ? unplacedVenueGap(location, wiring.publishingOrg) : null;
      if (venueGap) {
        drops.unknownVenue += sittingCount;
        keptButPlaceless += sittingCount;
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
          /* NH-RC4: the body, from the wiring row that produced this meeting. */
          bodyId: wiring.bodyId,
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
          ...(venueGap ? { venueGap } : {}),
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

      // Sittings the board's Past Agendas list dates, each citing its agenda
      // PDF. No start time is published there, so none is claimed (M59).
      for (const sitting of pastSittings) {
        const qualifier = sitting.qualifier && !/revised|cancel+ed/i.test(sitting.qualifier) ? sitting.qualifier : null;
        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.boardId}:${sitting.y}-${String(sitting.mo).padStart(2, "0")}-${String(sitting.d).padStart(2, "0")}`,
          ocdId: wiring.ocdId,
          bodyId: wiring.bodyId,
          bodyName,
          title: qualifier ? `${bodyName} — ${qualifier}` : bodyName,
          startsAt: toZonedIso(sitting.y, sitting.mo, sitting.d, 0, 0, wiring.timeZone),
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
          ...(online ? { online } : {}),
          ...(venueGap ? { venueGap } : {}),
          agendaUrl: sitting.pdfUrl,
          jurisdiction: wiring.jurisdiction,
          status: sitting.canceled ? "CANCELED" : "CONCLUDED",
          provenance: {
            sourceUrl: pastAgendaListUrl(wiring.config.boardId),
            sourceOrg: wiring.publishingOrg,
            collectedAt,
            verifiedAt: null,
          },
        });
      }
    }

    return accountedNormalize(SOURCE_NAME, raw, { meetings, drops }, {
      logicalInput: cannotAssert ? null : considered,
      outOfWindow,
      countedButProduced: keptButPlaceless,
    });
  };

  return {
    name: SOURCE_NAME,

    async fetch(query?: MeetingQuery): Promise<ClerksBoardsRaw[]> {
      const collected: ClerksBoardsRaw[] = [];
      for (const wiring of wiringRows) {
        const url = boardPageUrl(wiring.config.boardId);
        const { text } = await politeGetText(url, {
          fetchImpl,
          accept: "text/html",
          signal: query?.signal,
        });
        // The Past Agendas list is read only for a board whose published
        // schedule places no sitting in the served window (R8): one more
        // request for those boards, none for the rest.
        const now = clock();
        const page = parseBoardPage(text);
        const expanded = page.scheduleText
          ? expandSchedule(
              page.scheduleText,
              new Date(now.getTime() - WINDOW_BACK_DAYS * 86_400_000),
              new Date(now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000),
            )
          : null;
        let pastAgendaHtml: string | undefined;
        if (expanded === null || expanded.length === 0) {
          pastAgendaHtml = (await politeGetText(pastAgendaListUrl(wiring.config.boardId), {
            fetchImpl,
            accept: "text/html",
            signal: query?.signal,
          })).text;
        }
        collected.push({
          wiring,
          html: text,
          ...(pastAgendaHtml !== undefined ? { pastAgendaHtml } : {}),
          collectedAt: now.toISOString(),
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
