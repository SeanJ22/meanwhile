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
 * What was left in the allowlist was 81 occurrences of 2026-08-16 through
 * 2026-08-19 across eight files: the session-label convention (state.md §18 —
 * labels that ran ahead of the wall clock, history deliberately not
 * rewritten). The mapping from label to wall clock is settled and recorded
 * (labels 08-15/08-16 ran on 2026-08-13; 08-17/08-18/08-19 on 2026-08-14).
 *
 * ## 2026-08-19 (g20): R16's remainder closed itself, and two guards fought it
 *
 * The clock reached 2026-08-19 and the last of those 81 occurrences stopped
 * being a future date. The allowlist is now **empty** — the check at full
 * strength, nothing tolerated — and the documents are untouched, which is
 * exactly the retirement the R16 split was built for.
 *
 * Two guards failed on that, and both failed the same way: they asserted the
 * BROKEN state and so fired on the day it got fixed.
 *
 *   - `assert.ok(suspicious >= 1, "the residue vanished silently?")` — now
 *     asserts the healthy state instead: zero suspicious hits, and no entry
 *     left standing whose date has passed.
 *   - `readAllowlist` threw on zero entries as "extraction is broken" — now
 *     tells an empty literal from a failed parse by whether a `file:` key
 *     survives in the block.
 *
 * This is session correction 9.8's shape in a second place: a check that
 * only holds while things are unhealthy is not a check, it is a thermometer
 * that only reads a fever.
 */
/**
 * **Why each remaining suspicious date is still here** — G10's 8c bullet,
 * resolved 2026-08-18 (g19).
 *
 * The bullet allowed two outcomes per date: fix it, or record why it cannot
 * be recovered. Every one was first recovered from `git blame`, because
 * neither outcome is choosable without knowing the real date.
 *
 * What blame gives is a COMMIT DATE, and that is an UPPER BOUND rather than
 * a pin: a line committed on the 17th describes work done on or before the
 * 17th. Substituting the 17th for an unknown 16th replaces one plausible
 * date with another, which is the defect this whole check exists to catch,
 * not a fix for it. So a stamp was corrected only where a second,
 * independent, authoritative record states the date exactly.
 *
 * **Two were corrected on that basis** and are gone from this list:
 *   - `docs/photo-report.md` "the 2b rule (tightened …)" — CLAUDE.md pins
 *     door 2 at 2026-08-14, and the commit (92e8575c) agrees.
 *   - `docs/tracker.csv` "NEW INVARIANT in CLAUDE.md (adopted …)" —
 *     CLAUDE.md's own Adopted line for the distinct-join rule is 2026-08-14.
 *
 * **The eight below stay, each for a stated reason.** They are two species:
 */
export const SUSPICIOUS_REASONS: Readonly<
  Record<string, { committed: string; species: string; why: string }>
> = {
  // ── Species 1: SESSION SEQUENCE LABELS ────────────────────────────────
  // Not wall-clock dates at all. state.md documents this itself, in the
  // very line that trips the check: the labels from "the … session" through
  // "the 2026-08-19 session" ARE sequence labels, and state.md §18 rules
  // that this history is deliberately not rewritten. Correcting them would
  // renumber the session history to make a date checker quieter, which is
  // the tail wagging the dog.
  "docs/defects.md:80": {
    committed: "2026-08-14",
    species: "SESSION_LABEL",
    why: "A section heading naming a session by its sequence label. Renaming it would break every cross-reference to that session in state.md and the tracker.",
  },
  "docs/state.md:226": {
    committed: "2026-08-14",
    species: "SESSION_LABEL",
    why: "Prose referring to §17 by its sequence label. The label is the section's name.",
  },
  "docs/state.md:3925": {
    committed: "2026-08-14",
    species: "SESSION_LABEL",
    why: "§17's own heading. This is the label the other references point at.",
  },
  "docs/state.md:4038": {
    committed: "2026-08-14",
    species: "SESSION_LABEL",
    why: "§17's state-as-of line, carrying the same label as its heading.",
  },
  "docs/state.md:4057": {
    committed: "2026-08-14",
    species: "SESSION_LABEL",
    why: "The line that DEFINES these as sequence labels rather than dates. Rewriting it would delete the explanation for the other seven.",
  },

  // ── Species 2: BOUNDED, NOT PINNED ────────────────────────────────────
  // Real stamps on real work, written ahead of the wall clock. Their commit
  // date bounds them from above and nothing pins them exactly, so a
  // correction here would be a guess wearing a citation. Routed to the
  // author rather than repaired.
  "docs/tracker.csv:122": {
    committed: "2026-08-17",
    species: "BOUNDED",
    why: "'2026-08-19: THE SURFACE SHIPPED as A09'. The work happened on or before 2026-08-17; which day is not recoverable from anything in the repo.",
  },
  "docs/tracker.csv:140": {
    committed: "2026-08-17",
    species: "BOUNDED",
    why: "'audited 2026-08-19' on the photo audit. On or before 2026-08-17; the audit left no dated artifact of its own.",
  },
  "docs/tracker.csv:141": {
    committed: "2026-08-17",
    species: "BOUNDED",
    why: "'Recorded 2026-08-19 per the session brief'. On or before 2026-08-17; the brief it cites is not in the repo.",
  },
};

/** One tolerated future date, pinned to its file and its exact count. */
interface DateAllowEntry {
  file: string;
  date: string;
  count: number;
  group: string;
}

// The annotation is load-bearing now that the list is empty: an empty array
// literal has no element type to infer. `parseAllowlistSource` reads past it.
const ALLOWLIST: DateAllowEntry[] = [
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
  // ---- 2026-08-19 (g20): THE LIST IS NOW EMPTY, and that is the outcome
  // ---- rather than an oversight. Sixteen entries stood here, every one
  // ---- dated 2026-08-16 through 2026-08-19; the clock reached the last of
  // ---- them today and not one can be hit again. This file's own rule
  // ---- decides what happens next — "a pin that can no longer be hit is
  // ---- not a pin" — so they are removed rather than left standing as a
  // ---- toleration nothing can exercise.
  // ----
  // ---- The DOCUMENTS are unchanged: those dates are still written where
  // ---- they always were, and SUSPICIOUS_REASONS above still records why
  // ---- each was left as written. What changed is only that they are past
  // ---- dates now, which is the retirement the R16 split was designed for.
  // ----
  // ---- An empty allowlist is the check at full strength: every future
  // ---- date in a scanned document now fails outright, with nothing
  // ---- tolerated. The R16 test below asserts that empty state directly,
  // ---- so this cannot quietly refill.
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
        `). EVERY ONE CARRIES A REASON — see SUSPICIOUS_REASONS above ` +
        `(G10's 8c bullet, resolved 2026-08-18). Two species: a SESSION_LABEL ` +
        `is not a wall-clock date at all and state.md rules that history is ` +
        `not rewritten; a BOUNDED stamp has a commit date that bounds it from ` +
        `above and nothing that pins it, so correcting it would be a guess ` +
        `wearing a citation. The gap between hit and declared is entries ` +
        `whose date is now in the past; the allowlist retires itself.`,
    );
    for (const hit of allowed) {
      const record = SUSPICIOUS_REASONS[`${hit.file}:${hit.line}`];
      console.warn(
        `  warn  ${hit.file}:${hit.line}  ${hit.date}  ` +
          (record
            ? `[${record.species}, committed ${record.committed}] ${record.why}`
            : `NO REASON RECORDED — add one to SUSPICIOUS_REASONS`),
      );
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

  // The expected-future category is non-empty and must stay so: an election
  // day in November is supposed to postdate every scan until it happens, and
  // a scan finding none of them has stopped reaching the annotations.
  assert.ok(expected >= 6, `only ${expected} expected-future date(s) recognised`);

  // ── 2026-08-19 (g20): this assertion used to read `suspicious >= 1`, and
  // ── it failed the moment the residue was gone — which is to say, it
  // ── failed on the day the thing it was guarding got FIXED. That is the
  // ── same shape as a walk check that vanishes when a source is healthy
  // ── (session correction 9.8): a guard that only holds while things are
  // ── broken stops holding exactly when it matters least and complains
  // ── exactly when it matters least too.
  // ──
  // ── The healthy state is what gets asserted now, and it is the stronger
  // ── claim: NOTHING is tolerated. Every future date in a scanned document
  // ── fails outright. The two ways that could rot are both named here —
  // ── a stale entry that can never fire again, and a hit with no entry
  // ── behind it — so refilling the allowlist requires a live, dated,
  // ── still-future pin and nothing else will pass.
  for (const entry of ALLOWLIST) {
    assert.ok(
      entry.date > todayStr,
      `${entry.file} ${entry.date} has passed — a pin that can no longer be ` +
        `hit is not a pin, and leaving it here makes the declared budget lie`,
    );
  }
  assert.equal(
    suspicious,
    0,
    `${suspicious} suspicious future date(s) hit against an allowlist of ` +
      `${ALLOWLIST.length} entr(ies) — every one must be declared above`,
  );

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

/* ---------------------------------------------------------- g20, R16 --- */

test("an empty allowlist is legitimate; a broken extraction still throws", async () => {
  // 2026-08-19 (g20). Both of these guards used to read "empty means
  // broken", and both failed on the day the last tolerated date passed into
  // the past — that is, on the day the thing they guarded got fixed. The
  // distinction they were missing is asserted here so it cannot be lost
  // again: an entry that fails to parse leaves its `file:` key behind, and
  // a genuinely empty literal leaves nothing.
  const { mkdtempSync, writeFileSync: write } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "doc-dates-"));

  const empty = join(dir, "empty.ts");
  write(empty, "const ALLOWLIST = [\n  // nothing tolerated\n];\n", "utf8");
  assert.deepEqual(
    readAllowlist(empty),
    [],
    "a genuinely empty allowlist must extract as empty, not throw — an empty " +
      "list is the check at full strength",
  );

  const broken = join(dir, "broken.ts");
  // An entry whose shape the extractor cannot read. It must NOT be silently
  // dropped: a toleration that vanishes is a hole nobody sees.
  write(
    broken,
    'const ALLOWLIST = [\n  { file: "docs/x.md", date: "2026-99-99" },\n];\n',
    "utf8",
  );
  assert.throws(
    () => readAllowlist(broken),
    /extraction is broken/,
    "an unparseable entry must fail closed",
  );

  const missing = join(dir, "missing.ts");
  write(missing, "const SOMETHING_ELSE = [];\n", "utf8");
  assert.throws(() => readAllowlist(missing), /no ALLOWLIST literal/);
});
