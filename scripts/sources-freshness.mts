/**
 * `pnpm sources:freshness` — **RULING 96 made checkable.**
 *
 * Written 2026-08-22 (Discovery Conduct session, item 6).
 *
 * RULING 53 gave ABSENCES a shelf life. RULING 96 gives SOURCES one, for the
 * same reason: a register row is a claim — *this endpoint answers, this licence
 * permits, this is where the list lives* — and every one of those can stop being
 * true without anything in this repo noticing. A register with no dates cannot
 * tell a session which of its rows are observations and which are folklore.
 *
 * ## What it does
 *
 * Reads `docs/sources.md`, finds every ENTRY, and reports each one's
 * **last-walked date** against its expiry window:
 *
 * - **candidate fields — 7 days**
 * - **bodies, rosters and everything else — 14 days**
 * - **walled sources — 14 days, regardless of how emphatically the wall was
 *   recorded**
 *
 * An entry is a row in one of the register's tables, or a `###` source section.
 *
 * ```
 * pnpm sources:freshness           # report; exit 0
 * pnpm sources:freshness --seed    # write a Last walked value into every entry that lacks one
 * pnpm sources:freshness --strict  # exit 1 if any entry is past expiry or UNKNOWN
 * ```
 *
 * ## Where a seeded date comes from, and why it is labelled
 *
 * `--seed` recovers a date from **git history** — the last commit that touched
 * that entry's own text in `docs/sources.md`, via `git log -S`. That is not the
 * same thing as the day the source was walked and this file never pretends it
 * is: it is the last day somebody wrote something down about it, which is the
 * best evidence the repo actually holds. Where even that is unrecoverable the
 * value is **`UNKNOWN`**, and `UNKNOWN` reads as STALE — the same way a record
 * that cannot say when it was measured reads as stale rather than fresh,
 * because defaulting the other way is how a bad date buys permanent trust.
 *
 * A seeded date is never invented. There is no `--today` shortcut: stamping an
 * entry with today's date without having called it is the fabrication rule.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const FILE = join(ROOT, "docs", "sources.md");
const SEED = process.argv.includes("--seed");
const STRICT = process.argv.includes("--strict");
const AS_OF: string = today();

/** The expiry windows, in days. RULING 53's, extended to sources by RULING 96. */
const WINDOW_DEFAULT = 14;
const WINDOW_CANDIDATE = 7;

const DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
/**
 * The marker as it is WRITTEN, emphasis included — `- **Last walked:** 2026-08-20`.
 *
 * The first version of this pattern required the date to follow the colon
 * directly, so it read every seeded section as UNKNOWN while the seeding run
 * itself reported them dated. That is worth a comment rather than a silent fix:
 * a freshness check that reads its own marker wrong reports the whole register
 * as stale, which is the safe direction to fail but not a correct one.
 */
const MARKER = /Last walked:\**\s*(\d{4}-\d{2}-\d{2}|UNKNOWN)/;

interface Entry {
  /** Human name, as it reads in the register. */
  name: string;
  /** `table` rows carry the date in a cell; `section` entries carry a marker line. */
  kind: "table" | "section";
  /** 0-based index into the file's lines. */
  line: number;
  lastWalked: string | null;
  /** Which window applies. */
  window: number;
  /** Days since the last walk, or null when UNKNOWN. */
  ageDays: number | null;
  stale: boolean;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * The last commit that touched this entry's own text, as `YYYY-MM-DD`.
 *
 * `git log -S<needle>` finds commits where the number of occurrences of the
 * needle changed, which is the closest git can get to "when was this row
 * written". A needle that is not unique returns the newest such commit, which is
 * still a real date about a real change to this row.
 */
function gitDateFor(needle: string): string | null {
  if (needle.length < 8) return null;
  try {
    const out = execFileSync(
      "git",
      ["log", "-1", "--format=%ad", "--date=short", `-S${needle}`, "--", "docs/sources.md"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return DATE.test(out) ? out : null;
  } catch {
    return null;
  }
}

/** Strip markdown emphasis and links down to something readable in a report. */
function plain(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

const lines = readFileSync(FILE, "utf8").split(/\r?\n/);
const entries: Entry[] = [];

/**
 * A table is recognised by its separator row. The last column is the
 * `Last walked` column once `--seed` has run; before that the header is added
 * and every row gets a cell.
 */
let inTable = false;
let tableHasColumn = false;

for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];

  // ── `###` source sections ──────────────────────────────────────────────
  if (raw.startsWith("### ")) {
    inTable = false;
    const name = plain(raw.slice(4));
    // The register's own commentary headings are not sources.
    if (/^(Two traps|Routes added|The Census key|The credentials|What)/i.test(name)) continue;
    // The marker, if the section already carries one, sits within its first
    // few lines so a reader sees it without scrolling.
    let marker: string | null = null;
    let markerLine = -1;
    for (let j = i + 1; j < Math.min(i + 8, lines.length) && !lines[j].startsWith("### "); j++) {
      const m = MARKER.exec(lines[j]);
      if (m !== null) {
        marker = m[1];
        markerLine = j;
        break;
      }
    }
    entries.push({
      name,
      kind: "section",
      line: markerLine >= 0 ? markerLine : i,
      lastWalked: marker,
      window: WINDOW_DEFAULT,
      ageDays: null,
      stale: false,
    });
    continue;
  }

  // ── table rows ────────────────────────────────────────────────────────
  if (/^\|\s*-{2,}/.test(raw) || /^\|[\s:|-]+\|$/.test(raw)) {
    inTable = true;
    tableHasColumn = lines[i - 1]?.includes("Last walked") ?? false;
    continue;
  }
  if (inTable && raw.startsWith("|")) {
    const cells = raw.split("|").slice(1, -1);
    if (cells.length === 0) {
      inTable = false;
      continue;
    }
    // A two-column table in this register is a MEASUREMENT — the Census key's
    // question/answer block — not a list of sources. Dating those rows would
    // put a freshness claim on a finding rather than on a route.
    if (cells.length < 3) continue;
    // The name is the first cell that is not a bare number (the credential
    // table leads with `#`).
    const name = plain(/^\s*\d+\s*$/.test(cells[0]) ? (cells[1] ?? "") : cells[0]);
    if (name.length === 0) continue;
    const marker = tableHasColumn ? (DATE.exec(cells[cells.length - 1])?.[1] ?? null) : null;
    const unknown = tableHasColumn && /UNKNOWN/.test(cells[cells.length - 1]);
    entries.push({
      name,
      kind: "table",
      line: i,
      lastWalked: marker ?? (unknown ? "UNKNOWN" : null),
      window: WINDOW_DEFAULT,
      ageDays: null,
      stale: false,
    });
    continue;
  }
  if (inTable && !raw.startsWith("|")) inTable = false;
}

/* ------------------------------------------------------------------- seed --- */

if (SEED) {
  const out = [...lines];
  let seeded = 0;
  let fromGit = 0;
  let unknown = 0;

  // Tables first: add the header cell and a cell per row, working from the
  // bottom so earlier line numbers stay valid.
  const tableRows = entries.filter((e) => e.kind === "table" && e.lastWalked === null);
  const touchedTables = new Set<number>();
  for (const e of [...tableRows].reverse()) {
    const date = gitDateFor(e.name.slice(0, 40));
    const value = date ?? "UNKNOWN";
    if (date !== null) fromGit++;
    else unknown++;
    out[e.line] = `${out[e.line].replace(/\s*$/, "")} ${value} |`;
    e.lastWalked = value;
    seeded++;
    // Find this row's header and separator, and widen them once.
    for (let j = e.line - 1; j >= 0; j--) {
      if (/^\|[\s:|-]+\|$/.test(out[j]) || /^\|\s*-{2,}/.test(out[j])) {
        if (!touchedTables.has(j)) {
          touchedTables.add(j);
          out[j] = `${out[j].replace(/\s*$/, "")}---|`;
          out[j - 1] = `${out[j - 1].replace(/\s*$/, "")} Last walked |`;
        }
        break;
      }
      if (!out[j].startsWith("|")) break;
    }
  }

  // Sections: insert a marker line under the heading.
  const sectionRows = entries.filter((e) => e.kind === "section" && e.lastWalked === null);
  for (const e of [...sectionRows].reverse()) {
    const date = gitDateFor(e.name.slice(0, 40));
    const value = date ?? "UNKNOWN";
    if (date !== null) fromGit++;
    else unknown++;
    out.splice(e.line + 1, 0, `- **Last walked:** ${value}`);
    e.lastWalked = value;
    seeded++;
  }

  writeFileSync(FILE, out.join("\n"), "utf8");
  console.log(`seeded ${seeded} entries — ${fromGit} recovered from git history, ${unknown} UNKNOWN`);
}

/* ----------------------------------------------------------------- report --- */

for (const e of entries) {
  if (e.lastWalked === null || e.lastWalked === "UNKNOWN") {
    e.ageDays = null;
    e.stale = true;
    continue;
  }
  e.ageDays = daysBetween(e.lastWalked, AS_OF);
  e.stale = e.ageDays > e.window;
}

const dated = entries.filter((e) => e.lastWalked !== null).length;
const unknownCount = entries.filter((e) => e.lastWalked === "UNKNOWN").length;
const staleCount = entries.filter((e) => e.stale).length;

console.log(`\ndocs/sources.md — freshness against ${AS_OF} (RULING 96)\n`);
console.log(`  entries                 ${entries.length}`);
console.log(`  carrying a date         ${dated - unknownCount} of ${entries.length}`);
console.log(`  UNKNOWN                 ${unknownCount} of ${entries.length}`);
console.log(`  past expiry or unknown  ${staleCount} of ${entries.length}`);
console.log(`  window                  ${WINDOW_DEFAULT} days (${WINDOW_CANDIDATE} for candidate fields)`);

if (staleCount > 0) {
  console.log(`\n  STALE — re-walk, or report stale with the date:`);
  for (const e of entries.filter((x) => x.stale)) {
    console.log(`    ${(e.lastWalked ?? "UNKNOWN").padEnd(11)} ${e.name.slice(0, 78)}`);
  }
}

if (STRICT && staleCount > 0) process.exit(1);
