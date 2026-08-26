/**
 * ITEM 8a (2026-08-26) — every job names its own cause, and a deterministic
 * refusal is not retried.
 *
 * Both instruments are proved against REAL CAPTURED LOG TEXT from runs this
 * repository actually produced, never against a fixture written to make the
 * matcher pass (RULING 110 — the instrument is shown catching the real thing).
 * The run ids are in the assertions so a reader can go and look.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { FAILURE_CLASSES, diagnose } from "../lib/ops/failure-classes.ts";
import { classifyRejection } from "../lib/ops/push-rejection.ts";

const ROOT = join(import.meta.dirname, "..");

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

/* -------------------------------------------------------------------------- */
/* THE REJECTION CLASSIFIER                                                    */
/* -------------------------------------------------------------------------- */

test("a ruleset refusal is POLICY and is NOT retried", () => {
  const v = classifyRejection(GH013);
  assert.equal(v.kind, "POLICY", "GH013 from run 32989362288 is a decision on the server");
  assert.equal(v.retryable, false, "attempts 2 through 5 of that run were guaranteed to fail identically");
  assert.match(v.reason, /deploy-key path|Deploy keys/i, "and the remedy names the actual cause");
});

test("a losing race IS retried, because rebasing changes the input", () => {
  const v = classifyRejection(
    " ! [rejected]        HEAD -> main (non-fast-forward)\nhint: Updates were rejected because the tip of your current branch is behind",
  );
  assert.equal(v.kind, "RACE");
  assert.equal(v.retryable, true);
});

test("an unrecognised rejection is retried and says it is unrecognised", () => {
  const v = classifyRejection("error: RPC failed; curl 92 HTTP/2 stream 5 was not closed cleanly");
  assert.equal(v.kind, "UNKNOWN");
  assert.equal(
    v.retryable,
    true,
    "treating an unrecognised transient as permanent would turn a recoverable run red; the other direction costs seconds",
  );
});

test("a credential refusal is POLICY — every retry presents the same credential", () => {
  const v = classifyRejection("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.");
  assert.equal(v.kind, "POLICY");
  assert.equal(v.retryable, false);
});

/* -------------------------------------------------------------------------- */
/* THE DIAGNOSER                                                               */
/* -------------------------------------------------------------------------- */

test("the diagnoser names the ruleset refusal from the real log", () => {
  const d = diagnose(GH013, GH013.trim().split("\n").slice(-5));
  assert.equal(d.verdict, "KNOWN");
  assert.ok(
    d.classes.some((c) => c.id === "push-refused-by-ruleset"),
    "the GH013 class is recognised",
  );
  assert.match(d.message, /Deploy keys/, "and the remedy is in plain words, not 'see the logs'");
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
  // RULING 157 — the class list was derived from the GH013 log. This is a
  // different run, a different job, and a different failure mode: the four
  // tracker guards that went red because job-watch committed the store and
  // left its generated views behind.
  const d = diagnose(TRACKER_DISAGREEMENT);
  assert.equal(d.verdict, "KNOWN");
  assert.ok(d.classes.some((c) => c.id === "tracker-store-and-views-disagree"));
  assert.match(d.message, /tracker:views/, "and it names the command that fixes it");
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

/* -------------------------------------------------------------------------- */
/* THE STEP IS WIRED INTO EVERY WORKFLOW THAT CAN FAIL                         */
/* -------------------------------------------------------------------------- */

test("every scheduled pusher ends with the diagnosing step", () => {
  const dir = join(ROOT, ".github/workflows");
  const files = readdirSync(dir).filter((f) => f.endsWith(".yml") && f !== "build-check.yml");
  assert.ok(files.length >= 8, `expected the eight pushers, saw ${files.length}`);
  const missing = files.filter((f) => !readFileSync(join(dir, f), "utf8").includes("corepack pnpm diagnose"));
  assert.deepEqual(
    missing,
    [],
    "a workflow with no diagnosing step dies with `Process completed with exit code 1` and nothing else",
  );
});
