import type { AssignmentSources } from "../assignment-view.ts";
import { plainCode, plainText } from "../plain-words.ts";
import { latestServedObservation, servedWitness } from "../served-reader.ts";
import type { WorkItem } from "../work-item.ts";
import { PUBLIC_SITE_ORIGIN } from "../../ops/origins.ts";

export interface AssignmentEvidenceEvent {
  readonly id: string;
  readonly stage: "SOURCE" | "ATTEMPT" | "SAVED" | "EXTRACTED" | "CHECKED" | "PUBLISHED" | "READER";
  readonly at: string | null;
  readonly title: string;
  readonly says: string;
  readonly nextAction: string | null;
  readonly sourceUrl: string | null;
  readonly publicUrl: string | null;
  /** Exact private request route, only for a complete RAW capture on this work. */
  readonly privateCopy?: { readonly path: string; readonly byteLength: number };
  readonly references: readonly (readonly [string,string])[];
}
export interface AssignmentEvidenceTrail {
  readonly events: readonly AssignmentEvidenceEvent[];
  readonly gaps: readonly string[];
}
const asTime=(value:string|null|undefined)=>value&&Number.isFinite(Date.parse(value))?value:null;
function safeHttps(value:string|null|undefined,publicOnly=false):string|null {
  if(!value) return null;
  try {
    const url=new URL(value);
    if(url.protocol!=="https:"||url.username||url.password||url.hash||publicOnly&&url.origin!==PUBLIC_SITE_ORIGIN) return null;
    if(url.search && !(publicOnly && url.pathname==="/ballot" && [...url.searchParams.keys()].length===1 &&
      /^\d{5}$/.test(url.searchParams.get("zip")??""))) return null;
    return `${url.origin}${url.pathname}${url.search}`;
  } catch { return null; }
}
function findingCodes(result:{readonly findings?:readonly {readonly code:string}[]}):string {
  const codes=[...new Set((result.findings??[]).map(row=>plainCode(row.code)).filter(Boolean))];
  return codes.length?` Recorded reasons: ${codes.slice(0,4).join("; ")}${codes.length>4?`; ${codes.length-4} more in the result`:""}.`:"";
}
/** Every join is exact work/attempt/artifact/result identity; no raw saved bytes or URL credentials enter it. */
export function assignmentEvidenceTrail(sources:AssignmentSources,assignmentId:string,nextAction:string|null):AssignmentEvidenceTrail {
  const items=sources.workItems.filter(item=>item.id===assignmentId ||
    sources.obligations.some(ob=>ob.id===assignmentId&&sources.occurrences.some(occ=>occ.workItemId===item.id&&occ.obligationId===ob.id)));
  const workIds=new Set(items.map(item=>item.id));
  const attempts=sources.attempts.filter(row=>workIds.has(row.workItemId));
  const byAttempt=new Map(attempts.map(row=>[row.id,row]));
  const events:AssignmentEvidenceEvent[]=[];
  const gaps:string[]=[];
  const add=(event:AssignmentEvidenceEvent)=>events.push(event);
  const ref=(...entries:(readonly [string,string|null|undefined])[]):readonly (readonly [string,string])[]=>
    entries.filter((entry):entry is readonly [string,string]=>typeof entry[1]==="string"&&entry[1].length>0);
  const provenance=new Map((sources.inheritedOrigins??[]).map(row=>[`${row.originWorkItemId}:${row.artifact.artifactId}`,row]));
  if(sources.inheritedOrigins===null) gaps.push("Earlier saved-document origins exceeded the bounded read or could not be confirmed. No reuse saving is claimed.");
  if(items.length===0) gaps.push("No linked work item was returned for this assignment; its execution trail cannot be built.");
  for(const item of items) {
    add({id:`registered:${item.id}`,stage:"SOURCE",at:asTime(item.createdAt),title:"Work registered",
      says:`${plainText(item.obligation)} This records work owed, not a discovered source or public result.`,nextAction:null,sourceUrl:null,publicUrl:null,
      references:ref(["Work item",item.id],["Subject",item.subject])});
  }
  for(const attempt of attempts) {
    if(attempt.cost.durationMs!==null&&attempt.cost.durationMs>0&&attempt.startedAt===attempt.endedAt)
      gaps.push(`Attempt ${attempt.id} records identical start and end times despite measured work. Its elapsed time cannot be recovered from those timestamps.`);
    const label=attempt.outcome===null?"Running or not closed":attempt.outcome==="COMPLETED"?"Completed":`Stopped: ${plainCode(attempt.outcome)}`;
    const requests=attempt.cost.requestCount;
    add({id:`attempt:${attempt.id}`,stage:"ATTEMPT",at:asTime(attempt.endedAt??attempt.startedAt),title:`${plainCode(attempt.worker.role)} attempt · ${label}`,
      says:`Started ${asTime(attempt.startedAt)??"at an invalid or missing time"}. ${requests===null?"Source request count was not reported.":`${requests} source request${requests===1?"":"s"} recorded.`}${attempt.abortReason?` ${plainText(attempt.abortReason)}`:""}`,
      nextAction:attempt.outcome==="COMPLETED"?null:nextAction,sourceUrl:null,publicUrl:null,
      references:ref(["Attempt",attempt.id],["Work item",attempt.workItemId],["Route task",attempt.routeTaskId],["Method version",String(attempt.methodVersion)])});
  }
  for(const artifact of sources.artifacts.filter(row=>workIds.has(row.workItemId))) {
    const attempt=byAttempt.get(artifact.attemptId);
    if(!attempt || !attempt.artifactIds.includes(artifact.artifactId)) continue;
    const eligibleCopy=artifact.tier==="RAW"&&!artifact.partial&&artifact.byteLength>0&&artifact.byteLength<=32*1024*1024&&
      itemById(items,artifact.workItemId)?.project==="freshness"&&
      [artifact.workItemId,artifact.attemptId,artifact.artifactId].every(id=>/^[a-z][a-z0-9-]{1,120}$/.test(id))&&
      artifact.artifactId.startsWith("ar-");
    if(asTime(artifact.recordedAt)&&asTime(attempt.endedAt)&&Date.parse(artifact.recordedAt)>Date.parse(attempt.endedAt!))
      gaps.push(`Saved document ${artifact.artifactId} was recorded after its Attempt's stated end time. The historical event order is uncertain.`);
    add({id:`saved:${artifact.workItemId}:${artifact.artifactId}`,stage:"SAVED",at:asTime(artifact.recordedAt),title:artifact.partial?"Partial document saved":"Document saved",
      says:`${artifact.byteLength.toLocaleString("en-US")} bytes retained from the recorded source.${artifact.partial?" This is incomplete and cannot prove the full source.":" Saving it does not mean facts were extracted or published."}`,
      nextAction:artifact.partial?nextAction:null,sourceUrl:safeHttps(artifact.canonicalUrl),publicUrl:null,
      ...(eligibleCopy?{privateCopy:{path:`/api/admin/evidence/${artifact.workItemId}/${artifact.attemptId}/${artifact.artifactId}`,
        byteLength:artifact.byteLength}}:{}),
      references:ref(["Saved document",artifact.artifactId],["Content hash",artifact.contentHash],["Original attempt",artifact.attemptId],["Work item",artifact.workItemId])});
  }
  for(const scout of sources.scoutResults.filter(row=>workIds.has(row.workItemId))) {
    add({id:`scout:${scout.attemptId}`,stage:"SOURCE",at:asTime(scout.recordedAt),
      title:scout.refusal?"Source search refused":"Source search recorded",
      says:`${scout.candidates.length} proposed route${scout.candidates.length===1?"":"s"}; ${scout.findings.length} possible record or pointer finding${scout.findings.length===1?"":"s"}. These are leads, not extracted or published facts. ${scout.refusal?"The finish was refused, so its proposals cannot be treated as accepted.":""}`,
      nextAction:scout.refusal?nextAction:null,sourceUrl:null,publicUrl:null,
      references:ref(["Scout attempt",scout.attemptId],["Route task",scout.routeTaskId],
        ...scout.candidates.map(candidate=>["Proposed route",candidate.routeId] as const),
        ...scout.artifactIds.map(id=>["Cited saved document",id] as const))});
  }
  for(const row of sources.workerResults.filter(row=>workIds.has(row.workItemId))) {
    const attempt=byAttempt.get(row.attemptId);
    if(!attempt||attempt.outcome!=="COMPLETED"||row.completion?.closedAttempt?.id!==attempt.id||
      row.completion.closedAttempt.workItemId!==attempt.workItemId||row.result?.role!==row.worker?.role) continue;
    const result=row.result;
    const base=ref(["Result",row.id],["Attempt",row.attemptId],["Work item",row.workItemId],
      ["Route task",row.routeTaskId],["Method version",String(row.methodVersion)]);
    if(result.role==="ACQUIRER") {
      if(!result.source||!Array.isArray(result.artifacts)) {gaps.push(`An older acquisition result on ${row.workItemId} lacks a readable source or saved-document list.`);continue;}
      const held=result.artifacts.filter(artifact=>artifact.reused);
      for(const artifact of held) {
        const declared=itemById(items,row.workItemId)?.autonomousPlan?.acquisition?.flatMap(acq=>acq.held??[])
          .find(h=>h.artifactId===artifact.artifactId&&h.inheritedFromWorkItemId&&
            h.sourceRouteId===result.source.id&&h.sourceObservationArtifactId===result.source.observation?.artifactId);
        const origin=declared?.inheritedFromWorkItemId?provenance.get(`${declared.inheritedFromWorkItemId}:${artifact.artifactId}`):null;
        const verified=origin&&origin.attempt.id===artifact.acquisitionAttemptId&&origin.artifact.contentHash===artifact.contentHash&&
          origin.artifact.canonicalUrl===artifact.canonicalUrl;
        const firstAttempt=byAttempt.get(artifact.acquisitionAttemptId);
        const sameWork=firstAttempt?.outcome==="COMPLETED"&&firstAttempt.artifactIds.includes(artifact.artifactId)&&
          sources.artifacts.some(a=>a.workItemId===row.workItemId&&a.artifactId===artifact.artifactId&&
            a.attemptId===artifact.acquisitionAttemptId&&a.contentHash===artifact.contentHash&&!a.partial);
        const noRequest=result.requestCount===0&&result.bytesFetched===0&&
          attempt.cost.requestCount===0&&attempt.cost.bytesFetched===0;
        add({id:`reuse:${row.id}:${artifact.artifactId}`,stage:"SAVED",at:asTime(row.endedAt),title:verified?"Earlier saved document reused":sameWork?"Saved document reused":"Reuse reported; origin unconfirmed",
          says:`The completed acquisition recorded reuse of saved bytes. ${verified?"Original capture owner and completed attempt were checked.":sameWork?"The earlier capture is on this same work item.":"The earlier capture could not be independently matched in this read."} ${noRequest?"This acquisition made no new source request.":"A zero-request saving is not established."} No dollar saving is inferred.`,
          nextAction:verified||sameWork?null:nextAction,sourceUrl:safeHttps(artifact.canonicalUrl),publicUrl:null,
          references:ref(...base,["Saved document",artifact.artifactId],["Original attempt",artifact.acquisitionAttemptId],
            ["Original work item",verified?origin.originWorkItemId:sameWork?row.workItemId:null],["Content hash",artifact.contentHash])});
      }
      add({id:`source:${row.id}`,stage:"SOURCE",at:asTime(row.endedAt),title:`Source acquisition ${plainCode(result.verdict).toLowerCase()}`,
        says:`The worker used ${result.source.retrieval==="fetch_public"?"a direct public web request":result.source.retrieval==="browse"?"a browser visit":"a recorded source method"}; ${result.artifacts.length} saved document${result.artifacts.length===1?"":"s"} in its result. ${Number.isSafeInteger(result.requestCount)?`${result.requestCount} source request${result.requestCount===1?"":"s"} reported`:"source request count not recorded"}.${findingCodes(result)}`,
        nextAction:result.verdict==="ACQUIRED"?null:nextAction,sourceUrl:safeHttps(result.source.url),publicUrl:null,
        references:ref(...base,["Source route",result.source.id],["Source",result.source.sourceId],["Observation document",result.source.observation?.artifactId])});
    } else if(result.role==="PARSER") {
      if(!Array.isArray(result.records)||!Array.isArray(result.warnings)) {gaps.push(`An older extraction result on ${row.workItemId} lacks readable record counts.`);continue;}
      add({id:`extracted:${row.id}`,stage:"EXTRACTED",at:asTime(row.endedAt),title:`Extraction ${plainCode(result.verdict).toLowerCase()}`,
        says:`${result.actualRowCount} candidate record${result.actualRowCount===1?"":"s"} extracted. Candidate facts still need independent checks.${result.warnings.length?` ${result.warnings.length} warning${result.warnings.length===1?"":"s"} recorded.`:""}`,
        nextAction:result.verdict==="EXTRACTED"?null:nextAction,sourceUrl:null,publicUrl:null,
        references:ref(...base,["Saved document",result.artifactId],["Content hash",result.contentHash],["Original capture attempt",result.acquiredByAttemptId],
          ...result.records.map(record=>["Candidate record",record.id] as const))});
    } else if(result.role==="VALIDATOR"||result.role==="ADVERSARIAL_AUDITOR") {
      const count=result.role==="VALIDATOR"?result.validatedRecordCount:result.survivingRecordCount;
      add({id:`checked:${row.id}`,stage:"CHECKED",at:asTime(row.endedAt),title:`${result.role==="VALIDATOR"?"Independent check":"Adversarial audit"} ${plainCode(result.verdict).toLowerCase()}`,
        says:`${count} candidate record${count===1?"":"s"} ${result.role==="VALIDATOR"?"validated":"survived the audit"}. This is not a publication or public-view check.${findingCodes(result)}`,
        nextAction:result.verdict==="PASS"||result.verdict==="SURVIVED"?null:nextAction,sourceUrl:null,publicUrl:null,
        references:ref(...base,["Producer attempt",result.producerAttemptId],
          ...(result.role==="ADVERSARIAL_AUDITOR"?[["Validator attempt",result.validatorAttemptId] as const]:[]),
          ...((result.role==="VALIDATOR"?result.validatedRecordIds:result.survivingRecordIds)??[]).map(id=>["Checked record",id] as const))});
    }
  }
  for(const item of items) if(item.publicationOutcome) {
    const outcome=item.publicationOutcome;
    add({id:`publication:${item.id}:${outcome.workerResultId}`,stage:"PUBLISHED",at:asTime(outcome.at),
      title:outcome.status==="PUBLISHED"?"Publication accepted":outcome.status==="PARTIALLY_PUBLISHED"?"Some records accepted":"Publication held",
      says:`${outcome.acceptedRecordIds?.length??"An unrecorded number of"} accepted source records. ${outcome.status==="HELD"?"No public result is established by this attempt.":"A public readback is still a separate check."} ${plainText(outcome.code)}.`,
      nextAction:outcome.status==="PUBLISHED"?null:nextAction,sourceUrl:null,publicUrl:null,
      references:ref(["Work item",item.id],["Publisher result",outcome.workerResultId],["Version",outcome.versionId],
        ["Candidate",outcome.candidateId],...(outcome.acceptedRecordIds??[]).map(id=>["Accepted record",id] as const))});
    const observation=latestServedObservation(sources.servedReader,item.id,outcome.workerResultId);
    const current=servedWitness(sources.servedReader&&observation?{...sources.servedReader,witnesses:[observation]}:null,item.id,outcome.workerResultId,sources.nowIso);
    if(observation) {
      const matches=observation.versionId===outcome.versionId&&observation.readerKey===item.autonomousPlan?.publication?.bodyId&&
        observation.state==="CONFIRMED"&&current?.checkedAt===observation.checkedAt;
      add({id:`reader:${item.id}:${observation.checkedAt}`,stage:"READER",at:asTime(observation.checkedAt),
        title:matches&&current?.versionId===outcome.versionId?"Current public result confirmed":"Public readback did not confirm current delivery",
        says:matches&&current?.versionId===outcome.versionId?"The published version was read back through the site's reader projection.":
          `Latest check: ${plainText(observation.reason)}. A current matching public result is not established.`,
        nextAction:matches&&current?.versionId===outcome.versionId?null:nextAction,sourceUrl:null,
        publicUrl:matches&&current?.versionId===outcome.versionId?safeHttps(current.url,true):null,
        references:ref(["Work item",item.id],["Publisher result",outcome.workerResultId],["Reader version",observation.versionId],["Reader key",observation.readerKey],["Response hash",observation.responseSha256])});
    }
  }
  if(sources.servedReader===null) gaps.push("The public reader check was not readable with this work item; publication cannot be called visible here.");
  if(events.some(event=>event.stage==="SAVED"&&!event.privateCopy)) gaps.push("Some saved documents have no eligible private original-copy control here. The source-page link may show a later version.");
  events.sort((a,b)=>(Date.parse(b.at??"")||0)-(Date.parse(a.at??"")||0)||a.id.localeCompare(b.id));
  return {events,gaps};
}
function itemById(items:readonly WorkItem[],id:string):WorkItem|undefined {return items.find(item=>item.id===id);}
