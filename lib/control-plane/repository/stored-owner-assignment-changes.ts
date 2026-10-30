import { heldWorkItems, type LogCursor } from "../owner-snapshot-totals.ts";
import { askGapObligationId } from "../ask-gap-id.ts";
import type { AskGapCode } from "../../ask/gap-codes.ts";
import { stateCodeOf } from "../unit-state.ts";
import type { OwnerAssignmentChanges } from "./owner-assignment-changes.ts";
import type { AggregateRepository, AppendOnlyRepository, ControlPlaneRepositories, RecordProjection } from "./types.ts";

/** Local stores use the same source cursors; only the native adapter routes beside Postgres rows. */
export function storedOwnerAssignmentChanges(get:()=>ControlPlaneRepositories):OwnerAssignmentChanges {
  return {async read(input){
    const repos=get(),cursors:Record<string,LogCursor>={},groups=new Set<string>(),items=new Set<string>(),attempts=new Set<string>(),changed=new Set<string>();
    const links:{id:string;parent:string|null}[]=[],leaseTasks=new Set<string>(),scoutAttempts=new Set<string>();
    const sources={obligations:{id:true},debts:{obligationId:true},occurrences:{obligationId:true,workItemId:true},askGapObservations:{bodyId:true,code:true},
      workItems:{id:true,directoryParent:true,planRepair:true},routeTasks:{workItemId:true},attempts:{id:true,workItemId:true},leases:{routeTaskId:true},
      artifacts:{workItemId:true},workerResults:{workItemId:true},scoutResults:{workItemId:true,attemptId:true}} satisfies Record<string,RecordProjection>;
    for(const[name,projection]of Object.entries(sources)){
      const prior=input.cursors[name],since=input.through===null?null:new Date(Date.parse(prior?.through??input.through)-input.slackMs).toISOString();
      const held=(prior?.held??[]).filter(([, ,at])=>since===null||at>=since),taken:LogCursor["held"][number][]=[],rows:Record<string,unknown>[]=[];
      const page=(values:readonly {id?:string;key?:string;revision?:number;position?:number;changedAt?:string;value?:unknown;record?:unknown}[])=>{
        for(const row of values){taken.push([row.id??row.key!,row.revision??row.position!,row.changedAt??""]);rows.push((row.value??row.record) as Record<string,unknown>);}
      };
      const repo=repos[name as keyof typeof sources],seen=held.map(([id,version])=>[id,version] as const);
      const result= "listChangedSince" in repo ? await (repo as AggregateRepository<unknown>).listChangedSince!(since,seen,{projection,page})
        :await (repo as AppendOnlyRepository<unknown>).readChangedSince(since,seen,{projection,page});
      const through=result.through??new Date().toISOString();
      cursors[name]={through,held:[...held,...taken.map(([id,version,at])=>[id,version,at||through] as const)].filter(([, ,at])=>Date.parse(at)>=Date.parse(through)-input.slackMs)};
      for(const row of rows){
        if(row.workItemId){items.add(String(row.workItemId));changed.add(String(row.workItemId));}
        if(name==="obligations")groups.add(String(row.id));
        if(row.obligationId)groups.add(String(row.obligationId));
        if(name==="askGapObservations")groups.add(askGapObligationId(String(row.bodyId),row.code as AskGapCode));
        if(name==="attempts")attempts.add(String(row.id));
        if(name==="leases")leaseTasks.add(String(row.routeTaskId));
        if(name==="scoutResults"&&!row.workItemId&&row.attemptId)scoutAttempts.add(String(row.attemptId));
        if(name==="workItems"){
          const id=String(row.id),directory=row.directoryParent as {workItemId?:string}|null,repair=row.planRepair as {parentWorkItemId?:string}|null;
          items.add(id);changed.add(id);links.push({id,parent:directory?.workItemId??repair?.parentWorkItemId??null});
        }
      }
    }
    for(const[repo,ids]of [[repos.routeTasks,leaseTasks],[repos.attempts,scoutAttempts]] as const)for(const row of await repo.readManyNarrowed!([...ids],{workItemId:true})){
      const id=(row.value as {workItemId:string}).workItemId;items.add(id);changed.add(id);
    }
    const owners=await repos.ownerAssignmentRows.heads(await repos.ownerAssignmentRows.find({members:[...items],clauses:[...groups]}));
    const known=new Set(owners.flatMap(row=>row.members)),byId=new Map(owners.map(row=>[row.id,{id:row.id,state:row.state}]));
    for(const id of groups)byId.set(id,{id,state:stateCodeOf(id)??"other"});
    return {through:Object.values(cursors).map(cursor=>cursor.through).sort()[0]!,cursors,groups:[...byId.values()],
      items:[...await heldWorkItems(repos,[...items].filter(id=>!known.has(id)))],changedAttempts:[...attempts],changedWorkItems:[...changed],links};
  }};
}
