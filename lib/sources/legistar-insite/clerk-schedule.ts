/**
 * **THE BODY'S OWN CLERK, PUBLISHING THE SAME SITTINGS ON THE COUNTY'S OWN
 * SITE.** (Discovered and measured 2026-08-28.)
 *
 * ## Why a second enumeration of the same calendar is not redundant
 *
 * Every route in this directory so far is Granicus telling us about Pima. The
 * Clerk of the Board's schedule table at
 * `https://www.pima.gov/2559/Board-of-Supervisors-Meeting-Schedule` is **Pima
 * telling us about Pima**, on Pima's own domain, and it is the record the
 * vendor's calendar is generated FROM rather than a copy of it.
 *
 * That makes it the only available check on the vendor. If `Calendar.aspx` and
 * this page disagree about whether a sitting exists, or about what hour it
 * starts, a reader needs to know that a disagreement exists — and there is no
 * way to know it from one publisher.
 *
 * Measured the day it was found, over the future horizon: **14 explicit
 * instances here, 14 explicit instances on the InSite grid, 14 of 14 agreeing
 * on body, date and wall-clock time.** Two independent first-party publishers,
 * no disagreement. That is a result, not an assumption, and it is re-measured
 * every time this parser runs rather than remembered.
 *
 * ## What this page carries that the vendor's calendar does not
 *
 * - The Clerk's own **submission deadline** per sitting.
 * - An **end** time: `Special (at 1:00 p.m. - 6:00 p.m.)` for 20 October. The
 *   grid publishes a start and nothing else.
 * - **Amendments in the publisher's own voice**: `Study Session ( at 2:00 p.m.
 *   ) * Amended to 1:30 p.m.` — the county saying it moved its own meeting.
 *
 * ## What it is NOT
 *
 * It is not an ingestion source and it does not produce `Meeting` rows. It is
 * read as CORROBORATION and as disposition evidence — `lib/sources/legistar-
 * insite/horizon.ts` puts its instances in the union with their own provenance,
 * and the meetings a reader sees still come from the routes that carry a room,
 * an agenda link and a per-meeting record. Promoting it to a producing source
 * would be adding an external source, which `CLAUDE.md` makes an ask-before.
 *
 * ## Permission
 *
 * `www.pima.gov/robots.txt`, read 2026-08-28: `Disallow: /` for **Baiduspider
 * and Yandex only**; `User-agent: *` carries no `Disallow` and no
 * `Crawl-delay`. Siteimprove's crawlers are asked for `Crawl-delay: 20`, which
 * is not us. Nothing here is disallowed.
 *
 * Nothing below concludes. A page that yields no rows is a failed extraction
 * for the caller to report as one — never a county with no meetings.
 */
import { decodeEntities } from "../http.ts";

/**
 * One sitting as the Clerk's table publishes it.
 *
 * `startTime` is null when the row named a meeting and did NOT name an hour —
 * which the table genuinely does, for the pre-May-2026 rows whose start is
 * carried in the page's prose instead. **Null is the honest value**: this route
 * published a meeting without a time, and inferring one from the prose rule
 * would be this parser generating a fact the table does not state.
 */
export interface ClerkScheduleInstance {
  /** `YYYY-MM-DD`, the body's own calendar date. */
  date: string;
  /** `HH:MM` 24-hour local, or null when the row published no hour. */
  startTime: string | null;
  /** `HH:MM` local, when the row published a range. The grid never does. */
  endTime: string | null;
  /** "Study Session", "Regular", "Special - Virtual Meeting" — as printed. */
  kind: string;
  /** The Clerk's submission deadline, `YYYY-MM-DD`, or null for `- - -`. */
  clerkDeadline: string | null;
  /** The Meeting Type cell entire, verbatim. The evidence for everything above. */
  publishedText: string;
  /** True when `startTime` came from an "Amended to …" note rather than the first hour. */
  amended: boolean;
}

/** `M/D/YY` or `M/D/YYYY` as the Clerk prints it, to `YYYY-MM-DD`. */
export function clerkDate(raw: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(raw.trim());
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // A two-digit year is read as 2000+YY. That is what the publisher means on a
  // page whose own heading says "January 2026 through June 2026", and it is
  // stated rather than assumed silently — a table that one day prints `1/6/99`
  // will produce 2099 and be wrong out loud rather than quietly.
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * `5:00 p.m.`, `9 a.m.`, `Noon` → `HH:MM`.
 *
 * "Noon" is in here because the Clerk writes it — `Board Retreat (Noon to 5:00
 * p.m.)` — and a parser that only knew digits would have read that sitting as
 * having no published time at all.
 */
export function clerkTime(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (/^noon$/.test(text)) return "12:00";
  if (/^midnight$/.test(text)) return "00:00";
  const match = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?$/.exec(text);
  if (!match) return null;
  const rawHour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (rawHour < 1 || rawHour > 12 || minute > 59) return null;
  const hour = (rawHour % 12) + (match[3] === "p" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Every clock the Clerk wrote in one fragment, in the order written. */
const TIME_PATTERN = /\b(?:noon|midnight|\d{1,2}(?::\d{2})?\s*[ap]\.?\s*m\.?)/gi;

function times(fragment: string): string[] {
  return [...fragment.matchAll(TIME_PATTERN)]
    .map((m) => clerkTime(m[0]))
    .filter((t): t is string => t !== null);
}

/**
 * Strip the table's own footnote markers and separators from a meeting kind.
 *
 * `*` and `**` are footnotes the page defines beneath the table ("Start time
 * for Study Sessions will be determined on a case-by-case basis"). They are
 * not part of the meeting's name and must not reach a reader — `CLAUDE.md`:
 * reader surfaces speak plain language.
 */
function cleanKind(raw: string): string {
  return raw
    .replace(/\*+/g, " ")
    .replace(/\bAmended to\b[\s\S]*$/i, " ")
    .replace(/^[\s,;:/·-]+|[\s,;:/·-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The instances one "Meeting Type" cell publishes — one, two, or none.
 *
 * **Two is the normal case and it is the whole point.** `Study Session (at 1:00
 * p.m.) * Regular (at 5:00 p.m.)` is ONE table row publishing TWO distinct
 * sittings of one body on one day, and a parser that took one meeting per row
 * would lose exactly the study sessions this workstream exists to recover.
 *
 * The segmentation is on the time parentheticals: each `(… time …)` closes one
 * sitting, and the text between the previous close and this open is that
 * sitting's kind. An `Amended to <time>` note in that gap belongs to the
 * PRECEDING sitting — the publisher writes the correction after the thing it
 * corrects — so it is applied backwards and removed from the next kind.
 */
export function parseMeetingTypeCell(
  cell: string,
  date: string,
  clerkDeadline: string | null,
): ClerkScheduleInstance[] {
  const instances: ClerkScheduleInstance[] = [];
  const groups = [...cell.matchAll(/\(([^()]*)\)/g)].filter((g) => times(g[1]).length > 0);

  let cursor = 0;
  for (const group of groups) {
    const gap = cell.slice(cursor, group.index);
    const inside = times(group[1]);

    // An amendment in the gap corrects the sitting already recorded.
    const amendment = /\bAmended to\s+([^*.]*?[ap]\.?\s*m\.?)/i.exec(gap);
    const previous = instances[instances.length - 1];
    if (amendment && previous) {
      const amended = clerkTime(amendment[1]);
      if (amended) {
        previous.startTime = amended;
        previous.amended = true;
      }
    }

    const kind = cleanKind(gap);
    instances.push({
      date,
      startTime: inside[0] ?? null,
      endTime: inside.length > 1 ? inside[inside.length - 1] : null,
      // A cell whose parenthetical has no preceding words is the body's own
      // regular sitting; the table's subject IS the Board, so "Regular" is what
      // it means and is what the surrounding rows say in full.
      kind: kind || "Regular",
      clerkDeadline,
      publishedText: cell,
      amended: false,
    });
    cursor = group.index + group[0].length;
  }

  // A trailing amendment, after the last parenthetical.
  const tail = cell.slice(cursor);
  const trailing = /\bAmended to\s+([^*.]*?[ap]\.?\s*m\.?)/i.exec(tail);
  const last = instances[instances.length - 1];
  if (trailing && last) {
    const amended = clerkTime(trailing[1]);
    if (amended) {
      last.startTime = amended;
      last.amended = true;
    }
  }

  if (instances.length > 0) return instances;

  // No parenthetical carried a clock. The row still NAMED a meeting, so it is
  // produced with a null time rather than discarded — "this county publishes a
  // sitting on this date and did not publish its hour" is a fact worth keeping,
  // and it is not the same fact as "no sitting".
  const kind = cleanKind(cell);
  if (!kind) return [];
  return [
    {
      date,
      startTime: null,
      endTime: null,
      kind,
      clerkDeadline,
      publishedText: cell,
      amended: false,
    },
  ];
}

/**
 * Every sitting the Clerk's schedule page publishes.
 *
 * Anchored on the table's own header — a `Board Meeting` column and a `Meeting
 * Type` column — rather than on a fixed column index, because the page carries
 * more than one table (the location notice is a one-cell table of its own) and
 * because a CivicPlus page's tables are hand-authored and get re-ordered.
 *
 * Returns `[]` when no table on the page has those headers. **That is a failed
 * extraction, not an empty schedule**, and the caller says so.
 */
export function parseClerkSchedule(html: string): ClerkScheduleInstance[] {
  const cellText = (fragment: string): string =>
    decodeEntities(fragment.replace(/<[^>]*>/g, " "))
      .replace(/ /g, " ")
      .replace(/\s+/g, " ")
      .trim();

  for (const table of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const rows = [...table[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) =>
      [...r[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/gi)].map((c) => cellText(c[0])),
    );

    const headerIndex = rows.findIndex(
      (cells) =>
        cells.some((c) => /^board meeting$/i.test(c)) &&
        cells.some((c) => /^meeting type$/i.test(c)),
    );
    if (headerIndex < 0) continue;

    const header = rows[headerIndex];
    const dateColumn = header.findIndex((c) => /^board meeting$/i.test(c));
    const typeColumn = header.findIndex((c) => /^meeting type$/i.test(c));
    const deadlineColumn = header.findIndex((c) => /deadline/i.test(c));

    const instances: ClerkScheduleInstance[] = [];
    for (const cells of rows.slice(headerIndex + 1)) {
      const date = clerkDate(cells[dateColumn] ?? "");
      if (!date) continue;
      const deadline =
        deadlineColumn >= 0 ? clerkDate(cells[deadlineColumn] ?? "") : null;
      instances.push(
        ...parseMeetingTypeCell(cells[typeColumn] ?? "", date, deadline),
      );
    }
    return instances;
  }

  return [];
}
