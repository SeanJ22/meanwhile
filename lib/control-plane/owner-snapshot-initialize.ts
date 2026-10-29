import { OwnerSnapshotFold, type OwnerSnapshotTotals } from "./owner-snapshot-totals.ts";
import { expansionScopesOf } from "./expansion/scopes.ts";
import { readAskGapObservations } from "./ask-gap-observations.ts";
import type { ControlPlaneRepositories, Persisted } from "./repository/types.ts";
import type { ServedReaderReadback } from "./served-reader.ts";
import type { ProviderReading } from "./provider-billing.ts";

/** The contract's changed-row backlog is checkpointed before ordinary publisher eligibility. */
export async function initializeOwnerSnapshot(repos:ControlPlaneRepositories,input:{
  readonly deadline:number;readonly log:(line:string)=>void;readonly now?:()=>string;readonly maxStates?:number;readonly slackMs?:number;
}):Promise<boolean>{
  const readTotals=async()=>await repos.ownerSnapshotTotals.readNarrowed("totals",{
    formatVersion:true,costs:true,assignments:true,ownerWorkListReady:true,initializing:true,initialization:true,
  }) as Persisted<OwnerSnapshotTotals>|null;
  let prior=await readTotals();
  if(prior?.value.ownerWorkListReady&&!prior.value.initializing)return true;
  if(!prior||prior.value.formatVersion!==4)throw new Error("OWNER_WORK_LIST_MIGRATION_REQUIRED: structural owner migration is incomplete");
  const [current,config,ask]=await Promise.all([
    repos.ownerSnapshots.readNarrowed("current",{servedReaderReadback:true,providerBilling:true}),
    repos.adminConfig.readSections("current",{expansionScopes:true}),readAskGapObservations(repos.askGapObservations),
  ]);
  const scopes=expansionScopesOf(config?.value??null);
  if(scopes.malformed)throw new Error("Owner initialization cannot read expansion scopes");
  const at=prior.value.initialization?.at??(input.now??(()=>new Date().toISOString()))();
  const carried=current?.value as {servedReaderReadback?:ServedReaderReadback;providerBilling?:{readings:ProviderReading[]}}|undefined;
  const fold=await OwnerSnapshotFold.fold(repos,prior.value,{
    nowIso:at,slackMs:input.slackMs,servedReader:carried?.servedReaderReadback??null,askGapObservations:"unreadable"in ask?null:ask.rows,
    scopes:scopes.scopes,carried:carried?.providerBilling?.readings??[],write:true,log:input.log,
    checkpoint:{run:prior.value.initialization?.run??`${at}:contract:${crypto.randomUUID()}`,maxStates:input.maxStates??Infinity,
      canContinue:()=>Date.now()+90_000<input.deadline,
      save:async(fold,progress)=>{
        await fold.saveTotals(prior,progress);
        prior=await readTotals();
        input.log(`owner initialization: ${progress?.phase??"complete"}; ${progress?.pending.length??0} states remain`);
      }},
  });
  return fold.complete;
}
