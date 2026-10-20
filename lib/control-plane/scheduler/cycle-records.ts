import { CycleWorkset } from "./cycle-workset.ts";
import { debtCauseForDisposition, recordFailure } from "./debt.ts";
import { DISCHARGING_DISPOSITIONS, dischargesObligation, type DispatchResult } from "./dispatch.ts";
import { settledUnresolvedReason, type SettledOccurrence } from "./durable.ts";
import type { ScheduledObligation } from "./obligation.ts";

/** The existing record/recovery rules applied immediately to one result, with complete output retained on disk. */
export class CycleRecords {
  readonly outcomes:Record<string,number>={};
  readonly executors:Record<string,number>={};
  readonly usdByExecutor:Record<string,number>={};
  readonly dispositions:Record<string,number>={};
  readonly recoveredDispositions:Record<string,number>={};
  committed=0;
  artifacts=0;
  costUsd=0;
  costedAttempts=0;
  recoveredReadings=0;
  private readonly workset:CycleWorkset;
  private readonly now:string;
  constructor(workset:CycleWorkset,now:string){this.workset=workset;this.now=now;}
  defer(obligationId:string,why:string):void {this.workset.append("deferred",{obligationId,why});}
  recover(row:ScheduledObligation,settled:SettledOccurrence):void {
    const discharged=DISCHARGING_DISPOSITIONS.includes(settled.disposition.disposition);
    const disposition=settled.disposition.disposition;
    this.recoveredDispositions[disposition]=(this.recoveredDispositions[disposition]??0)+1;
    this.workset.append("recovered",{...settled,discharged});this.workset.recover(row.obligation.id,discharged);
    if(discharged){this.recoveredReadings++;this.workset.clearDebt(row.obligation.id);return;}
    this.workset.addDebt(recordFailure(this.workset.debt(row.obligation.id),{
      obligationId:row.obligation.id,cause:debtCauseForDisposition(settled.disposition.disposition),detail:settledUnresolvedReason(settled.disposition),
      target:row.obligation.routeId??row.obligation.subjectId,dueAt:row.nextDueAt,now:this.now,
    }),Date.parse(this.now));
  }
  record(row:ScheduledObligation,result:DispatchResult):void {
    this.workset.append("dispatched",result);
    const outcome=result.outcome??"UNRECORDED";this.outcomes[outcome]=(this.outcomes[outcome]??0)+1;
    if(result.executor){this.executors[result.executor]=(this.executors[result.executor]??0)+1;this.usdByExecutor[result.executor]=(this.usdByExecutor[result.executor]??0)+(result.cost?.usd??0);}
    if(result.cost!==null){this.costedAttempts++;this.costUsd+=result.cost?.usd??0;}
    if(result.dispositionCommitted){this.committed++;this.artifacts+=result.artifactIds.length;const name=result.disposition??"unrecorded";this.dispositions[name]=(this.dispositions[name]??0)+1;}
    if(dischargesObligation(result)){this.workset.clearDebt(row.obligation.id);this.workset.discharged(row.obligation.id);this.workset.append("worked",row.obligation.id);}
    else if(result.outcome==="SIMULATED")this.workset.append("simulated",row.obligation.id);
    else if(result.outcome!=="NOT_CLAIMED")this.workset.addDebt(recordFailure(this.workset.debt(row.obligation.id),{
      obligationId:row.obligation.id,
      cause:result.outcome==="NO_ROUTE_TASK"?"NEVER_DISPATCHED":result.dispositionCommitted?debtCauseForDisposition(result.disposition??""):"UPSTREAM_ERROR",
      detail:result.dispositionCommitted?`the route was disposed ${result.disposition}, which closes the RouteTask and is not a reading of the record: ${result.detail}`:result.detail,
      target:row.obligation.routeId??row.obligation.subjectId,dueAt:row.nextDueAt,now:this.now,
    }),Date.parse(this.now));
  }
}
