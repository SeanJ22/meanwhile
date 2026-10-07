import { decodeEntities } from "../sources/http.ts";
import { statedCountIn } from "./count-assertion.ts";
import { extracted, zeroRows, cannotRun } from "./types.ts";
import type { ExtractResult } from "./types.ts";

/**
 * Layer 5: who sits on a board, read off the body's own roster table.
 *
 * Reads Drupal Views tables by their cell classes (`views-field-title` for the
 * person, `views-field-field-job-title` for office and term,
 * `views-field-field-staff-phone`), so the class names, not the column order,
 * are the contract. A table with no recognisable field classes falls back to
 * its `<thead>` labels (`Name` / `Title` / `Phone`).
 *
 * - It never infers a role: no title cell is `title: null`.
 * - It never parses a term into a date: the term is carried verbatim in
 *   `title`, and `termText` only when literally printed.
 * - It reads only the page it is given.
 *
 * Zero rows is a failed extraction (`ZERO_ROWS`), never "no members".
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
   * The contact route the page links for this person, usually a site contact
   * form, absolutised against the page URL. A form is not an email address.
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
 * The nearest heading above an offset: the section a table sits under. Read
 * backwards, because tables nest inside sections and a forward scan would pick
 * the wrong heading.
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

      // A row with no mapped name is a layout or spacer row.
      if (!row.name || mapped < 2) continue;
      // A header row inside `<tbody>` is not a person.
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
  /*
   * Check against the count the page's own prose states, not the `<tr>` count:
   * spacer, header and layout rows are legitimately skipped.
   */
  const stated = statedCountIn(textOf(html));
  return extracted<RosterRow>(
    LAYER,
    source,
    inputBytes,
    rows,
    { tables: tablesSeen, tablesRejected, people: rows.length },
    stated ??
      "the page carries no sentence stating how many people sit on this body, " +
        "so the table read cannot be checked against a denominator",
  );
}
