import { OwnerSnapshotFold, OwnerSnapshotFoldPending, readOwnerSnapshotTotals } from "./owner-snapshot-totals.ts";
import { expansionScopesOf } from "./expansion/scopes.ts";
import { readAskGapObservations } from "./ask-gap-observations.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import type { ServedReaderReadback } from "./served-reader.ts";
import type { ProviderReading } from "./provider-billing.ts";

/** The contract's changed-row backlog is checkpointed before ordinary publisher eligibility. */
export async function initializeOwnerSnapshot(repos:ControlPlaneRepositories,input:{
  readonly deadline:number;readonly log:(line:string)=>void;readonly now?:()=>string;readonly maxStates?:number;readonly slackMs?:number;
}):Promise<boolean>{
  const prior=await readOwnerSnapshotTotals(repos);
  if(prior?.value.ownerWorkListReady&&!prior.value.initializing)return true;
  if(!prior||prior.value.formatVersion!==4)throw new Error("OWNER_WORK_LIST_MIGRATION_REQUIRED: structural owner migration is incomplete");
  const [current,config,ask]=await Promise.all([
    repos.ownerSnapshots.readNarrowed("current",{servedReaderReadback:true,providerBilling:true}),
    repos.adminConfig.readSections("current",{expansionScopes:true}),readAskGapObservations(repos.askGapObservations),
  ]);
  const scopes=expansionScopesOf(config?.value??null);
  if(scopes.malformed)throw new Error("Owner initialization cannot read expansion scopes");
  const carried=current?.value as {servedReaderReadback?:ServedReaderReadback;providerBilling?:{readings:ProviderReading[]}}|undefined;
  const clock=input.now??(()=>new Date().toISOString());
  try{
    await OwnerSnapshotFold.fold(repos,prior.value,{
      nowIso:clock(),slackMs:input.slackMs,servedReader:carried?.servedReaderReadback??null,
      askGapObservations:"unreadable"in ask?null:ask.rows,scopes:scopes.scopes,carried:carried?.providerBilling?.readings??[],write:true,log:input.log,
      continuation:{deadline:input.deadline,maxStates:input.maxStates,now:clock,allowInitialization:true},
    });return true;
  }catch(error){if(error instanceof OwnerSnapshotFoldPending)return false;throw error;}
}
