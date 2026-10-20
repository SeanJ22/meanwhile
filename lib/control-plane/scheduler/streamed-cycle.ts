import { CycleWorkset } from "./cycle-workset.ts";
import { CycleRecords } from "./cycle-records.ts";
import { runCycleQueue } from "./cycle-queue.ts";
import { dispatchOne, sweepExpiredLeases, type DeclaredExecutor, type DispatchResult, type ExecutorDecision } from "./dispatch.ts";
import { isScheduled, scheduleObligation, waitingSince, type FreshnessObligation, type ScheduledObligation } from "./obligation.ts";
import type { SettledOccurrence } from "./durable.ts";
import type { CycleInput, CycleResult, LaneCounts } from "./shadow-loop.ts";

/** Reclaim and stream every obligation through the same scheduling/retry rules; full records stay on disk. */
export async function runStreamedCycle(input:CycleInput):Promise<CycleResult> {
  const nowMs=Date.parse(input.now),workset=await CycleWorkset.open();
  try {
    const reclaim=input.skipReclaim?{reclaimed:[],releasedSettled:[],stillLive:[],refused:[]}
      :await sweepExpiredLeases(input.recoveryRepos??input.repos,{now:input.now,observedBy:input.holder});
    input.onRecoveryComplete?.();
    for await(const debt of input.debts)workset.addDebt(debt,nowMs,true);
    const cadenceSources:Record<string,number>={};
    const scheduleOne=(obligation:FreshnessObligation)=>{
      const row=scheduleObligation(obligation,nowMs);workset.add(row,input.placeFirst?.has(obligation.id)??false,nowMs);
      if(isScheduled(row))cadenceSources[row.cadenceSource]=(cadenceSources[row.cadenceSource]??0)+1;
    };
    if(input.obligationSource)await input.obligationSource.visit(scheduleOne);
    else if(input.obligations)for await(const obligation of input.obligations)scheduleOne(obligation);
    else throw new Error("CYCLE_OBLIGATION_SOURCE_REQUIRED");
    const records=new CycleRecords(workset,input.now);
    for await(const settled of input.settledOccurrences??[]){const row=workset.scheduledFor(settled.obligationId);if(row)records.recover(row,settled);}
    for(const debt of workset.backedOff)if(!workset.isRecovered(debt.obligationId))records.defer(debt.obligationId,debt.cause==="AWAITING_ADAPTER"
      ?"AWAITING_ADAPTER: the required adapter has not changed; elapsed backoff cannot supply missing code. The obligation remains owed to Engineer."
      :`its clock has passed and it is holding ${debt.consecutiveFailures} consecutive failure(s), so the backoff computed for it stands until ${debt.retryAt}. Held out of this cycle and counted here — a walled route re-opened every cycle is a hot loop reported as an outage.`);
    const research=input.research;
    await workset.classify(research?.decide);workset.prepareQueue(input.huntFor);
    const deterministicDue=workset.laneCount("deterministic"),modelDue=workset.laneCount("model"),ceiling=input.maxDispatches??workset.dueCount;
    const deterministicDeferredBy:Record<string,number>={},modelDeferredBy:Record<string,number>={};
    let deterministicDispatched=0,deterministicRecovered=0,deterministicOldestWaiting:string|null=null,modelOldestWaiting:string|null=null,modelDeferred=0;
    const holdDeterministic=(row:ScheduledObligation,code:string)=>{
      deterministicDeferredBy[code]=(deterministicDeferredBy[code]??0)+1;
      const since=waitingSince(row,workset.debt(row.obligation.id,true));
      if(deterministicOldestWaiting===null||since<deterministicOldestWaiting)deterministicOldestWaiting=since;
    };
    for(const row of workset.modelRows){
      records.defer(row.obligation.id,"HUNTED_IN_PACKET: its government's packet carries this blank to the hunters; work remains due until a fact is checked.");
      modelDeferred++;modelDeferredBy.HUNTED_IN_PACKET=(modelDeferredBy.HUNTED_IN_PACKET??0)+1;
      if(modelOldestWaiting===null||row.nextDueAt<modelOldestWaiting)modelOldestWaiting=row.nextDueAt;
    }
    const dispatchRow=async(row:ScheduledObligation,executor:DeclaredExecutor,decision:ExecutorDecision|undefined):Promise<DispatchResult>=>{
      let result:DispatchResult;
      try {
        const dispatch=executor.dispatch??(request=>dispatchOne(input.repos,{...request,executor}));
        result=await dispatch({obligation:row,routeTaskId:input.routeTaskFor(row.obligation.id),holder:input.holder,now:input.now,clock:input.clock,
          leaseTtlMs:input.leaseTtlMs,bound:input.bound,maturity:input.maturity,...(decision?{decision}:{}),
          ...(input.methodVersion!==undefined?{methodVersion:input.methodVersion}:{}),...(input.policyVersion!==undefined?{policyVersion:input.policyVersion}:{})});
      }catch(error){
        result={obligationId:row.obligation.id,routeTaskId:input.routeTaskFor(row.obligation.id),executor:null,executorChosen:decision?.kind??null,decisionDisagreement:decision?.disagreement??null,executorMismatch:false,claimed:false,outcome:"FAILED",attemptId:null,dispositionCommitted:false,disposition:null,artifactIds:[],cost:null,worker:null,
          detail:"the dispatch threw and was isolated so the cycle could continue rather than aborting every other due occurrence: "+(error instanceof Error?error.message:String(error))};
      }
      records.record(row,result);return result;
    };
    let admitted=0;
    await runCycleQueue(workset,{capacity:input.workerCapacity??1,placePriority:input.placePriority,comparator:input.placeComparator,huntRounds:input.huntFor!==undefined,providerLimitOf:input.providerLimitOf,run:async slot=>{
      let row=slot.row;
      if(input.openOccurrence===undefined&&input.requireOpenOccurrence&&input.routeTaskFor(row.obligation.id)===null){records.defer(row.obligation.id,"NO_OPEN_OCCURRENCE: outside this cycle's reserved lane slots; work remains due.");holdDeterministic(row,"NO_OPEN_OCCURRENCE");return;}
      if(admitted>=ceiling){
        records.defer(row.obligation.id,`this cycle dispatched its stated ceiling of ${ceiling} item(s) and ${deterministicDue-ceiling} remained due. They are deferred to the next cycle, counted here, and their debt continues to age — a ceiling that dropped them silently would report the same number whatever the backlog was`);
        holdDeterministic(row,"DISPATCH_CEILING");return;
      }
      admitted++;
      if(input.obligationSource){const full=await input.obligationSource.read(row.obligation.id);if(!full)throw new Error(`CYCLE_OBLIGATION_HYDRATION_MISSING:${row.obligation.id}`);row={...row,obligation:full};}
      let opened:boolean|{readonly settled:SettledOccurrence}=true;
      if(input.openOccurrence)try{opened=await input.openOccurrence(row);}catch{opened=false;}
      if(opened===false){admitted--;records.defer(row.obligation.id,"NO_OPEN_OCCURRENCE: the occurrence could not be opened in step with dispatch this cycle; work remains due.");holdDeterministic(row,"NO_OPEN_OCCURRENCE");return;}
      if(opened!==true){admitted--;records.recover(row,opened.settled);deterministicRecovered++;return;}
      const admission=input.admitDispatch?.(row)??{admit:true as const};
      if(!admission.admit){admitted--;records.defer(row.obligation.id,`${admission.code}: ${admission.why}. Deferred with its next-due, never dropped and never reported complete.`);holdDeterministic(row,admission.code);return;}
      deterministicDispatched++;
      const result=await dispatchRow(row,typeof input.executor==="function"?input.executor(row):input.executor,slot.decision);
      if(research?.onDispatched)await research.onDispatched(result,"DETERMINISTIC");
    }});
    const lanes:LaneCounts|null=research?{deterministic:{due:deterministicDue,dispatched:deterministicDispatched,deferredBy:deterministicDeferredBy,recovered:deterministicRecovered,oldestWaitingDueAt:deterministicOldestWaiting},model:{due:modelDue,dispatched:0,deferred:modelDeferred,deferredBy:modelDeferredBy,recovered:0,oldestWaitingDueAt:modelOldestWaiting}}:null;
    const {oldestDebtHours}=workset.buildIncidents(nowMs),debts=workset.debts,incidents=workset.incidents;
    return {
      startedAt:input.now,finishedAt:new Date(nowMs).toISOString(),reclaim,schedule:{scheduled:workset.scheduled,unscheduled:workset.unscheduled},dueCount:workset.dueCount,
      dispatched:workset.output("dispatched"),worked:workset.output("worked"),recovered:workset.output("recovered"),simulated:workset.output("simulated"),deferred:workset.output("deferred"),debts,incidents,
      risk:{obligationsScheduled:workset.scheduled.length,obligationsUnscheduled:workset.unscheduled.length,obligationsOverdue:workset.overdueCount,debtRows:debts.length,incidents:incidents.length,oldestDebtHours,activation:"SHADOW_NOT_ACTIVATED"},
      lanes,promotedToReaderTruth:false,
      summary:{cadenceSources,outcomes:records.outcomes,executors:records.executors,usdByExecutor:records.usdByExecutor,dispositions:records.dispositions,recoveredDispositions:records.recoveredDispositions,committed:records.committed,artifacts:records.artifacts,costUsd:records.costUsd,costedAttempts:records.costedAttempts,recoveredReadings:records.recoveredReadings},
      close:()=>workset.close(),
    };
  }catch(error){await workset.close();throw error;}
}
