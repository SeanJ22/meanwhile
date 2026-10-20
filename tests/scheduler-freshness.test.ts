import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_CADENCE_HOURS,
  MIN_CADENCE_HOURS,
  dueNow,
  scheduleAll,
  scheduleObligation,
  isScheduled,
  type FreshnessObligation,
} from "../lib/control-plane/scheduler/obligation.ts";
import {
  FIRST_BACKOFF_MINUTES,
  MAX_BACKOFF_MINUTES,
  aggregateIncidents,
  recordFailure,
  retryable,
} from "../lib/control-plane/scheduler/debt.ts";
import {
  type RunWork,
  chooseExecutor,
  sweepExpiredLeases,
} from "../lib/control-plane/scheduler/dispatch.ts";
import { digestLines, huntRoundComparator, runCycle, runPool } from "../lib/control-plane/scheduler/shadow-loop.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  beginAttemptFor,
  claimRouteTask,
  registerRouteTask,
  registerWorkItem,
} from "../lib/control-plane/repository/coordinator.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";

const NOW = "2026-08-30T12:00:00.000Z";

const disposes: RunWork = async () => ({
  ranAs: "DETERMINISTIC",
  kind: "DISPOSED",
  disposition: {
    disposition: "WALKED_NO_YIELD",
    observation: { rawCount: 0, normalizedCount: 0, routeOnlyCount: 0, earliest: null, latest: null },
    permission: "ALLOWED",
    transport: "REACHABLE",
    note: "stub walked the route and it returned nothing",
  },
  detail: "walked",
});

const NOW_MS = Date.parse(NOW);

function obligation(over: Partial<FreshnessObligation> = {}): FreshnessObligation {
  return {
    id: "ob-1",
    recordClass: "filings",
    subjectId: "wtp-body/pima#governing",
    routeId: "legistar:events",
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    lastWorkedAt: null,
    ...over,
  };
}

test("an obligation with NO signal takes the daily default and SAYS so", () => {
  const row = scheduleObligation(obligation(), NOW_MS);
  assert.ok(isScheduled(row));
  assert.equal(row.cadenceHours, DEFAULT_CADENCE_HOURS);
  assert.equal(row.cadenceSource, "DEFAULT_NO_SIGNAL");
  assert.match(row.basis, /DEFAULT and not a derivation/);
  const meeting = scheduleObligation(obligation({ recordClass: "meetings" }), NOW_MS);
  assert.ok(isScheduled(meeting));
  assert.equal(meeting.cadenceHours, 12, "meeting sources keep their 12-hour cadence even without another signal");
});

test("a reader deadline places the check BEFORE it, not on it", () => {
  const row = scheduleObligation(
    obligation({ readerImpactAt: new Date(NOW_MS + 10 * 3_600_000).toISOString() }),
    NOW_MS,
  );
  assert.ok(isScheduled(row));
  assert.equal(row.cadenceSource, "READER_IMPACT");
  assert.equal(row.cadenceHours, 5);
  for (const offset of [-6, 6]) {
    const meeting = scheduleObligation(obligation({ recordClass: "meetings",
      meetingStartsAt: [new Date(NOW_MS + offset * 86_400_000).toISOString()] }), NOW_MS);
    assert.ok(isScheduled(meeting));
    assert.equal(meeting.cadenceHours, 1, "upcoming and concluded meetings within seven days are checked hourly");
  }
});

test("where both signals exist the SHORTER binds", () => {
  const row = scheduleObligation(
    obligation({
      readerImpactAt: new Date(NOW_MS + 40 * 3_600_000).toISOString(),
      observedChangeRateHours: 3,
    }),
    NOW_MS,
  );
  assert.ok(isScheduled(row));
  assert.equal(row.cadenceHours, 3);
  assert.equal(row.cadenceSource, "OBSERVED_CHANGE_RATE");
});

test("a declared publisher cycle outranks a rate we inferred", () => {
  const row = scheduleObligation(
    obligation({ observedChangeRateHours: 2, declaredCycleHours: 168 }),
    NOW_MS,
  );
  assert.ok(isScheduled(row));
  assert.equal(row.cadenceSource, "DECLARED_CYCLE");
  assert.equal(row.cadenceHours, 168);
});

test("a passed deadline is due at the floor, never in the past forever", () => {
  const row = scheduleObligation(
    obligation({ readerImpactAt: new Date(NOW_MS - 5 * 3_600_000).toISOString() }),
    NOW_MS,
  );
  assert.ok(isScheduled(row));
  assert.equal(row.cadenceHours, MIN_CADENCE_HOURS);
});

test("the next-due anchors on the last WORK, not on every glance", () => {
  const lastWorkedAt = new Date(NOW_MS - 20 * 3_600_000).toISOString();
  const row = scheduleObligation(obligation({ lastWorkedAt }), NOW_MS);
  assert.ok(isScheduled(row));
  assert.equal(row.nextDueAt, new Date(Date.parse(lastWorkedAt) + 24 * 3_600_000).toISOString());
});

test("an obligation with broken cadence data is NAMED, never defaulted", () => {
  const pass = scheduleAll(
    [
      obligation({ id: "good" }),
      obligation({ id: "bad-rate", observedChangeRateHours: Number.NaN }),
      obligation({ id: "bad-date", readerImpactAt: "sometime next week" }),
      obligation({ id: "bad-cycle", declaredCycleHours: -4 }),
    ],
    NOW_MS,
  );
  assert.deepEqual(pass.scheduled.map((s) => s.obligation.id), ["good"]);
  assert.equal(pass.unscheduled.length, 3);
  assert.match(pass.unscheduled.find((u) => u.obligation.id === "bad-date")!.reason, /does not parse/);
  for (const u of pass.unscheduled) {
    assert.ok(u.reason.length > 0, "every unscheduled row carries its reason");
  }
});

test("an INACTIVE obligation is not owed on a clock, and says that too", () => {
  const pass = scheduleAll([obligation({ active: false })], NOW_MS);
  assert.equal(pass.scheduled.length, 0);
  assert.match(pass.unscheduled[0].reason, /not active/);
});

test("due work comes back soonest-first, so nothing starves behind a priority", () => {
  const pass = scheduleAll(
    [
      obligation({ id: "late", lastWorkedAt: new Date(NOW_MS - 96 * 3_600_000).toISOString() }),
      obligation({ id: "later", lastWorkedAt: new Date(NOW_MS - 48 * 3_600_000).toISOString() }),
      obligation({ id: "not-yet", lastWorkedAt: NOW }),
    ],
    NOW_MS,
  );
  assert.deepEqual(dueNow(pass, NOW_MS).map((r) => r.obligation.id), ["late", "later"]);
});

test("a transient failure becomes DEBT with a backoff, never a notification", () => {
  const first = recordFailure(null, {
    obligationId: "ob-1",
    cause: "RATE_LIMITED",
    detail: "429 from the vendor",
    target: "pima.legistar.com",
    dueAt: NOW,
    now: NOW,
  });
  assert.equal(first.consecutiveFailures, 1);
  assert.equal(
    first.retryAt,
    new Date(NOW_MS + FIRST_BACKOFF_MINUTES * 60_000).toISOString(),
  );

  const second = recordFailure(first, {
    obligationId: "ob-1",
    cause: "RATE_LIMITED",
    detail: "429 again",
    target: "pima.legistar.com",
    dueAt: NOW,
    now: NOW,
  });
  assert.equal(second.consecutiveFailures, 2);
  assert.equal(
    second.firstFailedAt,
    first.firstFailedAt,
    "the age of the debt never resets, or a three-day outage reads as fifteen minutes old",
  );
});

test("backoff is CAPPED — uncapped doubling is abandonment on a schedule", () => {
  let debt = recordFailure(null, {
    obligationId: "ob-1",
    cause: "UPSTREAM_ERROR",
    detail: "503",
    target: "host",
    dueAt: NOW,
    now: NOW,
  });
  for (let i = 0; i < 20; i += 1) {
    debt = recordFailure(debt, {
      obligationId: "ob-1",
      cause: "UPSTREAM_ERROR",
      detail: "503",
      target: "host",
      dueAt: NOW,
      now: NOW,
    });
  }
  const gapMinutes = (Date.parse(debt.retryAt) - NOW_MS) / 60_000;
  assert.equal(gapMinutes, MAX_BACKOFF_MINUTES);
  assert.ok(retryable([debt], NOW_MS + MAX_BACKOFF_MINUTES * 60_000).length === 1);
});

test("one outage is ONE incident, whatever it is behind", () => {
  const debts = Array.from({ length: 312 }, (_, i) =>
    recordFailure(null, {
      obligationId: `ob-${i}`,
      cause: "REFUSED_BY_HOST",
      detail: "403 from the WAF",
      target: "pima.legistar.com",
      dueAt: new Date(NOW_MS - 2 * 3_600_000).toISOString(),
      now: NOW,
    }),
  );
  const incidents = aggregateIncidents(debts, NOW_MS);
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].obligationsAffected, 312);
  assert.equal(incidents[0].cause, "REFUSED_BY_HOST");
  assert.ok(incidents[0].oldestHours >= 2);
});

test("a graduated route runs deterministic code; anything else runs bounded", () => {
  const graduated = chooseExecutor(
    scheduleObligation(obligation({ routeId: "legistar:events" }), NOW_MS) as never,
    () => "GRADUATED",
  );
  assert.equal(graduated.kind, "DETERMINISTIC");

  const ungraduated = chooseExecutor(
    scheduleObligation(obligation({ routeId: "unknown:thing" }), NOW_MS) as never,
    () => "UNGRADUATED",
  );
  assert.equal(ungraduated.kind, "BOUNDED_MODEL_WORKER");

  const noRoute = chooseExecutor(
    scheduleObligation(obligation({ routeId: null }), NOW_MS) as never,
    () => "GRADUATED",
  );
  assert.equal(noRoute.kind, "BOUNDED_MODEL_WORKER");
  assert.match(noRoute.why, /names no route yet/);
});

test("a worker killed mid-Attempt leaves the RouteTask reclaimable", async () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-sched-"));
  const repos = await createFileRepositories(root);

  const item = createWorkItem({
    project: "freshness",
    subject: "wtp-body/pima#governing",
    obligation: "refresh:meetings",
    why: "the scheduler owes this body a fresh reading of its calendar",
    priority: "P1",
    now: NOW,
  });
  await registerWorkItem(repos, item, NOW);
  const task = createRouteTask({
    workItemId: item.id,
    routeId: "legistar:events",
    routeLabel: "Legistar /EventDates",
    target: "pima.legistar.com",
    inherited: true,
    now: NOW,
  });
  await registerRouteTask(repos, task, NOW);

  // A killed worker runs no cleanup: worker A claims, opens an Attempt and simply stops.
  const claimed = await claimRouteTask(repos, {
    routeTaskId: task.id,
    holder: "worker-a",
    now: NOW,
    ttlMs: 60_000,
  });
  await beginAttemptFor(repos, {
    routeTaskId: task.id,
    workItemId: item.id,
    worker: {
      role: "RETRIEVAL",
      provider: "test",
      version: "1",
      instance: "worker-a",
    } as never,
    lease: claimed.lease.value,
    now: NOW,
    methodVersion: 61,
    policyVersion: "p1",
  });

  const early = await sweepExpiredLeases(repos, {
    now: new Date(NOW_MS + 30_000).toISOString(),
    observedBy: "worker-b",
  });
  assert.deepEqual(early.reclaimed, []);
  assert.deepEqual(early.stillLive, [task.id]);

  const after = new Date(NOW_MS + 120_000).toISOString();
  const sweep = await sweepExpiredLeases(repos, { now: after, observedBy: "worker-b" });
  assert.deepEqual(sweep.reclaimed, [task.id], "the abandoned route is reclaimed");

  const reclaimedTask = await repos.routeTasks.mustRead(task.id);
  assert.equal(
    reclaimedTask.value.state,
    "RECLAIMABLE",
    "the task leaves CLAIMED — it is free to re-claim rather than stuck in flight under a " +
      "worker that no longer exists",
  );
  assert.equal(
    reclaimedTask.value.disposition,
    null,
    "and it carries NO disposition: the route was never worked to a boundary, and inventing " +
      "one for a worker that died would be a disposition nobody reached",
  );

  const attempts = await repos.attempts.list();
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].value.worker.instance, "worker-a");

  const second = await claimRouteTask(repos, {
    routeTaskId: task.id,
    holder: "worker-b",
    now: after,
    ttlMs: 60_000,
  });
  assert.equal(second.lease.value.holder, "worker-b");
});

test("a full cycle runs unattended and NEVER promotes to reader truth", async () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-cycle-"));
  const repos = await createFileRepositories(root);

  const item = createWorkItem({
    project: "freshness",
    subject: "s",
    obligation: "refresh:meetings",
    why: "w",
    priority: "P1",
    now: NOW,
  });
  await registerWorkItem(repos, item, NOW);
  const task = createRouteTask({
    workItemId: item.id,
    routeId: "legistar:events",
    routeLabel: "l",
    target: "t",
    inherited: true,
    now: NOW,
  });
  await registerRouteTask(repos, task, NOW);

  const cycle = await runCycle({
    repos,
    obligations: [
      obligation({ id: "ob-due", lastWorkedAt: new Date(NOW_MS - 48 * 3_600_000).toISOString() }),
      obligation({ id: "ob-broken", observedChangeRateHours: Number.POSITIVE_INFINITY }),
    ],
    debts: [],
    routeTaskFor: (id) => (id === "ob-due" ? task.id : null),
    maturity: () => "GRADUATED",
    executor: { lane: "DETERMINISTIC", run: disposes },
    holder: "cycle-worker",
    now: NOW,
    leaseTtlMs: 60_000,
  });

  assert.equal(cycle.promotedToReaderTruth, false);
  assert.equal(cycle.dispatched.filter((d) => d.outcome === "WORKED").length, 1);
  assert.equal(cycle.schedule.unscheduled.length, 1, "the broken row is named, not defaulted");

  const lines = digestLines(cycle);
  assert.ok(lines[0]!.startsWith("ACTIVITY"));
});

test("an obligation with no RouteTask is COUNTED, not skipped", async () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-cycle2-"));
  const repos = await createFileRepositories(root);
  const cycle = await runCycle({
    repos,
    obligations: [obligation({ id: "orphan", lastWorkedAt: new Date(NOW_MS - 48 * 3_600_000).toISOString() })],
    debts: [],
    routeTaskFor: () => null,
    maturity: () => "GRADUATED",
    executor: { lane: "DETERMINISTIC", run: disposes },
    holder: "cycle-worker",
    now: NOW,
    leaseTtlMs: 60_000,
  });
  assert.equal(cycle.dispatched[0].outcome, "NO_ROUTE_TASK");
  assert.equal(cycle.debts.length, 1, "and it becomes debt that retries itself");
  assert.equal(cycle.debts[0].cause, "NEVER_DISPATCHED");
});

test("a losing claim is normal concurrency, never debt", async () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-cycle3-"));
  const repos = await createFileRepositories(root);
  const item = createWorkItem({
    project: "freshness",
    subject: "s",
    obligation: "o",
    why: "w",
    priority: "P1",
    now: NOW,
  });
  await registerWorkItem(repos, item, NOW);
  const task = createRouteTask({
    workItemId: item.id,
    routeId: "r",
    routeLabel: "l",
    target: "t",
    inherited: true,
    now: NOW,
  });
  await registerRouteTask(repos, task, NOW);
  await claimRouteTask(repos, {
    routeTaskId: task.id,
    holder: "the-other-worker",
    now: NOW,
    ttlMs: 600_000,
  });

  const cycle = await runCycle({
    repos,
    obligations: [obligation({ id: "contended", lastWorkedAt: new Date(NOW_MS - 48 * 3_600_000).toISOString() })],
    debts: [],
    routeTaskFor: () => task.id,
    maturity: () => "GRADUATED",
    executor: { lane: "DETERMINISTIC", run: disposes },
    holder: "this-worker",
    now: NOW,
    leaseTtlMs: 60_000,
  });
  assert.equal(cycle.dispatched[0].outcome, "NOT_CLAIMED");
  assert.equal(cycle.debts.length, 0, "a lease conflict is the lease working");
});

test("work beyond the cycle's stated ceiling is DEFERRED with a reason", async () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-cycle4-"));
  const repos = await createFileRepositories(root);
  const overdue = new Date(NOW_MS - 48 * 3_600_000).toISOString();
  const cycle = await runCycle({
    repos,
    obligations: [
      obligation({ id: "a", lastWorkedAt: overdue }),
      obligation({ id: "b", lastWorkedAt: overdue }),
      obligation({ id: "c", lastWorkedAt: overdue }),
    ],
    debts: [],
    routeTaskFor: () => null,
    maturity: () => "GRADUATED",
    executor: { lane: "DETERMINISTIC", run: disposes },
    holder: "w",
    now: NOW,
    leaseTtlMs: 60_000,
    maxDispatches: 1,
  });
  assert.equal(cycle.dispatched.length, 1);
  assert.equal(cycle.deferred.length, 2);
  assert.match(cycle.deferred[0].why, /stated ceiling/);
  const { runPool } = await import("../lib/control-plane/scheduler/shadow-loop.ts");
  const pulled: string[] = [];
  let order = ["a", "b", "c"];
  await runPool(["a", "b", "c"], 1, async id => {
    pulled.push(id);
    if (id === "a") order = ["c", "b", "a"];
  }, async () => (a, b) => order.indexOf(a) - order.indexOf(b));
  assert.deepEqual(pulled, ["a", "c", "b"]);
  const concurrent: string[] = [];
  await runPool(["a", "b", "c"], 3, async id => { concurrent.push(id); },
    async () => (a, b) => order.indexOf(a) - order.indexOf(b));
  assert.deepEqual([...concurrent].sort(), ["a", "b", "c"], "concurrent ranking cannot hand out a row twice");
});

test("hunt rounds survive changing place priority and completed tasks leaving the actual pool", async () => {
  const ids = ["a1", "a2", "a3", "b1", "b2", "c1", "c2"];
  const huntFor = (id: string) => id[0]!;
  const pulled: string[] = [];
  let priority = ["a", "b", "c"];
  await runPool(ids, 1, async id => {
    pulled.push(id);
    if (id === "a1") priority = ["c", "b", "a"];
  }, async () => (a, b) => priority.indexOf(huntFor(a)) - priority.indexOf(huntFor(b)), huntFor);
  assert.deepEqual(pulled, ["a1", "c1", "b1", "c2", "b2", "a2", "a3"]);

  const compareRound = huntRoundComparator(ids, huntFor);
  const rank = (a: string, b: string) => compareRound(a, b) || ["a", "b", "c"].indexOf(huntFor(a)) - ["a", "b", "c"].indexOf(huntFor(b));
  assert.deepEqual(["a2", "b1", "c1"].sort(rank), ["b1", "c1", "a2"]);
  assert.deepEqual(["c2", "a3", "b2"].sort(rank), ["b2", "c2", "a3"]);
  const resumed: string[] = [];
  await runPool(["a2", "b1", "c1"], 1, async id => { resumed.push(id); }, async () => rank);
  assert.deepEqual(resumed, ["b1", "c1", "a2"], "actual pending selection retains the full-wave rounds after a1 leaves");
});

test("twenty concurrent pulls serve every hunt before one hunt takes its second child", async () => {
  const ids = Array.from({ length: 20 }, (_, hunt) => Array.from({ length: hunt === 0 ? 4 : 1 }, (_, child) => `${hunt}:${child}`)).flat();
  const huntFor = (id: string) => id.split(":")[0]!;
  const pulled: string[] = [];
  let release!: () => void;
  const firstRound = new Promise<void>(resolve => { release = resolve; });
  await runPool(ids, 20, async id => {
    pulled.push(id);
    if (pulled.length === 20) release();
    await firstRound;
  }, async () => (a, b) => Number(huntFor(a)) - Number(huntFor(b)), huntFor);
  assert.equal(new Set(pulled.slice(0, 20).map(huntFor)).size, 20);
  assert.equal(new Set(pulled).size, ids.length, "a concurrent pull cannot duplicate a lease candidate");
  assert.deepEqual(pulled.slice(20), ["0:1", "0:2", "0:3"]);
});

test("a committed non-reading is named for what it is: only a wall is a host refusal", async () => {
  const { debtCauseForDisposition, DEBT_CAUSES } = await import("../lib/control-plane/scheduler/debt.ts");
  assert.equal(debtCauseForDisposition("BLOCKED_CURRENTLY"), "REFUSED_BY_HOST");
  assert.equal(debtCauseForDisposition("REQUIRES_NEW_ADAPTER"), "AWAITING_ADAPTER");
  assert.equal(debtCauseForDisposition("DISCOVERED"), "AWAITING_ROUTINE_READ");
  const { plainCode, hasPlainMeaning } = await import("../lib/control-plane/plain-words.ts");
  for (const cause of DEBT_CAUSES) assert.ok(hasPlainMeaning(cause), `${cause} has plain words`);
  assert.equal(plainCode("AWAITING_ADAPTER"), "Waiting for a reader to be built");
  assert.equal(plainCode("AWAITING_ROUTINE_READ"), "Waiting for its scheduled read");
});
