import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { syncObligations, openOccurrence } from "../lib/control-plane/scheduler/durable.ts";
import { selectedCycleRepositories } from "../lib/control-plane/scheduler/cycle-selection.ts";
import { sweepExpiredLeases } from "../lib/control-plane/scheduler/dispatch.ts";

test("a filtered recovery reads only selected occurrence histories without a global scan", async () => {
  const repos = createMemoryRepositories();
  const now = "2026-09-30T20:30:00Z";
  const definitions = ["selected", "unrelated"].map(id => ({ id, subjectId: id, recordClass: "meetings",
    routeId: "source", active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }));
  const sync = await syncObligations(repos, definitions, now, { exactReads: true });
  const opened = await Promise.all(sync.all.map(obligation => openOccurrence(repos, { obligation, dueAt: now, now })));
  const selected = opened.find(row => row?.occurrence.obligationId === "selected")!;
  const noGlobalScan = async (): Promise<never> => { throw new Error("UNRELATED_HISTORY_SCANNED"); };
  const scoped = await selectedCycleRepositories({ ...repos,
    attempts: { ...repos.attempts, list: noGlobalScan },
    routeTasks: { ...repos.routeTasks, list: noGlobalScan },
    workItems: { ...repos.workItems, list: noGlobalScan },
    leases: { ...repos.leases, list: noGlobalScan },
    workerResults: { ...repos.workerResults, readAll: noGlobalScan },
    costs: { ...repos.costs, readAll: noGlobalScan },
  }, ["selected"]);
  assert.deepEqual((await scoped.workItems.list()).map(row => row.id), [selected.workItem.id]);
  assert.deepEqual((await scoped.routeTasks.list()).map(row => row.id), [selected.routeTask.id]);
  assert.deepEqual(await scoped.attempts.list(), []);
  assert.deepEqual(await scoped.costs.readAll(), []);
  assert.deepEqual(await sweepExpiredLeases(scoped, { now, observedBy: "filtered-run" }),
    { reclaimed: [], releasedSettled: [], stillLive: [], refused: [] });
  assert.equal((await repos.workItems.list()).length, 2);
});
