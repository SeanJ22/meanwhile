import { decodeEntities } from "../sources/http.ts";
import { extracted, zeroRows, cannotRun } from "./types.ts";
import type { ExtractResult } from "./types.ts";

/**
 * **LAYER 5 — THE ROSTER TABLE** (NH Hunt, 2026-08-20).
 *
 * Who sits on a board, read off the body's own page.
 *
 * ## Why this had to be built rather than hunted around
 *
 * `CLAUDE.md`: *where a tool does not exist to reach a public record, BUILD
 * IT.* The wall was not access — Newbury's Selectboard page answers 200 to a
 * plain fetch with an identified `User-Agent`. The wall was that the three
 * members, their titles and their term-expiry years sit inside a `views-table`
 * whose only distinguishing marks are CSS class names, and this repository had
 * no layer that could turn one of those into rows. Layer 4 reads an embedded
 * JSON payload; there is none here. The text layer reads a PDF. So the roster
 * was reachable and unreadable, which is difficulty, and difficulty is
 * friction rather than refusal.
 *
 * ## What it reads, and how wide the class is
 *
 * Drupal 7 **Views** tables, which is what a very large number of New England
 * municipal sites are built on — Newbury runs `Drupal 7` (its own `generator`
 * meta tag) and renders every board page as `Staff Contacts` and
 * `Board Members` sections, each a `<table class="views-table">` whose cells
 * carry `views-field-<machine-name>` classes: `views-field-title` for the
 * person, `views-field-field-job-title` for the office and term,
 * `views-field-field-staff-phone` for the number.
 *
 * **The class names are the contract, not the column order**, which is what
 * makes this survive a site adding a column. A table with no recognisable
 * field classes falls back to the `<thead>` labels, so a hand-built roster
 * table with `Name` / `Title` / `Phone` headers reads too — that is the second
 * shape, and it is common on the same sites for committees the Views module
 * was never wired for.
 *
 * ## What it deliberately does not do
 *
 * - **It never infers a role.** A person with no title cell gets `title: null`
 *   and the caller renders the gap; "Member" is not assumed.
 * - **It never parses a term into a date.** `Member (March 2027)` is carried
 *   verbatim in `title` and the year is offered separately in `termText` only
 *   when it is literally printed. A term inferred from a cycle would be a
 *   generated fact about a named person.
 * - **It reads the page it is given.** Following a `/user/NNNN/contact` link
 *   to an email form is a separate rung and a separate call.
 *
 * A zero-row extraction is a FAILED extraction: a board page with no roster
 * table reports `ZERO_ROWS` naming the tables it saw and rejected, never "this
 * board has no members".
 */

export interface RosterRow {
  /** The section heading the table sat under: "Board Members", "Staff Contacts". */
  section: string;
  /** The person, exactly as the page writes it, whitespace collapsed. */
  name: string;
  /** Office and, where printed, term — `"Chair (March 2026)"`. Null when the page prints none. */
  title: string | null;
  /** Phone exactly as published. Null when the row carries none. */
  phone: string | null;
  /** Email exactly as published. Null when the row carries none. */
  email: string | null;
  /**
   * The contact route the page links for this person — usually a site contact
   * form at `/user/NNNN/contact`, absolutised against the page URL when one is
   * given. A form is a working contact; it is not an email address and is
   * never rendered as one.
   */
  contactUrl: string | null;
  /** The bracketed term text, when the title literally prints one. */
  termText: string | null;
}

const LAYER = "ROSTER_TABLE" as const;

/** Cell-class → field, the Drupal Views machine names these pages emit. */
const FIELD_CLASS: Array<[RegExp, keyof RosterRow]> = [
  [/views-field-title\b/, "name"],
  [/views-field-field-job-title\b/, "title"],
  [/views-field-field-staff-phone\b/, "phone"],
  [/views-field-field-staff-email\b/, "email"],
  [/views-field-field-phone\b/, "phone"],
  [/views-field-field-email\b/, "email"],
];

/** Header-label → field, for the hand-built tables on the same sites. */
const HEADER_LABEL: Array<[RegExp, keyof RosterRow]> = [
  [/^name$/i, "name"],
  [/^(title|position|office|role)$/i, "title"],
  [/^(phone|telephone|phone number)$/i, "phone"],
  [/^e-?mail$/i, "email"],
];

const TERM = /\(([^)]*\b(?:19|20)\d{2}\b[^)]*)\)/;

function textOf(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  ).trim();
}

function hrefIn(html: string, base: string | null): string | null {
  const m = /<a[^>]*href="([^"]+)"/i.exec(html);
  if (!m) return null;
  const href = decodeEntities(m[1]);
  if (/^https?:/i.test(href)) return href;
  if (!base) return href;
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function mailtoIn(html: string): string | null {
  const m = /href="mailto:([^"?]+)/i.exec(html);
  return m ? decodeEntities(m[1]) : null;
}

/**
 * The nearest heading ABOVE an offset — the section a table sits under.
 *
 * Read backwards from the table rather than forwards from the heading, because
 * these pages nest the table two `<div>`s deep inside a `<section>` and a
 * forward scan would attribute a table to whichever heading happened to be
 * closest in document order rather than to the one that governs it.
 */
function sectionAbove(html: string, at: number): string {
  const before = html.slice(0, at);
  const headings = [...before.matchAll(/<h[1-4][^>]*>([\s\S]{0,200}?)<\/h[1-4]>/gi)];
  const last = headings[headings.length - 1];
  return last ? textOf(last[1]) : "";
}

/**
 * Read every roster table on one HTML page.
 *
 * @param html   the page bytes as text
 * @param source what was read, for the report
 * @param pageUrl the page's own URL, so a relative contact link absolutises
 */
export function extractRosterTables(
  html: string,
  source: string,
  pageUrl: string | null = null,
): ExtractResult<RosterRow> {
  const inputBytes = Buffer.byteLength(html, "utf8");
  if (!/<table/i.test(html)) {
    return cannotRun<RosterRow>(
      LAYER,
      source,
      "the document carries no <table> at all — this layer reads roster " +
        "TABLES, and a page that lists its board in prose needs a different rung",
      { bytes: inputBytes },
    );
  }

  const rows: RosterRow[] = [];
  let tablesSeen = 0;
  let tablesRejected = 0;

  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)];
  for (const table of tables) {
    tablesSeen += 1;
    const block = table[0];
    const section = sectionAbove(html, table.index ?? 0);

    // The header labels, for the fallback mapping.
    const headerCells = [
      ...(/<thead[\s\S]*?<\/thead>/i.exec(block)?.[0] ?? "").matchAll(
        /<th[^>]*>([\s\S]*?)<\/th>/gi,
      ),
    ].map((m) => textOf(m[1]));

    const bodyBlock = /<tbody[\s\S]*?<\/tbody>/i.exec(block)?.[0] ?? block;
    const trs = [...bodyBlock.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    let produced = 0;

    for (const tr of trs) {
      const cells = [...tr[1].matchAll(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi)].map((m) => m[0]);
      if (cells.length === 0) continue;

      const row: RosterRow = {
        section,
        name: "",
        title: null,
        phone: null,
        email: null,
        contactUrl: null,
        termText: null,
      };
      let mapped = 0;

      cells.forEach((cell, i) => {
        const value = textOf(cell);
        const byClass = FIELD_CLASS.find(([re]) => re.test(cell))?.[1];
        const byHeader = HEADER_LABEL.find(([re]) => re.test(headerCells[i] ?? ""))?.[1];
        const field = byClass ?? byHeader;
        if (!field) return;
        mapped += 1;
        if (field === "name") {
          row.name = value;
          row.contactUrl = hrefIn(cell, pageUrl);
        } else if (field === "title") {
          row.title = value || null;
        } else if (field === "phone") {
          row.phone = value || null;
        } else if (field === "email") {
          row.email = mailtoIn(cell) ?? (value || null);
        }
      });

      // A row with no mapped name is a layout row, a spacer, or a table this
      // layer has no business reading. Counted, never guessed at.
      if (!row.name || mapped < 2) continue;
      /*
       * A HEADER ROW INSIDE `<tbody>` is not a person, and Kearsarge's
       * district-office table has exactly one — `Name | Position | Phone` as
       * an ordinary `<tr>` under `<tbody>`, with the same cell classes as the
       * fourteen real rows below it. The first run of this layer carried
       * "Name" into the roster as the district's fifteenth staff member, which
       * is a fabricated person on a public body's page and the one thing this
       * whole toolkit exists to refuse.
       */
      if (HEADER_LABEL.some(([re]) => re.test(row.name))) continue;
      row.email ??= mailtoIn(tr[1]);
      const term = row.title ? TERM.exec(row.title) : null;
      row.termText = term ? term[1].trim() : null;
      rows.push(row);
      produced += 1;
    }
    if (produced === 0) tablesRejected += 1;
  }

  if (rows.length === 0) {
    return zeroRows<RosterRow>(
      LAYER,
      source,
      inputBytes,
      `read ${tablesSeen} table(s) and mapped no person row out of any of them — ` +
        "a failed extraction against this page, never a board with no members",
      { tables: tablesSeen, tablesRejected },
    );
  }
  return extracted<RosterRow>(LAYER, source, inputBytes, rows, {
    tables: tablesSeen,
    tablesRejected,
    people: rows.length,
  });
}
