import type { ExecutiveActionStore } from "../officials/executive-actions.ts";
import type { ManualSourceSetReceipt } from "../civic-data/types.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { manualPackageInputDigest,readManualPackageReplay,withManualPackageInput } from "../civic-data/manual-package-replay.ts";
import { processRegisteredManualCandidate } from "../civic-data/promotion.ts";
import { azOfficialActionsCandidate,readAzOfficialActionsPrior } from "./data-plane.ts";

/** Reading the same reviewed files is a replay, not a new check of their remote publishers. */
export async function publishAzOfficialActionsPackage(input:{readonly projection:ExecutiveActionStore;readonly sourceReceipt:ManualSourceSetReceipt;
  readonly sourceThrough:string},store:RoutineDataStore,now:string) {
  const inputDigest=manualPackageInputDigest("az-official-actions",input),retrievedAt=input.sourceReceipt.reviewedAt;
  const fresh=azOfficialActionsCandidate({store:input.projection,sourceReceipt:input.sourceReceipt,sourceThrough:input.sourceThrough,retrievedAt});
  const replay=await readManualPackageReplay(store,fresh,inputDigest);
  if(replay)return{replay,publication:null};
  const prior=await readAzOfficialActionsPrior(store,now);
  const candidate=withManualPackageInput(azOfficialActionsCandidate({store:input.projection,sourceReceipt:input.sourceReceipt,
    sourceThrough:input.sourceThrough,retrievedAt,prior}),inputDigest,fresh.retrieval.rawHash);
  const outcome=await processRegisteredManualCandidate(store,"az-official-actions",candidate,now,prior?.versionId??null,{confirmUnchanged:false});
  return{replay:null,publication:{candidate,outcome}};
}
