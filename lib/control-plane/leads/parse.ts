/**
 * Reads research leads from pasted text or a CSV (an Excel sheet arrives as
 * CSV). Pure: text in, rows out, plus an account of everything not taken.
 *
 * ```
 *   a table     a header row naming a link column (link, url, website...);
 *               every other column is kept as the row's notes
 *   a list      one lead per line: the first web address on the line is the
 *               link, and the rest of the line is its note
 *   repeats     the same link again is kept once and counted
 * ```
 */

import { csvRows, delimiterOf, type SkippedRows } from "../bulk-hunts/parse.ts";
import { canonicalLeadUrl, LEAD_LINK_MAX_CHARS, LEAD_NOTE_KEYS_MAX, LEAD_NOTE_MAX_CHARS } from "./order.ts";

export interface ParsedLead {
  /** The row's number in the upload, from 1. */
  readonly n: number;
  readonly link: string;
  readonly notes: Readonly<Record<string, string>>;
}

export interface ParsedLeads {
  readonly leads: readonly ParsedLead[];
  readonly duplicates: number;
  readonly skipped: readonly SkippedRows[];
  /** The link column a table was read by, and the columns kept as notes. */
  readonly columns: { readonly link: string; readonly notes: readonly string[] } | null;
}

export const LINK_COLUMN = /^(?:link|links|url|urls|href|website|web ?site|web ?address|web ?page|page|lead|leads|source ?url)$/i;
const LINK_TOKEN = /^(?:[a-z][a-z0-9+.-]*:\/\/\S+|www\.\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?)$/i;
const EXAMPLES = 5;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

class Leads {
  readonly leads: ParsedLead[] = [];
  readonly seen = new Set<string>();
  duplicates = 0;
  private readonly skips = new Map<string, { count: number; examples: string[] }>();

  skip(why: string, example: string): void {
    const held = this.skips.get(why) ?? { count: 0, examples: [] };
    held.count += 1;
    if (held.examples.length < EXAMPLES && example !== "") held.examples.push(clip(example, 40));
    this.skips.set(why, held);
  }

  add(link: string, notes: Record<string, string>): void {
    const key = canonicalLeadUrl(link) ?? link.trim();
    if (this.seen.has(key)) {
      this.duplicates += 1;
      return;
    }
    this.seen.add(key);
    this.leads.push({ n: this.leads.length + 1, link: link.trim().slice(0, LEAD_LINK_MAX_CHARS), notes });
  }

  skipped(): SkippedRows[] {
    return [...this.skips.entries()].map(([why, v]) => ({ why, count: v.count, examples: v.examples }));
  }
}

/** A file with a header row naming a link column, or a pasted list with one lead per line. */
export function parseLeads(text: string): ParsedLeads {
  const body = text.replace(/^﻿/, "");
  const firstLine = body.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = delimiterOf(firstLine);
  const header = firstLine.split(delimiter).map((h) => h.trim().replace(/^"|"$/g, ""));
  const linkCol = header.findIndex((h) => LINK_COLUMN.test(h));
  return linkCol >= 0 ? fromTable(body, delimiter, linkCol) : fromList(body);
}

function fromTable(text: string, delimiter: string, linkCol: number): ParsedLeads {
  const rows = csvRows(text, delimiter);
  const header = (rows[0] ?? []).map((h, i) => h.trim() || `Column ${i + 1}`);
  const noteCols = header.map((name, i) => ({ name, i })).filter((c) => c.i !== linkCol).slice(0, LEAD_NOTE_KEYS_MAX);
  const out = new Leads();
  for (const row of rows.slice(1)) {
    const link = (row[linkCol] ?? "").trim();
    const notes: Record<string, string> = {};
    for (const c of noteCols) {
      const value = (row[c.i] ?? "").trim();
      if (value !== "") notes[c.name] = clip(value, LEAD_NOTE_MAX_CHARS);
    }
    if (link === "") {
      out.skip("no link in the row", Object.values(notes)[0] ?? "");
      continue;
    }
    out.add(link, notes);
  }
  return { leads: out.leads, duplicates: out.duplicates, skipped: out.skipped(), columns: { link: header[linkCol]!, notes: noteCols.map((c) => c.name) } };
}

function fromList(text: string): ParsedLeads {
  const out = new Leads();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const tokens = line.split(/[\s,;]+/).filter((t) => t !== "");
    const at = tokens.findIndex((t) => LINK_TOKEN.test(t.replace(/^[<("']+|[>)"'.]+$/g, "")));
    if (at < 0) {
      out.skip("no link in the row", line.trim());
      continue;
    }
    const link = tokens[at]!.replace(/^[<("']+|[>)"'.]+$/g, "");
    const rest = line.replace(tokens[at]!, " ").replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "");
    out.add(link, rest === "" ? {} : { Note: clip(rest, LEAD_NOTE_MAX_CHARS) });
  }
  return { leads: out.leads, duplicates: out.duplicates, skipped: out.skipped(), columns: null };
}
