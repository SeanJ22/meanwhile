/**
 * Reads a list of ZIPs from pasted text or a CSV. Pure: text in, ZIPs out, plus
 * an account of everything not taken.
 *
 * ```
 *   a ZIP         five digits, or ZIP+4 cut back to five
 *   lost zero     four digits (a spreadsheet dropped the leading zero) are
 *                 padded and counted
 *   removed       a row whose evidence says the ZIP left the district in a
 *                 redraw is skipped and counted
 *   not a ZIP     anything else in a pasted list is named, never dropped quietly
 * ```
 *
 * A column named district (or group, name, place) becomes the group a ZIP is
 * shown under.
 */

export interface ParsedZip {
  readonly zip: string;
  /** The district or name the file put this ZIP under, when it had one. */
  readonly group: string | null;
}

export interface SkippedRows {
  readonly why: string;
  readonly count: number;
  /** A few examples, so the owner can see what was skipped. */
  readonly examples: readonly string[];
}

export interface ParsedZips {
  readonly zips: readonly ParsedZip[];
  /** ZIPs that arrived four digits long and were padded with a leading zero. */
  readonly paddedZeros: number;
  /** The same ZIP listed again; kept once. */
  readonly duplicates: number;
  readonly skipped: readonly SkippedRows[];
  /** Which columns a file was read by, for the preview line. */
  readonly columns: { readonly zip: string; readonly group: string | null } | null;
}

export const BULK_MAX_ZIPS = 5000;
const EXAMPLES = 5;
export const ZIP_COLUMN = /^(?:zip|zips|zcta|zcta5|zip_?code|zipcode|postal_?code|zip5)$/i;
const GROUP_COLUMN = /^(?:district|group|name|place|area|label|cd)$/i;

class Skips {
  private readonly byWhy = new Map<string, { count: number; examples: string[] }>();
  add(why: string, example: string): void {
    const held = this.byWhy.get(why) ?? { count: 0, examples: [] };
    held.count += 1;
    if (held.examples.length < EXAMPLES && example !== "") held.examples.push(example);
    this.byWhy.set(why, held);
  }
  list(): SkippedRows[] {
    return [...this.byWhy.entries()].map(([why, v]) => ({ why, count: v.count, examples: v.examples }));
  }
}

/** One cell as a ZIP, or null with the reason. */
function zipOf(raw: string): { readonly zip: string; readonly padded: boolean } | { readonly why: string } {
  const t = raw.trim().replace(/^'+/, "");
  if (/^\d{5}(?:-\d{4})?$/.test(t)) return { zip: t.slice(0, 5), padded: false };
  if (/^\d{4}$/.test(t)) return { zip: `0${t}`, padded: true };
  if (t === "") return { why: "no ZIP in the row" };
  return { why: "not a five-digit ZIP" };
}

/** RFC 4180 rows: quoted cells, doubled quotes, commas and line breaks inside quotes. */
export function csvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

function delimiterOf(firstLine: string): string {
  const counts = [",", "\t", ";"].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** A file with a header row naming a ZIP column, or a plain pasted list. */
export function parseZips(text: string): ParsedZips {
  const body = text.replace(/^﻿/, "");
  const firstLine = body.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = delimiterOf(firstLine);
  const header = firstLine.split(delimiter).map((h) => h.trim().replace(/^"|"$/g, ""));
  const zipCol = header.findIndex((h) => ZIP_COLUMN.test(h));
  return zipCol >= 0 ? fromTable(body, delimiter, zipCol, header) : fromList(body);
}

function fromList(text: string): ParsedZips {
  const skips = new Skips();
  const seen = new Set<string>();
  const zips: ParsedZip[] = [];
  let paddedZeros = 0;
  let duplicates = 0;
  for (const token of text.split(/[\s,;]+/)) {
    if (token === "") continue;
    const z = zipOf(token);
    if ("why" in z) {
      skips.add(z.why, token.slice(0, 30));
      continue;
    }
    if (z.padded) paddedZeros += 1;
    if (seen.has(z.zip)) {
      duplicates += 1;
      continue;
    }
    seen.add(z.zip);
    zips.push({ zip: z.zip, group: null });
  }
  return { zips, paddedZeros, duplicates, skipped: skips.list(), columns: null };
}

function fromTable(text: string, delimiter: string, zipCol: number, header: readonly string[]): ParsedZips {
  const rows = csvRows(text, delimiter);
  const groupCol = header.findIndex((h, i) => i !== zipCol && GROUP_COLUMN.test(h));
  const evidenceCol = header.findIndex((h) => /^evidence$/i.test(h));
  const activeCol = header.findIndex((h) => /^active$/i.test(h));
  const skips = new Skips();
  const seen = new Set<string>();
  const zips: ParsedZip[] = [];
  let paddedZeros = 0;
  let duplicates = 0;
  for (const row of rows.slice(1)) {
    const cell = (i: number): string => (i >= 0 ? (row[i] ?? "").trim() : "");
    const raw = cell(zipCol);
    const z = zipOf(raw);
    if ("why" in z) {
      skips.add(z.why, raw === "" ? cell(groupCol) : raw.slice(0, 30));
      continue;
    }
    if (/^REMOVED/i.test(cell(evidenceCol))) {
      skips.add("the file marks it as removed from the district", z.zip);
      continue;
    }
    if (activeCol >= 0 && /^(?:false|no|0|n)$/i.test(cell(activeCol))) {
      skips.add("the file marks it as not active", z.zip);
      continue;
    }
    if (z.padded) paddedZeros += 1;
    if (seen.has(z.zip)) {
      duplicates += 1;
      continue;
    }
    seen.add(z.zip);
    zips.push({ zip: z.zip, group: cell(groupCol) || null });
  }
  return { zips, paddedZeros, duplicates, skipped: skips.list(), columns: { zip: header[zipCol], group: groupCol >= 0 ? header[groupCol] : null } };
}
