/**
 * A body's agendas, results and minutes from its Destiny Agenda publisher list
 * (`public.destinyhosted.com/agenda_publish.cfm?id=<tenant>&mt=<type>`). The
 * list is one month per page (`&get_month=M&get_year=YYYY`); each row is one
 * sitting, with
 *
 * - the agenda link, whose text is the sitting's date as printed ("September 17, 2026") and whose title
 *   attribute names the meeting and repeats the date ("View Agenda for City Council Regular Meeting
 *   (09/17/2026)");
 * - the meeting's name ("City Council Regular Meeting");
 * - the minutes cell, whose link text is what the city calls the document ("Results", "Minutes");
 * - other links ("Video").
 *
 * A month with nothing posted says so in the page's own words ("No agendas or minutes were found for the
 * meeting type 'City Council' in October 2026."): that is a read list with no row, and it is the only way
 * this parser reports an empty month. A page with neither the table nor that sentence is not this list at all,
 * and is reported as unread, never as empty.
 *
 * This module never creates a sitting: the Destiny list states no time and no place. Rows join to sittings the
 * body's own schedule already dated, on the date and the meeting's name (`joinDestinyRows`).
 */

import { decodeEntities } from "../http.ts";

export interface DestinyRow {
  /** `YYYY-MM-DD`, from the agenda link's own text; the title attribute's date must agree. */
  readonly date: string;
  /** The meeting's name as the list prints it, whitespace collapsed. */
  readonly title: string;
  /** Absolute URL of the sitting's agenda page, or null when the row carries no agenda link. */
  readonly agendaUrl: string | null;
  /** The minutes cell and the other-links cell, in the city's own words, absolute URLs. */
  readonly links: readonly { readonly label: string; readonly href: string }[];
}

export interface DestinyMonth {
  /** True when the page is a Destiny list: its meeting table or its own "No agendas … were found" sentence. */
  readonly read: boolean;
  readonly rows: readonly DestinyRow[];
  /** Rows set aside, counted: no date in the agenda cell, or the two printed dates disagree. */
  readonly undated: number;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Every numeric reference (`&#x3f;`, `&#61;`) and the named ones this repo decodes. Destiny encodes its hrefs. */
function decodeAll(value: string): string {
  return decodeEntities(
    value
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec))),
  );
}

function text(html: string): string {
  return decodeAll(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The month list URL for one month: the wired list plus Destiny's own month and year parameters. */
export function destinyMonthUrl(listUrl: string, year: number, month: number): string {
  const url = new URL(listUrl);
  url.searchParams.set("get_month", String(month));
  url.searchParams.set("get_year", String(year));
  return url.toString();
}

/**
 * How far ahead a month's list is worth reading. Destiny lists a sitting only once its agenda is posted, about
 * a week ahead, so later months cannot hold a posted agenda yet and are not asked for.
 */
export const DESTINY_AHEAD_DAYS = 35;

/**
 * Every calendar month from `fromMs`'s to `toMs`'s (UTC), in order, once each, so a concluded sitting keeps
 * its results and minutes.
 */
export function destinyMonthsBetween(fromMs: number, toMs: number): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  if (!(fromMs <= toMs)) return out;
  const start = new Date(fromMs);
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth() + 1;
  const end = new Date(toMs);
  const last = end.getUTCFullYear() * 12 + end.getUTCMonth();
  while (year * 12 + (month - 1) <= last) {
    out.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

/** One Destiny month page. `pageUrl` resolves the list's relative links. */
export function parseDestinyMonth(html: string, pageUrl: string): DestinyMonth {
  const tableAt = html.indexOf('id="meeting-table"');
  const nothingFound = /id="nothingFound"/.test(html);
  if (tableAt < 0) return { read: false, rows: [], undated: 0 };
  const end = html.indexOf("</table>", tableAt);
  const table = html.slice(tableAt, end < 0 ? undefined : end);
  const body = table.slice(Math.max(0, table.indexOf("<tbody")));
  const rows: DestinyRow[] = [];
  let undated = 0;
  for (const tr of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 2) continue;
    const [agendaCell, meetingCell, minutesCell = "", otherCell = ""] = cells;
    const printed = /([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})/.exec(text(agendaCell));
    const month = printed ? MONTHS.indexOf(printed[1].toLowerCase()) + 1 : 0;
    const date = printed && month > 0 ? `${printed[3]}-${String(month).padStart(2, "0")}-${printed[2].padStart(2, "0")}` : null;
    const titled = /title="[^"]*\((\d{2})\/(\d{2})\/(\d{4})\)"/.exec(agendaCell);
    const titledDate = titled ? `${titled[3]}-${titled[1]}-${titled[2]}` : null;
    if (date === null || (titledDate !== null && titledDate !== date)) {
      undated += 1;
      continue;
    }
    const agendaHref = /<a\b[^>]*href="([^"]+)"/i.exec(agendaCell)?.[1] ?? null;
    const links: { label: string; href: string }[] = [];
    for (const cell of [minutesCell, otherCell]) {
      for (const a of cell.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const label = text(a[2]);
        if (label === "") continue;
        links.push({ label, href: new URL(decodeAll(a[1]), pageUrl).toString() });
      }
    }
    rows.push({
      date,
      title: text(meetingCell),
      agendaUrl: agendaHref === null ? null : new URL(decodeAll(agendaHref), pageUrl).toString(),
      links,
    });
  }
  if (rows.length === 0 && undated === 0 && !nothingFound) return { read: false, rows: [], undated: 0 };
  return { read: true, rows, undated };
}

function key(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The Destiny row for one sitting, or why there is none.
 *
 * - A sitting whose own title the city printed (a day file's "City Council Work Session") joins the row of the
 *   same date whose meeting name is the same words; nothing else.
 * - A sitting known only by its date (the schedule table's) joins the date's row only when the list has exactly
 *   one row that day. Two or more is ambiguous and joins none.
 * - `EMPTY` is stated only when the month holding the date was read and lists no row on that date at all: the
 *   publisher's own agenda list was observed, and this sitting's place in it was empty.
 */
export function joinDestinyRows(
  months: ReadonlyMap<string, DestinyMonth>,
  date: string,
  printedTitle: string | null,
): DestinyRow | "EMPTY" | null {
  const month = months.get(date.slice(0, 7));
  if (!month || !month.read) return null;
  const sameDay = month.rows.filter((r) => r.date === date);
  if (sameDay.length === 0) return month.undated === 0 ? "EMPTY" : null;
  if (printedTitle !== null) {
    const matched = sameDay.filter((r) => key(r.title) === key(printedTitle));
    return matched.length === 1 ? matched[0] : null;
  }
  return sameDay.length === 1 ? sameDay[0] : null;
}
