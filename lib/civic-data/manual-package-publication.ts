import type { RoutineDataStore } from "./store.ts";
import { manualProjectionCandidate,type ManualProjectionPackage } from "./manual-projections.ts";
import { prepareManualProjectionSuccessor } from "./manual-successor.ts";
import { processRegisteredManualCandidate } from "./promotion.ts";
import { manualPackageInputDigest,readManualPackageReplay,withManualPackageInput } from "./manual-package-replay.ts";

/** A held package replay reuses its pointed output without renewing any source/fact date. */
export async function publishManualProjectionPackage(input:ManualProjectionPackage,store:RoutineDataStore,now:string) {
  const inputDigest=manualPackageInputDigest(input.contractId,input),fresh=manualProjectionCandidate(input);
  const replay=await readManualPackageReplay(store,fresh,inputDigest);
  if(replay)return {replay,publication:null};
  const prepared=await prepareManualProjectionSuccessor(input,store,now),candidate=withManualPackageInput(prepared.candidate,inputDigest,fresh.retrieval.rawHash);
  const outcome=await processRegisteredManualCandidate(store,input.contractId,candidate,now,prepared.expectedBaseVersionId,{confirmUnchanged:false});
  return {replay:null,publication:{candidate,outcome}};
}
