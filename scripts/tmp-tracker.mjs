/* Temporary tracker editor — deleted before handoff. Appends or replaces a
   row by ID, never leaving two rows with the same ID. */
import { readFileSync, writeFileSync } from "node:fs";

const PATH = "docs/tracker.csv";

function csvEscape(value) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function upsertRow(fields) {
  const [id] = fields;
  const line = fields.map(csvEscape).join(",");
  let text = readFileSync(PATH, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const rows = text.split(/\r?\n/);
  // A row may span multiple physical lines (quoted newlines); find the start
  // index of the row whose first field is the id, then the next row start.
  let start = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].startsWith(`${id},`)) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    const trimmed = text.replace(/[\r\n]+$/, "");
    writeFileSync(PATH, trimmed + eol + line + eol, "utf8");
    return "appended";
  }
  let end = start + 1;
  while (end < rows.length && !/^[A-Z]\d+,/.test(rows[end]) && rows[end] !== "") {
    end++;
  }
  rows.splice(start, end - start, line);
  writeFileSync(PATH, rows.join(eol), "utf8");
  return "replaced";
}

const [, , mode] = process.argv;
if (mode === "run") {
  const payload = JSON.parse(readFileSync(process.argv[3], "utf8"));
  for (const fields of payload) console.log(upsertRow(fields), fields[0]);
}
