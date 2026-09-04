// Controlled child: the parent kills this process only after durable artifact attribution.
import path from "node:path";
import { createFileRepositories } from "../../lib/control-plane/repository/file-store.ts";
import { DurableEvidenceStore } from "../../lib/control-plane/evidence/durable-store.ts";
import { autonomousHarness, FIXTURE_URL } from "../helpers/autonomous-fleet.ts";
import { nextAutonomousOperation } from "../../lib/control-plane/workers/coordinator.ts";
import { dispatchWorkerTask } from "../../lib/control-plane/workers/runtime.ts";

const root=process.argv[2];
if(!root || !path.isAbsolute(root)) throw new Error("RECOVERY_FIXTURE_ROOT_REQUIRED");
const repos=await createFileRepositories(path.join(root,"control"));
const originalAppend=repos.artifacts.append.bind(repos.artifacts);
const instrumented={...repos,artifacts:{...repos.artifacts,append:async (...args:Parameters<typeof originalAppend>)=>{
  const written=await originalAppend(...args);
  const record=args[2];
  if(record.canonicalUrl===FIXTURE_URL) {
    process.send?.({kind:"VAULTED",artifactId:record.artifactId,attemptId:record.attemptId,routeTaskId:record.routeTaskId});
    await new Promise<void>(()=>{process.on("message",()=>{});});
  }
  return written;
}}};
const h=await autonomousHarness({repos:instrumented,store:new DurableEvidenceStore(path.join(root,"vault"))});
const decision=await nextAutonomousOperation(h.runtime,h.item.id);
if(decision.task?.workerTask?.role!=="ACQUIRER") throw new Error("RECOVERY_FIXTURE_EXPECTED_ACQUIRER");
await dispatchWorkerTask(h.runtime,decision.task);
throw new Error("RECOVERY_FIXTURE_MUST_BE_KILLED_BEFORE_COMPLETION");
