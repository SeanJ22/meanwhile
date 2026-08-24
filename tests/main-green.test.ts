import assert from "node:assert/strict";
import test from "node:test";

// A `.mjs` sibling, imported for its decision functions only — the CLI half is
// guarded behind an entry-point check and does not run on import, so nothing
// here talks to GitHub.
import { neverStarted, verdictFromCheckRuns } from "../scripts/main-green.mjs";

/**
 * **RULING 75's server-truth check, and the distinction it exists to hold.**
 * (NJ Hunt 3, 2026-08-22.)
 *
 * Every other gate in this repo answers a question about the WORKING TREE.
 * This one asks GitHub what happened to a commit AFTER it landed, because a
 * close-out commit reaches `main` through a door no local gate stands at — and
 * that put a red suite on `main` twice.
 *
 * Its whole discipline is that four states stay apart: green, red, pending, and
 * could-not-tell. **A check that cannot reach its subject must never print like
 * a passing one, and must never print like a failure of the subject either.**
 *
 * The second half of that was violated by the first version, on its first real
 * use. All three checks on `d0e0e34` completed in three to four seconds with
 * ZERO steps — twice, including an explicit re-run — because GitHub could not
 * allocate a runner. GitHub reports `conclusion: failure` for that and is not
 * wrong; the run failed. But it is a failure of the CHECK, not of the TREE, and
 * reporting it as a broken `main` sends a session hunting a defect that does
 * not exist. RULING 12: a walled source is not a broken job.
 */

const at = (name: string, over: Partial<Record<string, unknown>> = {}) => ({
  name,
  status: "completed",
  conclusion: "failure",
  started_at: "2026-08-22T21:50:18Z",
  completed_at: "2026-08-22T21:50:22Z",
  steps: [],
  ...over,
});

test("a run that completed with NO STEPS never started", () => {
  assert.equal(neverStarted(at("build (default)")), true);
});

test("a run that recorded even one step DID start, however it ended", () => {
  assert.equal(
    neverStarted(at("gates", { steps: [{ name: "Install", conclusion: "failure" }] })),
    false,
    "reaching a step means the runner existed — that failure is the tree's",
  );
});

test("a long run with no steps is still judged on the steps, not the clock", () => {
  // The duration corroborates; the step count is the test. A six-hour hang with
  // no step recorded is exactly the F25 shape and is not a healthy tree either.
  assert.equal(
    neverStarted(at("build", { completed_at: "2026-08-22T22:50:18Z" })),
    false,
    "an hour of something is not a runner that never started",
  );
});

test("an in-flight run is not judged at all", () => {
  assert.equal(neverStarted(at("build", { status: "in_progress", conclusion: null })), false);
});

test("every check stillborn reads CANNOT TELL, never RED", () => {
  const v = verdictFromCheckRuns([
    at("build (default)"),
    at("build (standalone)"),
    at("gates (test · lint · tsc)"),
  ]);
  assert.equal(v.verdict, "unknown", "the tree cannot be judged by runs that never executed");
  assert.match(v.why, /never started/);
  assert.deepEqual(v.failed, [], "a runner that could not be allocated is not a failing check");
});

test("a genuinely failing check is still RED", () => {
  /*
   * The other direction, and the one that matters more. `be40ad9` really was
   * broken — five TS18046 sites — and softening this would hand back exactly
   * the silence RULING 75 was adopted over.
   */
  const v = verdictFromCheckRuns([
    at("gates", { steps: [{ name: "Types", conclusion: "failure" }] }),
    { ...at("build (default)"), conclusion: "success", steps: [{ name: "Build" }] },
  ]);
  assert.equal(v.verdict, "red");
  assert.equal(v.failed.length, 1);
});

test("a mixed run judges what RAN and names what did not", () => {
  const v = verdictFromCheckRuns([
    { ...at("build"), conclusion: "success", steps: [{ name: "Build" }] },
    at("gates"),
  ]);
  // One started and passed, one never started. That is not green — there is a
  // check whose verdict nobody has — and it is not red either.
  //
  // A-008: this comment was already correct and the assertion below it was not.
  // `notEqual(verdict, "red")` is satisfied by GREEN, which is precisely what
  // the code returned, so the prose and the test disagreed and the prose lost
  // silently. The test now asserts the invariant its own comment states.
  assert.equal(v.verdict, "unknown", "a check with no verdict is not a passing check");
  assert.notEqual(v.verdict, "red", "the stillborn one is not counted as a failure");
  assert.deepEqual(v.failed, []);
  assert.deepEqual(v.neverStarted, ["gates"], "the check nobody has a verdict for is NAMED");
});

/**
 * **A-008, reproduced.** (External correctness audit of `336a3eb`, remediated
 * 2026-08-24.)
 *
 * The auditor could not run code, so this is the finding turned into the case
 * that fails against the old function and passes against the new one. Against
 * the code as shipped it returned `{verdict: "green", why: "2 check(s) passed"}`
 * — green on a commit where the gates job executed nothing, and a count of two
 * passes where there was one.
 *
 * This is the release gate every session trusts under RULING 75. A false green
 * here is not one wrong answer; it is every subsequent session reporting a
 * healthy `main` without looking.
 */
test("A-008 · one passing check beside one stillborn REQUIRED check is not GREEN", () => {
  const v = verdictFromCheckRuns([
    {
      ...at("build (default)"),
      conclusion: "success",
      completed_at: "2026-08-22T22:02:22Z",
      steps: [{ name: "Build", conclusion: "success" }],
    },
    at("gates (test · lint · tsc)"),
  ]);
  assert.equal(v.verdict, "unknown", "GREEN here is the A-008 false green");
  assert.deepEqual(v.neverStarted, ["gates (test · lint · tsc)"]);
  assert.match(v.why, /NOT green/, "the reason has to say why it is not green");
  assert.match(v.why, /gates/, "and it has to name the check nobody has a verdict for");
});

/**
 * The other direction, which is what makes the fix a fix rather than a
 * broadening. A REAL failure stays RED even when a second runner was never
 * allocated: a named defect outranks an unknown, and demoting it to
 * cannot-tell would hand back the silence RULING 75 was adopted over.
 */
test("A-008 · a real failure beside a stillborn check is still RED, and both are named", () => {
  const v = verdictFromCheckRuns([
    at("gates", { steps: [{ name: "Types", conclusion: "failure" }] }),
    at("build (standalone)"),
  ]);
  assert.equal(v.verdict, "red");
  assert.deepEqual(v.failed, ["gates (failure)"]);
  assert.deepEqual(v.neverStarted, ["build (standalone)"]);
});

/**
 * And PENDING outranks stillborn, because work in flight is a question about
 * the future rather than a wall. Reporting a cap that is not there sends a
 * session hunting the wrong thing.
 */
test("A-008 · a stillborn check beside work still running reports PENDING, naming both", () => {
  const v = verdictFromCheckRuns([
    { ...at("build"), status: "in_progress", conclusion: null, steps: [] },
    at("gates"),
  ]);
  assert.equal(v.verdict, "pending");
  assert.deepEqual(v.pending, ["build"]);
  assert.deepEqual(v.neverStarted, ["gates"]);
});

test("no check at all is CANNOT TELL, not GREEN", () => {
  const v = verdictFromCheckRuns([]);
  assert.equal(v.verdict, "unknown");
  assert.match(v.why, /not the same as passing/);
});

test("all checks passing is the only GREEN", () => {
  const v = verdictFromCheckRuns([
    { ...at("a"), conclusion: "success", steps: [{ name: "s" }] },
    { ...at("b"), conclusion: "skipped", steps: [{ name: "s" }] },
  ]);
  assert.equal(v.verdict, "green");
});

test("a check still running is PENDING, which is not green", () => {
  const v = verdictFromCheckRuns([
    { ...at("a"), conclusion: "success", steps: [{ name: "s" }] },
    { ...at("b"), status: "in_progress", conclusion: null, steps: [{ name: "s" }] },
  ]);
  assert.equal(v.verdict, "pending");
});
