import {ADMIN_CONFIG_ID} from '../control-plane/gateway/admin-config.ts';
import {RESEARCH_INTENT_LOG_KEY} from '../control-plane/scheduler/research-policy.ts';
import type {ControlPlaneRepositories} from '../control-plane/repository/types.ts';
import type {ObligationAssignment} from '../control-plane/scheduler/obligation.ts';
/** Read only the instructions already bound to this government's occurrence.
 * Direction is Sean's text; this function creates no work or spending limit. */
export async function huntDirections(repos:ControlPlaneRepositories,refs:readonly string[],assignments:readonly ObligationAssignment[]){
 const notes:{at:string;note:string}[]=[];
 for(const ref of new Set(refs)){
  const records=await repos.researchIntents.readWhere(RESEARCH_INTENT_LOG_KEY,['intentId'],ref);
  for(const record of records)if(record.kind==='INTENT' && record.action==='DISPATCH' && record.note)notes.push({at:record.requestedAt,note:record.note});
 }
 const keys=[...new Set(assignments.filter(mark=>refs.includes(mark.ref) && !mark.ref.startsWith('DISPATCH:')).map(mark=>mark.assignmentKey))];
 if(keys.length){
  // CP-01's repository fetches these section rows by ID; no whole Admin history.
  const config=await (repos.adminConfig.read as (id:string,sections?:unknown)=>ReturnType<typeof repos.adminConfig.read>)(ADMIN_CONFIG_ID,{expansionScopes:{ids:keys}});
  for(const scope of config?.value.expansionScopes??[])if(refs.includes(scope.receiptId) && scope.note)notes.push({at:scope.decidedAt,note:scope.note});
 }
 return [...new Set(notes.sort((a,b)=>b.at.localeCompare(a.at)).map(row=>row.note))];
}
