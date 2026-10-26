import { createHash } from "node:crypto";
import { sourceContentHash, confirmSourceHashUnchanged, type SourceHashConfirmation } from "../civic-data/source-hash.ts";
import type { RoutineDataStore, SourceHead } from "../civic-data/store.ts";
import type { CivicDataReadStore } from "../civic-data/read-model.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { runtimeCivicReadCache, type CivicReadCache } from "../db/civic-read-cache.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { readPublishedSourceChecks } from "../civic-data/source-checks.ts";
import type { SourceAcquisitionEvidence } from "../sources/acquisition-trace.ts";
import { runStamp, stampFromRead } from "../ops/freshness.ts";
import type { OutcomeSnapshot } from "./types.ts";

export interface OutcomeSourceRequest extends SourceAcquisitionEvidence {
  readonly meetingId: string | null;
  readonly checkedAt: string;
}
export interface OutcomeSourcePlan {
  readonly formatVersion: 1;
  readonly context: string;
  readonly complete: boolean;
  /** Changed endpoints still waiting for their sitting's independent publication. */
  readonly pendingMeetingIds?: readonly string[];
  readonly requests: readonly OutcomeSourceRequest[];
}
export const outcomeSourcePlanHash = (plan: OutcomeSourcePlan): string => sourceContentHash(plan.requests.map(request =>
  ({requestedUrl:request.requestedUrl,finalUrl:request.finalUrl,capture:{rawHash:request.rawHash}})),{context:plan.context});
const pageKey=(url:string,rawHash:string)=>`outcome-page:${createHash("sha256").update(JSON.stringify([url,rawHash])).digest("hex")}`;

/** A cutoff saves only completed source checks. The next pass does not fetch those sources again inside their check window. */
export async function probeOutcomeSourcePlan(input: {
  readonly store: RoutineDataStore; readonly head: SourceHead; readonly plan: OutcomeSourcePlan;
  readonly context: string; readonly fresh: readonly OutcomeSourceRequest[]; readonly now: () => string;
  readonly signal: AbortSignal; readonly maxAgeMs: number;
  readonly cache?: CivicReadCache;
  readonly acquire: (request: OutcomeSourceRequest) => Promise<SourceAcquisitionEvidence>;
}): Promise<{readonly confirmed:SourceHashConfirmation|null;readonly changedMeetings:ReadonlySet<string>;readonly requests:readonly OutcomeSourceRequest[]}> {
  const changedMeetings=new Set<string>();
  if(!input.plan.complete||input.plan.context!==input.context||input.head.rawHashBasis!=="SOURCE_CONTENT_V1")return{confirmed:null,changedMeetings,requests:[]};
  const cache=(input.cache??runtimeCivicReadCache()).jobState(),key=input.head.scope;
  const context=JSON.stringify([input.head.versionId,input.context]);
  const saved=await cache.readCheckpoint<{context:string;requests:OutcomeSourceRequest[]}>("outcome-source-checks",key);
  const prior=new Map((saved?.context===context?saved.requests:[]).map(request=>[request.requestedUrl,request]));
  const fresh=new Map(input.fresh.map(request=>[request.requestedUrl,request]));
  const requests:OutcomeSourceRequest[]=[];
  for(const request of input.plan.requests){
    input.signal.throwIfAborted();
    let checked=fresh.get(request.requestedUrl);
    const remembered=prior.get(request.requestedUrl);
    if(!checked&&remembered&&Date.parse(remembered.checkedAt)>Date.parse(input.now())-input.maxAgeMs)checked=remembered;
    if(!checked){const acquired=await input.acquire(request);checked={...acquired,meetingId:request.meetingId,checkedAt:input.now()};}
    if(checked.httpStatus!==200||checked.byteCount<=0)return{confirmed:null,changedMeetings,requests};
    requests.push(checked);
    await cache.checkpoint("outcome-source-checks",key,{context,requests},context);
    if(checked.rawHash!==request.rawHash&&request.meetingId)changedMeetings.add(request.meetingId);
  }
  const plan:OutcomeSourcePlan={...input.plan,requests},rawHash=outcomeSourcePlanHash(plan);
  const first=requests[0],oldest=requests.map(request=>request.checkedAt).sort()[0];
  if(!first||rawHash!==input.head.rawHash)return{confirmed:null,changedMeetings,requests};
  const confirmed=await confirmSourceHashUnchanged({store:input.store,sourceId:input.head.sourceId,recordClass:input.head.recordClass,
    scope:input.head.scope,parserVersion:input.head.parserVersion,rawHash,now:input.now(),complete:true,
    retrieval:{requestedUrl:first.requestedUrl,finalUrl:first.finalUrl,httpStatus:first.httpStatus,rawHash,retrievedAt:oldest,
      sourceCheck:{requestedUrl:first.requestedUrl,finalUrl:first.finalUrl,httpStatus:200,rawHash:first.rawHash,checkedAt:oldest}}});
  if(confirmed)await recordOutcomeSourceChecks(input.store,confirmed.head,plan);
  return{confirmed,changedMeetings,requests};
}

export async function recordOutcomeSourceChecks(store:RoutineDataStore,head:SourceHead,plan:OutcomeSourcePlan):Promise<void>{
  if(!store.recordSourceCheck||!head.rawHash)return;
  for(const request of plan.requests){
    if(request.byteCount<=0||request.httpStatus<200||request.httpStatus>=300)continue;
    await store.recordSourceCheck({sourceId:head.sourceId,recordClass:head.recordClass,scope:head.scope,pointerVersionId:head.versionId,
      sourceHash:head.rawHash,sourceKey:pageKey(request.finalUrl,request.rawHash),rawHash:request.rawHash,parserVersion:head.parserVersion,
      checkedAt:request.checkedAt,sourceUrls:[...new Set([request.requestedUrl,request.finalUrl])],jurisdictionIds:[head.scope]});
  }
}

/** Every outcome field keeps the exact body hash and byte count of its own endpoint. */
export function bindOutcomeSourceHashes(snapshot:OutcomeSnapshot,requests:readonly OutcomeSourceRequest[]):OutcomeSnapshot{
  const endpoint=(url:string)=>{const parsed=new URL(url);return parsed.origin+parsed.pathname;};
  return{...snapshot,sittings:snapshot.sittings.map(sitting=>({...sitting,...Object.fromEntries((["agenda","outcomes","rollCalls"] as const).map(field=>
    [field,sitting[field].map(record=>{const pages=requests.filter(request=>endpoint(request.finalUrl)===record.provenance.endpoint);
      return pages.length?{...record,provenance:{...record.provenance,
        rawHash:sourceContentHash(pages.map(page=>({...page,capture:{rawHash:page.rawHash}}))),
        byteCount:pages.reduce((sum,page)=>sum+page.byteCount,0),
        sourcePages:pages.map(page=>({url:page.finalUrl,rawHash:page.rawHash,byteCount:page.byteCount}))}}:record;})]))}))};
}

/** A source check can refresh only a field carried by the same endpoint and exact unchanged bytes. */
export async function withOutcomeSourceChecks(snapshot:OutcomeSnapshot,scope:string,options:{
  readonly store?: CivicDataReadStore | Pick<RoutineDataStore,"readSourceChecks">;
  readonly query?: ReadOnlyQuery | null;
}={}):Promise<OutcomeSnapshot>{
  const keys=new Set(snapshot.sittings.flatMap(sitting=>[...sitting.agenda,...sitting.outcomes,...sitting.rollCalls].flatMap(record=>
    record.provenance.sourcePages?.map(page=>pageKey(page.url,page.rawHash))??[])));
  if(!keys.size)return snapshot;
  const checkStore=options.store as Pick<RoutineDataStore,"readSourceChecks">|undefined;
  const query=options.store?null:options.query===undefined?readerQuery():options.query;
  const rows=await(checkStore?.readSourceChecks?checkStore.readSourceChecks("MEETING_OUTCOME",scope,[...keys]):query?
    readPublishedSourceChecks(async(text,params)=>(await query([{text,params}]))[0]??[],"MEETING_OUTCOME",scope,[...keys]):Promise.resolve([])).catch(()=>[]);
  const checks=new Map(rows.map(row=>[row.sourceKey,row]));
  return{...snapshot,sittings:snapshot.sittings.map(sitting=>({...sitting,...Object.fromEntries((["agenda","outcomes","rollCalls"] as const).map(field=>
    [field,sitting[field].map(record=>{const source=record.provenance,pages=source.sourcePages??[];
      const checked=pages.map(page=>checks.get(pageKey(page.url,page.rawHash)));
      const oldest=checked.length&&checked.every(check=>check!==undefined)?checked.map(check=>check!.checkedAt).sort()[0]:null;
      const day=oldest?runStamp(new Date(oldest)):null;
      return day&&source.byteCount&&(source.readOn==="UNKNOWN"||String(day)>String(source.readOn))?{...record,provenance:{...source,
        readOn:stampFromRead({source:source.endpoint,ok:true,bytes:source.byteCount,on:day})}}:record;})]))}))};
}
