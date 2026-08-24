import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  completedRuns,
  failedTwiceConsecutively,
  failedTwiceInWindow,
  failureRate,
  runsOnOwnCadence,
  type WorkflowRun,
} from "../lib/ops/job-watch.ts";

/**
 * **RULING 56 — a scheduled job that fails tells someone.** (NH Hunt 3,
 * 2026-08-21.)
 *
 * The watcher's own logic may not be a thing that is only ever exercised in
 * production, because that is the shape it exists to catch. These hold the
 * decision against fixed run lists, with no network.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const run = (
  id: number,
  conclusion: string | null,
  createdAt: string,
  status = "completed",
): WorkflowRun => ({ databaseId: id, conclusion, status, createdAt });

test("two failures at the top of the list is a finding", () => {
  const found = failedTwiceConsecutively([
    run(3, "failure", "2026-08-20T13:12:51Z"),
    run(2, "failure", "2026-08-20T07:08:02Z"),
    run(1, "success", "2026-08-19T18:54:56Z"),
  ]);
  assert.ok(found);
  assert.equal(found.newest.databaseId, 3);
  assert.equal(found.previous.databaseId, 2);
});

test("one failure is not a finding — a wall does not usually repeat", () => {
  assert.equal(
    failedTwiceConsecutively([
      run(3, "failure", "2026-08-21T13:12:56Z"),
      run(2, "success", "2026-08-21T07:09:40Z"),
      run(1, "failure", "2026-08-20T13:12:51Z"),
    ]),
    null,
  );
});

test("two failures separated by a success is not a finding", () => {
  assert.equal(
    failedTwiceConsecutively([
      run(3, "failure", "2026-08-21T13:00:00Z"),
      run(2, "success", "2026-08-21T07:00:00Z"),
      run(1, "failure", "2026-08-20T13:00:00Z"),
    ]),
    null,
  );
});

test("too little history returns null, which is not the same claim as healthy", () => {
  assert.equal(failedTwiceConsecutively([run(1, "failure", "2026-08-21T13:00:00Z")]), null);
  assert.equal(failedTwiceConsecutively([]), null);
});

test("an in-flight run cannot mask the failure before it", () => {
  // A run still going has no conclusion. If it counted, the pair below would
  // read as "not two failures" and a job failing right now would go unseen.
  const runs = completedRuns([
    run(4, null, "2026-08-21T18:00:00Z", "in_progress"),
    run(3, "failure", "2026-08-21T13:00:00Z"),
    run(2, "failure", "2026-08-21T07:00:00Z"),
  ]);
  assert.equal(runs.length, 2);
  assert.ok(failedTwiceConsecutively(runs));
});

test("cancelled is not failure — a cancelled run is nobody's diagnosis", () => {
  assert.equal(
    failedTwiceConsecutively([
      run(3, "cancelled", "2026-08-19T07:07:20Z"),
      run(2, "failure", "2026-08-19T01:54:45Z"),
    ]),
    null,
  );
});

test("asOf hides later runs, so the detector can be held against known history", () => {
  const all = [
    run(3, "success", "2026-08-21T07:09:40Z"),
    run(2, "failure", "2026-08-20T13:12:51Z"),
    run(1, "failure", "2026-08-20T07:08:02Z"),
  ];
  assert.equal(failedTwiceConsecutively(completedRuns(all)), null);
  const asOf = completedRuns(all, new Date("2026-08-20T14:00:00Z"));
  assert.equal(asOf.length, 2);
  assert.ok(failedTwiceConsecutively(asOf), "the same list, seen earlier, IS a finding");
});

test("runs out of order are sorted before the top two are read", () => {
  // The API returns newest-first today. Depending on that silently is how a
  // detector starts reading the two OLDEST runs after an upstream change.
  const found = failedTwiceConsecutively(
    completedRuns([
      run(1, "success", "2026-08-18T01:00:00Z"),
      run(3, "failure", "2026-08-20T13:00:00Z"),
      run(2, "failure", "2026-08-20T07:00:00Z"),
    ]),
  );
  assert.ok(found);
  assert.equal(found.newest.databaseId, 3);
});

test("the rate is a pair, never a bare percentage", () => {
  const rate = failureRate([
    run(3, "failure", "2026-08-20T13:00:00Z"),
    run(2, "success", "2026-08-20T07:00:00Z"),
    run(1, "failure", "2026-08-20T01:00:00Z"),
  ]);
  assert.deepEqual(rate, { failures: 2, completed: 3 });
});

/**
 * The watcher is worth nothing if it is not RUN. This asserts the workflow
 * that runs it exists and names the script, so deleting the schedule fails the
 * build rather than quietly returning the product to the state RULING 56 was
 * adopted to end.
 */
test("a workflow actually runs the watcher on a schedule", () => {
  const yml = readFileSync(join(ROOT, ".github", "workflows", "job-watch.yml"), "utf8");
  assert.match(yml, /schedule:/, "it runs on a schedule");
  assert.match(yml, /watch:workflows/, "it runs the watcher");
  assert.match(yml, /--open/, "it is allowed to open the row, not only report");
});

/**
 * Every workflow the repo schedules is watched. A new scheduled job that
 * nobody added to the list would fail silently exactly as these two did.
 */
test("every scheduled workflow in the repo is on the watch list", () => {
  const dir = join(ROOT, ".github", "workflows");
  const watcher = readFileSync(join(ROOT, "scripts", "watch-workflows.mts"), "utf8");

  const scheduled = readdirSync(dir).filter((f) => {
    if (!f.endsWith(".yml")) return false;
    if (f === "job-watch.yml") return false; // the watcher itself
    return /^\s*schedule:/m.test(readFileSync(join(dir, f), "utf8"));
  });

  /*
   * RULING 116: a guard may pin an INVARIANT or a DIRECTION, never the size of
   * a set that legitimately moves. This asserted `>= 5` and went red on
   * 2026-08-24 because RULING 124 consolidated five scheduled refreshes into
   * one — the guard failed on the day the work was done, which is precisely
   * the shape that trains a reader to edit the constant.
   *
   * The invariant is the second assertion and it never needed the first: EVERY
   * scheduled workflow is watched. The floor stays at 1 only so that a repo
   * with no schedules at all cannot pass this vacuously.
   */
  assert.ok(
    scheduled.length >= 1,
    "no scheduled workflow found at all — this guard would pass without looking",
  );
  const missing = scheduled.filter((f) => !watcher.includes(f));
  assert.deepEqual(missing, [], `scheduled workflows nothing watches: ${missing.join(", ")}`);
});


/* --------------------------------------------------------------------------
 * NJ Hunt 3 item 1c (2026-08-22) — the double failure that healed before the
 * watcher looked.
 *
 * `refresh-meetings-snapshot.yml` failed at 01:25 and again at 01:30 on
 * 2026-08-22 and went green at 01:51. Job watch reads once a day at 15:40 UTC
 * and read only the two most recent completed runs, so by the time it looked
 * the pair was buried under a success. It passed. It opened nothing. No Needs
 * Sean row exists for it, and the failure rate stood at 17 of 40.
 *
 * The RULE was never wrong — replaying it with `--asof=2026-08-22T01:45:00Z`
 * fires and names both run ids. The SAMPLING was: a two-run window read once a
 * day cannot see anything that heals in between. These hold the widened
 * detector against the real shape, using the real run ids.
 * ------------------------------------------------------------------------ */

test("1c: a healed double failure is found anywhere in the window", () => {
  // The live shape, newest first: success at 01:51 over the 01:30/01:25 pair.
  const runs = [
    run(32544643877, "success", "2026-08-22T01:51:50Z"),
    run(32543652154, "failure", "2026-08-22T01:30:53Z"),
    run(32543393133, "failure", "2026-08-22T01:25:44Z"),
    run(32516048635, "success", "2026-08-21T18:58:15Z"),
  ];

  // The old head-only rule sees nothing. That is the defect, pinned.
  assert.equal(
    failedTwiceConsecutively(runs),
    null,
    "the head-only rule cannot see a pair that has already healed",
  );

  const found = failedTwiceInWindow(runs);
  assert.ok(found, "the window scan finds the pair the daily reading missed");
  assert.equal(found.newest.databaseId, 32543652154);
  assert.equal(found.previous.databaseId, 32543393133);
  assert.equal(found.healed, true, "not at the head — it recovered, and that is stated");
});

test("1c: a pair at the head is reported as still broken, not as healed", () => {
  const found = failedTwiceInWindow([
    run(3, "failure", "2026-08-22T18:50:05Z"),
    run(2, "failure", "2026-08-22T13:02:18Z"),
    run(1, "success", "2026-08-22T07:00:52Z"),
  ]);
  assert.ok(found);
  assert.equal(found.healed, false, "the pair is at the head — this job is failing now");
});

test("1c: alternating failures are not a pair — the rule is still ADJACENT", () => {
  assert.equal(
    failedTwiceInWindow([
      run(4, "failure", "2026-08-22T18:00:00Z"),
      run(3, "success", "2026-08-22T12:00:00Z"),
      run(2, "failure", "2026-08-22T06:00:00Z"),
      run(1, "success", "2026-08-22T00:00:00Z"),
    ]),
    null,
    "a flaky job that never fails twice running is not what this detector claims to catch",
  );
});

test("1c: the MOST RECENT pair is the one returned", () => {
  const found = failedTwiceInWindow([
    run(6, "success", "2026-08-22T18:00:00Z"),
    run(5, "failure", "2026-08-22T12:00:00Z"),
    run(4, "failure", "2026-08-22T06:00:00Z"),
    run(3, "success", "2026-08-21T18:00:00Z"),
    run(2, "failure", "2026-08-21T12:00:00Z"),
    run(1, "failure", "2026-08-21T06:00:00Z"),
  ]);
  assert.ok(found);
  assert.equal(found.newest.databaseId, 5, "the older pair is not the one worth a row");
});

test("1c: a window with fewer than two runs says nothing rather than healthy", () => {
  assert.equal(failedTwiceInWindow([]), null);
  assert.equal(failedTwiceInWindow([run(1, "failure", "2026-08-22T18:00:00Z")]), null);
});

/* -------------------------------------------------------------------------- */
/* A DRILL IS NOT A FAILURE — closing JOB02's diagnosis (2026-08-24)          */
/* -------------------------------------------------------------------------- */

test("JOB02: two manual dispatches do NOT raise a row", () => {
  // The real case, from the run list read on 2026-08-23: runs 32543393133 and
  // 32543652154, five minutes apart, both workflow_dispatch, both carrying
  // WTP_INGEST_FORCE_JOB_FAILURE. The ingest's own log says "No vendor failed.
  // No source failed." The watcher raised a P1 Needs Sean row on a drill.
  const drills: WorkflowRun[] = [
    { databaseId: 32543652154, conclusion: "failure", status: "completed", createdAt: "2026-08-22T01:30:53Z", event: "workflow_dispatch" },
    { databaseId: 32543393133, conclusion: "failure", status: "completed", createdAt: "2026-08-22T01:25:44Z", event: "workflow_dispatch" },
    { databaseId: 1, conclusion: "success", status: "completed", createdAt: "2026-08-21T01:25:44Z", event: "schedule" },
  ];
  const cadence = runsOnOwnCadence(drills);
  assert.equal(cadence.dispatchedSetAside, 2);
  assert.equal(failedTwiceConsecutively(cadence.kept), null);
  assert.equal(failedTwiceInWindow(cadence.kept), null);
});

test("a real scheduled double failure STILL raises a row", () => {
  // The half that matters more. Narrowing the input must not have narrowed the
  // detector: this is the case the watcher exists for and it must survive.
  const real: WorkflowRun[] = [
    { databaseId: 3, conclusion: "failure", status: "completed", createdAt: "2026-08-22T01:30:00Z", event: "schedule" },
    { databaseId: 2, conclusion: "failure", status: "completed", createdAt: "2026-08-21T01:30:00Z", event: "schedule" },
    { databaseId: 1, conclusion: "success", status: "completed", createdAt: "2026-08-20T01:30:00Z", event: "schedule" },
  ];
  const cadence = runsOnOwnCadence(real);
  assert.equal(cadence.dispatchedSetAside, 0);
  assert.notEqual(failedTwiceConsecutively(cadence.kept), null);
});

test("an unknown trigger is NOT treated as a drill", () => {
  // Fail in the direction that keeps the alarm. A run whose trigger we cannot
  // read must never be able to silence the watcher — that is the direction
  // that loses a real failure, and it is the one a missing field would take by
  // default if `undefined` counted as a dispatch.
  const unknown: WorkflowRun[] = [
    { databaseId: 2, conclusion: "failure", status: "completed", createdAt: "2026-08-22T01:30:00Z" },
    { databaseId: 1, conclusion: "failure", status: "completed", createdAt: "2026-08-21T01:30:00Z" },
  ];
  assert.equal(runsOnOwnCadence(unknown).dispatchedSetAside, 0);
  assert.notEqual(failedTwiceConsecutively(runsOnOwnCadence(unknown).kept), null);
});

test("the drill filter does not change the RATE, which is a fact about the workflow", () => {
  const mixed: WorkflowRun[] = [
    { databaseId: 3, conclusion: "failure", status: "completed", createdAt: "2026-08-22T02:00:00Z", event: "workflow_dispatch" },
    { databaseId: 2, conclusion: "failure", status: "completed", createdAt: "2026-08-22T01:00:00Z", event: "schedule" },
    { databaseId: 1, conclusion: "success", status: "completed", createdAt: "2026-08-21T01:00:00Z", event: "schedule" },
  ];
  // The rate counts everything; only the row-raising test is narrowed.
  assert.deepEqual(failureRate(mixed), { failures: 2, completed: 3 });
  assert.equal(runsOnOwnCadence(mixed).dispatchedSetAside, 1);
});
