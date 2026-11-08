import {createHash} from "node:crypto";
import type {EvidenceStore} from "../control-plane/evidence/store.ts";
import type {FactDb,Query} from "../facts/publish.ts";
import {acquireCampaignFinanceResource} from "./state-acquisition.ts";
import {CAMPAIGN_FINANCE_PARSER,type CampaignFinanceResource} from "./state-sources.ts";
import {rebuildCampaignCycles} from "./state-cycles.ts";
import type {ReaderCachePurger} from "../reader/cache.ts";
import {CAMPAIGN_PEOPLE_SQL,readCampaignMoneyPeople,type CampaignMoneyPerson} from "./state-people.ts";
import {survivingIds} from "../core/ids.ts";
import {recordFactConfirmation} from "../facts/confirmation.ts";

const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export const campaignResourceCursor=(state:string,id:string)=>`campaign-money:resource:${state}:${hash(id)}`;
export interface CampaignResourceInput {readonly publicationId:string;readonly dependencyHash:string}
export interface CampaignResourceCheck {readonly resourceId:string;readonly rawHash:string;readonly rawHashes:readonly string[];readonly checkedAt:string}
export const campaignResourceContentHash=(resource:CampaignFinanceResource,rawHashes:readonly string[])=>
  hash(`${CAMPAIGN_FINANCE_PARSER}:${JSON.stringify(resource)}:${[...new Set(rawHashes)].sort().join("\n")}`);
export const campaignStateSourceHash=(state:string,descriptorHash:string,dependencyHash:string,resources:ReadonlyMap<string,string>)=>
  hash(JSON.stringify({state,parser:CAMPAIGN_FINANCE_PARSER,descriptorHash,dependencyHash,resources:[...resources].sort(([a],[b])=>a.localeCompare(b))}));

/** Native roster hashes and the actual body/place/person bindings are source inputs.
 * Resolve the same division choices as CAMPAIGN_PEOPLE_SQL; unrelated places created
 * while filing money cannot change this digest. No financial output enters the clock. */
const campaignDependencySql=`WITH RECURSIVE state_place AS MATERIALIZED (
    SELECT id AS division FROM entity WHERE kind='place' AND state=$2
      AND id ~ '^ocd-division/country:us/(state|district|territory):[^/]+$' ORDER BY id LIMIT 1
  ), body_parents(body_id,id,depth) AS (
    SELECT id,id,0 FROM entity WHERE kind='body' AND state=$2
    UNION ALL SELECT p.body_id,e.parent_id,p.depth+1 FROM body_parents p JOIN entity e ON e.id=p.id
      WHERE e.parent_id IS NOT NULL AND p.depth<8
  ), body_places AS MATERIALIZED (
    SELECT DISTINCT ON(body_id) body_id,division FROM (
      SELECT p.body_id,p.depth,ep.place_id AS division FROM body_parents p JOIN entity_place ep ON ep.entity_id=p.id
      UNION ALL SELECT p.body_id,p.depth,e.id FROM body_parents p JOIN entity e ON e.id=p.id WHERE e.kind='place'
    ) places WHERE division LIKE 'ocd-division/%' ORDER BY body_id,depth,division
  ), binding_bodies AS (
    SELECT DISTINCT 'registry' AS origin,r.body_id FROM civic_data_rows r JOIN civic_data_promotions p
      ON p.key=r.promotion_key AND p.current_version_id=r.version_id
      WHERE p.record_class='REGISTRY_RUNTIME_BINDING' AND (p.scope=$1 OR p.scope LIKE $1||':%')
        AND r.collection='bodyRosters' AND r.body_id IS NOT NULL
        AND EXISTS(SELECT 1 FROM reader_payload_members(reader_payload_node(r.value)->'members'))
    UNION SELECT 'fact',e.id FROM entity e JOIN fact f ON f.entity_id=e.id
      JOIN entity person ON person.id=substr(f.field,8) JOIN source_copy s ON s.id=f.source_copy_id
      WHERE e.state=$2 AND e.kind='body' AND f.field LIKE 'member:%' AND f.status='live' AND s.url IS NOT NULL
  ), dependencies AS (
    SELECT jsonb_build_array('promotion',p.record_class,p.scope,c.parser_version,c.raw_hash,c.normalized_hash) AS value
      FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id
      WHERE (p.scope=$1 OR p.scope LIKE $1||':%') AND (p.record_class IN ('STATE_LEGISLATOR','FEDERAL_DIRECTORY','REGISTRY_RUNTIME_BINDING','BALLOT_CANDIDACY','STATE_CAMPAIGN_FINANCE')
        OR p.record_class='CURATED_READER_RECORD' AND p.scope=$1||':campaign-finance')
    UNION ALL SELECT jsonb_build_array('body-place',b.origin,b.body_id,
      coalesce((SELECT division FROM body_places WHERE body_id=b.body_id),
        CASE WHEN b.origin='registry' AND b.body_id LIKE 'ocd-division/%' THEN split_part(b.body_id,'#',1) END,
        (SELECT division FROM state_place))) FROM binding_bodies b
    UNION ALL SELECT jsonb_build_array('member',f.entity_id,f.field,f.value,p.name,s.url,
      (SELECT value FROM entity_external_id WHERE entity_id=p.id AND scheme='roster-member' LIMIT 1)) FROM entity e JOIN fact f ON f.entity_id=e.id
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
  const held=await readCampaignMoneyPeople(async(text,params)=>{
    if(text!==CAMPAIGN_PEOPLE_SQL)throw new Error("Campaign people snapshot requested an unrelated query");
    const rows=await query(`WITH people AS MATERIALIZED (${text}),inputs AS (${campaignDependencySql})
      SELECT people.*,inputs.hash AS dependency_hash FROM inputs LEFT JOIN people ON true`,params);
    snapshot.dependencyHash=dependencyDigest(rows[0]?.dependency_hash);
    return rows.filter(row=>typeof row.id==="string");
  },state);
  if(!snapshot.dependencyHash)throw new Error("Campaign people snapshot has no source inputs");
  // A person merged into another is that other person: the money files under the survivor, and the old id stays one of its aliases.
  const survivors=await survivingIds(query,held.map(person=>person.id));
  const people=new Map<string,CampaignMoneyPerson>();
  for(const person of held){
    const id=survivors.get(person.id)??person.id,{aliases:_,...row}=person,key=JSON.stringify({...row,id}),seen=people.get(key);
    const aliases=[...new Set([...seen?.aliases??[],...person.aliases??[],...id===person.id?[]:[person.id]])].filter(alias=>alias!==id);
    people.set(key,seen?{...seen,aliases}:id===person.id?person:{...person,id,aliases});
  }
  return {people:[...people.values()],dependencyHash:snapshot.dependencyHash};
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
  readonly vault:EvidenceStore;readonly directory:string;readonly runId:string;readonly now:()=>string;readonly fetch?:typeof fetch;readonly signal?:AbortSignal;readonly releaseEveryMs?:number;readonly heldOnly?:boolean;
}):Promise<CampaignResourceCheck|null> {
  const checks:{rawHash:string;checkedAt:string}[]=[];let complete=false;
  for await(const page of acquireCampaignFinanceResource(state,resource,{...options,signal:options.signal??new AbortController().signal,probeOnly:true,
    ...(input?.dependencyHash===dependencyHash?{acceptedPublicationId:input.publicationId}:{}),
    releaseEveryMs:options.releaseEveryMs??24*60*60_000})){
    if(!page.unchanged)return null;
    checks.push(...page.checkedSources??[]);complete=page.complete;
  }
  if(!complete||!checks.length)return null;
  const rawHashes=[...new Set(checks.map(check=>check.rawHash))];
  return {resourceId:resource.id,rawHash:campaignResourceContentHash(resource,rawHashes),rawHashes,checkedAt:checks.map(check=>check.checkedAt).sort()[0]};
}

/** Exact source bytes refresh only the financial facts they support. Cycle dates remain the oldest contributing check. */
export async function confirmCampaignResourceChecks(db:FactDb&{readonly query:Query},state:string,checks:readonly CampaignResourceCheck[],purge?:ReaderCachePurger):Promise<void> {
  const people=new Set<string>();
  for(const check of checks){
    const rows=await db.transaction(async query=>{
      const rows=await query(`SELECT s.id,e.parent_id,array_agg(f.id) AS ids FROM checked_fact f JOIN source_copy s ON f.source_copy_id=s.id JOIN entity e ON f.entity_id=e.id WHERE e.state=$1 AND f.field LIKE 'campaign-money:%' AND f.status='live' AND f.provenance_kind<>'OWNER'
      AND f.value->>'resource'=$2 AND s.sha256=ANY($3::text[]) AND f.checked_at<$4::timestamptz
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f.value->'amounts') a(amount)
        WHERE amount?'provenance' AND NOT $3::text[] @> ARRAY[amount#>>'{provenance,rawHash}']) GROUP BY s.id,e.parent_id`,
      [state,check.resourceId,check.rawHashes,check.checkedAt]);
      for(const row of rows)await recordFactConfirmation(query,{copyId:Number(row.id),scope:`campaign-source:${state}`,at:check.checkedAt,factIds:(row.ids as number[]).map(Number)});
      return rows;
    });
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

/** A complete exact-byte check resolves only failed work for the same identity inputs.
 * Failure metadata is saved only for an exact person/seat already found by the ordinary
 * held-cycle query. Settlement uses that existing work, without reading people or facts. */
export async function settleCampaignSourceFailures(query:Query,state:string,dependencyHash:string,checkedAt:string):Promise<void> {
  await query(`WITH eligible AS MATERIALIZED (
      SELECT c.name,c.position::jsonb AS saved FROM pass_cursor c
      WHERE c.name LIKE $1 AND c.position::jsonb#>>'{sourceFailure,dependencyHash}'=$2
        AND $3::timestamptz>(c.position::jsonb#>>'{sourceFailure,failedAt}')::timestamptz
    ), recovered AS (
      UPDATE pass_cursor c SET position=((eligible.saved-'sourceFailure')||jsonb_build_object('checkedAt',$3::text,'found',true))::text
      FROM eligible WHERE c.name=eligible.name AND c.position::jsonb=eligible.saved
      RETURNING eligible.saved#>>'{sourceFailure,personId}' AS person_id,
        eligible.saved#>>'{sourceFailure,seat}' AS seat,eligible.saved#>>'{sourceFailure,reason}' AS reason
    ) DELETE FROM blank b USING recovered r WHERE b.entity_id=r.person_id AND b.field='campaign-money:'||r.seat
      AND b.stage='ACQUIRE' AND b.reason='MONEY_NOT_YET_JOINED' AND b.detail=r.reason`,
    [`campaign-money:person:${state}:%`,dependencyHash,checkedAt]);
}
