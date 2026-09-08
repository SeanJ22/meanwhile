/**
 * PER-SOURCE GATE ISOLATION AND THE RUN RECORD, HELD WITHOUT A SUITE, A GIT
 * TREE OR A NETWORK. (2026-09-02, the refresh-failure session.)
 *
 * The scheduled refresh of 2026-09-01 and 2026-09-02 threw away three sources'
 * fresh data both days because one test refused one source's bytes. These
 * hold the decision that stops that — which source a failing file belongs to
 * — against fixed inputs, and the record and debt files against a scratch
 * directory. The SEEDED cases are the two September runs, reproduced from
 * their own logs.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { REFRESH_SOURCES, dueDecisions } from "../lib/ops/refresh-cadence.ts";
import { attributeFailures, failingTestFiles, refusalReason } from "../lib/ops/refresh-gate.ts";
import {
  REFRESH_DEBT_PATH,
  REFRESH_REPORT_PATH,
  REFRESH_RUN_PATH,
  SOURCE_OUTCOMES,
  clearDebt,
  dayAfter,
  declareFutureDates,
  emptyDebt,
  nextCadenceDay,
  readDebt,
  readRefreshRun,
  recordDebt,
  renderRefreshRunMarkdown,
  writeDebtIfChanged,
  writeRefreshRun,
  type RefreshRun,
} from "../lib/ops/refresh-report.ts";

/* -------------------------------------------------------------------------- */
/* THE REPORTER'S OWN WORDS                                                    */
/* -------------------------------------------------------------------------- */

/** The tail of run 33636708298's `corepack pnpm test`, verbatim from the run log (2026-09-02). */
const RUN_33636708298_TAIL = `
ℹ tests 4771
ℹ suites 32
ℹ pass 4764
ℹ fail 5
ℹ cancelled 0
ℹ skipped 2
ℹ todo 0
ℹ duration_ms 199409.972283

✖ failing tests:

test at tests/candidate-cards.test.ts:24:1
✖ every card key resolves against the ballot data or lineup keys (7.470666ms)
  AssertionError [ERR_ASSERTION]: card key "ballot-nj-morris:7th-congressional-member-of-the-house-of-representatives-cd-7:legu-a-lana" resolves to no candidacy or contest
      at TestContext.<anonymous> (file:///home/runner/work/meanwhile/meanwhile/tests/candidate-cards.test.ts:40:12)

test at tests/candidate-links.test.ts:31:1
✖ every candidate-links key resolves to a real candidacy or lineup nominee (8.171713ms)
  AssertionError [ERR_ASSERTION]: links key "ballot-nj-morris:7th-congressional-member-of-the-house-of-representatives-cd-7:legu-a-lana" matches no candidacy id and no lineup nominee — it renders nowhere

test at tests/concluded.test.ts:289:1
✖ M58: every wired jurisdiction either has history or explains its absence (15.491816ms)
  AssertionError [ERR_ASSERTION]: 20 of 21 wired jurisdictions show concluded meetings; these show none and give no reason: New London, NH

test at tests/nj-filing-clock.test.ts:93:1
✖ 2: the committed ballot's ids are distinct and its coverage never silently shrinks (3.642509ms)
  AssertionError [ERR_ASSERTION]: candidacies fell to 275 from a floor of 276

test at tests/source-stamp.test.ts:75:3
✖ every declared stamp in the tree AGREES with git, where git can answer (114.855326ms)
  AssertionError [ERR_ASSERTION]: a declared source stamp disagrees with its sources' own history. Either the sources moved and the declaration was not updated in the same commit, or the declaration is a typo.
 ELIFECYCLE  Test failed. See above for more details.
##[error]Process completed with exit code 1.
`;

test("SEEDED: the five failing files of run 33636708298 are read off the reporter's own summary", () => {
  assert.deepEqual(failingTestFiles(RUN_33636708298_TAIL), [
    "tests/candidate-cards.test.ts",
    "tests/candidate-links.test.ts",
    "tests/concluded.test.ts",
    "tests/nj-filing-clock.test.ts",
    "tests/source-stamp.test.ts",
  ]);
});

test("a path mentioned OUTSIDE the failing section is not a failing file", () => {
  const green = `
✔ every card key resolves against the ballot data or lineup keys (7ms)
  a note mentioning tests/candidate-cards.test.ts:24:1 in passing
ℹ tests 10
ℹ pass 10
ℹ fail 0
`;
  assert.deepEqual(failingTestFiles(green), []);
});

test("a reporter that died before its summary still yields its own `test at` lines, and nothing else", () => {
  const partial = "test at tests/a.test.ts:1:1\n✖ a (1ms)\nSegmentation fault\nsee tests/b.test.ts:9:9 for why\n";
  assert.deepEqual(failingTestFiles(partial), ["tests/a.test.ts"]);
});

/* -------------------------------------------------------------------------- */
/* ATTRIBUTION                                                                 */
/* -------------------------------------------------------------------------- */

const SEPT_2_FAILING = [
  "tests/candidate-cards.test.ts",
  "tests/candidate-links.test.ts",
  "tests/concluded.test.ts",
  "tests/nj-filing-clock.test.ts",
  "tests/source-stamp.test.ts",
];

test("SEEDED: run 33636708298 attributes four files to nj-filing and meetings and one to the tree — and commits NOTHING under the tree's red", () => {
  /*
   * What the revert trials would have shown that day: with nj-filing's paths
   * at HEAD the three ballot files pass; with meetings' at HEAD the concluded
   * test passes; the stamp test fails whatever is reverted, because the drift
   * was on main before the refresh ran.
   */
  const v = attributeFailures({
    failing: SEPT_2_FAILING,
    changedSources: ["meetings", "nj-filing", "dotgov"],
    trials: [
      { sourceId: "meetings", passing: ["tests/concluded.test.ts"] },
      { sourceId: "nj-filing", passing: ["tests/candidate-cards.test.ts", "tests/candidate-links.test.ts", "tests/nj-filing-clock.test.ts"] },
      { sourceId: "dotgov", passing: [] },
    ],
    allRevertedPassing: ["tests/candidate-cards.test.ts", "tests/candidate-links.test.ts", "tests/concluded.test.ts", "tests/nj-filing-clock.test.ts"],
  });
  assert.equal(v.verdict, "TREE_RED");
  assert.deepEqual(v.treeFiles, ["tests/source-stamp.test.ts"]);
  assert.deepEqual([...v.culprits].sort(), ["meetings", "nj-filing"]);
  assert.deepEqual(v.survivors, [], "a red the data did not cause commits nothing — dotgov included");
  const stamp = v.byFile.find((a) => a.file === "tests/source-stamp.test.ts")!;
  assert.equal(stamp.sourceId, null);
  assert.match(stamp.basis, /the tree's, not any source's data/);
});

test("SEEDED: run 33517560447 attributes its one failing file to meetings, and nj-filing and dotgov SURVIVE", () => {
  // 2026-09-01: one failure, New London's rolled-off history. That day's clerk
  // filing and .gov snapshot were fine and were thrown away with it.
  const v = attributeFailures({
    failing: ["tests/concluded.test.ts"],
    changedSources: ["meetings", "nj-filing", "dotgov"],
    trials: [
      { sourceId: "meetings", passing: ["tests/concluded.test.ts"] },
      { sourceId: "nj-filing", passing: [] },
      { sourceId: "dotgov", passing: [] },
    ],
    allRevertedPassing: null,
  });
  assert.equal(v.verdict, "ATTRIBUTED");
  assert.deepEqual(v.culprits, ["meetings"]);
  assert.deepEqual(v.survivors, ["nj-filing", "dotgov"]);
  assert.match(refusalReason("meetings", v.byFile), /tests\/concluded\.test\.ts/);
  assert.match(refusalReason("meetings", v.byFile), /owed until it lands/);
});

test("a file that passes only with EVERY changed source reverted is the refresh's jointly — every changed source is culpable", () => {
  const v = attributeFailures({
    failing: ["tests/joint.test.ts"],
    changedSources: ["a", "b"],
    trials: [
      { sourceId: "a", passing: [] },
      { sourceId: "b", passing: [] },
    ],
    allRevertedPassing: ["tests/joint.test.ts"],
  });
  assert.equal(v.verdict, "ATTRIBUTED");
  assert.deepEqual([...v.culprits].sort(), ["a", "b"]);
  assert.deepEqual(v.survivors, []);
  assert.equal(v.byFile.length, 2, "one attribution row per culpable source");
});

test("a file that passes when EITHER of two sources is reverted refuses the combination, and both are culpable", () => {
  const v = attributeFailures({
    failing: ["tests/pair.test.ts"],
    changedSources: ["a", "b", "c"],
    trials: [
      { sourceId: "a", passing: ["tests/pair.test.ts"] },
      { sourceId: "b", passing: ["tests/pair.test.ts"] },
      { sourceId: "c", passing: [] },
    ],
    allRevertedPassing: null,
  });
  assert.equal(v.verdict, "ATTRIBUTED");
  assert.deepEqual([...v.culprits].sort(), ["a", "b"]);
  assert.deepEqual(v.survivors, ["c"]);
});

test("no failing file is GREEN, and every changed source survives", () => {
  const v = attributeFailures({ failing: [], changedSources: ["x", "y"], trials: [], allRevertedPassing: null });
  assert.equal(v.verdict, "GREEN");
  assert.deepEqual(v.survivors, ["x", "y"]);
});

test("a red with no changed source at all is the tree's by construction", () => {
  const v = attributeFailures({ failing: ["tests/z.test.ts"], changedSources: [], trials: [], allRevertedPassing: null });
  assert.equal(v.verdict, "TREE_RED");
  assert.deepEqual(v.survivors, []);
});

/* -------------------------------------------------------------------------- */
/* DEBT                                                                        */
/* -------------------------------------------------------------------------- */

test("a source in debt is DUE whatever its cadence says, and clears when it lands", () => {
  const wednesday = new Date("2026-09-02T00:00:00Z");
  const noDebt = dueDecisions(null, wednesday, 8, []);
  const dotgov = noDebt.find((d) => d.source.id === "dotgov")!;
  assert.equal(dotgov.due, false, "dotgov is monthly and September 2 is not the first");

  const inDebt = dueDecisions(null, wednesday, 8, [{ sourceId: "dotgov", firstFailedOn: "2026-09-01" }]);
  const dotgovDebt = inDebt.find((d) => d.source.id === "dotgov")!;
  assert.equal(dotgovDebt.due, true, "a source refused on the first is owed now, not next month");
  assert.equal(dotgovDebt.debtSince, "2026-09-01");
  assert.deepEqual(dotgovDebt.recoveredFrom, [], "debt is not a catch-up day and is not written as one");
});

test("debt counts consecutive failures, keeps the first day, and is discharged by name", () => {
  let file = emptyDebt("2026-09-01");
  file = recordDebt(file, { sourceId: "meetings", reason: "gate refused: tests/concluded.test.ts", today: "2026-09-01", nextDueAt: "2026-09-02" });
  file = recordDebt(file, { sourceId: "meetings", reason: "gate refused: tests/concluded.test.ts", today: "2026-09-02", nextDueAt: "2026-09-03" });
  // A second run the same day is not a second failure.
  file = recordDebt(file, { sourceId: "meetings", reason: "gate refused: tests/concluded.test.ts", today: "2026-09-02", nextDueAt: "2026-09-03" });
  const meetings = file.debts.find((d) => d.sourceId === "meetings")!;
  assert.equal(meetings.firstFailedOn, "2026-09-01");
  assert.equal(meetings.lastFailedOn, "2026-09-02");
  assert.equal(meetings.consecutiveFailures, 2);
  assert.equal(meetings.nextDueAt, "2026-09-03");
  assert.deepEqual(clearDebt(file, "meetings").debts, []);
});

test("nextCadenceDay and dayAfter agree with the cadence table", () => {
  const meetings = REFRESH_SOURCES.find((s) => s.id === "meetings")!;
  const dotgov = REFRESH_SOURCES.find((s) => s.id === "dotgov")!;
  const wednesday = new Date("2026-11-04T00:00:00Z");
  assert.equal(nextCadenceDay(meetings, wednesday), "2026-11-09", "the next post-election Monday");
  assert.equal(nextCadenceDay(dotgov, wednesday), "2026-12-01", "the next 1st");
  assert.equal(dayAfter("2026-09-30"), "2026-10-01");
  assert.equal(dayAfter("2026-12-31"), "2027-01-01");
});

/* -------------------------------------------------------------------------- */
/* THE RECORD ON DISK                                                          */
/* -------------------------------------------------------------------------- */

function sampleRun(): RefreshRun {
  return {
    formatVersion: 1,
    runDate: "2026-09-02",
    startedAt: "2026-09-02T13:36:32.000Z",
    finishedAt: "2026-09-02T13:37:11.000Z",
    mode: "CADENCE",
    exitCode: 0,
    sources: REFRESH_SOURCES.map((s) => ({
      id: s.id,
      due: s.id !== "fec" && s.id !== "legiscan",
      ran: s.id !== "fec" && s.id !== "legiscan",
      outcome: s.id === "fec" || s.id === "legiscan" ? "NOT_DUE" : s.id === "meetings" ? "ROUTE_UNREAD" : "INGESTED",
      reason: s.id === "meetings" ? "the gate refused this source's data: tests/concluded.test.ts" : "ran clean",
      commands: [...s.commands],
      failedCommand: null,
      exitCode: s.id === "fec" || s.id === "legiscan" ? null : 0,
      governs: [...s.governs],
      changedPaths: s.id === "meetings" || s.id === "fec" || s.id === "legiscan" ? [] : [...s.governs],
      recoveredFrom: s.id === "dotgov" ? ["2026-09-01"] : [],
      nextDueAt: s.id === "meetings" ? "2026-09-03" : s.id === "fec" ? "2026-09-07" : "2026-09-03",
    })),
    catchUp: { lastLanded: "docs/refresh-run.md, run date 2026-08-31", days: ["2026-09-01", "2026-09-02"], cap: 8, off: false },
    gate: {
      verdict: "REFUSED",
      ranAt: "2026-09-02T13:37:37.000Z",
      failingFiles: ["tests/concluded.test.ts"],
      attribution: [{ file: "tests/concluded.test.ts", sourceId: "meetings", basis: "passes with meetings's governed paths at HEAD" }],
      note: "The suite refused 1 source(s): meetings.",
    },
  };
}

test("the run record round-trips, keeps the contract's field names, and the Markdown is rendered from it", () => {
  const root = mkdtempSync(join(tmpdir(), "refresh-report-"));
  try {
    const run = sampleRun();
    writeRefreshRun(root, run, REFRESH_SOURCES);
    const back = readRefreshRun(root)!;
    assert.deepEqual(back, run);

    const contract = ["id", "due", "ran", "outcome", "reason", "commands", "failedCommand", "exitCode", "governs", "changedPaths", "recoveredFrom", "nextDueAt"];
    for (const s of back.sources) {
      for (const key of contract) assert.ok(key in s, `${s.id} is missing "${key}" — another lane reads that name`);
      assert.ok(SOURCE_OUTCOMES.includes(s.outcome), `${s.id}: unknown outcome ${s.outcome}`);
    }
    for (const key of ["formatVersion", "runDate", "startedAt", "finishedAt", "mode", "exitCode", "sources"]) {
      assert.ok(key in back, `the record is missing "${key}"`);
    }

    const md = readFileSync(join(root, REFRESH_REPORT_PATH), "utf8");
    assert.match(md, /^Run date: \*\*2026-09-02\*\*/m, "the orchestrator reads this exact line back for catch-up");
    assert.match(md, /ROUTE_UNREAD/);
    assert.match(md, /tests\/concluded\.test\.ts/);
    // Every future date on a line is declared expected, on that line — the
    // doc-dates guard scans docs/*.md and refuses an undeclared one.
    for (const line of md.split("\n")) {
      const future = (line.match(/\d{4}-\d{2}-\d{2}/g) ?? []).filter((d) => d > "2026-09-02");
      if (future.length > 0) assert.match(line, /expected-future:/, `undeclared future date on: ${line}`);
    }
    assert.equal(existsSync(join(root, REFRESH_RUN_PATH)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the debt file is written only when its debts move — a quiet day stays quiet", () => {
  const root = mkdtempSync(join(tmpdir(), "refresh-debt-"));
  try {
    mkdirSync(join(root, "data", "ops"), { recursive: true });
    assert.equal(writeDebtIfChanged(root, emptyDebt("2026-09-02"), "2026-09-02"), false, "no debts and no file: nothing to write");
    assert.equal(existsSync(join(root, REFRESH_DEBT_PATH)), false);

    const one = recordDebt(emptyDebt("2026-09-02"), { sourceId: "meetings", reason: "r", today: "2026-09-02", nextDueAt: "2026-09-03" });
    assert.equal(writeDebtIfChanged(root, one, "2026-09-02"), true);
    assert.equal(readDebt(root, "2026-09-03").debts.length, 1);
    assert.equal(writeDebtIfChanged(root, one, "2026-09-03"), false, "same debts on a later day: updatedOn alone never earns a write");
    assert.equal(readDebt(root, "2026-09-03").updatedOn, "2026-09-02");

    assert.equal(writeDebtIfChanged(root, clearDebt(one, "meetings"), "2026-09-03"), true, "a discharged debt is a change");
    assert.deepEqual(readDebt(root, "2026-09-03").debts, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a future date on a rendered line is declared on that line, and a past one is left alone", () => {
  assert.equal(declareFutureDates("next due 2026-09-03", "2026-09-02", "why"), "next due 2026-09-03 <!-- expected-future: 2026-09-03 — why -->");
  assert.equal(declareFutureDates("ran 2026-09-01", "2026-09-02", "why"), "ran 2026-09-01");
  const md = renderRefreshRunMarkdown(sampleRun(), REFRESH_SOURCES);
  assert.ok(md.includes("expected-future: 2026-09-03"), "the next-due day is declared");
  assert.ok(md.includes("expected-future: 2026-11-03"), "the election date in a cadence reason is declared");
  writeFileSync(join(tmpdir(), "refresh-md-sample.md"), md); // for a reader; not asserted on
});
