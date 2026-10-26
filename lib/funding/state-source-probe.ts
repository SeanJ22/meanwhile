import {createHash} from "node:crypto";
import type {EvidenceStore} from "../control-plane/evidence/store.ts";
import type {FactDb,Query} from "../facts/publish.ts";
import {acquireCampaignFinanceResource} from "./state-acquisition.ts";
import {CAMPAIGN_FINANCE_PARSER,type CampaignFinanceResource} from "./state-sources.ts";
import {rebuildCampaignCycles} from "./state-cycles.ts";
import type {ReaderCachePurger} from "../reader/cache.ts";
import {CAMPAIGN_PEOPLE_SQL,readCampaignMoneyPeople} from "./state-people.ts";

const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export const campaignResourceCursor=(state:string,id:string)=>`campaign-money:resource:${state}:${hash(id)}`;
export interface CampaignResourceInput {readonly publicationId:string;readonly dependencyHash:string}
export interface CampaignResourceCheck {readonly resourceId:string;readonly rawHashes:readonly string[];readonly checkedAt:string}

/** Native roster hashes and body bindings are source inputs; financial outputs never feed their own change clock. */
const campaignDependencySql=`WITH dependencies AS (
    SELECT jsonb_build_array('promotion',p.record_class,p.scope,c.parser_version,c.raw_hash,c.normalized_hash) AS value
      FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id
      WHERE (p.scope=$1 OR p.scope LIKE $1||':%') AND p.record_class IN ('STATE_LEGISLATOR','FEDERAL_DIRECTORY','REGISTRY_RUNTIME_BINDING','BALLOT_CANDIDACY')
    UNION ALL SELECT jsonb_build_array('body',e.id,e.parent_id,e.name) FROM entity e WHERE e.state=$2 AND e.kind IN ('body','place')
    UNION ALL SELECT jsonb_build_array('body-place',ep.entity_id,ep.place_id) FROM entity_place ep JOIN entity e ON e.id=ep.entity_id WHERE e.state=$2 AND e.kind='body'
    UNION ALL SELECT jsonb_build_array('member',f.entity_id,f.field,f.value,p.name,s.url) FROM entity e JOIN fact f ON f.entity_id=e.id
      LEFT JOIN entity p ON p.id=substr(f.field,8) LEFT JOIN source_copy s ON s.id=f.source_copy_id
      WHERE e.state=$2 AND e.kind='body' AND f.field LIKE 'member:%' AND f.status='live'
  ) SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') AS hash FROM dependencies`;
const dependencyDigest=(value:unknown):string=>{
  if(typeof value!=="string"||!/^[a-f0-9]{64}$/.test(value))throw new Error("Campaign source identity inputs are unavailable");
  return hash(`${CAMPAIGN_FINANCE_PARSER}:${value}`);
};
export async function campaignMoneyDependencyHash(query:Query,state:string):Promise<string> {
  const [row]=await query(campaignDependencySql,[`US-${state}`,state]);
  if(typeof row?.hash!=="string"||!/^[a-f0-9]{64}$/.test(row.hash))throw new Error("Campaign source identity inputs are unavailable");
  return dependencyDigest(row.hash);
}

/** The changed-source pass binds its actual people to the same database snapshot as its dependency hash. */
export async function readCampaignMoneyInputs(query:Query,state:string) {
  const snapshot:{dependencyHash:string|null}={dependencyHash:null};
  const people=await readCampaignMoneyPeople(async(text,params)=>{
    if(text!==CAMPAIGN_PEOPLE_SQL)throw new Error("Campaign people snapshot requested an unrelated query");
    const rows=await query(`WITH people AS MATERIALIZED (${text}),inputs AS (${campaignDependencySql})
      SELECT people.*,inputs.hash AS dependency_hash FROM inputs LEFT JOIN people ON true`,params);
    snapshot.dependencyHash=dependencyDigest(rows[0]?.dependency_hash);
    return rows.filter(row=>typeof row.id==="string");
  },state);
  if(!snapshot.dependencyHash)throw new Error("Campaign people snapshot has no source inputs");
  return {people,dependencyHash:snapshot.dependencyHash};
}

/** Read the existing source cursors, without campaign facts or the published people list. */
export async function campaignResourceInputs(query:Query,state:string):Promise<ReadonlyMap<string,CampaignResourceInput>> {
  const rows=await query("SELECT name,position FROM pass_cursor WHERE name LIKE $1",[`campaign-money:resource:${state}:%`]);
  const result=new Map<string,CampaignResourceInput>();
  for(const row of rows){try{const input=JSON.parse(String(row.position)) as CampaignResourceInput;
    if(typeof input.publicationId==="string"&&typeof input.dependencyHash==="string")result.set(String(row.name),input);}catch{/* Incomplete source progress is read normally. */}}
  return result;
}

export async function probeCampaignResource(state:string,resource:CampaignFinanceResource,input:CampaignResourceInput|undefined,dependencyHash:string,options:{
  readonly vault:EvidenceStore;readonly directory:string;readonly runId:string;readonly now:()=>string;readonly fetch?:typeof fetch;
}):Promise<CampaignResourceCheck|null> {
  const checks:{rawHash:string;checkedAt:string}[]=[];let complete=false;
  for await(const page of acquireCampaignFinanceResource(state,resource,{...options,signal:new AbortController().signal,probeOnly:true,
    ...(input?.dependencyHash===dependencyHash?{acceptedPublicationId:input.publicationId}:{}),
    releaseEveryMs:resource.kind==="SOCRATA"?60*60_000:24*60*60_000})){
    if(!page.unchanged)return null;
    checks.push(...page.checkedSources??[]);complete=page.complete;
  }
  if(!complete||!checks.length)return null;
  return {resourceId:resource.id,rawHashes:[...new Set(checks.map(check=>check.rawHash))],checkedAt:checks.map(check=>check.checkedAt).sort()[0]};
}

/** Exact source bytes refresh only the financial facts they support. Cycle dates remain the oldest contributing check. */
export async function confirmCampaignResourceChecks(db:FactDb&{readonly query:Query},state:string,checks:readonly CampaignResourceCheck[],purge?:ReaderCachePurger):Promise<void> {
  const people=new Set<string>();
  for(const check of checks){
    const rows=await db.query(`UPDATE fact f SET checked_at=$4 FROM source_copy s,entity e WHERE f.source_copy_id=s.id AND f.entity_id=e.id
      AND e.state=$1 AND f.field LIKE 'campaign-money:%' AND f.status='live' AND f.provenance_kind<>'OWNER'
      AND f.value->>'resource'=$2 AND s.sha256=ANY($3::text[]) AND f.checked_at<$4::timestamptz RETURNING e.parent_id`,
      [state,check.resourceId,check.rawHashes,check.checkedAt]);
    for(const row of rows)if(typeof row.parent_id==="string")people.add(row.parent_id);
    const missing=await db.query(`SELECT DISTINCT e.parent_id FROM entity e JOIN fact f ON f.entity_id=e.id JOIN source_copy s ON s.id=f.source_copy_id
      WHERE e.state=$1 AND e.parent_id IS NOT NULL AND f.field LIKE 'campaign-money:%' AND f.status='live'
        AND f.value->>'resource'=$2 AND s.sha256=ANY($3::text[]) AND jsonb_array_length(f.value->'amounts')>0
        AND NOT EXISTS(SELECT 1 FROM fact cycle WHERE cycle.entity_id=e.parent_id AND cycle.status='live'
          AND cycle.field='campaign-cycle:'||e.id||':'||(f.value->>'cycle'))`,[state,check.resourceId,check.rawHashes]);
    for(const row of missing)if(typeof row.parent_id==="string")people.add(row.parent_id);
  }
  const ids=[...people];const at=checks.map(check=>check.checkedAt).sort()[0];
  for(let start=0;start<ids.length;start+=500)await rebuildCampaignCycles(db,state,ids.slice(start,start+500),at,purge);
}
