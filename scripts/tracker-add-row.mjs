/**
 * Add ONE new row to `docs/tracker.csv`, appended at the end.
 *
 * Usage: node scripts/tracker-add-row.mjs <json-file>
 * where the JSON is `{ ID, Area, Item, Detail, Priority, Status, "Depends on",
 * Target, Notes }` — every key optional except ID.
 *
 * Refuses when the ID already exists (a tracker with two rows per ID cannot
 * be read by anything, CLAUDE.md), and prints the row count before and after
 * so an append that appended nothing cannot report success.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , jsonPath] = process.argv;
if (!jsonPath) {
  console.error("usage: tracker-add-row.mjs <json-file>");
  process.exit(1);
}
const row = JSON.parse(readFileSync(jsonPath, "utf8"));
if (!row.ID) {
  console.error("row has no ID");
  process.exit(1);
}

const FILE = "docs/tracker.csv";
const raw = readFileSync(FILE, "utf8");
const lines = raw.split(/\r?\n/);
const header = lines[0].split(",");

const idRe = new RegExp("^" + row.ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ",");
const clash = lines.filter((l) => idRe.test(l));
if (clash.length > 0) {
  console.error(`tracker: ID ${row.ID} already exists — edit that row instead`);
  process.exit(1);
}

const cell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
};
const encoded = header.map((h) => cell(row[h])).join(",");

const before = lines.filter(Boolean).length;
const body = raw.endsWith("\n") ? raw : raw + "\n";
writeFileSync(FILE, body + encoded + "\n", "utf8");
const after = readFileSync(FILE, "utf8").split(/\r?\n/).filter(Boolean).length;

console.log(`${row.ID} added; rows ${before} -> ${after}`);
if (after !== before + 1) {
  console.error("ROW COUNT DID NOT MOVE BY EXACTLY ONE");
  process.exit(1);
}
