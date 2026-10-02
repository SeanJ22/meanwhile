import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
import { failureTail, renderFailureTail, shapeFailureTail } from "../lib/ops/job-watch-log.ts";

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

test("PDC terminal boundary: no job watcher is dispatchable and GitHub owns zero routine clocks", () => {
  const dir = join(ROOT, ".github", "workflows");
  // Build Check's three-hourly run is a software certification of main (the whole
  // suite behind affected-only PR tests), not an operations clock; exempt by
  // exact name and cron only. tests/admin-source-registry.test.ts says why.
  const softwareCertification = (file: string, text: string) =>
    file === "build-check.yml" && /^\s{2}schedule:\s*\n\s{4}- cron: '17 \*\/3 \* \* \*'\s*$/m.test(text);
  const scheduled = readdirSync(dir)
    .filter((file) => /\.ya?ml$/.test(file))
    .filter((file) => {
      const text = readFileSync(join(dir, file), "utf8");
      return /^\s*schedule:/m.test(text) && !softwareCertification(file, text);
    });
  assert.deepEqual(scheduled, [], `GITHUB_ROUTINE_OPS_CRONS=${scheduled.length}: ${scheduled.join(", ")}`);
  assert.equal(existsSync(join(dir, "job-watch.yml")), false, "job-watch.yml is still dispatchable");
  assert.equal(existsSync(join(ROOT, "scripts", "watch-workflows.mts")), false, "the job-watch CLI still exists");
  const pkg = readFileSync(join(ROOT, "package.json"), "utf8");
  assert.doesNotMatch(pkg, /"watch:workflows"\s*:/, "the retired watcher still has a familiar executable alias");
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

/**
 * ## The warm-log upgrade (2026-08-25, the one-session brief item 2)
 *
 * Sean's standing complaint is that night jobs keep tripping and nobody learns
 * why. A row naming the run id and the failing step says WHERE to look; it does
 * not say WHAT HAPPENED, so every diagnosis begins by fetching a log — which is
 * the cost `JOB03` was opened over.
 *
 * These walk the shaping against a RECORDED EXCERPT of the real failing run
 * (32833989579, the daily refresh of 2026-08-25 09:49 UTC). RULING 110: the
 * instrument is shown catching the real instance, not a plausible one.
 */

const RECORDED_FAILING_LOG = readFileSync(
  join(ROOT, "tests", "fixtures", "job-watch", "refresh-daily-32833989579-tail.txt"),
  "utf8",
);

test("the tail carries the REAL cause line off the real recorded run", () => {
  const shaped = shapeFailureTail(RECORDED_FAILING_LOG);
  assert.notEqual(shaped, null);
  const text = shaped!.lines.join("\n");
  // The sentence a reader needs first. If the shaping ever drops it, this row
  // is back to naming a run id and nothing else.
  assert.match(text, /EVERY due source failed/);
});

test("the scaffolding comes off: no job column, no step column, no ISO timestamp", () => {
  const shaped = shapeFailureTail(RECORDED_FAILING_LOG);
  for (const line of shaped!.lines) {
    assert.doesNotMatch(line, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/, `timestamp survived: ${line}`);
    assert.doesNotMatch(line, /^refresh\tUNKNOWN STEP/, `step column survived: ${line}`);
  }
});

test("post-job git cleanup is filtered out — a tail made of it has told the reader nothing", () => {
  const shaped = shapeFailureTail(RECORDED_FAILING_LOG);
  const text = shaped!.lines.join("\n");
  assert.doesNotMatch(text, /Post job cleanup/);
  assert.doesNotMatch(text, /\[command\]\/usr\/bin\/git version/);
});

test("a clip is STATED with both numbers, never implied", () => {
  const many = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
  const shaped = shapeFailureTail(many, { lines: 5 });
  assert.equal(shaped!.clipped, true);
  assert.equal(shaped!.totalLines, 60);
  assert.equal(shaped!.lines.length, 5);
  // The two-numbers rule applied to a log excerpt.
  assert.match(renderFailureTail(shaped), /last 5 of 60 line\(s\)/);
  // And the tail is the END, which is where a cause lives.
  assert.match(renderFailureTail(shaped), /line 59/);
});

test("an unclipped tail does not claim to be clipped", () => {
  const shaped = shapeFailureTail("only line\n");
  assert.equal(shaped!.clipped, false);
  assert.match(renderFailureTail(shaped), /All 1 line\(s\)/);
});

test("a log that COULD NOT BE READ never reads like a run that printed nothing", () => {
  // RULING 24, inside the watcher. These are two different claims and the row
  // must be able to tell a reader which one it is holding.
  const unreadable = failureTail(1, () => {
    throw new Error("gh: HTTP 502");
  });
  const empty = failureTail(1, () => "");
  assert.match(unreadable, /COULD NOT BE READ/);
  assert.match(unreadable, /not about the run/);
  assert.match(empty, /carried no meaningful line/);
  assert.notEqual(unreadable, empty);
});

test("a long single line is capped rather than carried whole", () => {
  const shaped = shapeFailureTail(`${"x".repeat(5000)}\n`, { lineChars: 80 });
  assert.equal(shaped!.lines[0].length, 80);
  assert.match(shaped!.lines[0], /…$/);
});

test("the cause line is surfaced even when it sits far above the tail", () => {
  /*
   * The first live run of this upgrade printed 1,842 lines and the last
   * fourteen were a node stack trace, while the sentence a reader needs sat a
   * screen above the window. A tail is where a failure ENDS; it is not
   * reliably where a failure is EXPLAINED.
   */
  const log = [
    "AssertionError [ERR_ASSERTION]: these files enumerate every covered state by hand",
    ...Array.from({ length: 40 }, (_, i) => `    at Test.run (node:internal/test_runner/test:${i}:1)`),
  ].join("\n");
  const shaped = shapeFailureTail(log);
  // The tail alone would carry only stack frames.
  assert.ok(shaped!.lines.every((l) => l.trim().startsWith("at ")));
  // The cause is surfaced regardless of where it sat.
  assert.match(renderFailureTail(shaped), /enumerate every covered state by hand/);
  assert.match(renderFailureTail(shaped), /NAME the failure/);
});

test("a stack frame is never mistaken for the naming of a failure", () => {
  const shaped = shapeFailureTail(["    at Foo.bar (/x/y.js:1:1) Error: nope", "done"].join("\n"));
  assert.deepEqual(shaped!.causes, []);
});

test("a cause already visible in the tail is not repeated above it", () => {
  const shaped = shapeFailureTail("first\n##[error]Process completed with exit code 1.");
  assert.match(shaped!.lines.join("\n"), /##\[error\]/);
  assert.deepEqual(shaped!.causes, []);
});

test("the real recorded run names its cause, not only its stack", () => {
  const rendered = renderFailureTail(shapeFailureTail(RECORDED_FAILING_LOG));
  // Both halves of the real failure, from the real log.
  assert.match(rendered, /extraction does not conserve/);
  assert.match(rendered, /EVERY due source failed/);
});

test("a PASSING TEST is never surfaced as a cause, however cause-shaped its name", () => {
  /*
   * Found by running this against the real log, not by reasoning about it. The
   * meetings refresh prints guard names like "a readonly connection string in
   * the RIGHT variable is refused" — a perfect match for the `refused` shape,
   * and a guard reporting SUCCESS. Four of them crowded out the real assertion.
   */
  const log = [
    "✔ PLANTED: a readonly connection string in the RIGHT variable is refused (0.3ms)",
    "✔ PLANTED: any other variable name is refused — there is no second door (1.6ms)",
    "ℹ fail 1",
    "  AssertionError [ERR_ASSERTION]: the real one",
    // Pushed above the tail window, which is where this defect actually lives.
    ...Array.from({ length: 20 }, (_, i) => `    at Test.run (node:internal/test_runner/test:${i}:1)`),
  ].join("\n");
  const causes = shapeFailureTail(log)!.causes;
  assert.equal(causes.length, 1);
  assert.match(causes[0], /the real one/);
  assert.ok(!causes.some((c) => c.includes("PLANTED")), `a passing guard was surfaced: ${causes.join(" | ")}`);
});
