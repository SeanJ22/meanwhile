/**
 * **THE ONE-TIME REBUILD** — `docs/tracker.csv` becomes the two stores.
 * (Prompt E items 5, 7 and 8. 2026-08-20.)
 *
 * This runs ONCE and is then history. It is committed rather than thrown away
 * because the derivation is the audit trail: a section assignment that nobody
 * can check is a section assignment nobody should believe, and 456 rows landed
 * in nine sections on the strength of the rules below.
 *
 * After this, `docs/tracker-working.csv` and `docs/tracker-resolved.csv` ARE
 * the tracker, `scripts/tracker.mjs` owns them, and `docs/tracker.csv` is a
 * frozen snapshot of what the tracker looked like the moment before.
 *
 * ## What was wrong with the thing it replaces
 *
 * Three things, and only the first is about presentation.
 *
 * 1. **It never emptied.** 456 rows, 315 finished, one view. The number the
 *    author looked at was 456 rather than the 141 that were actually left.
 * 2. **Its sections came from the dependency graph.** Correct for sequencing a
 *    session, useless for answering "where does New Hampshire stand", because
 *    New Hampshire work was scattered across every section by dependency depth.
 *    247 rows — 54% of the tracker — sat in a section called "Everything with
 *    no recorded prerequisite", which is not a place.
 * 3. **Rows were titled in engineering shorthand.** `D07 — OCD-ID resolution
 *    layer` tells a person who wrote it exactly what it means and tells anyone
 *    else nothing at all.
 *
 * ## The rules, in the order they are applied
 *
 * SECTION. First match wins, and every step is a lookup rather than a
 * judgement, so a disagreement is about the rule and not about the row.
 *   1. An explicit assignment in `docs/tracker-assignments.json`.
 *   2. The ballot-universe key a hunt row already carries in its own Detail —
 *      `[ballot-nh-merrimack:…]`, `[ballot-nj-morris:…]`, `[ballot-az-pima:…]`.
 *      The state is stated in the data; nothing is inferred from a place name.
 *   3. The legacy `Area`, through the map below.
 *
 * PRIORITY (RULING 29 — three levels, no fourth, ranked inside a section and
 * never across them).
 *   1. An explicit assignment.
 *   2. P3 where the row is parked, tabled or undecided — real work, no
 *      consequence to deferring.
 *   3. P1 where something is broken or stalled: the row is an open DEFECT, or
 *      another OPEN row cannot start until it closes.
 *   4. P2 otherwise — the section is not done without it.
 *
 * ATTRIBUTION (RULING 40): `scripts/tracker-attribution.mjs`, which is a git
 * lookup and not a guess. `UNKNOWN` is a defect and there are none.
 *
 * DESCRIPTION (item 8a): `docs/tracker-descriptions.json`, authored per row.
 * A row without one is a defect and the script refuses to write.
 *
 * Run:  node scripts/tracker-rebuild.mjs [--write]
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { attribute, labelFor } from "./tracker-attribution.mjs";
import {
  COLUMNS,
  RESOLVED_CSV,
  ROOT,
  WORKING_CSV,
  readSections,
  writeStore,
} from "./tracker-core.mjs";
import { parseCsv } from "./xlsx.mjs";

const WRITE = process.argv.includes("--write");

const ASSIGNMENTS = "docs/tracker-assignments.json";
const DESCRIPTIONS = "docs/tracker-descriptions.json";

/** The legacy `Area` field, mapped onto the nine sections. */
const AREA_TO_SECTION = {
  "Map & UI": "product-ui",
  Data: "data-infrastructure",
  "Repo & ops": "repo-ops",
  Ballot: "product-ui",
  Business: "needs-sean",
  "Ask anything": "product-ui",
  API: "data-infrastructure",
  Meetings: "data-infrastructure",
  "Core product": "product-ui",
  Coverage: "data-infrastructure",
  Validate: "needs-sean",
  Process: "constitution-rules",
  "Trust & risk": "needs-sean",
  Officials: "data-infrastructure",
  "Vendor review": "data-infrastructure",
  "Trust & launch": "needs-sean",
  Registry: "data-infrastructure",
  "Reader surfaces": "product-ui",
  Distribution: "needs-sean",
  "Cross-cutting": "constitution-rules",
  Standards: "constitution-rules",
  Reactions: "product-ui",
  "Copy & truth": "product-ui",
  Funding: "data-infrastructure",
};

/** The ballot-universe keys the hunt rows carry in their own Detail. */
const BALLOT_KEY_TO_SECTION = [
  [/\[ballot-nh-/, "nh-hunt"],
  [/\[ballot-nj-/, "nj-hunt"],
  [/\[ballot-az-/, "az-hunt"],
];

const DONE_STATUSES = ["Done", "Absorbed"];
const PARKED_STATUSES = ["Tabled", "Parked", "Undecided"];
/** A status that names a live defect rather than a plan. */
const DEFECT_STATUSES = ["Open"];

function readLegacy() {
  const grid = parseCsv(readFileSync(join(ROOT, "docs/tracker.csv"), "utf8"));
  const header = grid[0].map((h) => h.trim());
  return grid.slice(1).map((r) => {
    const row = {};
    header.forEach((h, i) => {
      row[h] = r[i] ?? "";
    });
    row.ID = row.ID.trim();
    return row;
  });
}

const json = (p, fallback) =>
  existsSync(join(ROOT, p)) ? JSON.parse(readFileSync(join(ROOT, p), "utf8")) : fallback;

/* ------------------------------------------------------------------ main --- */

const sections = readSections();
const sectionSlugs = new Set(sections.map((s) => s.slug));
const legacy = readLegacy();
const assignments = json(ASSIGNMENTS, { sections: {}, priorities: {} });
const descriptions = json(DESCRIPTIONS, {});
const { opened, closed } = attribute();

const isDone = (r) => DONE_STATUSES.includes((r.Status ?? "").trim());

/* Which OPEN rows are waiting on which. A row that another open row depends on
 * is blocking, and blocking is the P1 test. */
const blocks = new Set();
for (const r of legacy) {
  if (isDone(r)) continue;
  for (const dep of (r["Depends on"] ?? "").split(/[;,\s]+/)) {
    if (dep.trim()) blocks.add(dep.trim());
  }
}

function sectionFor(row) {
  if (assignments.sections[row.ID]) return assignments.sections[row.ID];
  const haystack = `${row.Detail ?? ""} ${row.Item ?? ""}`;
  for (const [re, slug] of BALLOT_KEY_TO_SECTION) if (re.test(haystack)) return slug;
  return AREA_TO_SECTION[(row.Area ?? "").trim()] ?? null;
}

function priorityFor(row) {
  if (assignments.priorities[row.ID]) return assignments.priorities[row.ID];
  const status = (row.Status ?? "").trim();
  if (PARKED_STATUSES.includes(status)) return "P3";
  if (DEFECT_STATUSES.includes(status)) return "P1";
  if (blocks.has(row.ID)) return "P1";
  return "P2";
}

const problems = [];
const working = [];
const resolved = [];

for (const row of legacy) {
  const section = sectionFor(row);
  if (!section) {
    problems.push(`${row.ID}: legacy Area "${row.Area}" maps to no section`);
    continue;
  }
  if (!sectionSlugs.has(section)) {
    problems.push(`${row.ID}: assigned to "${section}", which is not in the section list`);
    continue;
  }
  const description = descriptions[row.ID];
  if (!description) {
    problems.push(`${row.ID}: no description — item 8a, a defect and not a remainder`);
    continue;
  }
  const open = opened.get(row.ID);
  if (!open) {
    problems.push(`${row.ID}: no opening commit — RULING 40 says attribution is a lookup`);
    continue;
  }
  const close = closed.get(row.ID);
  const done = isDone(row);

  const out = {
    ID: row.ID,
    Section: section,
    Priority: done ? "" : priorityFor(row),
    Title: assignments.titles?.[row.ID] ?? row.Item,
    "What this is": description,
    /*
     * RULING 36's three states. A row the old tracker called Done is
     * `Resolved`; a row it called Absorbed is `Resolved` too, because absorbed
     * into another row is a decision that it is finished, and the row it went
     * into is named in its own session record.
     */
    Resolution: done ? "Resolved" : "",
    Condition: "",
    Notes: "",
    /*
     * RULING 39 — the stamp is written by the script. Here it is the DATE OF
     * THE COMMIT THAT CLOSED THE ROW, recovered from git, rather than today:
     * stamping 315 finished rows with today's date would erase eleven days of
     * history and replace it with the day somebody ran a migration.
     */
    "Resolved on": done ? (close?.date ?? "") : "",
    "Opened by": labelFor(open),
    "Closed by": done && close ? labelFor(close) : "",
    "Depends on": row["Depends on"] ?? "",
    "Legacy area": row.Area ?? "",
    Detail: row.Detail ?? "",
    "Session record": row.Notes ?? "",
  };
  (done ? resolved : working).push(out);
}

/* ----------------------------------------------------------------- report --- */

const total = working.length + resolved.length;
console.log(`\ntracker rebuild — ${legacy.length} legacy row(s) in\n`);

if (problems.length) {
  console.log(`  REFUSED — ${problems.length} row(s) could not be rebuilt:\n`);
  for (const p of problems.slice(0, 40)) console.log(`    ${p}`);
  if (problems.length > 40) console.log(`    … and ${problems.length - 40} more`);
  console.log("\n  Nothing written.\n");
  process.exit(1);
}

console.log(`  working store   ${working.length} open row(s)`);
console.log(`  resolved store  ${resolved.length} finished row(s)`);
console.log(`  the pair        ${working.length} + ${resolved.length} = ${total}, against ${legacy.length} in`);
if (total !== legacy.length) {
  console.log("\n  REFUSED — the pair does not reconcile. Nothing written.\n");
  process.exit(1);
}

console.log(`\n  per section (open · resolved):`);
for (const s of sections) {
  const w = working.filter((r) => r.Section === s.slug);
  const d = resolved.filter((r) => r.Section === s.slug);
  const p = (lvl) => w.filter((r) => r.Priority === lvl).length;
  console.log(
    `    ${s.title.padEnd(22)} ${String(w.length).padStart(4)} · ${String(d.length).padStart(4)}` +
      `   P1 ${p("P1")}  P2 ${p("P2")}  P3 ${p("P3")}`,
  );
}
const assigned = sections.reduce(
  (n, s) => n + working.filter((r) => r.Section === s.slug).length + resolved.filter((r) => r.Section === s.slug).length,
  0,
);
console.log(`\n  every row has a home: ${assigned} of ${total} — RULING 32, no holding section`);

if (WRITE) {
  writeFileSync(join(ROOT, WORKING_CSV), writeStore(working), "utf8");
  writeFileSync(join(ROOT, RESOLVED_CSV), writeStore(resolved), "utf8");
  console.log(`\n  written  ${WORKING_CSV}  (${COLUMNS.length} columns)`);
  console.log(`  written  ${RESOLVED_CSV}\n`);
} else {
  console.log(`\n  dry run — pass --write to write the stores\n`);
}
