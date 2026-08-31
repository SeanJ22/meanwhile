/**
 * **A SILENT STOP IS NEVER ACCEPTABLE AGAIN.**
 * (Session B closure, 2026-08-31, operational incident.)
 *
 * The owner saw five refresh workflows with no run since 2026-08-26 and
 * reported five days of unrefreshed production data. The observation was right;
 * the conclusion was wrong; and **nothing in the repository could tell the
 * difference** — which is the actual defect and what this closes.
 *
 * Those five had their crons consolidated into `refresh-daily.yml`, which has
 * run on schedule and succeeded every day since. A workflow with no cron and a
 * workflow whose schedule broke look identical in the Actions list, and until
 * now they looked identical here too.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  STALENESS_WINDOW_MULTIPLE,
  cronsInWorkflowYaml,
  scheduleStaleness,
  shortestIntervalHours,
} from "../lib/ops/schedule-audit.ts";

const NOW = "2026-08-31T16:38:00.000Z";

test("SEEDED: a SCHEDULED workflow with a stale last run is an INCIDENT", () => {
  /* Daily cron, last run three days ago. Past the 48h window. */
  const verdict = scheduleStaleness({
    workflow: "refresh-daily.yml",
    crons: ["11 9 * * *"],
    lastRunAt: "2026-08-28T09:11:00.000Z",
    nowISO: NOW,
  });
  assert.equal(verdict.state, "STALE");
  assert.equal(verdict.intervalHours, 24);
  assert.equal(verdict.windowHours, 48);
  assert.match(verdict.detail, /RULING 218 operational incident/);
});

test("SEEDED: a DISPATCH-ONLY workflow is NOT_SCHEDULED and can never be stale", () => {
  /*
   * This is the false alarm, reproduced. `refresh-meetings-snapshot.yml` has
   * carried `on: workflow_dispatch:` alone since its cron moved to
   * `refresh-daily.yml`. Silence from it is correct and permanent, and a check
   * that flagged it would manufacture an incident every single day.
   */
  const verdict = scheduleStaleness({
    workflow: "refresh-meetings-snapshot.yml",
    crons: [],
    lastRunAt: "2026-08-26T17:51:58.000Z",
    nowISO: NOW,
  });
  assert.equal(verdict.state, "NOT_SCHEDULED");
  assert.notEqual(verdict.state, "STALE");
  assert.match(verdict.detail, /carries no cron/);
  assert.match(
    verdict.detail,
    /the file that took it over is what to watch/,
    "the message must point at the replacement, or the next reader repeats the same diagnosis",
  );
});

test("ordinary GitHub lateness does NOT fire — the window is twice the interval", () => {
  /*
   * Measured, not guessed: this repository's own refresh-daily runs landed
   * between 38 minutes and 11h38m after their slot over the six days to
   * 2026-08-30. A one-interval window would have fired on four of six.
   */
  assert.equal(STALENESS_WINDOW_MULTIPLE, 2);
  for (const lateHours of [0.6, 5.2, 11.7, 23.9]) {
    const lastRun = new Date(Date.parse(NOW) - lateHours * 3_600_000).toISOString();
    const verdict = scheduleStaleness({
      workflow: "refresh-daily.yml",
      crons: ["11 9 * * *"],
      lastRunAt: lastRun,
      nowISO: NOW,
    });
    assert.equal(verdict.state, "FRESH", `${lateHours}h late must not fire`);
  }
});

test("a scheduled workflow that has NEVER run is its own state", () => {
  const verdict = scheduleStaleness({
    workflow: "something-new.yml",
    crons: ["0 6 * * *"],
    lastRunAt: null,
    nowISO: NOW,
  });
  assert.equal(verdict.state, "NEVER_RAN");
  assert.match(verdict.detail, /never fired is not a young schedule/);
});

test("two daily slots halve the interval, so the window halves with it", () => {
  assert.equal(shortestIntervalHours(["11 9 * * *"]), 24);
  assert.equal(shortestIntervalHours(["11 9 * * *", "11 21 * * *"]), 12);
  assert.equal(shortestIntervalHours([]), null);
});

test("SEEDED: an UNPARSEABLE cron is reported unknown, never given a guessed window", () => {
  const verdict = scheduleStaleness({
    workflow: "weird.yml",
    crons: ["*/5 * * * *"],
    lastRunAt: "2026-08-01T00:00:00.000Z",
    nowISO: NOW,
  });
  assert.equal(
    verdict.state,
    "NOT_SCHEDULED",
    "a guessed interval would produce a guessed incident",
  );
  assert.equal(verdict.windowHours, null);
  assert.match(verdict.detail, /cannot parse/);
});

test("the cron reader is what separates the two cases, and it reads the file", () => {
  /* The discriminator is the workflow file itself, not a memory of what it
     used to say. */
  assert.deepEqual(cronsInWorkflowYaml("on:\n  workflow_dispatch:\n"), []);
  assert.deepEqual(
    cronsInWorkflowYaml('on:\n  schedule:\n    - cron: "11 9 * * *"\n  workflow_dispatch:\n'),
    ["11 9 * * *"],
  );
});
