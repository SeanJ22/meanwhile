/**
 * Abandoned occurrences: open, not pointed to, the obligation has opened a later sequence, and
 * the RouteTask is PENDING (never claimed). Closing one writes only the occurrence, unresolved
 * and with no disposition. Every test runs on the in-memory double and the durable file store.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import {
  OccurrenceStillOpen,
  closeAbandonedOccurrences,
  closeOccurrence,
  openOccurrence,
  scanOccurrences,
  settledRouteTaskIds,
  standing,
} from "../lib/control-plane/scheduler/durable.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { eachStore } from "./control-plane-fixtures.ts";

const T0 = "2026-09-01T14:30:45.411Z";
const T1 = "2026-09-02T09:00:00.000Z";
const T2 = "2026-09-23T18:00:00.000Z";
const ID = "freshness:candidate-enrichment:az:2026:state-az-cd-6:u-s-representative-district-6:bah-iman#candidate-marginalia-index";

function obligation(): FreshnessObligation {
  return {
    id: ID,
    recordClass: "candidate-enrichment",
    subjectId: "az:2026:state-az-cd-6:u-s-representative-district-6:bah-iman",
    routeId: "candidate-marginalia-index",
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    lastWorkedAt: null,
  };
}

async function fresh(repos: ControlPlaneRepositories) {
  return (await repos.obligations.mustRead(ID)).value;
}

/** The inputs the runner hands `scanOccurrences`: its obligations, and the two RouteTask id sets from its one listing. */
async function scanOf(repos: ControlPlaneRepositories) {
  const tasks = await repos.routeTasks.list();
  return scanOccurrences(repos, {
    obligations: [await fresh(repos)],
    settledRouteTaskIds: settledRouteTaskIds(tasks),
    neverClaimedRouteTaskIds: new Set(tasks.filter((t) => t.value.state === "PENDING").map((t) => t.id)),
  });
}

/** Occurrence 1 open on a never-claimed RouteTask, its pointer cleared, and occurrence 2 opened and closed. */
async function abandonedShape(repos: ControlPlaneRepositories) {
  await repos.obligations.put(ID, standing(obligation(), T0), T0);
  const first = await openOccurrence(repos, { obligation: await fresh(repos), dueAt: T0, now: T0 });
  assert.ok(first);
  const row = await repos.obligations.mustRead(ID);
  await repos.obligations.compareAndSet(ID, row.revision, { ...row.value, openOccurrenceId: null }, T0);
  const second = await openOccurrence(repos, { obligation: await fresh(repos), dueAt: T1, now: T1 });
  assert.ok(second);
  await closeOccurrence(repos, { occurrenceId: second.occurrence.id, disposition: "INGESTED", unresolvedReason: null, now: T1 });
  return { first, second };
}

test("openOccurrence refuses while its obligation points at an open occurrence, and writes nothing", async () => {
  for (const [label, repos] of await eachStore("wtp-abandoned-")) {
    await repos.obligations.put(ID, standing(obligation(), T0), T0);
    const first = await openOccurrence(repos, { obligation: await fresh(repos), dueAt: T0, now: T0 });
    assert.ok(first);
    const before = {
      obligation: await repos.obligations.mustRead(ID),
      occurrences: (await repos.occurrences.list()).length,
      tasks: (await repos.routeTasks.list()).length,
      items: (await repos.workItems.list()).length,
    };
    await assert.rejects(
      openOccurrence(repos, { obligation: await fresh(repos), dueAt: T1, now: T1 }),
      (error: unknown) => error instanceof OccurrenceStillOpen && error.occurrenceId === first.occurrence.id,
      `${label}: opening past an open occurrence would strand it`,
    );
    assert.deepEqual(
      {
        obligation: await repos.obligations.mustRead(ID),
        occurrences: (await repos.occurrences.list()).length,
        tasks: (await repos.routeTasks.list()).length,
        items: (await repos.workItems.list()).length,
      },
      before,
      `${label}: the refusal wrote nothing`,
    );

    await closeOccurrence(repos, { occurrenceId: first.occurrence.id, disposition: null, unresolvedReason: "walled", now: T1 });
    const next = await openOccurrence(repos, { obligation: await fresh(repos), dueAt: T1, now: T1 });
    assert.equal(next?.occurrence.sequence, 2, `${label}: once it is closed, the next opens`);
  }
});

test("SEEDED: an occurrence 1 its obligation moved past, on a never-claimed RouteTask, is closed unresolved and nothing else is written", async () => {
  for (const [label, repos] of await eachStore("wtp-abandoned-")) {
    const { first } = await abandonedShape(repos);
    const scan = await scanOf(repos);
    assert.deepEqual(scan.settled, []);
    assert.deepEqual(scan.abandoned, [{ occurrenceId: first.occurrence.id, obligationId: ID, sequence: 1, movedOnTo: 2 }], label);

    const obligationBefore = await repos.obligations.mustRead(ID);
    const taskBefore = await repos.routeTasks.mustRead(first.routeTask.id);
    const itemBefore = await repos.workItems.mustRead(first.workItem.id);
    const applied = await closeAbandonedOccurrences(repos, { abandoned: scan.abandoned, now: T2 });
    assert.deepEqual(applied, { closed: [first.occurrence.id], skipped: [], failed: [] });

    const closed = (await repos.occurrences.mustRead(first.occurrence.id)).value;
    assert.equal(closed.closedAt, T2);
    assert.equal(closed.disposition, null, `${label}: an abandoned occurrence is not a reading`);
    assert.match(closed.unresolvedReason ?? "", /^ABANDONED: the obligation moved on to occurrence 2 without closing occurrence 1, whose RouteTask was never claimed\. Nothing was read and nothing was refreshed$/);
    assert.deepEqual(await repos.obligations.mustRead(ID), obligationBefore, `${label}: the obligation is not written, so its anchor and count stand`);
    assert.deepEqual(await repos.routeTasks.mustRead(first.routeTask.id), taskBefore, `${label}: the RouteTask is not written`);
    assert.deepEqual(await repos.workItems.mustRead(first.workItem.id), itemBefore, `${label}: the WorkItem is not written`);
    assert.deepEqual(await repos.attempts.list(), [], `${label}: no Attempt exists or is made`);
    assert.equal(await repos.leases.read(first.routeTask.id), null, `${label}: and no lease`);

    assert.deepEqual((await scanOf(repos)).abandoned, [], `${label}: a closed occurrence is never found again`);
  }
});

test("a live pointer survives: closing an abandoned occurrence never clears the obligation's own open occurrence", async () => {
  for (const [label, repos] of await eachStore("wtp-abandoned-")) {
    const { first } = await abandonedShape(repos);
    const live = await openOccurrence(repos, { obligation: await fresh(repos), dueAt: T2, now: T2 });
    assert.ok(live);
    const scan = await scanOf(repos);
    assert.deepEqual(scan.abandoned.map((a) => [a.occurrenceId, a.movedOnTo]), [[first.occurrence.id, 3]]);
    await closeAbandonedOccurrences(repos, { abandoned: scan.abandoned, now: T2 });
    assert.equal((await fresh(repos)).openOccurrenceId, live.occurrence.id, `${label}: the live occurrence keeps its pointer`);
    assert.equal((await repos.occurrences.mustRead(live.occurrence.id)).value.closedAt, null, `${label}: and stays open`);
  }
});

test("never abandoned: the occurrence it points at, its latest occurrence even with the pointer lost, and one whose RouteTask was claimed", async () => {
  for (const [label, repos] of await eachStore("wtp-abandoned-")) {
    await repos.obligations.put(ID, standing(obligation(), T0), T0);
    const first = await openOccurrence(repos, { obligation: await fresh(repos), dueAt: T0, now: T0 });
    assert.ok(first);
    assert.deepEqual((await scanOf(repos)).abandoned, [], `${label}: the occurrence it points at is live work`);

    const row = await repos.obligations.mustRead(ID);
    await repos.obligations.compareAndSet(ID, row.revision, { ...row.value, openOccurrenceId: null }, T0);
    assert.deepEqual((await scanOf(repos)).abandoned, [], `${label}: the latest occurrence, pointer lost, has not been moved past`);

    const { first: stranded } = await (async () => {
      const second = await openOccurrence(repos, { obligation: await fresh(repos), dueAt: T1, now: T1 });
      assert.ok(second);
      await closeOccurrence(repos, { occurrenceId: second.occurrence.id, disposition: "INGESTED", unresolvedReason: null, now: T1 });
      return { first };
    })();
    const task = await repos.routeTasks.mustRead(stranded.routeTask.id);
    await repos.routeTasks.compareAndSet(task.id, task.revision, { ...task.value, state: "RECLAIMABLE" }, T1);
    assert.deepEqual((await scanOf(repos)).abandoned, [], `${label}: a RouteTask someone claimed may hold work; it is never closed as abandoned`);
  }
});

test("the close re-reads every condition at write time and skips, by name, anything that changed", async () => {
  for (const [label, repos] of await eachStore("wtp-abandoned-")) {
    const { first } = await abandonedShape(repos);
    const scan = await scanOf(repos);
    const task = await repos.routeTasks.mustRead(first.routeTask.id);
    await repos.routeTasks.compareAndSet(task.id, task.revision, { ...task.value, state: "CLAIMED" }, T2);
    const applied = await closeAbandonedOccurrences(repos, { abandoned: scan.abandoned, now: T2 });
    assert.deepEqual(applied.closed, [], label);
    assert.deepEqual(applied.skipped.map((s) => s.why), ["its RouteTask is no longer an unclaimed PENDING task"]);
    assert.equal((await repos.occurrences.mustRead(first.occurrence.id)).value.closedAt, null, `${label}: left open`);
  }
});
