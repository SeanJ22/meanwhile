import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  SCAN_EXEMPT,
  classify,
  readAllowlist,
  scanText,
  isExpectedFutureLine,
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
 *   AUTHOR_DECISION — **now empty.** The three stamps in `CLAUDE.md` that
 *     started this, plus two more the audit found once it stopped looking
 *     only for the word "Adopted". The author did not know the real dates,
 *     so they were recovered rather than decided: `pnpm verify-stamps` names
 *     the commit that introduced each rule, and the exported session
 *     transcripts give the session window that commit falls inside. Two
 *     independent sources, agreeing, on all five. The stamps were corrected
 *     and these entries deleted in the same commit. R14.
 *
 *   PRE_EXISTING — the other (file, date) pairs, found when this test first
 *     ran. The author expected three; the scan found 123. They are
 *     enumerated rather than excluded because this project's rule is that a
 *     gap is recorded, never smoothed — an unenumerated "known failures"
 *     escape hatch is how a check stops being one.
 *
 * ## R16, 2026-08-15: the inventory was never one thing
 *
 * The 117 were two species wearing one label, and treating them alike made
 * the warning useless in both directions.
 *
 * **Expected-future dates** are SUPPOSED to postdate every scan until they
 * happen — election day, a registration deadline, the September primary.
 * Warning about them on every run, every day, until November teaches a
 * reader to scroll past the warning, which is the only way this check can
 * actually fail. These are now ANNOTATED in the document itself, next to the
 * date, with the reason and the record they were verified against
 * (`<!-- expected-future: … -->` in Markdown, `[expected-future: …]` in the
 * tracker's prose columns). The scanner recognises the marker, counts them
 * in their own category, and never warns about them again — until the day
 * they become past dates, when they simply stop matching at all.
 *
 * **Suspicious-future dates** are the reason this check exists: session-label
 * residue and anything else unexplained. THE ALLOWLIST IS NOW THIS SET ONLY.
 * Its budget dropped from 26 entries / 118 declared occurrences to 16
 * entries / 81 — the six election-day dates left for the annotation, and the
 * rest retired themselves when the clock passed them.
 *
 * What is left in the allowlist is 81 occurrences of 2026-08-16 through
 * 2026-08-19 across eight files: the session-label convention (state.md §18 —
 * labels that ran ahead of the wall clock, history deliberately not
 * rewritten). The mapping from label to wall clock is settled and recorded
 * (labels 08-15/08-16 ran on 2026-08-13; 08-17/08-18/08-19 on 2026-08-14),
 * so correcting them is evidence-backed work rather than a judgement call —
 * but it is a bulk rewrite of eight documents, some of whose dates are
 * §-section labels that a recorded decision says stay as written, and it was
 * not done in the session that built this split. It stays R16's remainder,
 * warned about loudly and counted every run.
 */
const ALLOWLIST = [
  // ---- AUTHOR_DECISION (R14): EMPTY, and that is the outcome, not an
  // ---- oversight. All five stamps were recovered from two independent
  // ---- sources — the introducing commit's author date (already in -0700)
  // ---- and the session-transcript window containing it — and corrected in
  // ---- CLAUDE.md. There is nothing left for this group to tolerate.
  // ---- `CLAUDE.md` now carries no future date at all.

  // ---- SUSPICIOUS (R16) — session-label residue, and nothing else. Every
  // ---- entry here is a date somebody wrote that ran ahead of the wall
  // ---- clock. The expected-future dates that used to sit in this list are
  // ---- gone from it entirely: they are annotated in their own documents
  // ---- now, which is both a better record and one this list cannot
  // ---- contradict. Entries whose date has passed were removed in the same
  // ---- pass — a pin that can no longer be hit is not a pin.
  { file: "docs/coverage-audit-by-county.md", date: "2026-08-17", count: 14, group: "SUSPICIOUS" },
  { file: "docs/defects.md", date: "2026-08-19", count: 1, group: "SUSPICIOUS" },
  { file: "docs/officials-audit.md", date: "2026-08-16", count: 1, group: "SUSPICIOUS" },
  { file: "docs/photo-report.md", date: "2026-08-19", count: 1, group: "SUSPICIOUS" },
  { file: "docs/source-ladder.md", date: "2026-08-16", count: 3, group: "SUSPICIOUS" },
  { file: "docs/source-ladder.md", date: "2026-08-17", count: 5, group: "SUSPICIOUS" },
  { file: "docs/source-ladder.md", date: "2026-08-18", count: 2, group: "SUSPICIOUS" },
  { file: "docs/state.md", date: "2026-08-16", count: 3, group: "SUSPICIOUS" },
  { file: "docs/state.md", date: "2026-08-17", count: 4, group: "SUSPICIOUS" },
  { file: "docs/state.md", date: "2026-08-18", count: 5, group: "SUSPICIOUS" },
  { file: "docs/state.md", date: "2026-08-19", count: 4, group: "SUSPICIOUS" },
  { file: "docs/vendor-review.md", date: "2026-08-18", count: 2, group: "SUSPICIOUS" },
  { file: "docs/tracker.csv", date: "2026-08-16", count: 10, group: "SUSPICIOUS" },
  { file: "docs/tracker.csv", date: "2026-08-17", count: 18, group: "SUSPICIOUS" },
  { file: "docs/tracker.csv", date: "2026-08-18", count: 4, group: "SUSPICIOUS" },
  { file: "docs/tracker.csv", date: "2026-08-19", count: 4, group: "SUSPICIOUS" },
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
  const expected: Array<{ file: string; line: number; date: string }> = [];

  for (const rel of targets()) {
    const hits = scanText(readFileSync(join(ROOT, rel), "utf8"));
    scanned += hits.length;
    const split = classify(hits, ALLOWLIST, rel, todayStr);
    failures.push(...split.failures);
    allowed.push(...split.allowed);
    expected.push(...split.expected);
  }

  // The tracker is read as CSV, not as text: Notes and Detail are the columns
  // a person writes sentences into. Target is excluded deliberately — an
  // intended future date is the whole point of a target column.
  const csvHits = scanTrackerCsv(readFileSync(join(ROOT, "docs/tracker.csv"), "utf8"));
  scanned += csvHits.length;
  const csvSplit = classify(csvHits, ALLOWLIST, "docs/tracker.csv", todayStr);
  failures.push(...csvSplit.failures);
  allowed.push(...csvSplit.allowed);
  expected.push(...csvSplit.expected);

  // R16: the two species report separately, because they mean opposite
  // things. An expected-future date is the documents working — it is stated
  // once, quietly, with no per-occurrence noise, so that the warning below
  // keeps its meaning.
  if (expected.length > 0) {
    const files = new Set(expected.map((h) => h.file));
    console.log(
      `\n  dated  ${expected.length} expected-future date(s) across ` +
        `${files.size} file(s), each annotated in place with its reason and ` +
        `the record it was verified against — not warnings\n`,
    );
  }

  // Allowlisted hits are warnings, never silence. Printed on every run with a
  // count, because a tolerated defect nobody sees is an accepted one.
  if (allowed.length > 0) {
    // Observed and declared are different numbers and must not be printed as
    // if they were one. The allowlist is DATE-RELATIVE: an entry stops being
    // hit the moment the clock passes its date, so the observed count falls
    // on its own while the declared budget stays put. This run crossed
    // midnight and watched 117 become 88 — 29 entries retiring themselves —
    // which reads as a fix if the two numbers are conflated.
    const declared = new Map<string, number>();
    for (const entry of ALLOWLIST) {
      declared.set(entry.group, (declared.get(entry.group) ?? 0) + entry.count);
    }
    const declaredTotal = [...declared.values()].reduce((a, b) => a + b, 0);

    console.warn(
      `\n  WARN  ${allowed.length} SUSPICIOUS future date(s) hit, of ` +
        `${declaredTotal} declared (` +
        [...declared].map(([g, n]) => `${g} ${n}`).join(", ") +
        `). These are session-label residue — dates written ahead of the ` +
        `wall clock — and correcting them is R16's remainder. The gap is ` +
        `entries whose date is now in the past; the allowlist retires ` +
        `itself. See the ALLOWLIST at the top of tests/doc-dates.test.ts`,
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
      `${failures.length} failure(s), ${allowed.length} suspicious-allowlisted, ` +
      `${expected.length} expected-future.\n`,
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

/* --------------------------------------------------------------- R16 --- */

test("R16: the two species of future date are told apart, and neither hides", () => {
  const todayStr = today();
  let expected = 0;
  let suspicious = 0;

  for (const rel of targets()) {
    const split = classify(
      scanText(readFileSync(join(ROOT, rel), "utf8")),
      ALLOWLIST,
      rel,
      todayStr,
    );
    expected += split.expected.length;
    suspicious += split.allowed.length;
  }
  const csv = classify(
    scanTrackerCsv(readFileSync(join(ROOT, "docs/tracker.csv"), "utf8")),
    ALLOWLIST,
    "docs/tracker.csv",
    todayStr,
  );
  expected += csv.expected.length;
  suspicious += csv.allowed.length;

  // Both categories are non-empty today, which is what makes this test
  // meaningful: a scan that classified everything one way would pass a
  // weaker assertion without telling anything apart.
  assert.ok(expected >= 6, `only ${expected} expected-future date(s) recognised`);
  assert.ok(suspicious >= 1, `${suspicious} suspicious — the residue vanished silently?`);

  // The allowlist is the SUSPICIOUS set and nothing else. An expected-future
  // date that also sat in the allowlist would be tolerated twice and
  // corrected never.
  for (const entry of ALLOWLIST) {
    assert.equal(
      entry.group,
      "SUSPICIOUS",
      `${entry.file} ${entry.date} is in the allowlist under "${entry.group}" — ` +
        `expected-future dates are annotated in their document, not listed here`,
    );
  }
});

test("R16: a bare annotation is not an escape hatch", () => {
  // The marker must carry a reason. A `<!-- expected-future: -->` with
  // nothing after it would tolerate any date at all, which is the shape of
  // every escape hatch this project has refused to keep.
  assert.equal(isExpectedFutureLine("the date 2026-11-03 <!-- expected-future: -->"), false);
  assert.equal(isExpectedFutureLine("2026-11-03 [expected-future:]"), false);
  assert.equal(isExpectedFutureLine("2026-11-03"), false);
  assert.equal(isExpectedFutureLine("2026-11-03 <!-- expected-future: election day -->"), true);
  assert.equal(isExpectedFutureLine("2026-11-03 [expected-future: election day]"), true);

  // And every annotation actually shipped names a reason long enough to be
  // one — a word is not a reason.
  const annotated: string[] = [];
  for (const rel of [...targets(), "docs/tracker.csv"]) {
    for (const line of readFileSync(join(ROOT, rel), "utf8").split("\n")) {
      const m = /(?:<!--|\[)\s*expected-future:\s*([^\]>]+)/i.exec(line);
      if (m) annotated.push(m[1].trim());
    }
  }
  assert.ok(annotated.length >= 4, `only ${annotated.length} annotations found in the tree`);
  for (const reason of annotated) {
    assert.ok(reason.length >= 20, `"${reason}" is too short to be a reason`);
  }
});
