import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  classify,
  classifyRuns,
  isQuarantined,
  outcomeFor,
  type QuarantineFile,
  type RunOutcome,
} from "../lib/ops/flake-quarantine.ts";

/**
 * `NH176` — the walk failed a DIFFERENT single check on every run of one
 * unchanged build. These hold the classifier against that exact evidence.
 */

const ROOT = process.cwd();

test("a SINGLE failure is never FLAKY — that is the habit this exists to stop", () => {
  /*
   * The whole evidentiary basis: it takes a PASS on the same unchanged tree to
   * make a failure a flake. Reading a lone failure as probably-flaky is the
   * habit NH176 was opened over, and a classifier that did it would be the
   * defect wearing the instrument's badge.
   */
  assert.equal(classify({ identity: "x", outcomes: ["FAIL"] }).classification, "REAL");
  assert.equal(classify({ identity: "x", outcomes: ["FAIL", "FAIL"] }).classification, "REAL");
});

test("fails then passes on an unchanged tree is FLAKY, in either order", () => {
  assert.equal(classify({ identity: "x", outcomes: ["FAIL", "PASS"] }).classification, "FLAKY");
  assert.equal(classify({ identity: "x", outcomes: ["PASS", "FAIL"] }).classification, "FLAKY");
});

test("NH176's four real runs classify exactly as the row describes", () => {
  /*
   * The recorded evidence, replayed. Run 1's [promptD] schema check failed and
   * was REAL — the local branch was at 19 of 21 migrations, and it has passed
   * on every run since. [g12] failed in runs 2 and 4 and passed in 1 and 3.
   * [g5] failed in run 3 only.
   */
  const runs: Map<string, RunOutcome>[] = [
    new Map([["[promptD] schema", "FAIL"], ["[g12] exact name 07866", "PASS"], ["[g5] north Tucson crisp", "PASS"]]),
    new Map([["[promptD] schema", "PASS"], ["[g12] exact name 07866", "FAIL"], ["[g5] north Tucson crisp", "PASS"]]),
    new Map([["[promptD] schema", "PASS"], ["[g12] exact name 07866", "PASS"], ["[g5] north Tucson crisp", "FAIL"]]),
    new Map([["[promptD] schema", "PASS"], ["[g12] exact name 07866", "FAIL"], ["[g5] north Tucson crisp", "PASS"]]),
  ];
  const byId = new Map(classifyRuns(runs).map((v) => [v.identity, v]));

  // The one that was REAL in run 1 is FLAKY across four — because it passed
  // afterwards, which is what the row records: it was fixed, not flaky.
  // The classifier reports what the RUNS say; the row says why it changed.
  assert.equal(byId.get("[promptD] schema")?.classification, "FLAKY");
  assert.equal(byId.get("[g12] exact name 07866")?.classification, "FLAKY");
  assert.equal(byId.get("[g5] north Tucson crisp")?.classification, "FLAKY");
});

test("a check ABSENT from a run did not pass — it did not run", () => {
  // Folding an absent check into PASS is how a check that stopped existing
  // would read as healthy forever.
  const runs: Map<string, RunOutcome>[] = [
    new Map([["[a] one", "FAIL"]]),
    new Map<string, RunOutcome>(),
  ];
  const verdict = classifyRuns(runs)[0];
  assert.equal(verdict.classification, "REAL");
  assert.equal(verdict.passes, 0);
});

test("a check that only ever COULD NOT RUN gets no verdict about the check", () => {
  // RULING 24: an unreachable subject is not a failing one.
  const v = classify({ identity: "x", outcomes: ["COULD_NOT_RUN", "COULD_NOT_RUN"] });
  assert.equal(v.classification, "NEVER_RAN");
});

test("A QUARANTINED CHECK IS NEVER COUNTED AS PASSING", () => {
  /*
   * The load-bearing guard. The only way to get PASS out of `outcomeFor` is to
   * have actually passed — quarantine converts a FAIL into its own third
   * state, never into a pass.
   */
  const file: QuarantineFile = {
    note: "test",
    entries: [{ identity: "[g12] flaky one", row: "NH176", since: "2026-08-25", evidence: "1 of 4" }],
  };
  assert.equal(outcomeFor(file, "[g12] flaky one", false), "QUARANTINED");
  assert.equal(outcomeFor(file, "[g12] flaky one", true), "PASS");
  assert.equal(outcomeFor(file, "[other] not listed", false), "FAIL");
  assert.equal(outcomeFor(null, "[g12] flaky one", false), "FAIL");
});

test("quarantine matches an identity EXACTLY, never loosely", () => {
  // A loose match would silence checks nobody chose to silence, which is
  // strictly worse than the flake it suppressed.
  const file: QuarantineFile = {
    note: "test",
    entries: [{ identity: "[g12] exact name", row: "NH176", since: "2026-08-25", evidence: "" }],
  };
  assert.equal(isQuarantined(file, "[g12] exact name"), true);
  assert.equal(isQuarantined(file, "[g12] exact name at 03255"), false);
  assert.equal(isQuarantined(file, "[g12]"), false);
});

test("walk:all prints the quarantined count on every run", () => {
  /*
   * A deliberate exclusion that reads as a clean result is the silent-trim
   * shape this repo names most often. "372 passed" may never quietly mean
   * "372 passed and 3 were not counted".
   */
  const src = readFileSync(join(ROOT, "scripts", "walk-all.mts"), "utf8");
  assert.match(src, /outcomeFor\(QUARANTINE/, "walk:all does not consult the quarantine");
  assert.match(src, /QUARANTINED as flaky/, "walk:all does not print what it set aside");
  assert.match(src, /NOT counted as passing/, "the print does not say the number is excluded");
});
