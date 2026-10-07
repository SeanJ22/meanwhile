/**
 * Every job names its own cause, and a deterministic refusal is not retried. Proved against captured log text from
 * real runs, never against a fixture written to make the matcher pass.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { FAILURE_CLASSES, diagnose } from "../lib/ops/failure-classes.ts";

/** Captured from job-watch run 32989362288, 2026-08-26 16:37 UTC, verbatim. */
const GH013 = `
push-main: the tree is dirty before the rebase — 4 path(s) this run generated and did not stage: M docs/log.md, M docs/tracker-opened.json, M docs/tracker.md, M docs/tracker.xlsx
push-main: rebased onto origin/main, retrying
push-main: attempt 4 of 5 rejected — remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Changes must be made through a pull request.
remote: - 3 of 3 required status checks are expected.
 ! [remote rejected] HEAD -> main (push declined due to repository rule violations)
error: failed to push some refs to 'https://github.com/SeanJ22/We-The-People'
##[error]Process completed with exit code 1.
`;

/** Captured from build check run 32997211245, 2026-08-26 18:04 UTC, verbatim. */
const TRACKER_DISAGREEMENT = `
✖ RULING 30: a section over the five-P1 cap is REPORTED as stopped, never trimmed (2.140313ms)
  AssertionError [ERR_ASSERTION]: Needs Sean holds 7 P1 rows and docs/tracker.md must say the section is stopped
✖ the stated open count equals the rows underneath it, section by section (1.516154ms)
  AssertionError [ERR_ASSERTION]: docs/tracker.md states an open count other than 288
✖ item 1.4: every row a session reported opening is present in a store (115.175979ms)
  AssertionError [ERR_ASSERTION]: these rows are in a store and no session's ledger entry claims them
 ELIFECYCLE  Test failed. See above for more details.
`;

test("the diagnoser names the ruleset refusal from the real log", () => {
  const d = diagnose(GH013, GH013.trim().split("\n").slice(-5));
  assert.equal(d.verdict, "KNOWN");
  assert.ok(
    d.classes.some((c) => c.id === "push-refused-by-ruleset"),
    "the GH013 class is recognised",
  );
  assert.match(d.message, /normal pull-request/, "and the remedy preserves the software-only boundary");
});

test("the diagnoser reports EVERY matching class, not the first (RULING 164)", () => {
  const d = diagnose(`${GH013}\n${TRACKER_DISAGREEMENT}`);
  const ids = d.classes.map((c) => c.id);
  assert.ok(ids.includes("push-refused-by-ruleset"));
  assert.ok(ids.includes("tracker-store-and-views-disagree"));
  assert.ok(ids.includes("gate-suite-failed"));
  assert.ok(d.classes.length >= 3, `a run with three things wrong reports three, saw ${ids.join(", ")}`);
});

test("the diagnoser recognises the store-and-views disagreement it was NOT derived from", () => {
  // An independent case: a different run, job and failure mode from the log the classes were derived from.
  const d = diagnose(TRACKER_DISAGREEMENT);
  assert.equal(d.verdict, "KNOWN");
  assert.ok(d.classes.some((c) => c.id === "tracker-store-and-views-disagree"));
  assert.match(d.message, /ordinary software pull request/, "and it cannot restore a direct writer");
});

test("an unrecognised failure says so LOUDLY and shows what it saw", () => {
  const d = diagnose("Segmentation fault (core dumped)", ["Segmentation fault (core dumped)"]);
  assert.equal(d.verdict, "UNKNOWN");
  assert.match(d.message, /NOT ONE THIS REPOSITORY RECOGNISES/);
  assert.match(d.message, /Segmentation fault/, "the tail is printed — an unknown that shows nothing is useless");
  assert.match(d.message, /failure-classes\.ts/, "and it says where to add the class");
});

test("every failure class carries at least one shape and a remedy that is not a pointer", () => {
  assert.ok(FAILURE_CLASSES.length > 0, "a class list with no classes is a diagnoser that diagnoses nothing");
  for (const c of FAILURE_CLASSES) {
    assert.ok(c.shapes.length > 0, `${c.id} has no shapes`);
    assert.ok(c.remedy.length > 40, `${c.id}'s remedy is too short to be a remedy`);
    assert.ok(
      !/^see (the )?logs?/i.test(c.remedy),
      `${c.id}'s remedy sends the reader back to the logs, which is where they already are`,
    );
  }
});
