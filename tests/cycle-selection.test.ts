import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { syncObligations, openOccurrence } from "../lib/control-plane/scheduler/durable.ts";
import { selectedCycleRepositories } from "../lib/control-plane/scheduler/cycle-selection.ts";
import { sweepExpiredLeases } from "../lib/control-plane/scheduler/dispatch.ts";
import { beginAttemptFor, claimRouteTask, disposeRouteTask, reconcile } from "../lib/control-plane/repository/coordinator.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";

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
    leases: { ...repos.leases, list: noGlobalScan, listChangedSince:noGlobalScan },
    workerResults: { ...repos.workerResults, readAll: noGlobalScan,readChangedSince:async(since,held,options)=>{
      assert.deepEqual(options?.keys,[selected.workItem.id],"completion recovery must name an exact selected partition before transfer");
      return repos.workerResults.readChangedSince(since,held,options);
    } },
    costs: { ...repos.costs, readAll: noGlobalScan },
  }, ["selected"]);
  assert.deepEqual((await scoped.workItems.list()).map(row => row.id), [selected.workItem.id]);
  assert.deepEqual((await scoped.routeTasks.list()).map(row => row.id), [selected.routeTask.id]);
  assert.deepEqual(await scoped.attempts.list(), []);
  assert.deepEqual(await scoped.costs.readAll(), []);
  const occurrenceIds:string[]=[];
  const page=await scoped.occurrences.listChangedSince!(null,undefined,{projection:{obligationId:true},page:rows=>{
    for(const row of rows){assert.deepEqual(row.value,{obligationId:"selected"});occurrenceIds.push(row.id);}
  }});
  assert.deepEqual(page.rows,[]);assert.deepEqual(occurrenceIds,[selected.occurrence.id]);
  assert.deepEqual(await sweepExpiredLeases(scoped, { now, observedBy: "filtered-run" }),
    { reclaimed: [], releasedSettled: [], stillLive: [], refused: [] });
  assert.equal((await repos.workItems.list()).length, 2);
});

test("filtered disposition recovery uses selected route keys and preserves a committed result across a writer death", async () => {
  const repos = createMemoryRepositories();
  const now = "2026-09-30T20:30:00Z";
  const definitions = ["selected", "unrelated"].map(id => ({ id, subjectId: id, recordClass: "meetings",
    routeId: "source", active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }));
  const sync = await syncObligations(repos, definitions, now, { exactReads: true });
  const opened = await Promise.all(sync.all.map(obligation => openOccurrence(repos, { obligation, dueAt: now, now })));
  const selected = opened.find(row => row?.occurrence.obligationId === "selected")!;
  const stranger = opened.find(row => row?.occurrence.obligationId === "unrelated")!;
  const strangerBefore = await repos.routeTasks.mustRead(stranger.routeTask.id);
  const claimed = await claimRouteTask(repos, { routeTaskId: selected.routeTask.id, holder: "selected-worker", now, ttlMs: 60_000 });
  const attempt = await beginAttemptFor(repos, { routeTaskId: selected.routeTask.id, workItemId: selected.workItem.id,
    worker: { role: "ACQUIRER", provider: "fixture", version: "1", instance: "selected-worker" },
    lease: claimed.lease.value, now, methodVersion: 1, policyVersion: "1" });
  const crashing: ControlPlaneRepositories = { ...repos, attempts: { ...repos.attempts,
    compareAndSet: async (...args) => {
      if (args[2].outcome === "COMPLETED") throw new Error("DEATH_AFTER_DISPOSITION_COMMIT");
      return repos.attempts.compareAndSet(...args);
    } } };
  await assert.rejects(disposeRouteTask(crashing, { routeTaskId: selected.routeTask.id, attemptId: attempt.id,
    expectedTaskRevision: claimed.task.revision, now, disposition: { disposition: "WALKED_NO_YIELD", attemptId: attempt.id,
      at: now, artifactIds: [], observation: null, permission: "ALLOWED", transport: "REACHABLE", note: "The exact selected route returned no records." } }),
  /DEATH_AFTER_DISPOSITION_COMMIT/);
  const fail = async (): Promise<never> => { throw new Error("UNRELATED_DISPOSITION_SCAN"); };
  let pages = 0;
  const scoped = await selectedCycleRepositories({ ...repos,
    dispositions: { ...repos.dispositions, readAll: fail, readChangedSince: async (...args) => {
      assert.deepEqual(args[2]?.keys, [selected.routeTask.id]);
      pages++;
      return repos.dispositions.readChangedSince(...args);
    } },
    routeTasks: { ...repos.routeTasks, list: fail }, attempts: { ...repos.attempts, list: fail },
  }, ["selected"]);
  const recovered = await reconcile(scoped, now, { workItemIds: [selected.workItem.id] });
  assert.equal(recovered.commitsSeen, 1);
  assert.equal(recovered.healed.length, 1);
  assert.equal(pages, 1);
  assert.equal((await repos.routeTasks.mustRead(selected.routeTask.id)).value.state, "DISPOSED");
  assert.equal((await repos.attempts.mustRead(attempt.id)).value.outcome, "COMPLETED");
  assert.deepEqual(await repos.routeTasks.mustRead(stranger.routeTask.id), strangerBefore);
  assert.deepEqual(await reconcile(scoped, now), { commitsSeen: 1, healed: [] }, "the filtered parent also sees its already applied route commit");
});
