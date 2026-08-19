/**
 * Append text to one tracker row's Notes cell — a status change EDITS the
 * existing row and never appends a second row with the same ID (CLAUDE.md).
 *
 * Usage:
 *   node scripts/tracker-append-note.mjs <ID> <note-file> [--status=<Status>]
 *
 * Reads and rewrites `docs/tracker.csv` as CSV (quotes and embedded commas
 * intact), refuses when the ID is absent or appears twice, and prints the
 * before/after row count so a no-op edit cannot report success — the
 * verify-the-result rule applied to the instrument itself.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , id, notePath, ...rest] = process.argv;
if (!id || !notePath) {
  console.error("usage: tracker-append-note.mjs <ID> <note-file> [--status=X]");
  process.exit(1);
}
const statusArg = rest.find((a) => a.startsWith("--status="));
const newStatus = statusArg ? statusArg.slice("--status=".length) : null;

const FILE = "docs/tracker.csv";
const raw = readFileSync(FILE, "utf8");

/** Split CSV into rows of cells, honouring quotes and embedded newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c === "\r") {
      /* ignore */
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  // A trailing newline yields one empty final row. Dropping it here — and
  // writing exactly one newline back — is what keeps a note append from
  // growing the file by a blank row every time it runs.
  if (rows.length > 1) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === "") rows.pop();
  }
  return rows;
}

function encode(rows) {
  return rows
    .map((r) =>
      r
        .map((c) =>
          /[",\n]/.test(c) ? '"' + c.replaceAll('"', '""') + '"' : c,
        )
        .join(","),
    )
    .join("\n");
}

const rows = parseCsv(raw);
const header = rows[0];
const idCol = header.indexOf("ID");
const statusCol = header.indexOf("Status");
const notesCol = header.indexOf("Notes");
if (idCol < 0 || statusCol < 0 || notesCol < 0) {
  console.error("tracker header missing ID/Status/Notes");
  process.exit(1);
}

const matches = rows
  .map((r, i) => [r, i])
  .filter(([r], i) => i > 0 && r[idCol] === id);
if (matches.length === 0) {
  console.error(`tracker: no row with ID ${id} — refusing to invent one`);
  process.exit(1);
}
if (matches.length > 1) {
  console.error(
    `tracker: ${matches.length} rows carry ID ${id} — a duplicate pair, fix that first`,
  );
  process.exit(1);
}

const before = rows.length;
const [target] = matches[0];
const note = readFileSync(notePath, "utf8").replace(/\r?\n/g, " ").trimEnd();
const oldStatus = target[statusCol];
target[notesCol] = (target[notesCol] ?? "") + note;
if (newStatus) target[statusCol] = newStatus;

writeFileSync(FILE, encode(rows) + "\n", "utf8");

const after = parseCsv(readFileSync(FILE, "utf8")).length;
console.log(
  `${id}: rows ${before} -> ${after}; status ${oldStatus} -> ${target[statusCol]}; notes +${note.length} chars`,
);
if (after !== before) {
  console.error("ROW COUNT MOVED — that is never right for a note append");
  process.exit(1);
}
