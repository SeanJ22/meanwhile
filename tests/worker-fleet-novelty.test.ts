import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { autonomousHarness, FIXTURE_URL } from "./helpers/autonomous-fleet.ts";
import { runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { autonomousStandingRuntime } from "../lib/control-plane/workers/standing-runtime.ts";
import { unknownApplicability, type MethodKnowledge } from "../lib/method/knowledge.ts";
import type { ModelRequest } from "../lib/control-plane/scheduler/scout-executor.ts";

test("the actual Scout request inherits a learned method and the failed Hunter route before novelty",async t=>{
  const h=await autonomousHarness({response:{transportError:"socket timeout"}});
  await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1});
  const before=await h.repos.workerResults.readAll();
  const root=await mkdtemp(join(tmpdir(),"fleet-novelty-fixture-"));
  assert.equal(dirname(resolve(root)),resolve(tmpdir()));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const method:MethodKnowledge={version:56,updatedOn:"2026-09-03",routes:[{
    id:"fixture-learned-roster-route",title:"Walk the separately published fixture office register",tier:"A0",fields:["officeholder"],
    applicability:unknownApplicability("Recorded test method; applicability is offered, never assumed"),outcomes:[],subBranches:[],origin:"Recorded test control",learnedAtVersion:55,learnedOn:"2026-09-02"}]};
  await mkdir(join(root,"data","method"),{recursive:true});
  await writeFile(join(root,"data","method","knowledge.json"),JSON.stringify(method));
  const requests:ModelRequest[]=[];
  const runtime=await autonomousStandingRuntime({root,repos:h.repos,now:h.now,transport:async request=>{
    requests.push(request);
    throw new Error("OFFLINE_REQUEST_CAPTURE_COMPLETE");
  }});
  const run=await runAutonomousCoordinator(runtime,{maximum:1,concurrency:1,maxScoutDispatches:1});
  assert.equal(run.decisions[0].action,"SCOUT");
  assert.equal(requests.length,1,"the transport is an offline recorder, never a provider call");
  const request=JSON.stringify(requests[0]);
  assert.match(request,/fixture-learned-roster-route/);
  assert.match(request,/EXPLORATORY/);
  assert.match(request,/UNRESOLVED_INVESTIGATION/);
  assert.match(request,/fourteen retrieval rungs are a floor/);
  assert.ok(request.includes(FIXTURE_URL));
  assert.match(request,/timeout/);
  const result=(await h.repos.scoutResults.readAll()).at(-1)!;
  const attempt=(await h.repos.attempts.mustRead(result.attemptId)).value;
  assert.ok(Date.parse(attempt.endedAt!)>=Date.parse(result.recordedAt),"Completion must use the actual post-provider clock, not dispatch admission time.");
  assert.deepEqual(await h.repos.workerResults.readAll(),before,"a Scout transport failure cannot rewrite the prior Hunter evidence");
  assert.notEqual((await h.repos.workItems.mustRead(h.item.id)).value.state,"VERIFIED_COMPLETE");
});
