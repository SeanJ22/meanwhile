import assert from "node:assert/strict";
import test from "node:test";
import { autonomousHarness, FIXTURE_NOW, FIXTURE_URL } from "./helpers/autonomous-fleet.ts";
import { fairAutonomousWorkIds, nextAutonomousOperation, runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { dispatchWorkerTask } from "../lib/control-plane/workers/runtime.ts";
import { readAutonomousActivity } from "../lib/control-plane/workers/activity.ts";
import { scheduleAutonomousAcquisition } from "../lib/control-plane/workers/autonomous-plan.ts";
import { FIRST_BACKOFF_MINUTES } from "../lib/control-plane/scheduler/debt.ts";
import type { LegacyCivicExtractionContract } from "../lib/control-plane/workers/types.ts";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFieldManual } from "../lib/control-plane/field-manual.ts";
import { methodFixture, knowledgeEntries, methodVersionEntry } from "./method-store-fixture.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { runLeaseWorkerProcesses, runNationalPlaceWorkerProcesses, workerDispatchFailure, workerProcessSlots } from "../lib/control-plane/workers/process-pool.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { claimRouteTask, registerRouteTask } from "../lib/control-plane/repository/coordinator.ts";
import { transpileModule, ScriptTarget, ModuleKind } from "typescript";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import { huntRoundComparator } from "../lib/control-plane/scheduler/shadow-loop.ts";
import { withPromotedFixturesInChildren } from "./helpers/promoted-fixtures.ts";
import { readHeldDiggerWorkItems, readHeldDiggerPriorities, heldDiggerNamedOrder, compareNamedBeforeBackground } from "../lib/control-plane/workers/held-digger-priority.ts";

test("PDC: the production standing runtime refuses queued or newly due legacy meeting acquisitions without opening the source", async () => {
  const h = await autonomousHarness({
    plan: (plan) => {
      const contract: LegacyCivicExtractionContract = {
        schemaVersion: 1,
        recordClass: "LEGISTAR_EVENTS",
        subjectId: plan.contract.subjectId,
        sourceBodyId: null,
        sourceBodyName: null,
        publisherSlug: "fixture-legacy-meetings",
        requiredFields: ["EventId"],
        completenessScope: "Historical fixture only; the permanent data plane owns live acquisition.",
        expectedSourceDate: null,
      };
      return { ...plan, contract };
    },
  });
  const productionRuntime = {
    ...h.runtime,
    routineMeetingsAuthority: "PERMANENT_CIVIC_DATA_PLANE" as const,
  };
  const beforeTasks = (await h.repos.routeTasks.list()).length;
  const blocked = await nextAutonomousOperation(productionRuntime, h.item.id);
  assert.equal(blocked.action, "BLOCKED");
  assert.match(blocked.reason, /PDC_ROUTINE_MEETINGS_ACQUISITION_RETIRED/);
  assert.equal((await h.repos.routeTasks.list()).length, beforeTasks, "the standing path creates no replacement acquisition task");
  assert.deepEqual(h.calls, []);

  const historicalTestTask = await nextAutonomousOperation(h.runtime, h.item.id);
  assert.equal(historicalTestTask.task?.workerTask?.role, "ACQUIRER", "isolated test setup proves the positive control is actually an acquisition");
  await assert.rejects(
    dispatchWorkerTask(productionRuntime, historicalTestTask.task!),
    /PDC_ROUTINE_MEETINGS_ACQUISITION_RETIRED/,
  );
  assert.deepEqual(h.calls, [], "even an already queued legacy task cannot cross the production dispatch boundary");
});

test("50 hunts share admission before a larger priority hunt takes its second item", async () => {
  const h = await autonomousHarness();
  const items = Array.from({ length: 50 }, (_, i) => ({ ...h.item, id: `hunt-${i}:first`,
    autonomousPlan: { ...h.item.autonomousPlan!, ownerInstructions: [`hunt-${i}`] } }));
  const extra = Array.from({ length: 80 }, (_, i) => ({ ...items[0], id: `hunt-0:extra-${i}` }));
  const priorities = items.map((_, i) => ({ receiptId: `hunt-${i}`, priority: i }));
  const byId = new Map([...extra, ...items].map(item => [item.id, item]));
  const ordered = fairAutonomousWorkIds([...extra, ...items], new Map(), priorities);
  assert.equal(new Set(ordered.slice(0, 50).map(id => byId.get(id)!.autonomousPlan.ownerInstructions[0])).size, 50);
  const served = new Map([[ordered[0], FIXTURE_NOW]]);
  const resumed = fairAutonomousWorkIds([...extra, ...items], served, priorities);
  assert.equal(byId.get(resumed[0])!.autonomousPlan.ownerInstructions[0], "hunt-0", "owner place rank precedes earlier service");
  const equalRanks = priorities.map(row => ({ ...row, priority: 0 }));
  assert.equal(byId.get(fairAutonomousWorkIds([...extra, ...items], served, equalRanks)[0])!.autonomousPlan.ownerInstructions[0], "hunt-1");
  assert.equal(new Set(resumed).size, items.length + extra.length);
});

test("Hunter transport failure is durable OPEN evidence and retry reuses the canonical scheduling debt", async () => {
  const h=await autonomousHarness({response:{transportError:"socket timeout"}});
  const first=await nextAutonomousOperation(h.runtime,h.item.id); assert.equal(first.task?.workerTask?.role,"ACQUIRER");
  const result=await dispatchWorkerTask(h.runtime,first.task!); assert.equal(result.outcome,"WORKED",result.detail);
  const record=(await h.repos.workerResults.readAll())[0]; assert.equal(record.result.role,"ACQUIRER"); if(record.result.role!=="ACQUIRER") throw new Error("wrong role");
  assert.equal(record.result.verdict,"BLOCKED"); assert.equal(record.result.walkState.state,"OPEN"); assert.equal(record.result.artifacts.length,0); assert.equal(record.result.walk.at(-1)?.transport,"TIMEOUT");
  let latestFailure = record;
  for (const backoff of [FIRST_BACKOFF_MINUTES, 2 * FIRST_BACKOFF_MINUTES]) {
    assert.equal((await nextAutonomousOperation(h.runtime, h.item.id)).action, "BLOCKED", "a passing outage owes a free retry first");
    h.advanceTo(new Date(Date.parse(latestFailure.endedAt) + (backoff + 1) * 60_000).toISOString());
    const due = await nextAutonomousOperation(h.runtime, h.item.id);
    assert.equal(due.task?.workerTask?.role, "ACQUIRER", due.reason);
    const retried = await dispatchWorkerTask(h.runtime, due.task!);
    assert.equal(retried.outcome, "WORKED", retried.detail);
    latestFailure = (await h.repos.workerResults.readAll()).find(row => row.attemptId === retried.attemptId)!;
  }
  h.advanceTo(new Date(Date.parse(latestFailure.endedAt) + (4 * FIRST_BACKOFF_MINUTES + 1) * 60_000).toISOString());
  const retry=await nextAutonomousOperation(h.runtime,h.item.id); assert.equal(retry.task?.workerTask?.role,"ACQUIRER"); assert.notEqual(retry.task?.id,first.task?.id);
  const restart=await nextAutonomousOperation(h.runtime,h.item.id); assert.equal(restart.task?.id,retry.task?.id);
  assert.ok(!(await h.repos.routeTasks.list()).some(t=>t.value.workerTask?.role==="PARSER"));
  const activity=(await readAutonomousActivity(h.repos,[h.item.id],{observedAt:h.now()}))[0]; assert.equal(activity.walk.state,"OPEN"); assert.ok(activity.timeline.some(event=>event.walk?.transport==="TIMEOUT"));
});

test("CH-23 part 3 (DP-02): a passing outage on a known door is a free plain retry, with no paid walk", async () => {
  const h=await autonomousHarness({response:{transportError:"socket timeout"}});
  const failOnce=async()=>{
    const op=await nextAutonomousOperation(h.runtime,h.item.id); assert.equal(op.task?.workerTask?.role,"ACQUIRER",op.reason);
    assert.equal((await dispatchWorkerTask(h.runtime,op.task!)).outcome,"WORKED");
    return (await h.repos.workerResults.readAll()).map(row=>row).sort((a,b)=>b.endedAt.localeCompare(a.endedAt))[0];
  };
  const first=await failOnce();
  const waiting=await nextAutonomousOperation(h.runtime,h.item.id);
  assert.equal(waiting.action,"BLOCKED","a single timeout owes no paid walk");
  assert.match(waiting.reason,/passing outage.*read again with plain code at/);
  assert.ok(!(await h.repos.routeTasks.list()).some(row=>/autonomous:novelty:/.test(row.value.routeId)),"no Scout task was opened");
  h.advanceTo(new Date(Date.parse(first.endedAt)+(FIRST_BACKOFF_MINUTES+1)*60_000).toISOString());
  const second=await failOnce();
  assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).action,"BLOCKED");
  h.advanceTo(new Date(Date.parse(second.endedAt)+(2*FIRST_BACKOFF_MINUTES+1)*60_000).toISOString());
  await failOnce();
});

test("an elapsed acquisition cadence finishes retained worker handoffs before a real refresh",async()=>{
  const h=await autonomousHarness(); const acquired=await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1});
  const first=(await h.repos.workerResults.readAll())[0]; if(first.result.role!=="ACQUIRER")throw new Error("wrong role");
  const calls=h.calls.length; assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).task?.workerTask?.role,"PARSER"); assert.equal(h.calls.length,calls);
  const schedule=scheduleAutonomousAcquisition(h.item.autonomousPlan!,first.result,h.now()); assert.ok("nextDueAt" in schedule); if(!("nextDueAt" in schedule))throw new Error("unscheduled"); assert.equal(schedule.cadenceSource,"DEFAULT_NO_SIGNAL");
  h.advanceTo(new Date(Date.parse(schedule.nextDueAt)+86_400_000).toISOString());
  for (const role of ["PARSER", "VALIDATOR"]) {
    const next = await nextAutonomousOperation(h.runtime, h.item.id);
    assert.equal(next.task?.workerTask?.role, role, "Due refreshes cannot starve a retained extraction chain.");
    const advanced = await dispatchWorkerTask(h.runtime, next.task!);
    assert.equal(advanced.outcome, "WORKED", advanced.detail);
    h.advanceTo(new Date(Date.parse(h.now()) + 86_400_000).toISOString());
  }
  assert.equal(h.calls.length, calls, "Independent checks use the captured evidence, with no fabricated fresh acquisition.");
  const stale=await nextAutonomousOperation(h.runtime,h.item.id); assert.equal(stale.task?.workerTask?.role,"ACQUIRER"); assert.notEqual(stale.task?.id,acquired.dispatches[0].routeTaskId); assert.deepEqual(stale.task?.workerTask?.acquisition?.held,[]);
  assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).task?.id,stale.task?.id);
  const refreshed=await dispatchWorkerTask(h.runtime,stale.task!); assert.equal(refreshed.outcome,"WORKED",refreshed.detail); assert.ok(h.calls.length>calls);
  const latest=(await h.repos.workerResults.readAll()).find(record=>record.attemptId===refreshed.attemptId)!; if(latest.result.role!=="ACQUIRER")throw new Error("wrong role");
  assert.equal(latest.result.artifacts[0].artifactId,first.result.artifacts[0].artifactId,"Identical bytes keep their immutable original identity.");
  const current=scheduleAutonomousAcquisition(h.item.autonomousPlan!,latest.result,h.now()); assert.ok("nextDueAt" in current && Date.parse(current.nextDueAt)>Date.parse(h.now()));
  assert.notEqual((await nextAutonomousOperation(h.runtime,h.item.id)).task?.workerTask?.role,"ACQUIRER","A real unchanged-content fetch must not create a hot refresh loop.");
});

test("the same coordinator advances real procedures Hunter → Parser → Validator (§3, no audit stage) and preserves canonical accounting", async () => {
  const h=await autonomousHarness(); const roles:string[]=[];
  for(let index=0;index<3;index++) {
    const run=await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1});
    roles.push(run.decisions[0].task!.workerTask!.role); assert.equal(run.dispatches[0].outcome,"WORKED",run.dispatches[0].detail);
  }
  assert.deepEqual(roles,["ACQUIRER","PARSER","VALIDATOR"]);
  const terminal=await nextAutonomousOperation(h.runtime,h.item.id); assert.equal(terminal.action,"STAGED");
  const count=(await h.repos.attempts.list()).length; await runAutonomousCoordinator(h.runtime,{maximum:2,concurrency:2}); assert.equal((await h.repos.attempts.list()).length,count);
  const activity=(await readAutonomousActivity(h.repos,[h.item.id],{observedAt:h.now()}))[0];
  assert.equal(activity.timeline.filter(event=>event.kind==="WORKER_RESULT").length,3);
  assert.deepEqual(activity.accounting.attemptIds,(await h.repos.attempts.list()).map(row=>row.id).sort());
  assert.deepEqual(activity.accounting.transitionIds,(await h.repos.transitions.readAll()).map(t=>t.transitionId).sort());
  assert.deepEqual(activity.evidenceGaps,[]); assert.equal((await h.repos.promotionPipeline.readAll()).length,0);
});

test("a judgment call (one person matched across sources) still gets an independent audit, and a break keeps it blocked", async () => {
  const h=await autonomousHarness({plan:plan=>({...plan,contract:{...plan.contract,recordClass:"CROSS_SOURCE_IDENTITY"} as typeof plan.contract})});
  for(let index=0;index<3;index++) await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1});
  const runtime={...h.runtime,independentContext:async (scope:Parameters<typeof h.runtime.independentContext>[0])=>{
    const context=await h.runtime.independentContext(scope); return {...context,subjectId:context.subjectId,startedFrom:["CANONICAL_SUBJECT_IDENTITY" as const]};
  }};
  const run=await runAutonomousCoordinator(runtime,{maximum:1,concurrency:1}); assert.equal(run.dispatches[0].outcome,"WORKED",run.dispatches[0].detail);
  const audit=(await h.repos.workerResults.readAll()).find(r=>r.result.role==="ADVERSARIAL_AUDITOR"); assert.equal(audit?.result.verdict,"BROKE");
  assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).action,"BLOCKED");
  assert.equal((await h.repos.workItems.mustRead(h.item.id)).value.state,"REOPENED");
});

test("a stored plan that still demands verification with no authorities validates on §3 instead of sitting inconclusive", async () => {
  const h=await autonomousHarness({plan:plan=>({...plan,contract:{...plan.contract,schemaVersion:2,verification:{required:true,authorities:[]}} as typeof plan.contract})});
  for(let index=0;index<3;index++) {
    const run=await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1}); assert.equal(run.dispatches[0]?.outcome,"WORKED",run.dispatches[0]?.detail);
  }
  assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).action,"STAGED");
  const records=await h.repos.workerResults.readAll(); const validated=records.find(r=>r.result.role==="VALIDATOR")?.result;
  assert.equal(validated?.verdict,"PASS",JSON.stringify(validated));
  assert.ok(validated?.role==="VALIDATOR" && !validated.findings.some(f=>f.code==="EXTERNAL_VERIFICATION_MISSING"),"the empty-authority demand no longer makes every result inconclusive");
  assert.ok(Date.parse(FIXTURE_NOW)<Date.parse(h.now()));
});

test("coordinator selection hands out canonical tasks without running tools or opening an Attempt", async () => {
  const h = await autonomousHarness();
  const legacy = { ...h.item, id: "work:legacy-held", autonomousPlan: undefined };
  await h.repos.workItems.put(legacy.id, legacy, h.now());
  const heldTask = (await h.repos.routeTasks.listWhere(["workItemId"],h.item.id))[0]!;
  await h.repos.routeTasks.put("legacy-held-task",{...heldTask.value,id:"legacy-held-task",workItemId:legacy.id,state:"PENDING"},h.now());
  const before = (await h.repos.attempts.list()).length;
  let snapshotCalls = 0;
  let snapshot: readonly WorkItem[] = [];
  const planned = await runAutonomousCoordinator(h.runtime, { planOnly: true,
    onSelectionSnapshot: items => { snapshotCalls++; snapshot = items; },
    acceptsWorkItem: item => {
      assert.equal(item, snapshot.find(row => row.id === item.id), "ordering receives the exact selection rows, without another read or clone");
      return true;
    },
  });
  assert.equal(snapshotCalls, 1);
  assert.deepEqual(snapshot.map(item => item.id).sort(), [h.item.id, legacy.id].sort());
  assert.equal(snapshot.find(item => item.id === legacy.id)?.autonomousPlan, undefined, "held work without an autonomous plan is also available for ordering");
  assert.equal(planned.decisions[0]?.action, "WORKER");
  assert.equal(planned.decisions[0]?.task?.workItemId, h.item.id);
  assert.equal(planned.dispatches.length, 0);
  assert.equal((await h.repos.attempts.list()).length, before);
  assert.equal(h.calls.length, 0);
});

 test("separate processes pull shared tasks and each existing lease admits one Attempt", async () => {
  const root = await mkdtemp(join(tmpdir(), "s7-lease-worker-"));
  try {
    const repos = await createFileRepositories(root);
    const h = await autonomousHarness({ repos });
    const method = methodFixture();
    await writeFieldManual(repos, [...knowledgeEntries(method), methodVersionEntry(method)], h.now());
    const selected = await nextAutonomousOperation(h.runtime, h.item.id);
    const second = createRouteTask({ workItemId: h.item.id, routeId: selected.task!.routeId + ":second",
      routeLabel: selected.task!.routeLabel, target: selected.task!.target, inherited: false, now: h.now() });
    await registerRouteTask(repos, second, h.now());
    const pids: number[] = [];
    let pulls = 0;
    const results = await withPromotedFixturesInChildren(() => runLeaseWorkerProcesses({ entry: "lib/control-plane/workers/lease-worker.ts",
      config: { root: process.cwd(), fileStoreRoot: root, postgres: false, taskIds: [selected.task!.id, second.id],
        modelEnabled: false, searchEnabled: false, ceilingUsd: 0, fundedSubjects: [] },
      capacity: () => 2, onStarted: pid => pids.push(pid),
      orderPending: async ids => { pulls++; return [...ids].reverse(); },
      transportFor: () => async () => { throw new Error("unexpected paid call"); } }));
    assert.equal(pids.length, 2);
    assert.ok(pulls >= 2, "each worker asks the parent for current priority before claiming a lease");
    assert.ok(pids.every(pid => pid !== process.pid));
    const attempts = (await repos.attempts.list()).map(row => row.value).filter(row => row.routeTaskId === selected.task!.id);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]!.outcome, "COMPLETED", "the selected task is a plain acquisition");
    assert.equal(results.filter(row => row.attemptId !== null).length, 2);
    assert.equal((await repos.attempts.list()).filter(row => row.value.routeTaskId === second.id).length, 1);
    // Model the late sibling arriving after a denial released its lease.
    await assert.rejects(claimRouteTask(repos, { routeTaskId: second.id,
      holder: "late-sibling", now: h.now(), ttlMs: 300_000 }), /ROUTE_TASK_POLICY_DENIED/);
    assert.equal((await repos.routeTasks.mustRead(second.id)).value.state, "POLICY_DENIED");
    assert.equal((await repos.leases.mustRead(second.id)).value.released, true);
    assert.equal((await repos.attempts.list()).filter(row => row.value.routeTaskId === second.id).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("memory wait ends when the wave empties even if no queued worker can fit", { timeout: 10_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "s18-process-queue-"));
  try {
    await mkdir(join(root, "scripts"));
    await writeFile(join(root, "scripts/register-test-loader.mjs"), "");
    await writeFile(join(root, "worker.mjs"), `process.on('message', config => {
      process.send({ kind: 'finished', body: config.taskIds }); process.disconnect();
    });`);
    let forks = 0, available = 1000;
    await runLeaseWorkerProcesses({ entry: "worker.mjs", config: { root, postgres: false,
      taskIds: Array.from({ length: 40 }, (_, i) => `task:${i}`), modelEnabled: false, searchEnabled: false,
      ceilingUsd: 0, fundedSubjects: [] }, capacity: () => 40,
      slots: workerProcessSlots(() => 1, { availableBytes: () => available, headroomBytes: 0, peakBytes: () => 1 }),
      onStarted: () => { forks++; available = 0; }, transportFor: () => async () => { throw new Error("no model in this fixture"); } });
    assert.equal(forks, 1, "queued admissions release without spawning after the first child drains all tasks");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a worker kill timer defers unfinished work and ends only its owned process tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "s18-worker-timeout-"));
  try {
    await mkdir(join(root, "scripts"));
    await writeFile(join(root, "scripts/register-test-loader.mjs"), "");
    await writeFile(join(root, "worker.mjs"), `import { spawn } from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      process.once('message', config => {
        const grandchild = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
        writeFileSync('descendant.pid', String(grandchild.pid));
        setTimeout(()=>{grandchild.kill();process.send({kind:'finished',body:config.taskIds});process.disconnect();},2500);
      });`);
    const input = { entry: "worker.mjs", childTimeoutMs: 1000, config: { root, postgres: false,
      taskIds: ["owed"], modelEnabled: false, searchEnabled: false, ceilingUsd: 0, fundedSubjects: [] },
      capacity: () => 1, transportFor: () => async () => { throw new Error("no model in this fixture"); } };
    const results = await runLeaseWorkerProcesses(input);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.outcome, "FAILED");
    assert.match(results[0]!.detail, /WORKER_CHILD_TIMEOUT/);
    assert.equal(results[0]!.dispositionCommitted, false);
    const descendant = Number(await readFile(join(root, "descendant.pid"), "utf8"));
    if (process.platform === "win32") assert.throws(() => process.kill(descendant, 0));
    assert.doesNotThrow(() => process.kill(process.pid, 0), "the parent and unrelated trees remain alive");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the autonomous wave loop stops at its dispatch slice even while waves keep working", async () => {
  const source = await readFile(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  const start = source.indexOf("async function runAutonomousProcesses()");
  const end = source.indexOf("let campaignSites", start);
  assert.ok(start >= 0 && end > start);
  const snippet = transpileModule(source.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None } }).outputText;
  let calls = 0, now = 0;
  const wave = async () => { calls++; now += 20; return { dispatches: [{ outcome: calls <= 3 ? "WORKED" : "FAILED" }],
    scoutsAdmitted: 0, scoutsLimitedAdmitted: 0 }; };
  const run = new Function("runAutonomousWave", "releaseDrainRequested", "dispatchDeadlineMs", "Date", `${snippet} return runAutonomousProcesses;`)(wave, false, 30, { now: () => now });
  const report = await run();
  assert.equal(calls, 2);
  assert.equal(report.dispatches.length, 2, "completed work is retained when the slice defers later waves");

  const h = await autonomousHarness();
  const legacy = { ...h.item, id: "work:legacy-held", subject: "subject:legacy", autonomousPlan: undefined };
  const current = { ...h.item, id: "work:planned", subject: "subject:planned",
    autonomousPlan: { ...h.item.autonomousPlan!, ownerInstructions: ["hunt:planned"] } };
  const task = (workItemId: string, routeId: string) => createRouteTask({ workItemId, routeId,
    routeLabel: routeId, target: FIXTURE_URL, inherited: false, now: h.now() });
  const held = [task(legacy.id, "legacy:first"), task(legacy.id, "legacy:second"), task("work:missing", "dangling")];
  const plannedTask = task(current.id, "planned:first");
  const placeOrder = ["hunt:legacy", "hunt:planned"];
  const snapshotStart = source.indexOf("const workItemsById =", source.indexOf("async function runAutonomousWave()"));
  const snapshotEnd = source.indexOf("const plainTaskIds =", snapshotStart);
  const queueStart = source.indexOf("const readTaskQueue =", snapshotEnd);
  const queueEnd = source.indexOf("let taskQueue:", queueStart);
  assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart && queueStart > snapshotEnd && queueEnd > queueStart);
  const ordering = transpileModule(`return (async () => {
    ${source.slice(snapshotStart, snapshotEnd)}
    ${source.slice(queueStart, queueEnd)}
    return { taskIds, metadata, remainingSnapshotItems: workItemsById.size, readTaskQueue };
  })();`, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None } }).outputText;
  let orderingReads = 0;
  const unreadable = () => { orderingReads++; throw new Error("ordering must reuse the selected metadata"); };
  const selected = await new Function("held", "fleet", "runAutonomousCoordinator", "placeOrder", "paidWorkerCapacity",
    "placeRankFor", "huntRoundComparator", "repos", "squadReading", "readHeldDiggerWorkItems", "readHeldDiggerPriorities",
    "heldDiggerNamedOrder", "compareNamedBeforeBackground", "dispatchTargets", "dispatchPriority", "plannedOrder", ordering)(held, {},
    async (_fleet: unknown, options: { onSelectionSnapshot: (items: readonly WorkItem[]) => void }) => {
      options.onSelectionSnapshot([legacy, current]);
      return { decisions: [{ action: "WORKER", task: plannedTask }] };
    }, placeOrder, () => 1,
    (subject: string) => subject === legacy.subject ? placeOrder.indexOf("hunt:legacy") : null,
    huntRoundComparator, { routeTasks: { read: unreadable }, workItems: { read: unreadable } }, undefined,
    readHeldDiggerWorkItems, readHeldDiggerPriorities, heldDiggerNamedOrder, compareNamedBeforeBackground, [], new Set(), new Map());
  assert.equal(selected.remainingSnapshotItems, 0, "the whole selection index is released after retaining only queued metadata");
  assert.equal(selected.metadata.get(held[0]!.id), legacy);
  assert.equal(selected.metadata.get(plannedTask.id), current);
  assert.equal(selected.metadata.get(held[2]!.id), undefined, "a dangling task has no fabricated metadata and remains for the child's fresh read");
  placeOrder.reverse(); // The first child asks after the owner priority refresh.
  const queue = selected.readTaskQueue();
  assert.equal(queue.rank(plannedTask.id), 0);
  assert.equal(queue.rank(held[2]!.id), Infinity);
  const ordered = [...selected.taskIds].sort((a, b) => queue.compareRound(a, b) || queue.rank(a) - queue.rank(b));
  assert.equal(ordered[0], plannedTask.id);
  assert.ok(ordered.indexOf(held[0]!.id) < ordered.indexOf(held[1]!.id));
  assert.ok(ordered.includes(held[2]!.id), "ordering does not drop unresolved tasks or claim that they are absent");
  assert.ok(queue.compareRound(held[1]!.id, plannedTask.id) > 0, "removing a completed first task does not reset the hunt's second round");
  assert.equal(orderingReads, 0);
});

test("pool returns a completed dispatch and records unfinished work when a child exits unsuccessfully", async () => {
  const root = await mkdtemp(join(tmpdir(), "s18-process-failure-"));
  try {
    await mkdir(join(root, "scripts"));
    await writeFile(join(root, "scripts/register-test-loader.mjs"), "");
    const completed = { ...workerDispatchFailure("one", "fixture"), outcome: "WORKED",
      claimed: true, dispositionCommitted: true, disposition: "INGESTED", attemptId: "attempt:one" };
    await writeFile(join(root, "worker.mjs"), `process.on('message', () => {
      process.send({ kind: 'result', body: ${JSON.stringify(completed)} });
      process.exitCode = 1; process.disconnect();
    });`);
    const results = await runLeaseWorkerProcesses({ entry: "worker.mjs", config: { root, postgres: false,
      taskIds: ["one", "two"], modelEnabled: false, searchEnabled: false, ceilingUsd: 0, fundedSubjects: [] },
      capacity: () => 1, transportFor: () => async () => { throw new Error("no model in this fixture"); } });
    assert.deepEqual(results.map(row => [row.routeTaskId, row.outcome]), [["one", "WORKED"], ["two", "FAILED"]]);
    assert.match(results[1]!.detail, /LEASE_WORKER_EXIT/);
    assert.equal(results[1]!.claimed, false);
    assert.equal(results[1]!.dispositionCommitted, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("one work-item read failure costs one task and the same lease child reaches the next task", async () => {
  const root = await mkdtemp(join(tmpdir(), "s18-lease-read-"));
  try {
    const repos = await createFileRepositories(root);
    const h = await autonomousHarness({ repos });
    const method = methodFixture();
    await writeFieldManual(repos, [...knowledgeEntries(method), methodVersionEntry(method)], h.now());
    const selected = await nextAutonomousOperation(h.runtime, h.item.id);
    const unreadable = createRouteTask({ workItemId: "missing:forced-read", routeId: "forced-read",
      routeLabel: "Unreadable work item", target: "https://example.gov/", inherited: false, now: h.now() });
    await repos.routeTasks.put(unreadable.id, unreadable, h.now());
    let forks = 0;
    const results = await withPromotedFixturesInChildren(() => runLeaseWorkerProcesses({ entry: "lib/control-plane/workers/lease-worker.ts",
      config: { root: process.cwd(), fileStoreRoot: root, postgres: false, taskIds: [unreadable.id, selected.task!.id],
        modelEnabled: false, searchEnabled: false, ceilingUsd: 0, fundedSubjects: [] },
      capacity: () => 1, onStarted: () => { forks++; }, orderPending: async ids => ids,
      transportFor: () => async () => { throw new Error("unexpected paid call"); } }));
    const failedRead = results.find(row => row.routeTaskId === unreadable.id)!;
    assert.equal(failedRead.outcome, "FAILED");
    assert.equal(failedRead.attemptId, null);
    assert.equal(failedRead.claimed, false);
    assert.match(failedRead.detail, /missing:forced-read/);
    const next = results.find(row => row.routeTaskId === selected.task!.id)!;
    assert.ok(next.attemptId, "the next task still reaches its normal admission and durable Attempt");
    assert.equal((await repos.attempts.list()).filter(row => row.value.routeTaskId === selected.task!.id).length, 1);
    assert.equal((await repos.routeTasks.mustRead(unreadable.id)).value.state, "PENDING");
    assert.equal(forks, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ZIP process reports return after parent registry and election publication, with one shared pointer writer", async () => {
  const root = await mkdtemp(join(tmpdir(), "s7-national-ipc-"));
  const progress: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("RCD_PROGRESS=")) progress.push(JSON.parse(args[0].slice("RCD_PROGRESS=".length)).key);
    else log(...args);
  };
  try {
    await mkdir(join(root, "scripts"), { recursive: true });
    await mkdir(join(root, "lib/control-plane/workers"), { recursive: true });
    await writeFile(join(root, "scripts/register-test-loader.mjs"), "export {};\n");
    await writeFile(join(root, "lib/control-plane/workers/national-worker.ts"), `
      const replies = new Map(); let sequence = 0;
      const call = (kind, body) => new Promise((resolve, reject) => {
        const id = String(++sequence); replies.set(id, { resolve, reject }); process.send({ kind, id, body });
      });
      process.on('message', async message => {
        if (message.id) {
          const reply = replies.get(message.id); replies.delete(message.id);
          message.error ? reply.reject(Error(message.error.message)) : reply.resolve(message.body); return;
        }
        try {
          const zip = message.taskIds[0];
          const request = { now: '2026-09-30T21:00:00Z', divisions: [], geographyCaptures: [], sources: { zip, officials: [] } };
          const publication = await call('national-publication', request).catch(error => ({ error: error.message }));
          const election = await call('election-publication', { fields: [{ divisionId: 'ocd-division/country:us/state:ny',
            kind: 'registration_deadline', sourceUrl: 'https://elections.ny.gov/calendar', value: '2026-10-05', dates: ['2026-10-05'] }], now: request.now });
          await call('national-result', { zip, publications: [publication], electionPublications: [election] });
          process.send({ kind: 'finished', body: message.taskIds }); process.disconnect();
        } catch (error) { console.error(error.message); process.exitCode = 1; process.disconnect(); }
      });
    `);
    const store = new MemoryRoutineDataStore();
    let active = 0, peak = 0, registryCalls = 0;
    const published: string[] = [], delivered: string[] = [], pids: number[] = [];
    const write = async (kind: string) => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 15));
      active--; published.push(kind);
      return { kind };
    };
    const reports = await runNationalPlaceWorkerProcesses({ root, places: ["10001", "10002", "10003"].map(zip => ({ id: `national-place:${zip}`, zip, state: "NY" })), capacity: () => 2, store,
      orderPending: async ids => [...ids].reverse(),
      slots: workerProcessSlots(() => 2, { availableBytes: () => 1000 * 1024 * 1024,
        headroomBytes: 100 * 1024 * 1024, peakBytes: () => 600 * 1024 * 1024,
        minimumPeakBytes: () => 600 * 1024 * 1024 }),
      onStarted: pid => {
        if (pids.length === 1) assert.equal(delivered.length, 1, "The second ready ZIP stays queued until the first process finishes.");
        pids.push(pid);
      },
      publish: async input => {
        assert.equal(input.store, store, "the real store is supplied in the parent");
        registryCalls++;
        await write("registry");
        if (registryCalls === 1) throw new Error("one registry publication failed");
        return { promotedVersionId: `version:${registryCalls}`, divisions: [], bodies: [],
          members: [{ bodyId: "same-body", discoveryIds: ["same-official"], versionId: `version:${registryCalls}` }] };
      },
      publishElection: async () => { await write("election"); return { candidateId: "candidate:election",
        promotedVersionId: `election:${registryCalls}`, fields: ["same-deadline"], gaps: [] }; },
      onResult: report => { if ("deferred" in report) assert.fail(report.deferred);
        delivered.push(report.zip); assert.equal(report.electionPublications.length, 1); } });
    assert.equal(pids.length, 3);
    assert.equal(peak, 1, "registry and election callbacks share the parent critical section");
    assert.equal(published.length, 6, "one failure does not poison later pointer writes");
    assert.deepEqual(reports.map(report => report.zip).sort(), ["10001", "10002", "10003"]);
    assert.equal(delivered[0], "10003", "national workers pull the current owner place priority before launch");
    assert.deepEqual(delivered.sort(), ["10001", "10002", "10003"]);
    assert.equal(progress.length, 5);
    assert.equal(new Set(progress).size, 2, "new versions of the same registry and election facts cannot renew an idle child's progress clock");
    assert.equal(reports.filter(report => !("deferred" in report) && "error" in (report.publications[0] as object)).length, 1);
  } finally { console.log = log; await rm(root, { recursive: true, force: true }); }
});
