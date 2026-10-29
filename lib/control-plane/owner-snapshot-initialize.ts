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
  const carried=current?.value as {servedReaderReadback?:ServedReaderReadback;providerBilling?:{readings:ProviderReading[]}}|undefined;
  const clock=input.now??(()=>new Date().toISOString());
  const canContinue=()=>Date.now()+90_000<input.deadline;
  let refreshedThisAttempt=false,states=0;
  while(canContinue()){
    const refreshing=prior.value.initialization?.phase==="refresh";
    const currentClock=clock();
    const previousAt=prior.value.initialization?.at;
    const at=refreshing&&previousAt?Date.parse(currentClock)>Date.parse(previousAt)?currentClock:previousAt:previousAt??currentClock;
    const before=prior.revision;
    const fold=await OwnerSnapshotFold.fold(repos,refreshing?{...prior.value,initialization:undefined}:prior.value,{
      nowIso:at,slackMs:input.slackMs,servedReader:carried?.servedReaderReadback??null,askGapObservations:"unreadable"in ask?null:ask.rows,
      scopes:scopes.scopes,carried:carried?.providerBilling?.readings??[],write:true,log:input.log,
      checkpoint:{run:refreshing?`${at}:refresh:${crypto.randomUUID()}`:prior.value.initialization?.run??`${at}:contract:${crypto.randomUUID()}`,maxStates:(input.maxStates??Infinity)-states,
        canContinue,
        save:async(fold,progress)=>{
          if(progress===null&&!refreshedThisAttempt){
            // A backlog may span cleanup retries. Re-read its delta at the real current clock before publication is eligible.
            const now=clock();
            progress={at:Date.parse(now)>Date.parse(at)?now:at,run:`${now}:refresh:${crypto.randomUUID()}`,phase:"refresh",pending:[]};
          }
          await fold.saveTotals(prior,progress);
          prior=await readTotals();
          if(!prior)throw new Error("Owner initialization lost its national count row");
          input.log(`owner initialization: ${progress?.phase??"complete"}; ${progress?.pending.length??0} states remain`);
        }},
    });
    states+=fold.checkpointedStates;
    if(refreshing)refreshedThisAttempt=true;
    if(prior.value.ownerWorkListReady&&!prior.value.initializing)return true;
    // A state-count test bound or the inherited deadline can leave this phase untouched; resume it on the next attempt.
    if(prior.revision===before)return false;
  }
  return false;
}
