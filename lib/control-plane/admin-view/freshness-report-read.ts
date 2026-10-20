import { DIGEST_LOG_KEY } from "../admin-data.ts";
import { assertAggregateOnly, type FreshnessDetailReference, type FreshnessIncidentSummary } from "../owner-surface.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { RESEARCH_STATE_ID } from "../scheduler/research-policy.ts";

type Repositories = Pick<ControlPlaneRepositories,"ownerDigests">;
interface DigestIdentity {readonly digestId?:string;readonly runtimeOutcome?:{
  readonly kind?:string;readonly cycleId?:string;readonly incidents?:FreshnessDetailReference;
  readonly research?:TextReportMetadata;
}}
const PAGE_ROWS=32;
const logKeyFor=(cycleId:string)=>`freshness-details:${cycleId}:incidents`;

/** The predicate selects only a native reference object, so an older country array never crosses the connection. */
export async function readFreshnessIncidentReference(repos:Repositories,cycleId:string):Promise<FreshnessDetailReference|null>{
  const logKey=logKeyFor(cycleId);
  const [digest]=await repos.ownerDigests.readRecentWhere(DIGEST_LOG_KEY,["runtimeOutcome","incidents","logKey"],logKey,1,
    {digestId:true,runtimeOutcome:["kind","cycleId","incidents"]}) as readonly DigestIdentity[];
  if(!digest)return null;
  const outcome=digest.runtimeOutcome,ref=outcome?.incidents;
  if(digest.digestId!==cycleId||outcome?.kind!=="FRESHNESS_CYCLE"||outcome.cycleId!==cycleId||!ref||
    ref.cycleId!==cycleId||ref.logKey!==logKey||ref.section!=="incidents"||!Number.isSafeInteger(ref.rows)||ref.rows<0||
    !Number.isSafeInteger(ref.pages)||ref.pages<0||(ref.rows===0?ref.pages!==0:ref.pages<1||ref.rows<ref.pages||ref.rows>ref.pages*PAGE_ROWS))
    throw new Error("FRESHNESS_REPORT_REFERENCE_INVALID");
  return ref;
}

export interface FreshnessReportPage {
  readonly cycleId:string;readonly page:number;readonly rows:readonly FreshnessIncidentSummary[];
  readonly total:number;readonly nextPage:number|null;
}
export type FreshnessReportRead={readonly kind:"READ";readonly value:FreshnessReportPage}|
  {readonly kind:"NOT_RECORDED"|"OUT_OF_RANGE";readonly says:string};

/** One exact, pinned cycle and one existing detail partition; no report-wide scan or arbitrary log key. */
export async function readFreshnessReportPage(repos:Repositories,input:{readonly cycleId:string|null;readonly page:number}):Promise<FreshnessReportRead>{
  let cycleId=input.cycleId;
  if(cycleId===null){
    const [digest]=await repos.ownerDigests.readRecentWhere(DIGEST_LOG_KEY,["runtimeOutcome","kind"],"FRESHNESS_CYCLE",1,
      {digestId:true,runtimeOutcome:["kind","cycleId"]}) as readonly DigestIdentity[];
    if(!digest)return{kind:"NOT_RECORDED",says:"No freshness cycle report has been recorded yet."};
    if(typeof digest.digestId!=="string"||digest.runtimeOutcome?.kind!=="FRESHNESS_CYCLE"||digest.runtimeOutcome.cycleId!==digest.digestId)
      throw new Error("FRESHNESS_REPORT_CYCLE_INVALID");
    cycleId=digest.digestId;
  }
  const ref=await readFreshnessIncidentReference(repos,cycleId);
  if(!ref)return{kind:"NOT_RECORDED",says:"This cycle has no partitioned incident report recorded."};
  if(input.page>=Math.max(ref.pages,1))return{kind:"OUT_OF_RANGE",says:"That page is outside this cycle's incident report."};
  if(ref.rows===0)return{kind:"READ",value:{cycleId,page:input.page,rows:[],total:0,nextPage:null}};
  const key=`${ref.logKey}:${input.page}`;
  const [record]=await repos.ownerDigests.readRecent(key,1),details=record?.freshnessDetails;
  if(record?.digestId!==key||!details||details.cycleId!==cycleId||details.section!=="incidents"||details.page!==input.page||
    !Array.isArray(details.rows)||details.rows.length<1||details.rows.length>PAGE_ROWS)
    throw new Error("FRESHNESS_REPORT_PAGE_INVALID");
  const rows=details.rows as readonly FreshnessIncidentSummary[];
  for(const row of rows)if(typeof row?.cause!=="string"||typeof row.target!=="string"||!Number.isFinite(row.obligationsAffected)||row.obligationsAffected<0)
    throw new Error("FRESHNESS_REPORT_INCIDENT_INVALID");
  assertAggregateOnly(rows,"freshness incident report");
  return{kind:"READ",value:{cycleId,page:input.page,rows,total:ref.rows,nextPage:input.page+1<ref.pages?input.page+1:null}};
}

export type FreshnessTextSection="runtimeConditions"|"lines";
interface TextReportMetadata {
  readonly runtimeConditionCount?:number;
  readonly runtimeConditionDetails?:FreshnessDetailReference;
  readonly runtimeConditionDetailsUnavailable?:string|null;
  readonly cycleLogLineCount?:number;
  readonly cycleLogDetails?:FreshnessDetailReference;
}
export type FreshnessTextReportRead={readonly kind:"READ";readonly value:{
  readonly cycleId:string;readonly section:FreshnessTextSection;readonly page:number;readonly rows:readonly string[];
  readonly total:number;readonly recorded:number;readonly nextPage:number|null;readonly unavailable:string|null;
}}|{readonly kind:"NOT_RECORDED"|"OUT_OF_RANGE"|"UNAVAILABLE";readonly says:string};

/** Only reference metadata is selected from a cycle. In-flight conditions use
 * the same narrow projection; legacy country arrays are never decoded. */
export async function readFreshnessTextReportPage(repos:Pick<ControlPlaneRepositories,"ownerDigests"|"researchState">,
  input:{readonly cycleId:string|null;readonly page:number;readonly section:FreshnessTextSection}):Promise<FreshnessTextReportRead>{
  const [digest]=await repos.ownerDigests.readRecentWhere(DIGEST_LOG_KEY,
    input.cycleId===null?["runtimeOutcome","kind"]:["runtimeOutcome","cycleId"],input.cycleId??"FRESHNESS_CYCLE",1,
    {digestId:true,runtimeOutcome:{kind:true,cycleId:true,research:["runtimeConditionCount","runtimeConditionDetails",
      "runtimeConditionDetailsUnavailable","cycleLogLineCount","cycleLogDetails"]}}) as readonly DigestIdentity[];
  const outcome=digest?.runtimeOutcome as {kind?:string;cycleId?:string;research?:TextReportMetadata}|undefined;
  let cycleId=input.cycleId,metadata:TextReportMetadata|undefined;
  if(outcome?.kind==="FRESHNESS_CYCLE"){
    if(typeof outcome.cycleId!=="string"||digest?.digestId!==outcome.cycleId||cycleId!==null&&cycleId!==outcome.cycleId)
      throw new Error("FRESHNESS_REPORT_CYCLE_INVALID");
    cycleId=outcome.cycleId;metadata=outcome.research;
  }else if(input.section==="runtimeConditions"&&cycleId!==null){
    const current=await repos.researchState.readNarrowed(RESEARCH_STATE_ID,
      {host:true,cycleStartedAt:true,runtimeConditionCount:true,runtimeConditionDetails:true,runtimeConditionDetailsUnavailable:true});
    const state=current?.value as TextReportMetadata&{host?:string;cycleStartedAt?:string}|undefined;
    if(state&&`freshness-cycle:${state.host}:${state.cycleStartedAt}`===cycleId)metadata=state;
  }
  const ref=input.section==="runtimeConditions"?metadata?.runtimeConditionDetails:metadata?.cycleLogDetails;
  if(cycleId===null||!ref)return{kind:"NOT_RECORDED",says:"This cycle has no partitioned report for that section recorded."};
  if(ref.cycleId!==cycleId||ref.section!==input.section||ref.logKey!==`freshness-details:${cycleId}:${input.section}`||
    !Number.isSafeInteger(ref.rows)||ref.rows<0||!Number.isSafeInteger(ref.pages)||ref.pages<0||
    (ref.rows===0?ref.pages!==0:ref.pages<1||ref.rows<ref.pages||ref.rows>ref.pages*PAGE_ROWS))
    throw new Error("FRESHNESS_REPORT_REFERENCE_INVALID");
  const total=(input.section==="runtimeConditions"?metadata?.runtimeConditionCount:metadata?.cycleLogLineCount)??ref.rows;
  if(!Number.isSafeInteger(total)||total<ref.rows)throw new Error("FRESHNESS_REPORT_COUNT_INVALID");
  const unavailable=total>ref.rows?metadata?.runtimeConditionDetailsUnavailable??"Additional details have not been saved to this report. Their contents are unknown here.":null;
  if(total>0&&ref.rows===0)return{kind:"UNAVAILABLE",says:unavailable!};
  if(!Number.isSafeInteger(input.page)||input.page<0||input.page>=Math.max(ref.pages,1))
    return{kind:"OUT_OF_RANGE",says:"That page is outside this cycle's recorded report."};
  let rows:readonly string[]=[];
  if(ref.rows>0){
    const key=`${ref.logKey}:${input.page}`,[record]=await repos.ownerDigests.readRecent(key,1),details=record?.freshnessDetails;
    if(record?.digestId!==key||!details||details.cycleId!==cycleId||details.section!==input.section||details.page!==input.page||
      !Array.isArray(details.rows)||details.rows.length<1||details.rows.length>PAGE_ROWS||details.rows.some(row=>typeof row!=="string"))
      throw new Error("FRESHNESS_REPORT_PAGE_INVALID");
    rows=details.rows as readonly string[];
    assertAggregateOnly(rows,"freshness text report");
  }
  return{kind:"READ",value:{cycleId,section:input.section,page:input.page,rows,total,recorded:ref.rows,
    nextPage:input.page+1<ref.pages?input.page+1:null,unavailable}};
}
