/**
 * **A SILENT STOP IS NEVER ACCEPTABLE AGAIN.**
 * (Session B closure, 2026-08-31, operational incident + its two regressions.)
 *
 * The owner saw five refresh workflows with no run since 2026-08-26 and read it
 * as five days of unrefreshed production data. The observation was right; the
 * conclusion was wrong; and **nothing in the repository could tell the
 * difference** — those five had their crons consolidated into
 * `refresh-daily.yml`, which had run and succeeded every day since.
 *
 * The first version of this check then shipped with two false negatives of its
 * own, both of which let a broken schedule pass in silence. They are the two
 * SEEDED cases below.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  STALENESS_INCIDENT_STATES,
  STALENESS_WINDOW_MULTIPLE,
  cronsInWorkflowYaml,
  newestScheduledRun,
  scheduleStaleness,
  shortestIntervalHours,
} from "../lib/ops/schedule-audit.ts";

const NOW = "2026-08-31T16:38:00.000Z";
const DAILY = ["11 9 * * *"];

/* ==================== the incident the check exists for ==================== */

test("SEEDED: a SCHEDULED workflow with a stale scheduled run is an INCIDENT", () => {
  const verdict = scheduleStaleness({
    workflow: "refresh-daily.yml",
    crons: DAILY,
    lastScheduledRunAt: "2026-08-28T09:11:00.000Z",
    nowISO: NOW,
  });
  assert.equal(verdict.state, "STALE");
  assert.equal(verdict.intervalHours, 24);
  assert.equal(verdict.windowHours, 48);
  assert.match(verdict.detail, /RULING 218 operational incident/);
  assert.ok(STALENESS_INCIDENT_STATES.includes(verdict.state));
});

test("SEEDED: a DISPATCH-ONLY workflow is NOT_SCHEDULED and can never be stale", () => {
  /* The false alarm, reproduced: silence from a workflow with no cron is
     correct and permanent, and flagging it would manufacture an incident daily. */
  const verdict = scheduleStaleness({
    workflow: "refresh-meetings-snapshot.yml",
    crons: [],
    lastScheduledRunAt: "2026-08-24T10:03:17.000Z",
    nowISO: NOW,
  });
  assert.equal(verdict.state, "NOT_SCHEDULED");
  assert.ok(!STALENESS_INCIDENT_STATES.includes(verdict.state));
  assert.match(verdict.detail, /the file that took it over is what to watch/);
});

/* ============ REGRESSION 1 — a manual run must not mask a dead cron ======== */

test("SEEDED REGRESSION: a stopped cron followed by a MANUAL dispatch is still STALE", () => {
  /*
   * The exact defect. The check took the newest run of ANY trigger, so a cron
   * that stopped on Monday plus one human clicking Run workflow on Thursday
   * read FRESH — and somebody noticing and running it by hand is the single
   * most likely thing to happen after a schedule breaks, which is precisely
   * when this would have gone quiet.
   */
  const runs = [
    { event: "workflow_dispatch", createdAt: "2026-08-31T15:00:00.000Z" },
    { event: "schedule", createdAt: "2026-08-26T09:11:00.000Z" },
  ];

  const newestOfAnyKind = runs[0].createdAt;
  const newestScheduled = newestScheduledRun(runs);
  assert.equal(newestScheduled, "2026-08-26T09:11:00.000Z");
  assert.notEqual(
    newestScheduled,
    newestOfAnyKind,
    "the two differ, which is the whole reason the bug was invisible",
  );

  const verdict = scheduleStaleness({
    workflow: "refresh-daily.yml",
    crons: DAILY,
    lastScheduledRunAt: newestScheduled,
    nowISO: NOW,
  });
  assert.equal(
    verdict.state,
    "STALE",
    "a manual dispatch proves a human ran it and says nothing about whether the cron fired",
  );

  /* And the old behaviour is pinned as wrong, so nobody restores it. */
  const wrong = scheduleStaleness({
    workflow: "refresh-daily.yml",
    crons: DAILY,
    lastScheduledRunAt: newestOfAnyKind,
    nowISO: NOW,
  });
  assert.equal(wrong.state, "FRESH", "feeding it the newest run of any kind is what hid the stop");
});

test("newestScheduledRun ignores every non-schedule trigger, and orders by time", () => {
  assert.equal(newestScheduledRun([]), null);
  assert.equal(newestScheduledRun([{ event: "push", createdAt: "2026-08-31T00:00:00.000Z" }]), null);
  assert.equal(
    newestScheduledRun([
      { event: "schedule", createdAt: "2026-08-20T00:00:00.000Z" },
      { event: "schedule", createdAt: "2026-08-29T00:00:00.000Z" },
      { event: "workflow_dispatch", createdAt: "2026-08-31T00:00:00.000Z" },
    ]),
    "2026-08-29T00:00:00.000Z",
  );
});

/* ====== REGRESSION 2 — an unreadable cron is not an absent one ============= */

test("SEEDED REGRESSION: a cron the parser cannot read is UNREADABLE, never NOT_SCHEDULED", () => {
  /*
   * The second false negative, and the worse-shaped one: a workflow whose
   * schedule is REAL, whose runs this auditor cannot judge, passing monitoring
   * in silence because "cannot parse" had been folded into "has no schedule".
   */
  const verdict = scheduleStaleness({
    workflow: "weird.yml",
    crons: ["*/5 * * * *"],
    lastScheduledRunAt: "2026-08-01T00:00:00.000Z",
    nowISO: NOW,
  });
  assert.equal(verdict.state, "UNREADABLE_SCHEDULE");
  assert.notEqual(
    verdict.state,
    "NOT_SCHEDULED",
    "positively observing NO cron and failing to read one are opposite facts",
  );
  assert.ok(
    STALENESS_INCIDENT_STATES.includes(verdict.state),
    "it must open an incident: the thing that failed is the instrument",
  );
  assert.match(verdict.detail, /may not pass monitoring quietly/);
});

test("an unreadable last-run timestamp also refuses to pass quietly", () => {
  const verdict = scheduleStaleness({
    workflow: "weird.yml",
    crons: DAILY,
    lastScheduledRunAt: "not-a-date",
    nowISO: NOW,
  });
  assert.equal(verdict.state, "UNREADABLE_SCHEDULE");
  assert.match(verdict.detail, /an unclaimable freshness is not a passing one/);
});

/* ============================== the window ================================= */

test("ordinary GitHub lateness does NOT fire — the window is twice the interval", () => {
  /*
   * Measured, not guessed: refresh-daily's runs landed between 38 minutes and
   * 11h38m after their slot over the six days to 2026-08-30, and the scheduled
   * run on 2026-08-31 arrived 7h51m late on its own. A one-interval window
   * would have fired on most of them.
   */
  assert.equal(STALENESS_WINDOW_MULTIPLE, 2);
  for (const lateHours of [0.6, 5.2, 7.85, 11.7, 23.9]) {
    const lastRun = new Date(Date.parse(NOW) - lateHours * 3_600_000).toISOString();
    const verdict = scheduleStaleness({
      workflow: "refresh-daily.yml",
      crons: DAILY,
      lastScheduledRunAt: lastRun,
      nowISO: NOW,
    });
    assert.equal(verdict.state, "FRESH", `${lateHours}h late must not fire`);
  }
});

test("a scheduled workflow whose CRON has never fired is its own state", () => {
  const verdict = scheduleStaleness({
    workflow: "something-new.yml",
    crons: ["0 6 * * *"],
    lastScheduledRunAt: null,
    nowISO: NOW,
  });
  assert.equal(verdict.state, "NEVER_RAN");
  assert.match(verdict.detail, /Manual dispatches do not count/);
});

test("two daily slots halve the interval, so the window halves with it", () => {
  assert.equal(shortestIntervalHours(DAILY), 24);
  assert.equal(shortestIntervalHours(["11 9 * * *", "11 21 * * *"]), 12);
  assert.equal(shortestIntervalHours([]), null);
});

test("the cron reader is what separates scheduled from not, and it reads the file", () => {
  assert.deepEqual(cronsInWorkflowYaml("on:\n  workflow_dispatch:\n"), []);
  assert.deepEqual(
    cronsInWorkflowYaml('on:\n  schedule:\n    - cron: "11 9 * * *"\n  workflow_dispatch:\n'),
    ["11 9 * * *"],
  );
});
