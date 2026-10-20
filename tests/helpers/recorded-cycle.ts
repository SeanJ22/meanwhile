import { runCycle, type CycleInput, type CycleResult, type RecoveredOccurrence } from "../../lib/control-plane/scheduler/shadow-loop.ts";
import type { ScheduledObligation, UnscheduledObligation } from "../../lib/control-plane/scheduler/obligation.ts";
import type { DispatchResult } from "../../lib/control-plane/scheduler/dispatch.ts";
import type { FreshnessDebt, Incident } from "../../lib/control-plane/scheduler/debt.ts";

type Collections="schedule"|"dispatched"|"deferred"|"worked"|"recovered"|"simulated"|"debts"|"incidents";
/** Small fixtures collect the real disk cycle after it finishes; production uses the same core without collecting its rows. */
export type RecordedCycleResult=Omit<CycleResult,Collections>&{
  readonly schedule:{readonly scheduled:ScheduledObligation[];readonly unscheduled:UnscheduledObligation[]};
  readonly dispatched:DispatchResult[];
  readonly deferred:{readonly obligationId:string;readonly why:string}[];
  readonly worked:string[];
  readonly recovered:RecoveredOccurrence[];
  readonly simulated:string[];
  readonly debts:FreshnessDebt[];
  readonly incidents:Incident[];
};
export async function runRecordedCycle(input:CycleInput):Promise<RecordedCycleResult>{
  const cycle=await runCycle(input);
  try{return {...cycle,schedule:{scheduled:[...cycle.schedule.scheduled],unscheduled:[...cycle.schedule.unscheduled]},
    dispatched:[...cycle.dispatched],deferred:[...cycle.deferred],worked:[...cycle.worked],recovered:[...cycle.recovered],simulated:[...cycle.simulated],debts:[...cycle.debts],incidents:[...cycle.incidents],close:async()=>{}};}
  finally{await cycle.close();}
}
