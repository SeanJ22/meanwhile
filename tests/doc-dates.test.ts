import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  SCAN_EXEMPT,
  classify,
  readAllowlist,
  scanText,
  scanTrackerCsv,
  today,
} from "../scripts/doc-dates.mjs";

/**
 * No document in this repo may carry a date later than today.
 *
 * The defect that named this test: `CLAUDE.md` carried three rules stamped
 * "Adopted 2026-08-16", "2026-08-17" and "2026-08-19" — every one of them
 * later than the file's own last modification and later than every commit in
 * the repo. An agent produced a plausible date instead of reading one. That
 * is a fabricated claim about when a decision was made, in the file that
 * holds this product's constraints, and it is the same class of failure as a
 * generated candidate position: nobody checked, and it read fine.
 *
 * The comparison is against the **`America/Phoenix`** day, not UTC. A UTC
 * read after 5pm local is a day ahead, which would let a stamp written this
 * evening pass as tomorrow's — this bug's smaller sibling, and the reason
 * `pnpm stamp` exists.
 *
 * The scanner is shared with the pre-commit hook (`scripts/doc-dates.mjs`)
 * so the two can never drift apart.
 */

/* ------------------------------------------------------------ allowlist --- */

/**
 * The literal allowlist. Every entry is a future date that exists in the
 * tree TODAY and is not failing the suite yet — each one pinned to its file
 * and its exact occurrence count, so re-using a tolerated date to write a
 * *new* fabricated stamp still fails. An allowlist without counts is a hole;
 * this one is a record.
 *
 * Nothing here is a judgement about whether the date is right. The entries
 * are an inventory the author decides on, and every run prints them as
 * warnings with a count so they cannot rot quietly.
 *
 * Two groups:
 *
 *   AUTHOR_DECISION — the three stamps in `CLAUDE.md` that started this.
 *     `pnpm verify-stamps` recovers each rule's real introduction date from
 *     git history into `docs/stamp-audit.md`; **each of these three entries
 *     is deleted when the author approves the corrected date**, and the
 *     stamp in `CLAUDE.md` is changed in the same commit. R14.
 *
 *   PRE_EXISTING — the other 26 (file, date) pairs, 118 occurrences, found
 *     when this test first ran. The author expected three; the scan found
 *     123. They are enumerated rather than excluded because this project's
 *     rule is that a gap is recorded, never smoothed — an unenumerated
 *     "known failures" escape hatch is how a check stops being one. Most
 *     appear to be the session-label convention (state.md §18: labels that
 *     ran ahead of the wall clock, history deliberately not rewritten) and
 *     some are genuinely future events (2026-11-03 is the general election).
 *     Sorting them is the author's call, tracked as R16 — not this test's.
 */
const ALLOWLIST = [
  // ---- AUTHOR_DECISION (R14) — delete each entry when the author approves
  // ---- the corrected date in docs/stamp-audit.md.
  { file: "CLAUDE.md", date: "2026-08-16", count: 2, group: "AUTHOR_DECISION" },
  { file: "CLAUDE.md", date: "2026-08-17", count: 2, group: "AUTHOR_DECISION" },
  { file: "CLAUDE.md", date: "2026-08-19", count: 1, group: "AUTHOR_DECISION" },

  // ---- PRE_EXISTING (R16) — the inventory as it stood when this test landed
  // ---- on 2026-08-14. Deleted per entry as the author rules on each file.
  { file: "docs/ballot-research-2026.md", date: "2026-09-14", count: 1, group: "PRE_EXISTING" },
  { file: "docs/ballot-research-2026.md", date: "2026-11-03", count: 1, group: "PRE_EXISTING" },
  { file: "docs/coverage-audit-by-county.md", date: "2026-08-17", count: 14, group: "PRE_EXISTING" },
  { file: "docs/defects.md", date: "2026-08-15", count: 1, group: "PRE_EXISTING" },
  { file: "docs/defects.md", date: "2026-08-19", count: 1, group: "PRE_EXISTING" },
  { file: "docs/intake-report.md", date: "2026-08-15", count: 3, group: "PRE_EXISTING" },
  { file: "docs/officials-audit.md", date: "2026-08-16", count: 1, group: "PRE_EXISTING" },
  { file: "docs/photo-report.md", date: "2026-08-15", count: 4, group: "PRE_EXISTING" },
  { file: "docs/photo-report.md", date: "2026-08-19", count: 1, group: "PRE_EXISTING" },
  { file: "docs/source-ladder.md", date: "2026-08-15", count: 7, group: "PRE_EXISTING" },
  { file: "docs/source-ladder.md", date: "2026-08-16", count: 3, group: "PRE_EXISTING" },
  { file: "docs/source-ladder.md", date: "2026-08-17", count: 5, group: "PRE_EXISTING" },
  { file: "docs/source-ladder.md", date: "2026-08-18", count: 2, group: "PRE_EXISTING" },
  { file: "docs/state.md", date: "2026-08-15", count: 5, group: "PRE_EXISTING" },
  { file: "docs/state.md", date: "2026-08-16", count: 3, group: "PRE_EXISTING" },
  { file: "docs/state.md", date: "2026-08-17", count: 4, group: "PRE_EXISTING" },
  { file: "docs/state.md", date: "2026-08-18", count: 5, group: "PRE_EXISTING" },
  // Was 5. The §7 branch paragraph was rewritten this session to record the
  // current branch, and the label it carried — "(2026-08-19)" on a line that
  // now reads "Previously" — became `session label 0819` rather than being
  // left to read as a wall-clock date. The pin follows the tree, or it stops
  // being a pin.
  { file: "docs/state.md", date: "2026-08-19", count: 4, group: "PRE_EXISTING" },
  { file: "docs/state.md", date: "2026-11-03", count: 3, group: "PRE_EXISTING" },
  { file: "docs/vendor-review.md", date: "2026-08-18", count: 2, group: "PRE_EXISTING" },
  { file: "docs/tracker.csv", date: "2026-08-15", count: 9, group: "PRE_EXISTING" },
  { file: "docs/tracker.csv", date: "2026-08-16", count: 10, group: "PRE_EXISTING" },
  { file: "docs/tracker.csv", date: "2026-08-17", count: 18, group: "PRE_EXISTING" },
  { file: "docs/tracker.csv", date: "2026-08-18", count: 4, group: "PRE_EXISTING" },
  { file: "docs/tracker.csv", date: "2026-08-19", count: 4, group: "PRE_EXISTING" },
  { file: "docs/tracker.csv", date: "2026-11-03", count: 2, group: "PRE_EXISTING" },
];

/* ----------------------------------------------------------------- scan --- */

const ROOT = join(import.meta.dirname, "..");

/** Every file the rule covers: `CLAUDE.md` plus every `.md` under `docs/`. */
function targets(): string[] {
  return [
    "CLAUDE.md",
    ...readdirSync(join(ROOT, "docs"))
      .filter((name) => name.endsWith(".md"))
      .map((name) => `docs/${name}`),
  ].filter((rel) => !SCAN_EXEMPT.includes(rel));
}

test("no date in CLAUDE.md, docs/*.md, or the tracker's prose columns is in the future", () => {
  const todayStr = today();

  let scanned = 0;
  const failures: Array<{ file: string; line: number; date: string }> = [];
  const allowed: Array<{ file: string; line: number; date: string }> = [];

  for (const rel of targets()) {
    const hits = scanText(readFileSync(join(ROOT, rel), "utf8"));
    scanned += hits.length;
    const split = classify(hits, ALLOWLIST, rel, todayStr);
    failures.push(...split.failures);
    allowed.push(...split.allowed);
  }

  // The tracker is read as CSV, not as text: Notes and Detail are the columns
  // a person writes sentences into. Target is excluded deliberately — an
  // intended future date is the whole point of a target column.
  const csvHits = scanTrackerCsv(readFileSync(join(ROOT, "docs/tracker.csv"), "utf8"));
  scanned += csvHits.length;
  const csvSplit = classify(csvHits, ALLOWLIST, "docs/tracker.csv", todayStr);
  failures.push(...csvSplit.failures);
  allowed.push(...csvSplit.allowed);

  // Allowlisted hits are warnings, never silence. Printed on every run with a
  // count, because a tolerated defect nobody sees is an accepted one.
  if (allowed.length > 0) {
    const byGroup = new Map<string, number>();
    for (const entry of ALLOWLIST) {
      byGroup.set(entry.group, (byGroup.get(entry.group) ?? 0) + entry.count);
    }
    console.warn(
      `\n  WARN  ${allowed.length} allowlisted future date(s) — ` +
        [...byGroup].map(([g, n]) => `${g} ${n}`).join(", ") +
        ` — see the ALLOWLIST at the top of tests/doc-dates.test.ts`,
    );
    for (const hit of allowed) {
      console.warn(`  warn  ${hit.file}:${hit.line}  ${hit.date}`);
    }
  }

  // The denominator, reported whether or not anything failed. A scan that
  // matched nothing must not read as a pass — that is the same shape as the
  // empty RSS feed recorded as working.
  console.log(
    `\n  scan  ${scanned} date(s) scanned across ${targets().length + 1} file(s); ` +
      `${failures.length} failure(s), ${allowed.length} allowlisted.\n`,
  );

  assert.ok(
    scanned > 500,
    `only ${scanned} dates scanned — the scan is not reaching the documents`,
  );

  assert.equal(
    failures.length,
    0,
    `${failures.length} future date(s) — a date not read from the system clock is a fabrication ` +
      `(pnpm stamp prints today's):\n` +
      failures.map((f) => `    ${f.file}:${f.line}  ${f.date}`).join("\n"),
  );
});

test("the pre-commit hook reads the same allowlist this test enforces", () => {
  // The hook cannot keep its own copy: two lists enforcing one rule drift,
  // and the copy that drifts is always the one that stops failing. It reads
  // this file's literal, so this asserts the extraction still works.
  const extracted = readAllowlist(join(ROOT, "tests/doc-dates.test.ts"));

  assert.equal(
    extracted.length,
    ALLOWLIST.length,
    `the hook extracted ${extracted.length} allowlist entries, this file declares ${ALLOWLIST.length}`,
  );
  for (const [i, entry] of ALLOWLIST.entries()) {
    assert.deepEqual(
      { file: extracted[i].file, date: extracted[i].date, count: extracted[i].count },
      { file: entry.file, date: entry.date, count: entry.count },
      `allowlist entry ${i} does not survive extraction`,
    );
  }
});

test("today() reads the Phoenix day, not the UTC day", () => {
  // The sibling bug, pinned. 2026-08-15T04:01Z is 2026-08-14 21:01 in
  // Phoenix — the exact reading that made the fabricated stamps look
  // plausible to whatever wrote them.
  assert.equal(today(new Date("2026-08-15T04:01:34Z")), "2026-08-14");
  assert.equal(today(new Date("2026-08-15T06:59:59Z")), "2026-08-14");
  assert.equal(today(new Date("2026-08-15T07:00:00Z")), "2026-08-15");
});
