import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { autonomousHarness, FIXTURE_PROJECT } from "./helpers/autonomous-fleet.ts";
import { nextAutonomousOperation, runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { researchVaultResolver } from "../lib/control-plane/workers/vault-object.ts";
import { sweepExpiredLeases } from "../lib/control-plane/scheduler/dispatch.ts";
import { readAutonomousActivity } from "../lib/control-plane/workers/activity.ts";
import { contentHash } from "../lib/control-plane/ids.ts";

test("OS-killed Hunter leaves Attempt and vaulted bytes; external lease reclaim and fresh coordinator continue exactly once", async () => {
  const root=await mkdtemp(path.join(tmpdir(),"autonomous-recovery-"));
  const child=spawn(process.execPath,["--experimental-strip-types",fileURLToPath(new URL("./fixtures/autonomous-worker-kill.mts",import.meta.url)),root],{stdio:["ignore","pipe","pipe","ipc"],windowsHide:true});
  let errorText=""; child.stderr?.on("data",chunk=>{errorText+=chunk.toString();});
  try {
    const message=await new Promise<{artifactId:string;attemptId:string;routeTaskId:string}>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error(`RECOVERY_FIXTURE_NO_SIGNAL:${errorText}`)),15000);
      child.once("message",value=>{clearTimeout(timer);resolve(value as {artifactId:string;attemptId:string;routeTaskId:string});});
      child.once("error",error=>{clearTimeout(timer);reject(error);}); child.once("exit",code=>{clearTimeout(timer);reject(new Error(`RECOVERY_FIXTURE_EARLY_EXIT:${code}:${errorText}`));});
    });
    const exited=new Promise<void>(resolve=>child.once("exit",()=>resolve())); child.kill("SIGKILL"); await exited;
    const repos=await createFileRepositories(path.join(root,"control")); const store=new DurableEvidenceStore(path.join(root,"vault"));
    const attempt=(await repos.attempts.mustRead(message.attemptId)).value; assert.equal(attempt.outcome,null);
    const metadata=(await repos.artifacts.readAll()).find(record=>record.artifactId===message.artifactId)!; assert.equal(metadata.attemptId,attempt.id);
    const held=await researchVaultResolver(repos,store,FIXTURE_PROJECT)(message.artifactId); assert.equal(contentHash(held.bytes),metadata.contentHash);
    const lease=(await repos.leases.mustRead(message.routeTaskId)).value;
    const reclaimedAt=new Date(Date.parse(lease.expiresAt)+1000).toISOString();
    const sweep=await sweepExpiredLeases(repos,{now:reclaimedAt,observedBy:"external-test-supervisor"}); assert.deepEqual(sweep.reclaimed,[message.routeTaskId]);
    assert.equal((await repos.attempts.mustRead(attempt.id)).value.outcome,"LEASE_EXPIRED"); assert.equal((await repos.routeTasks.mustRead(message.routeTaskId)).value.state,"RECLAIMABLE");
    const h=await autonomousHarness({repos,store,clock:new Date(Date.parse(reclaimedAt)+16*60_000).toISOString()});
    assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).task?.id,message.routeTaskId);
    const resumed=await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1}); assert.equal(resumed.dispatches[0].outcome,"WORKED",resumed.dispatches[0].detail); assert.notEqual(resumed.dispatches[0].attemptId,attempt.id);
    const records=(await repos.workerResults.readAll()).filter(record=>record.result.role==="ACQUIRER"); assert.equal(records.length,1);
    if(records[0].result.role!=="ACQUIRER") throw new Error("wrong role");
    assert.equal(records[0].result.artifacts[0].artifactId,message.artifactId); assert.equal(records[0].result.artifacts[0].acquisitionAttemptId,attempt.id);
    const observations=(await repos.artifacts.readAll()).filter(record=>record.artifactId===message.artifactId);
    assert.equal(observations.length,2,"identical bytes retain both real acquisition observations");
    assert.deepEqual(observations.map(record=>record.attemptId).sort(),[attempt.id,resumed.dispatches[0].attemptId].sort());
    assert.deepEqual(observations.find(record=>record.attemptId===attempt.id),metadata,"recovery preserves the original acquisition metadata");
    assert.equal((await repos.dispositions.read(message.routeTaskId)).length,0);
    for(let index=0;index<2;index++) { const run=await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1}); assert.equal(run.dispatches[0].outcome,"WORKED",run.dispatches[0].detail); }
    assert.equal((await nextAutonomousOperation(h.runtime,h.item.id)).action,"STAGED");
    const activity=(await readAutonomousActivity(repos,[h.item.id],{observedAt:h.now()}))[0];
    assert.deepEqual(activity.accounting.attemptIds,(await repos.attempts.list()).map(row=>row.id).sort());
    assert.ok(activity.accounting.terminalAttemptIds.includes(attempt.id)); assert.ok(activity.timeline.some(event=>event.kind==="ARTIFACT"&&event.attemptId===attempt.id));
    assert.equal(activity.timeline.filter(event=>event.kind==="WORKER_RESULT").length,3); assert.deepEqual(activity.evidenceGaps,[]);
  } finally { if(child.exitCode===null) child.kill("SIGKILL"); await rm(root,{recursive:true,force:true}); }
});
