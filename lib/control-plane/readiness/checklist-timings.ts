import type { AssignmentSources } from "../assignment-view.ts";
import { servedWitness } from "../served-reader.ts";

export interface WorkDeliveryTiming {
  readonly workItemId:string;
  readonly subjectId:string;
  readonly recordClass:string;
  readonly registeredAt:string;
  readonly readyAt:null;
  readonly firstStartedAt:string|null;
  readonly firstSavedAt:string|null;
  readonly parsedAt:string|null;
  readonly verifiedAt:string|null;
  readonly acceptedAt:string|null;
  readonly visibleAt:string|null;
  /** Source publication is not the same clock as our fetch or publication. */
  readonly sourcePublishedAt:null;
  readonly registeredToStartMs:number|null;
  /** Upper bound to this observed readback, not a claimed first-visible time. */
  readonly verifiedToReadbackMs:number|null;
  readonly waitingFor:"START"|"EXTRACTION"|"VERIFICATION"|"PUBLICATION"|"PUBLIC_READBACK"|"NONE";
  readonly waitingSince:string|null;
  readonly unfinishedAgeMs:number|null;
  readonly workAgeMs:number|null;
  readonly timingIssue:boolean;
}
const valid=(value:string|undefined|null)=>value && Number.isFinite(Date.parse(value))?value:null;
const first=(values:readonly (string|undefined|null)[])=>values.map(valid).filter((v):v is string=>v!==null).sort((a,b)=>Date.parse(a)-Date.parse(b))[0]??null;
const latest=(values:readonly (string|undefined|null)[])=>values.map(valid).filter((v):v is string=>v!==null).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null;
const elapsed=(start:string|null,end:string|null)=>start && end && Date.parse(end)>=Date.parse(start)?Date.parse(end)-Date.parse(start):null;

/** Per-work clocks retain unfinished work and real event times. Neither a
 * scheduler's later eligibility time nor a dashboard refresh resets its age.
 * Exact result/approval identities prevent joining a later unrelated check to
 * an earlier publication. These are process timings, never checklist credit. */
export function checklistDeliveryTimings(sources:AssignmentSources, members:ReadonlySet<string>,now:string):WorkDeliveryTiming[] {
  const resultsByWork=new Map<string,AssignmentSources["workerResults"][number][]>();
  const attemptsByWork=new Map<string,AssignmentSources["attempts"][number][]>();
  const savedByWork=new Map<string,string[]>();
  for(const row of sources.workerResults) resultsByWork.set(row.workItemId,[...(resultsByWork.get(row.workItemId)??[]),row]);
  for(const row of sources.attempts) attemptsByWork.set(row.workItemId,[...(attemptsByWork.get(row.workItemId)??[]),row]);
  for(const row of sources.artifacts) if(!row.partial && row.tier!=="RESTRICTED_RAW") savedByWork.set(row.workItemId,[...(savedByWork.get(row.workItemId)??[]),row.recordedAt]);
  return sources.workItems.filter(item=>members.has(item.subject)&&item.autonomousPlan).map(item=>{
    const results=resultsByWork.get(item.id)??[];
    const publication=item.publicationOutcome;
    const accepted=publication && publication.status!=="HELD" && publication.candidateId && publication.versionId ? publication:null;
    const publicationAudit=accepted ? results.find(row=>row.id===accepted.workerResultId):undefined;
    const auditors=accepted ? (publicationAudit ? [publicationAudit] : []) : results.filter(row=>row.result.role==="ADVERSARIAL_AUDITOR" && row.result.verdict==="SURVIVED");
    const verifiedAt=latest(auditors.filter(row=>row.result.role==="ADVERSARIAL_AUDITOR" &&
      (row.result.verdict==="SURVIVED" || Boolean(accepted && accepted.acceptedRecordIds?.length &&
        accepted.acceptedRecordIds.every(id=>row.result.role==="ADVERSARIAL_AUDITOR" && row.result.survivingRecordIds?.includes(id)))))
      .map(row=>row.endedAt));
    const witness=accepted?servedWitness(sources.servedReader,item.id,accepted.workerResultId,now):null;
    const visibleAt=witness?.versionId===accepted?.versionId?valid(witness?.checkedAt):null;
    const registeredAt=item.createdAt;
    const attempts=attemptsByWork.get(item.id)??[];
    // Legacy dispatch sometimes stamped the cycle time onto both ends of a
    // measured multi-second execution. Keep those records, but do not derive
    // an exact start clock or claim zero elapsed execution from them.
    const contradictoryStart=(row:AssignmentSources["attempts"][number])=>Boolean(
      valid(row.startedAt)&&valid(row.endedAt)&&Date.parse(row.startedAt)===Date.parse(row.endedAt??"")&&
      row.cost?.durationMs!==null&&row.cost?.durationMs!==undefined&&row.cost.durationMs>0);
    const startIssue=attempts.some(contradictoryStart);
    const firstStartedAt=startIssue?null:first(attempts.map(row=>row.startedAt));
    const firstSavedAt=first(savedByWork.get(item.id)??[]);
    const audit=publicationAudit ?? auditors.sort((a,b)=>Date.parse(b.endedAt)-Date.parse(a.endedAt))[0];
    const lineage=new Set<string>();
    const byId=new Map(results.map(row=>[row.id,row]));
    const pending=[...(audit?.inputResultIds??[])];
    while(pending.length) {
      const id=pending.pop()!;
      if(lineage.has(id)) continue;
      lineage.add(id);
      pending.push(...(byId.get(id)?.inputResultIds??[]));
    }
    const parsedAt=latest(results.filter(row=>row.result.role==="PARSER" && row.result.verdict==="EXTRACTED" &&
      (!accepted && !audit || lineage.has(row.id))).map(row=>row.endedAt));
    const acceptedAt=valid(accepted?.at);
    const waitingFor:WorkDeliveryTiming["waitingFor"]=visibleAt?"NONE":acceptedAt?"PUBLIC_READBACK":verifiedAt?"PUBLICATION":parsedAt?"VERIFICATION":firstStartedAt||firstSavedAt||attempts.length?"EXTRACTION":"START";
    const waitingSince=visibleAt?null:acceptedAt??verifiedAt??parsedAt??firstSavedAt??registeredAt;
    const registeredToStartMs=elapsed(valid(registeredAt),firstStartedAt);
    const verifiedToReadbackMs=elapsed(verifiedAt,visibleAt);
    const unfinishedAgeMs=elapsed(valid(waitingSince),valid(now));
    const workAgeMs=visibleAt?null:elapsed(valid(registeredAt),valid(now));
    const timingIssue=startIssue||!valid(registeredAt)||Boolean(firstStartedAt&&registeredToStartMs===null)||Boolean(verifiedAt&&visibleAt&&verifiedToReadbackMs===null)||Boolean(waitingSince&&unfinishedAgeMs===null);
    return {workItemId:item.id,subjectId:item.subject,recordClass:item.autonomousPlan!.contract.recordClass,registeredAt,readyAt:null,firstStartedAt,firstSavedAt,
      parsedAt,verifiedAt,acceptedAt,visibleAt,sourcePublishedAt:null,registeredToStartMs,verifiedToReadbackMs,waitingFor,waitingSince,unfinishedAgeMs,workAgeMs,timingIssue};
  }).sort((a,b)=>(b.workAgeMs??-1)-(a.workAgeMs??-1)||a.workItemId.localeCompare(b.workItemId));
}
