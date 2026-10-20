import { DIGEST_LOG_KEY } from "../admin-data.ts";
import { assertAggregateOnly, type FreshnessDetailReference, type FreshnessIncidentSummary } from "../owner-surface.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";

type Repositories = Pick<ControlPlaneRepositories,"ownerDigests">;
interface DigestIdentity {readonly digestId?:string;readonly runtimeOutcome?:{
  readonly kind?:string;readonly cycleId?:string;readonly incidents?:FreshnessDetailReference;
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
