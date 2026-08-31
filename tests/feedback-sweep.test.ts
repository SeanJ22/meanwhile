/**
 * **THE SWEEP GATE.** (Session B, WS2.5, 2026-08-30.)
 *
 * The brief seeds one failure by name: *a date folder, or an item within one,
 * that a sweep neither processes nor lists as unidentifiable fails the sweep
 * gate.* Both halves are below, plus the refusals that keep a "processed" item
 * from being an empty word.
 *
 * The reason this is a committed gate rather than a habit: the A.1 sweep
 * accounted for all twenty of 8.30.26's captures as *unidentifiable —
 * deferred*, and that accounting passed every check the repository had.
 * Nothing was diagnosed and nothing was fixed, and nothing failed. A deferral
 * that names what it is deferring is legitimate; a deferral nothing measures
 * is how four consecutive sessions of the owner's standing instruction went
 * unactioned.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";

import {
  checkSweepGate,
  countSweep,
  validateSweep,
  type SweepRecord,
  type SweptItem,
} from "../lib/feedback/sweep.ts";

function item(over: Partial<SweptItem> = {}): SweptItem {
  return {
    id: "X-1",
    sources: ["DICTATION"],
    screenshots: ["2026-08-30_17-28-43.PNG"],
    surface: "Ask",
    zip: "85701",
    reported: "something the owner met",
    correctState: "what the source says is right",
    failureClass: "rendering",
    disposition: "FIXED_VERIFIED",
    workItemId: "wi:feedback:8.30.26:X-1",
    instancesFound: 1,
    instancesFixed: 1,
    checkId: "vac:x-1",
    checkResult: "GREEN",
    blocker: null,
    ...over,
  };
}

function sweep(over: Partial<SweepRecord> = {}): SweepRecord {
  return {
    folder: "8.30.26",
    filesInventoried: ["a.PNG"],
    sweptAtSha: "abc123",
    sweptAt: "2026-08-30",
    items: [item()],
    ...over,
  };
}

/* ==========================================================================
 * THE SEEDED FAILURE, BOTH HALVES
 * ======================================================================= */

test("SEEDED: a date folder with no sweep record FAILS the gate", () => {
  const verdict = checkSweepGate(["8.30.26", "9.02.26"], [sweep()]);
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.unswept, ["9.02.26"]);
  assert.match(verdict.problems.join(" "), /9\.02\.26/);
  assert.match(
    verdict.problems.join(" "),
    /not deferred, it is dropped/,
    "and the message says what the difference is",
  );
});

test("SEEDED: an item disposed OPEN_BLOCKED with no blocker FAILS", () => {
  /* A deferral with no reason is a silent defer wearing a status, which is the
     shape the whole module exists to refuse. */
  const verdict = checkSweepGate(
    ["8.30.26"],
    [sweep({ items: [item({ disposition: "OPEN_BLOCKED", blocker: null })] })],
  );
  assert.equal(verdict.passed, false);
  assert.match(verdict.problems.join(" "), /names no blocker or question/);
});

test("SEEDED: an item disposed UNIDENTIFIABLE with no question FAILS", () => {
  const problems = validateSweep(
    sweep({ items: [item({ disposition: "UNIDENTIFIABLE", blocker: null, checkId: null })] }),
  );
  assert.ok(problems.some((p) => /names no blocker or question/.test(p)));
});

/* ==========================================================================
 * WHAT KEEPS "PROCESSED" FROM BEING AN EMPTY WORD
 * ======================================================================= */

test("an item FIXED_VERIFIED with no permanent check is not closed", () => {
  /*
   * W2.4, mechanically. BAL-32 was reported on 8/28, fixed somewhere, and
   * reported again on 8/30 for the same named person — because nothing
   * re-asked the question. A fix with no check regresses silently.
   */
  const problems = validateSweep(sweep({ items: [item({ checkId: null })] }));
  assert.ok(problems.some((p) => /no permanent check/.test(p)));
  assert.ok(problems.some((p) => /8\/28/.test(p)), "the message carries the proof case");
});

test("THE STANDING INSTRUCTION: a class with instances left unfixed is not FIXED_VERIFIED", () => {
  /*
   * The owner's closing statement, mechanically. Every named person, body, zip
   * and district is an EXAMPLE; if the defect exists at that instance it
   * exists at the class. A fix that leaves the same defect on another page is
   * not a fix, and this is the assertion that says so without anyone having to
   * remember it.
   */
  const problems = validateSweep(
    sweep({ items: [item({ instancesFound: 3, instancesFixed: 1 })] }),
  );
  assert.ok(problems.some((p) => /instance\(s\) of the same class left unfixed/.test(p)));
});

test("more instances fixed than found is a counting error, never a bonus", () => {
  const problems = validateSweep(
    sweep({ items: [item({ instancesFound: 1, instancesFixed: 4 })] }),
  );
  assert.ok(problems.some((p) => /more fixed than found/.test(p)));
});

test("a sweep that inventoried nothing swept nothing", () => {
  const problems = validateSweep(sweep({ filesInventoried: [] }));
  assert.ok(problems.some((p) => /swept nothing/.test(p)));
});

test("duplicate item ids are refused — one row per distinct item", () => {
  const problems = validateSweep(sweep({ items: [item(), item()] }));
  assert.ok(problems.some((p) => /duplicate item id/.test(p)));
});

/* ==========================================================================
 * THE RECORD THIS SESSION ACTUALLY WROTE
 * ======================================================================= */

test("the committed 8.30.26 sweep is well-formed, and its counts are derived", () => {
  const path = "data/feedback/sweeps/8.30.26.json";
  assert.ok(existsSync(path), "the owner pass this session was briefed on is recorded");
  const record = JSON.parse(readFileSync(path, "utf8")) as SweepRecord;

  assert.deepEqual(validateSweep(record), [], "no problems in the committed record");

  const counts = countSweep(record);
  /* Stated N equals rendered rows: the counts are the arrays' own lengths. */
  assert.equal(counts.itemsFound, record.items.length);
  assert.equal(counts.filesInventoried, record.filesInventoried.length);
  assert.equal(
    counts.itemsProcessed + counts.unidentifiable,
    counts.itemsFound,
    "every item is either processed or listed as unidentifiable — there is no third state",
  );

  /* The owner's 20 captures plus the dictation and the spreadsheet. */
  assert.equal(
    record.filesInventoried.filter((f) => f.toUpperCase().endsWith(".PNG")).length,
    20,
  );
  assert.ok(record.filesInventoried.some((f) => f.endsWith(".docx")), "the dictation was read");
  assert.ok(record.filesInventoried.some((f) => f.endsWith(".xlsx")), "the spreadsheet was read");

  /* Items present in the dictation or the captures and absent from the
     spreadsheet are ADDED, never dropped. */
  assert.ok(
    record.items.some((i) => i.id === "ASK-24"),
    "the dictation's two-sittings-in-one-day item is carried even though the sheet omits it",
  );
  assert.ok(
    record.items.some((i) => i.sources.includes("OWNER_WORKBOOK")),
    "the owner's workbook amendments are owner feedback from the same date and are carried",
  );
});
