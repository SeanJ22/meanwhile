import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { requestHuntStop } from "../lib/control-plane/hunt-orders.ts";
import { researchPlanningStates, honorStoppedHunts } from "../lib/control-plane/repository/pg-store.ts";
import type { ResearchIntent } from "../lib/control-plane/scheduler/research-policy.ts";

const before="2026-10-25T15:00:00Z",stop="2026-10-25T16:00:00Z",after="2026-10-25T17:00:00Z";
const dispatch=(at:string):ResearchIntent=>({formatVersion:1,kind:"INTENT",intentId:"send-az",action:"DISPATCH",actor:"admin",adminSessionRef:"test-session",requestedAt:at,note:"Send agents to Arizona"});

test("Stop every hunt prevents all research reads, while a later Send resumes only its state",async()=>{
  const repos=createMemoryRepositories();
  assert.deepEqual(await researchPlanningStates(repos,[],["az","ca","system"]),["az","ca","system"]);
  await requestHuntStop(repos,{receiptId:"stop-all",at:stop,actor:"admin"});
  const histories=[repos.obligations,repos.occurrences,repos.workItems,repos.routeTasks,repos.fieldManual];
  for(const repo of histories)for(const method of ["list","listWhere","read"] as const)
    Object.assign(repo,{[method]:()=>{throw Error("stopped research must not read its tables");}});
  assert.deepEqual(await researchPlanningStates(repos,[dispatch(before)],["az","ca","system"]),[]);
  assert.deepEqual(await researchPlanningStates(repos,[dispatch(after)],["az","ca","system"]),["az","system"]);
  assert.deepEqual(await researchPlanningStates(repos,[dispatch(after),{formatVersion:1,kind:"INTENT",intentId:"cancel",action:"CANCEL_DISPATCH",actor:"admin",adminSessionRef:"test-session",requestedAt:after,note:"send-az"}],["az","ca","system"]),[]);
});

test("the parent acknowledges an existing stop without a research child and retains stored obligations",async()=>{
  const repos=createMemoryRepositories();
  await requestHuntStop(repos,{receiptId:"stop-az",state:"az",at:stop,actor:"admin"});
  await honorStoppedHunts(repos,after);
  assert.equal((await repos.huntOrders.latestStop("az"))?.value.confirmedAt,after);
  assert.deepEqual(await researchPlanningStates(repos,[],["az"]),[]);
  const source=await readFile("scripts/pilot-runner.mts","utf8");
  assert.ok(source.indexOf("await researchPlanningStates(repos, (await readRunnerControls(repos)).research)")<source.indexOf("const result = await runOneCycle(owner)"));
  assert.match(source,/researchStoppedByOwner = true;\s+await endOwnedProcessTree\(child\)/);
  const main=source.slice(source.indexOf("while (cycle < CYCLES)"));
  assert.ok(main.indexOf("await reconcileRuntimeReleaseAtBoundary()")<main.indexOf("await researchPlanningStates"),"stopped hunts still allow the existing release handoff");
});
