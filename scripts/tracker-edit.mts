/**
 * Edit `docs/tracker.csv` by ID, safely.
 *
 * Written 2026-08-18 (g19) after three sessions hand-rolled the same CSV
 * surgery with `sed`-shaped anchors. The tracker's Notes field is long,
 * quoted, comma-heavy prose; a positional edit against it is how a row grows
 * a duplicate or loses a column. This parses the file properly, edits by ID,
 * and refuses to write a file that fails the invariants CLAUDE.md states:
 * one row per ID, every row the same column count as the header.
 *
 * It never invents a date — pass stamps in, from `pnpm stamp`.
 *
 * Used as a library from a session's own script:
 *
 *   import { readTracker, setFields, appendNote, addRow, writeTracker } from "./tracker-edit.mts";
 */
import { readFileSync, writeFileSync } from "node:fs";

const PATH = "docs/tracker.csv";

export type Row = Record<string, string>;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function quote(v: string): string {
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export interface Tracker {
  header: string[];
  rows: Row[];
}

export function readTracker(): Tracker {
  const grid = parseCsv(readFileSync(PATH, "utf8"));
  const header = grid[0];
  const rows = grid.slice(1).map((cells) => {
    const r: Row = {};
    header.forEach((h, i) => (r[h] = cells[i] ?? ""));
    return r;
  });
  return { header, rows };
}

/** Overwrite named fields on an EXISTING row. Never appends a second row. */
export function setFields(t: Tracker, id: string, fields: Row): void {
  const hits = t.rows.filter((r) => r.ID === id);
  if (hits.length === 0) throw new Error(`tracker: no row ${id}`);
  if (hits.length > 1) throw new Error(`tracker: ${hits.length} rows share ${id}`);
  for (const [k, v] of Object.entries(fields)) {
    if (!t.header.includes(k)) throw new Error(`tracker: no column ${k}`);
    hits[0][k] = v;
  }
}

/** Append to a row's Notes with the ` || ` separator the file already uses. */
export function appendNote(t: Tracker, id: string, note: string): void {
  const hits = t.rows.filter((r) => r.ID === id);
  if (hits.length !== 1) throw new Error(`tracker: ${hits.length} rows for ${id}`);
  hits[0].Notes = hits[0].Notes ? `${hits[0].Notes} || ${note}` : note;
}

export function addRow(t: Tracker, row: Row): void {
  if (t.rows.some((r) => r.ID === row.ID))
    throw new Error(`tracker: ${row.ID} already exists`);
  const full: Row = {};
  for (const h of t.header) full[h] = row[h] ?? "";
  t.rows.push(full);
}

export function writeTracker(t: Tracker): void {
  // Invariants, checked before anything is written.
  const ids = t.rows.map((r) => r.ID);
  const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dupes.length > 0)
    throw new Error(`tracker: duplicate IDs ${[...new Set(dupes)].join(", ")}`);
  for (const r of t.rows) {
    for (const h of t.header) {
      if (!(h in r)) throw new Error(`tracker: row ${r.ID} missing column ${h}`);
    }
  }
  const out = [
    t.header.map(quote).join(","),
    ...t.rows.map((r) => t.header.map((h) => quote(r[h])).join(",")),
  ].join("\n");
  writeFileSync(PATH, out + "\n", "utf8");
  console.log(`tracker: wrote ${t.rows.length} rows, ${t.header.length} columns`);
}
