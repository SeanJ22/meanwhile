import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// A `.mjs` sibling, imported for its decision functions only — the CLI half is
// guarded behind an entry-point check and does not run on import, so nothing
// here talks to GitHub.
import { latestPerName, neverStarted, verdictFromCheckRuns } from "../scripts/main-green.mjs";

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
  assert.deepEqual((v as { neverStarted?: string[] }).neverStarted, ["gates"], "the check nobody has a verdict for is NAMED");
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
  assert.deepEqual((v as { neverStarted?: string[] }).neverStarted, ["gates (test · lint · tsc)"]);
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
  assert.deepEqual((v as { neverStarted?: string[] }).neverStarted, ["build (standalone)"]);
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
  assert.deepEqual((v as { neverStarted?: string[] }).neverStarted, ["gates"]);
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

/* -------------------------------------------------------------------------- */
/* NH208 — THE LATEST RUN PER CHECK NAME (2026-08-26, Item 8b(a2))            */
/* -------------------------------------------------------------------------- */

test("NH208: a superseded cancellation does not make a healthy commit read RED", () => {
  // The real shape, 2026-08-26: `build-check.yml` carries
  // `concurrency: cancel-in-progress`, so a second push seconds later cancels
  // the first run. Both check-runs stay on the commit. Branch protection judges
  // `?filter=latest` and saw all three contexts `success`; this file counted
  // every run and said RED.
  const v = verdictFromCheckRuns([
    {
      name: "build (default)",
      status: "completed",
      conclusion: "cancelled",
      started_at: "2026-08-26T17:02:00Z",
      completed_at: "2026-08-26T17:03:00Z",
      steps: [{ name: "Build", conclusion: "cancelled" }],
    },
    {
      name: "build (default)",
      status: "completed",
      conclusion: "success",
      started_at: "2026-08-26T17:22:00Z",
      completed_at: "2026-08-26T17:30:00Z",
      steps: [{ name: "Build", conclusion: "success" }],
    },
  ]);
  assert.equal(v.verdict, "green", `a superseded cancellation is not a failure — saw ${v.verdict}: ${v.why}`);
});

test("NH208: the LATEST run still decides, so a genuine later failure is RED", () => {
  // The direction that matters more. Narrowing to the latest run must not have
  // narrowed the detector: an earlier success followed by a real failure is red.
  const v = verdictFromCheckRuns([
    {
      name: "gates (test · lint · tsc)",
      status: "completed",
      conclusion: "success",
      started_at: "2026-08-26T17:02:00Z",
      completed_at: "2026-08-26T17:10:00Z",
      steps: [{ name: "Test", conclusion: "success" }],
    },
    {
      name: "gates (test · lint · tsc)",
      status: "completed",
      conclusion: "failure",
      started_at: "2026-08-26T18:00:00Z",
      completed_at: "2026-08-26T18:05:00Z",
      steps: [{ name: "Test", conclusion: "failure" }],
    },
  ]);
  assert.equal(v.verdict, "red");
  assert.deepEqual(v.failed, ["gates (test · lint · tsc) (failure)"]);
});

test("NH208: a stillborn run never overwrites a real verdict from the same context", () => {
  // `neverStarted` means the runner was never allocated. It is not a later
  // opinion about the tree, so it must not win the tiebreak against a run that
  // actually executed — that would turn a known-good commit into CANNOT TELL.
  const v = verdictFromCheckRuns([
    {
      name: "build (standalone)",
      status: "completed",
      conclusion: "success",
      started_at: "2026-08-26T17:02:00Z",
      completed_at: "2026-08-26T17:12:00Z",
      steps: [{ name: "Build", conclusion: "success" }],
    },
    {
      name: "build (standalone)",
      status: "completed",
      conclusion: "cancelled",
      started_at: null,
      completed_at: null,
      steps: [],
    },
  ]);
  assert.equal(v.verdict, "green", `saw ${v.verdict}: ${v.why}`);
});

test("NH208: latestPerName reduces to one run per name and keeps every distinct name", () => {
  const reduced = latestPerName([
    { name: "a", status: "completed", conclusion: "cancelled", started_at: "2026-08-26T01:00:00Z", completed_at: "2026-08-26T01:01:00Z", steps: [{ name: "s", conclusion: "cancelled" }] },
    { name: "a", status: "completed", conclusion: "success", started_at: "2026-08-26T02:00:00Z", completed_at: "2026-08-26T02:01:00Z", steps: [{ name: "s", conclusion: "success" }] },
    { name: "b", status: "completed", conclusion: "success", started_at: "2026-08-26T02:00:00Z", completed_at: "2026-08-26T02:01:00Z", steps: [{ name: "s", conclusion: "success" }] },
  ]);
  assert.equal(reduced.length, 2, "three runs across two names reduce to two");
  assert.deepEqual(reduced.map((r) => r.name).sort(), ["a", "b"], "no name is dropped");
  assert.equal(reduced.find((r) => r.name === "a")?.conclusion, "success", "the later run wins");
});

test("a CANCELLED check reads UNKNOWN — never pass, and never red either", () => {
  // The real shape, 2026-08-26: five commits landed on `main` in two minutes
  // and every one of their build checks was killed by the next push.
  // 1bf635d, a9fb8cc, 3be63c6, 48ebed9 and b85f572 are not passed and not
  // failed — they are unjudged, and a verdict has to be able to say that.
  const v = verdictFromCheckRuns([
    {
      name: "build (default)",
      status: "completed",
      conclusion: "cancelled",
      started_at: "2026-08-26T17:54:58Z",
      completed_at: "2026-08-26T17:55:20Z",
      steps: [{ name: "Build", conclusion: "cancelled" }],
    },
  ]);
  assert.equal(v.verdict, "unknown", `saw ${v.verdict}: ${v.why}`);
  assert.match(v.why, /CANCELLED/);
  assert.deepEqual(v.failed, [], "a cancelled check is not a failing check either");
});

test("a timed-out check is still RED — it ran and told us something bad", () => {
  // The direction that matters: narrowing `cancelled` out of the failure set
  // must not have narrowed the detector. A job GitHub killed at six hours is
  // not the same as a job another push superseded.
  const v = verdictFromCheckRuns([
    {
      name: "build (default)",
      status: "completed",
      conclusion: "timed_out",
      started_at: "2026-08-26T10:00:00Z",
      completed_at: "2026-08-26T16:00:00Z",
      steps: [{ name: "Build", conclusion: "timed_out" }],
    },
  ]);
  assert.equal(v.verdict, "red");
});

test("a cancelled check beside a passing one still refuses GREEN", () => {
  const v = verdictFromCheckRuns([
    {
      name: "build (default)",
      status: "completed",
      conclusion: "success",
      started_at: "2026-08-26T17:00:00Z",
      completed_at: "2026-08-26T17:10:00Z",
      steps: [{ name: "Build", conclusion: "success" }],
    },
    {
      name: "gates (test · lint · tsc)",
      status: "completed",
      conclusion: "cancelled",
      started_at: "2026-08-26T17:00:00Z",
      completed_at: "2026-08-26T17:01:00Z",
      steps: [{ name: "Test", conclusion: "cancelled" }],
    },
  ]);
  assert.equal(v.verdict, "unknown", "one unjudged required context is enough to refuse green");
});

test("build-check gives every push to main its own concurrency group", () => {
  // The fix for the shape above lives in the workflow, so the guard reads the
  // workflow. Asserting it in main-green.mjs would prove that the code the fix
  // introduced does what the code does (RULING 153).
  const yml = readFileSync(join(import.meta.dirname, "..", ".github/workflows/build-check.yml"), "utf8");
  const group = /group:\s*(.+)/.exec(yml)?.[1] ?? "";
  assert.match(
    group,
    /github\.sha/,
    "a push to main must key its concurrency group on the COMMIT, or the next push cancels this " +
      "commit's check and leaves it unjudged on main forever",
  );
  assert.match(group, /github\.event_name == 'push'/, "and pull requests keep the old superseding behaviour");
});

test("the hourly scheduled run supersedes only its own earlier run", () => {
  const yml = readFileSync(join(import.meta.dirname, "..", ".github/workflows/build-check.yml"), "utf8");
  const group = /group:\s*(.+)/.exec(yml)?.[1] ?? "";
  assert.match(group, /github\.event_name == 'schedule' && 'scheduled'/, "the scheduled run keeps one group of its own");
  assert.match(yml, /^\s*cancel-in-progress:\s*true\s*$/m);
});
