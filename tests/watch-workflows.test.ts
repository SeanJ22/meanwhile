import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  completedRuns,
  failedTwiceConsecutively,
  failureRate,
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

  assert.ok(scheduled.length >= 5, `expected the known scheduled jobs — found ${scheduled.length}`);
  const missing = scheduled.filter((f) => !watcher.includes(f));
  assert.deepEqual(missing, [], `scheduled workflows nothing watches: ${missing.join(", ")}`);
});
