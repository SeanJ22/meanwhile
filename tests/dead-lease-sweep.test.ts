/**
 * A dead lease on a settled route is released once, and the sweep never lists every Attempt to find one task's.
 *
 * `claimRouteTask` now refuses a disposed task, so `legacyReclaim` asserts that refusal and then writes what the old
 * claim wrote (the domain's `claim()` lease and the CLAIMED state), producing the residue the sweep meets.
 *
 * Every test runs on the in-memory double AND the durable file store.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ZERO_COST, claim, type Attempt, type WorkerRef } from "../lib/control-plane/attempt.ts";
import {
  RouteTaskSettled,
  abandonAttempt,
  attemptsForRouteTask,
  beginAttemptFor,
  claimRouteTask,
  disposeRouteTask,
  recordCost,
  registerRouteTask,
  registerWorkItem,
} from "../lib/control-plane/repository/coordinator.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { createRouteTask, type RouteTask } from "../lib/control-plane/route-task.ts";
import { recordFailure } from "../lib/control-plane/scheduler/debt.ts";
import { sweepExpiredLeases } from "../lib/control-plane/scheduler/dispatch.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";

const T0 = "2026-09-22T10:00:00.000Z"; // walked to a disposition
const T1 = "2026-09-22T10:05:00.000Z"; // a later dispatch re-claims the settled task
const T2 = "2026-09-22T10:10:00.000Z"; // the re-claim's lease has expired: the sweep
const T3 = "2026-09-22T10:20:00.000Z"; // the NEXT sweep
const TTL = 60_000;

async function eachStore(): Promise<Array<readonly [string, ControlPlaneRepositories]>> {
  return [
    ["memory", createMemoryRepositories()],
    ["file", await createFileRepositories(mkdtempSync(join(tmpdir(), "wtp-dead-lease-")))],
  ];
}

function walker(instance: string): WorkerRef {
  return { role: "ACQUIRER", provider: "we-the-people", version: "deterministic-walker", instance };
}

async function registered(repos: ControlPlaneRepositories, subject: string): Promise<RouteTask> {
  const item = createWorkItem({
    project: "freshness",
    subject,
    obligation: `refresh:${subject}`,
    why: "a dead-lease sweep fixture",
    priority: "P1",
    now: T0,
  });
  await registerWorkItem(repos, item, T0);
  const task = createRouteTask({
    workItemId: item.id,
    routeId: "legistar:events",
    routeLabel: "Legistar /events",
    target: subject,
    inherited: true,
    now: T0,
  });
  await registerRouteTask(repos, task, T0);
  return task;
}

/**
 * The re-claim of a settled task, as `claimRouteTask` performed it before it
 * refused one: the domain's `claim()` over the slot, then the task's state
 * overwritten to CLAIMED. The modern claim's refusal is asserted first.
 */
async function legacyReclaim(repos: ControlPlaneRepositories, routeTaskId: string, holder: string, now: string) {
  await assert.rejects(claimRouteTask(repos, { routeTaskId, holder, now, ttlMs: TTL }), RouteTaskSettled);
  const slot = await repos.leases.mustRead(routeTaskId);
  const lease = await repos.leases.compareAndSet(
    routeTaskId,
    slot.revision,
    claim(routeTaskId, holder, now, TTL, slot.value),
    now,
  );
  const task = await repos.routeTasks.mustRead(routeTaskId);
  await repos.routeTasks.compareAndSet(routeTaskId, task.revision, { ...task.value, state: "CLAIMED" }, now);
  return { lease };
}

/** A disposed RouteTask carrying an unreleased lease. */
async function settledWithDeadLease(repos: ControlPlaneRepositories, subject: string) {
  const task = await registered(repos, subject);

  const first = await claimRouteTask(repos, { routeTaskId: task.id, holder: "walker-a", now: T0, ttlMs: TTL });
  const walked = await beginAttemptFor(repos, {
    routeTaskId: task.id,
    workItemId: task.workItemId,
    worker: walker("walker-a"),
    lease: first.lease.value,
    now: T0,
    methodVersion: 1,
    policyVersion: "p1",
  });
  await disposeRouteTask(repos, {
    routeTaskId: task.id,
    attemptId: walked.value.id,
    expectedTaskRevision: first.task.revision,
    now: T0,
    disposition: {
      disposition: "WALKED_NO_YIELD",
      attemptId: walked.value.id,
      at: T0,
      artifactIds: [],
      observation: null,
      permission: "ALLOWED",
      transport: "REACHABLE",
      note: "the route was reached and returned nothing",
    },
  });
  await recordCost(
    repos,
    {
      attemptId: walked.value.id,
      workItemId: task.workItemId,
      routeTaskId: task.id,
      routeId: task.routeId,
      source: task.target,
      jurisdiction: null,
      project: "freshness",
      role: "ACQUIRER",
      cost: { ...ZERO_COST, requestCount: 1 },
      recordedAt: T0,
    },
    T0,
  );

  /* The later dispatch: the claim was admitted on the settled task... */
  const again = await legacyReclaim(repos, task.id, "walker-b", T1);
  const redundant = await beginAttemptFor(repos, {
    routeTaskId: task.id,
    workItemId: task.workItemId,
    worker: walker("walker-b"),
    lease: again.lease.value,
    now: T1,
    methodVersion: 1,
    policyVersion: "p1",
  });
  /* ...and its abandonment is refused by reclaim() before any lease release. */
  await assert.rejects(
    abandonAttempt(repos, {
      routeTaskId: task.id,
      attemptId: redundant.value.id,
      outcome: "ABORTED",
      reason: "the worker reached no boundary",
      now: T1,
    }),
    /settled route/,
  );
  return { task, deadLease: again.lease.value };
}

/** Every repository call, as `kind.method(firstStringArg)`, the way the cycle observer sees them. */
function recording(repos: ControlPlaneRepositories) {
  const calls: string[] = [];
  const observed = new Proxy(repos, {
    get(target, kind, receiver) {
      const store = Reflect.get(target, kind, receiver);
      if (!store || typeof store !== "object") return store;
      return new Proxy(store, {
        get(repository, method) {
          const operation = Reflect.get(repository, method);
          if (typeof operation !== "function") return operation;
          return (...args: unknown[]) => {
            calls.push(`${String(kind)}.${String(method)}(${typeof args[0] === "string" ? args[0] : ""})`);
            return operation.apply(repository, args);
          };
        },
      });
    },
  });
  return { repos: observed, calls };
}

test("SEEDED: an expired lease on a DISPOSED RouteTask is released exactly once, nothing else moves, and the next sweep does not walk it", async () => {
  for (const [label, repos] of await eachStore()) {
    const { task, deadLease } = await settledWithDeadLease(repos, "wtp-body/settled#1");
    const debt = recordFailure(null, {
      obligationId: "ob-unrelated",
      cause: "UPSTREAM_ERROR",
      detail: "a debt row the release must not touch",
      target: "legistar:events",
      dueAt: T0,
      now: T0,
    });
    await repos.debts.put(debt.obligationId, debt, T0);

    const before = {
      task: await repos.routeTasks.mustRead(task.id),
      lease: await repos.leases.mustRead(task.id),
      attempts: await repos.attempts.list(),
      costs: await repos.costs.readAll(),
      dispositions: await repos.dispositions.readAll(),
      debts: await repos.debts.list(),
    };
    /* The fixture shape is asserted rather than assumed. */
    assert.equal(before.task.value.disposition?.disposition, "WALKED_NO_YIELD", `${label}: settled`);
    assert.equal(before.task.value.state, "CLAIMED", `${label}: re-claimed after it was disposed`);
    assert.equal(before.lease.value.id, deadLease.id, `${label}: the re-claim's lease holds the slot`);
    assert.equal(before.lease.value.released, false, `${label}: and it was never released`);
    assert.deepEqual(before.attempts.map((row) => row.value.outcome).sort(), ["ABORTED", "COMPLETED"]);
    assert.equal(before.costs.length, 1);

    const sweep = await sweepExpiredLeases(repos, { now: T2, observedBy: "sweeper" });
    assert.deepEqual(sweep.releasedSettled, [task.id], `${label}: released as dead state`);
    assert.deepEqual(sweep.reclaimed, [], `${label}: never counted as a reclaim — nothing returned to the pool`);
    assert.deepEqual(sweep.refused, [], `${label}: and no longer refused`);

    const lease = await repos.leases.mustRead(task.id);
    assert.equal(lease.value.released, true, `${label}: the lease is released`);
    assert.equal(lease.revision, before.lease.revision + 1, `${label}: by exactly one write`);
    assert.deepEqual({ ...lease.value, released: false }, before.lease.value, `${label}: which changed nothing but released`);
    assert.deepEqual(await repos.routeTasks.mustRead(task.id), before.task, `${label}: the RouteTask did not move — disposition, attemptIds, revision`);
    assert.deepEqual(await repos.attempts.list(), before.attempts, `${label}: no Attempt was read into a write, closed or reopened`);
    assert.deepEqual(await repos.costs.readAll(), before.costs, `${label}: the cost ledger is untouched`);
    assert.deepEqual(await repos.dispositions.readAll(), before.dispositions, `${label}: the disposition log is untouched`);
    assert.deepEqual(await repos.debts.list(), before.debts, `${label}: the debt rows are untouched`);

    /* THE NEXT SWEEP: a released lease is skipped, so the settled task is never read again. */
    const observed = recording(repos);
    const next = await sweepExpiredLeases(observed.repos, { now: T3, observedBy: "sweeper" });
    assert.deepEqual(next, { reclaimed: [], releasedSettled: [], stillLive: [], refused: [] }, `${label}: nothing left to walk`);
    assert.deepEqual(observed.calls.filter((call) => call.includes(task.id)), [], `${label}: the settled task was not walked again`);
    assert.ok(observed.calls.includes("leases.list()"), `${label}: control — the sweep did list the leases it skipped`);
    assert.equal((await repos.leases.mustRead(task.id)).revision, lease.revision, `${label}: released exactly once`);
  }
});

test("a LIVE task's expired lease is still reclaimed and the task reopened, in the same sweep that releases a settled one", async () => {
  for (const [label, repos] of await eachStore()) {
    const settled = await settledWithDeadLease(repos, "wtp-body/settled#2");

    const live = await registered(repos, "wtp-body/live#1");
    const died = await claimRouteTask(repos, { routeTaskId: live.id, holder: "walker-dead", now: T1, ttlMs: TTL });
    const open = await beginAttemptFor(repos, {
      routeTaskId: live.id,
      workItemId: live.workItemId,
      worker: walker("walker-dead"),
      lease: died.lease.value,
      now: T1,
      methodVersion: 1,
      policyVersion: "p1",
    });
    const busy = await registered(repos, "wtp-body/live#2");
    await claimRouteTask(repos, { routeTaskId: busy.id, holder: "walker-alive", now: T2, ttlMs: 10 * 60_000 });

    const sweep = await sweepExpiredLeases(repos, { now: T2, observedBy: "sweeper" });
    assert.deepEqual(sweep.releasedSettled, [settled.task.id], `${label}: the settled lease is released`);
    assert.deepEqual(sweep.reclaimed, [live.id], `${label}: the live one is RECLAIMED`);
    assert.deepEqual(sweep.stillLive, [busy.id], `${label}: a lease still being renewed is left alone`);
    assert.deepEqual(sweep.refused, []);

    const reopened = await repos.routeTasks.mustRead(live.id);
    assert.equal(reopened.value.state, "RECLAIMABLE", `${label}: returned to the pool`);
    assert.equal(reopened.value.disposition, null, `${label}: with no disposition nobody reached`);
    assert.deepEqual(reopened.value.attemptIds, [open.value.id]);
    const closed = await repos.attempts.mustRead(open.value.id);
    assert.equal(closed.value.outcome, "LEASE_EXPIRED", `${label}: the dead Attempt is closed from outside`);
    assert.match(closed.value.abortReason ?? "", /stopped being renewed/);
    assert.equal((await repos.leases.mustRead(live.id)).value.released, true);

    const successor = await claimRouteTask(repos, { routeTaskId: live.id, holder: "walker-next", now: T2, ttlMs: TTL });
    assert.equal(successor.lease.value.holder, "walker-next", `${label}: another worker takes the reopened route`);
  }
});

test("an UNDISPOSED task whose lease expired before any Attempt opened is still refused as NothingToReclaim, and not released", async () => {
  /* A contention proof's claim that exited, by design, without opening an Attempt. */
  for (const [label, repos] of await eachStore()) {
    const task = await registered(repos, "wtp-body/claim-only#1");
    await claimRouteTask(repos, { routeTaskId: task.id, holder: "proof-worker", now: T0, ttlMs: TTL });
    const beforeTask = await repos.routeTasks.mustRead(task.id);
    const beforeLease = await repos.leases.mustRead(task.id);

    const sweep = await sweepExpiredLeases(repos, { now: T2, observedBy: "sweeper" });
    assert.deepEqual(sweep.releasedSettled, [], `${label}: not settled, so not released as settled`);
    assert.deepEqual(sweep.reclaimed, [], `${label}: no Attempt, so no abandonment to record`);
    assert.equal(sweep.refused.length, 1);
    assert.equal(sweep.refused[0].routeTaskId, task.id);
    assert.match(sweep.refused[0].why, /has no Attempt to reclaim/, `${label}: recorded, never swallowed`);
    assert.deepEqual(await repos.routeTasks.mustRead(task.id), beforeTask, `${label}: the task did not move`);
    assert.deepEqual(await repos.leases.mustRead(task.id), beforeLease, `${label}: nor the lease`);
  }
});

function attemptRow(id: string, routeTaskId: string, startedAt: string): Attempt {
  return {
    id,
    routeTaskId,
    workItemId: "wi-filter-fixture",
    worker: walker(`w-${id}`),
    leaseId: `ls-${id}`,
    startedAt,
    endedAt: null,
    outcome: null,
    abortReason: null,
    artifactIds: [],
    cost: ZERO_COST,
    methodVersion: 1,
    policyVersion: "p1",
  };
}

test("attemptsForRouteTask's filtered read returns exactly what the old full-list filter returned, row for row and in order, on memory and file", async () => {
  /* Id order disagrees with start order, two Attempts on rt-a start at the
     same instant, and three RouteTasks interleave, so a filtered read that
     dropped, duplicated or reordered a row cannot pass by accident. */
  const fixtures = [
    attemptRow("at-03", "rt-a", "2026-09-22T10:00:00.000Z"),
    attemptRow("at-01", "rt-a", "2026-09-22T10:02:00.000Z"),
    attemptRow("at-05", "rt-b", "2026-09-22T10:01:00.000Z"),
    attemptRow("at-02", "rt-a", "2026-09-22T10:01:00.000Z"),
    attemptRow("at-04", "rt-a", "2026-09-22T10:01:00.000Z"),
    attemptRow("at-06", "rt-c", "2026-09-22T10:03:00.000Z"),
    attemptRow("at-07", "rt-b", "2026-09-22T10:00:00.000Z"),
  ];
  const routeTaskIds = ["rt-a", "rt-b", "rt-c", "rt-none"];
  const answers = new Map<string, unknown>();

  for (const [label, repos] of await eachStore()) {
    for (const attempt of fixtures) await repos.attempts.put(attempt.id, attempt, T0);
    for (const routeTaskId of routeTaskIds) {
      /* The pre-fix implementation, verbatim: list everything, filter, sort. */
      const everything = await repos.attempts.list();
      const old = everything
        .filter((row) => row.value.routeTaskId === routeTaskId)
        .sort((a, b) => (a.value.startedAt < b.value.startedAt ? -1 : 1));
      const filtered = await attemptsForRouteTask(repos, routeTaskId);
      assert.deepEqual(filtered, old, `${label}: ${routeTaskId} — same rows, same order`);
      assert.deepEqual(
        await repos.attempts.listWhere(["routeTaskId"], routeTaskId),
        everything.filter((row) => row.value.routeTaskId === routeTaskId),
        `${label}: listWhere is list() filtered, in list order`,
      );
      answers.set(`${label}|${routeTaskId}`, filtered);
    }
    assert.deepEqual(
      (answers.get(`${label}|rt-a`) as readonly { id: string }[]).map((row) => row.id),
      ["at-03", "at-02", "at-04", "at-01"],
      `${label}: the comparison is not vacuous — rt-a has four Attempts, oldest first`,
    );
    assert.deepEqual(answers.get(`${label}|rt-none`), [], `${label}: no Attempts is an empty answer`);
  }
  for (const routeTaskId of routeTaskIds) {
    assert.deepEqual(answers.get(`memory|${routeTaskId}`), answers.get(`file|${routeTaskId}`), `${routeTaskId}: memory and file answer identically`);
  }
});

test("POSITIVE CONTROL: a sweep over N dead settled leases makes zero full Attempt listings, and the same counter does see one", async () => {
  const N = 5;
  for (const [label, repos] of await eachStore()) {
    const dead: string[] = [];
    for (let i = 0; i < N; i += 1) dead.push((await settledWithDeadLease(repos, `wtp-body/settled#n${i}`)).task.id);
    const live = await registered(repos, "wtp-body/live#n");
    const died = await claimRouteTask(repos, { routeTaskId: live.id, holder: "walker-dead", now: T1, ttlMs: TTL });
    await beginAttemptFor(repos, {
      routeTaskId: live.id,
      workItemId: live.workItemId,
      worker: walker("walker-dead"),
      lease: died.lease.value,
      now: T1,
      methodVersion: 1,
      policyVersion: "p1",
    });

    const observed = recording(repos);
    const sweep = await sweepExpiredLeases(observed.repos, { now: T2, observedBy: "sweeper" });
    assert.deepEqual([...sweep.releasedSettled].sort(), [...dead].sort(), `${label}: all ${N} dead leases released`);
    assert.deepEqual(sweep.reclaimed, [live.id]);
    const attemptReads = (method: string) =>
      observed.calls.filter((call) => call.startsWith(`attempts.${method}(`)).length;
    assert.equal(attemptReads("list"), 0, `${label}: no full Attempt listing across ${N} dead leases`);
    assert.equal(attemptReads("listWhere"), 1, `${label}: one filtered read, for the one live reclaim that needs its Attempts`);

    /* The control: the pre-fix read, once per dead lease, through the SAME counter. */
    for (const routeTaskId of dead) {
      (await observed.repos.attempts.list()).filter((row) => row.value.routeTaskId === routeTaskId);
    }
    assert.equal(attemptReads("list"), N, `${label}: the counter sees every full listing, so the zero above is a measurement`);
  }
});
