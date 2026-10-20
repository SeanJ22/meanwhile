import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { temporaryPath } from "../civic-data/temporary-path.ts";
import { sourceAcquisitionFailure,isSourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { canonicalJson } from "../control-plane/repository/types.ts";
import { pageDoorDraft } from "../doors/page-doors.ts";
import { rawCaptureVault } from "../civic-data/raw-capture-remote.ts";
import { upsertDerivedDoor,type DoorRepository } from "../doors/registry.ts";
import { recordDoorOutcome } from "../doors/outcome.ts";
import { recordDoorEvidence,evidenceFromFailureCode } from "../doors/shut.ts";
import { prepareProductionCivicDataWrite } from "../civic-data/production-write.ts";
import { type SourceCheckEvidence } from "../civic-data/types.ts";
import { readerFactDb } from "../facts/db.ts";
import { type FactDb, type Query } from "../facts/publish.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { invalidateReaderCache,type ReaderCachePurger } from "../reader/cache.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { acquireCampaignFinanceResource } from "./state-acquisition.ts";
import { bindCampaignMoney,campaignMoneyPeopleIndex,campaignMoneyWork,campaignPersonKey,campaignRecordYear, readCampaignMoneyPeople, campaignName, campaignOffice, type CampaignMoneyPerson } from "./state-people.ts";
import { fileCampaignMoneyFacts, readCampaignPredecessors } from "./state-facts.ts";
import { campaignFinanceResources } from "./state-resource-index.ts";
import {rebuildCampaignCycles,replaceCycles} from "./state-cycles.ts";
import { filedOrganizations } from "./state-money-funding.ts";
import type { StateMoneyRecord } from "./state-money.ts";
import type { CampaignSourceRecord } from "./state-source-records.ts";
import { US_JURISDICTIONS } from "../coverage/states.ts";
import { campaignMoneySourceResources, campaignFinanceSource, campaignFinanceNativeScope, type CampaignFinanceResource, type CampaignFinanceWorkCheck } from "./state-sources.ts";

type AcquisitionOptions=Parameters<typeof acquireCampaignFinanceResource>[2];
interface ResourceOptions extends AcquisitionOptions {
  readonly people:readonly CampaignMoneyPerson[];
  readonly publishedPeople?:readonly CampaignMoneyPerson[];
  readonly countUnmatched?:boolean;
  readonly facts:FactDb&{readonly query:Query};
  readonly purge?:ReaderCachePurger;
  readonly onPublished?:(value:{readonly state:string;readonly records:number;readonly people:readonly string[]})=>Promise<void>|void;
}
async function publishCampaignFinanceResource(state:string,resource:CampaignFinanceResource,options:ResourceOptions){
  if(!resource.cycle?.length || !resource.office.length || !resource.candidate.length && !resource.candidateParts?.length)throw sourceAcquisitionFailure(
    "PUBLISHER_DOCUMENT_INVALID","The extract's committee, candidate, office and election-cycle links remain open work.");
  let records=0,unjoined=0,complete=false,check:SourceCheckEvidence|null=null;
  const people=campaignMoneyPeopleIndex(options.people);
  const published=options.publishedPeople?campaignMoneyPeopleIndex(options.publishedPeople):people;
  const reasons:Record<string,number>={};
  await mkdir(temporaryPath(options.directory),{recursive:true});
  const temporary=await mkdtemp(temporaryPath(join(options.directory,"campaign-identities-")));
  const counts=new DatabaseSync(join(temporary,"occurrences.db"));
  counts.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-1024; PRAGMA mmap_size=0; CREATE TABLE occurrence(id TEXT PRIMARY KEY,n INTEGER NOT NULL); CREATE TABLE touched(id TEXT PRIMARY KEY); CREATE TABLE active(id TEXT PRIMARY KEY)");
  const occurrence=counts.prepare("INSERT INTO occurrence VALUES (?,0) ON CONFLICT(id) DO UPDATE SET n=n+1 RETURNING n");
  const touched=counts.prepare("INSERT OR IGNORE INTO touched VALUES (?)");
  const seen=counts.prepare("INSERT OR IGNORE INTO active VALUES (?)"),active=counts.prepare("SELECT 1 AS present FROM active WHERE id=?");
  try{
    for await(const page of acquireCampaignFinanceResource(state,resource,{...options,publicationId:randomUUID(),
      onCapture:async capture=>{
        await options.facts.query(`INSERT INTO source_copy(url,final_url,fetched_at,http_status,sha256,blob_key,is_archive)
          VALUES($1,$1,$2,200,$3,$4,false) ON CONFLICT(blob_key) DO NOTHING`,[capture.url,capture.retrievedAt,capture.rawHash,capture.vaultKey]);
        await options.facts.query(`INSERT INTO pass_cursor(name,position) VALUES($1,$2)
          ON CONFLICT(name) DO UPDATE SET position=EXCLUDED.position WHERE pass_cursor.position<>EXCLUDED.position`,
          [`campaign-money:capture:${state}:${resource.id}:${createHash("sha256").update(capture.url).digest("hex")}`,JSON.stringify(capture)]);
      },
      selectRecord:(row)=>{
        const bound=bindCampaignMoney(row,people);
        if(bound)return (row.nativeId===null || row.nativeIdScope==="PUBLICATION" ? {...bound,id:`${row.id}:${String(occurrence.get(row.id)!.n).padStart(12,"0")}`} : bound);
        else if(options.countUnmatched!==false && !bindCampaignMoney(row,published)){
          unjoined++;
          const year=campaignRecordYear(row),reason=year===null?"The source has no readable filing period":year<2020?"The filing predates January 1, 2020":
            !row.cycle?"The source has no mapped election cycle":row.filingState!=="FILED"?"The source has not established a filed financial report":
            !row.filerName || !row.candidateName || !row.office?"The source does not bind a filed committee, candidate and office":
            "The filed person, office or district does not uniquely match a person we publish";
          reasons[reason]=(reasons[reason]??0)+1;
        }
        return null;
      }
    })){
      check=page.sourceCheck;
      const rows=page.records as CampaignSourceRecord[];
      if(!rows.length)continue;
      for(const row of rows)seen.run(row.id);
      const missing=rows.filter(row=>row.unavailableAmounts.length).map(row=>row.id);
      const previous=missing.length?await readCampaignPredecessors(options.facts.query,state,missing):new Map<string,Pick<CampaignSourceRecord,"amounts"|"provenance"|"filingUrl">>();
      for(let index=0;index<rows.length;index++){
        const row=rows[index],old=previous.get(row.id);
        if(old)rows[index]={...row,amounts:[...row.amounts,...old.amounts.filter(amount=>row.unavailableAmounts.includes(amount.label)).map(amount=>({...amount,provenance:amount.provenance??{...old.provenance,filingUrl:old.filingUrl}}))]};
      }
      const at=(options.now??(()=>new Date().toISOString()))();
      const filed=await fileCampaignMoneyFacts(options.facts,state,rows,at,{purge:options.purge});
      records+=rows.length;
      if(filed.written || filed.confirmed){
        if(resource.aggregation==="CYCLE_TOTAL")await options.onPublished?.({state,records:rows.length,people:[...new Set(rows.map(row=>row.person!.id))]});
        else for(const row of rows)touched.run(row.person!.id);
      }
    }
    if(!check)throw new Error("The campaign source returned no check");
    let after=0;
    for(;;){
      const previous=await options.facts.query(`SELECT f.id,e.parent_id,f.value->>'id' AS record_id FROM fact f JOIN entity e ON e.id=f.entity_id
        WHERE e.state=$1 AND e.parent_id=ANY($2::text[]) AND f.field LIKE 'campaign-money:%' AND f.status='live' AND f.provenance_kind<>'OWNER'
          AND f.value->>'resource'=$3 AND f.id>$4 ORDER BY f.id LIMIT 500`,[state,options.people.map(person=>person.id),resource.id,after]);
      if(!previous.length)break;
      const removed=previous.filter(row=>!active.get(String(row.record_id)));
      if(removed.length){
        if(records===0)throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID","The source no longer returns this person's previously filed rows; the last verified money is preserved for investigation");
        await options.facts.query("UPDATE fact SET status='superseded' WHERE id=ANY($1::bigint[])",[removed.map(row=>Number(row.id))]);
        for(const row of removed)touched.run(String(row.parent_id));
      }
      after=Number(previous.at(-1)!.id);
    }
    complete=true;return {records,unjoined,reasons,sourceCheck:check};
  }finally{
    try{
      let after="";
      for(;;){
        const batch=counts.prepare("SELECT id FROM touched WHERE id>? ORDER BY id LIMIT 500").all(after) as {id:string}[];
        if(!batch.length)break;
        if(complete)await options.onPublished?.({state,records,people:batch.map(row=>row.id)});after=batch.at(-1)!.id;
      }
    }finally{counts.close();await rm(temporaryPath(temporary),{recursive:true,force:true});}
  }
}

const DAY = 24 * 60 * 60_000;

const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
async function importHeldCampaignMoney(options:StateRefreshOptions,people:readonly CampaignMoneyPerson[],at:string):Promise<number>{
  let imported=0;
  if(!people.length || !(await options.query("SELECT 1 FROM civic_data_promotions WHERE record_class='STATE_CAMPAIGN_FINANCE' AND scope LIKE $1||':%' OR record_class='CURATED_READER_RECORD' AND scope=$1 LIMIT 1",[`US-${options.state}:campaign-finance`])).length)return 0;
  for(let start=0;start<people.length;start+=500){
    const batch=people.slice(start,start+500),byId=new Map(batch.map(person=>[person.id,person]));
    const wanted=JSON.stringify(batch.map(person=>({id:person.id,name:campaignName(person.name),aliases:[person.id,...person.aliases??[]]})));
    for(let offset=0;;offset+=500){
      const records=await options.query(`WITH held AS MATERIALIZED (
        SELECT p.scope,p.current_version_id,r.ordinal_index,CASE WHEN p.record_class='CURATED_READER_RECORD' THEN reader_payload_node(r.item)->'record' ELSE r.item END AS money,
          CASE WHEN p.record_class='CURATED_READER_RECORD' THEN reader_payload_node(r.item)->>'ocdId' END AS ocd_id,
          CASE WHEN p.record_class='CURATED_READER_RECORD' THEN reader_payload_node(r.item)->>'kind' END AS record_kind
        FROM civic_data_promotions p,LATERAL reader_payload_members(reader_payload_node(p.payload)->'records') r
        WHERE p.record_class='STATE_CAMPAIGN_FINANCE' AND p.scope LIKE $1||':%' OR p.record_class='CURATED_READER_RECORD' AND p.scope=$1
      ) SELECT h.current_version_id,reader_payload_value(h.money) AS record,w.id AS person_id,h.ocd_id,h.record_kind
        FROM held h,jsonb_to_recordset($2::jsonb) w(id text,name text,aliases jsonb)
        WHERE lower(trim(regexp_replace(CASE WHEN reader_payload_node(h.money)->>'candidateNameAsFiled' LIKE '%,%' THEN split_part(reader_payload_node(h.money)->>'candidateNameAsFiled',',',2)||' '||split_part(reader_payload_node(h.money)->>'candidateNameAsFiled',',',1) ELSE reader_payload_node(h.money)->>'candidateNameAsFiled' END,'[^a-zA-Z0-9]+',' ','g')))=w.name
          OR EXISTS(SELECT 1 FROM reader_payload_members(reader_payload_node(h.money)->'targetKeys') k WHERE w.aliases ? (k.item#>>'{}'))
        ORDER BY h.scope,h.ordinal_index,w.id LIMIT 500 OFFSET $3`,[`US-${options.state}:campaign-finance`,wanted,offset]);
      for(const held of records){
        const person=byId.get(String(held.person_id))!;
      const record=held.record as StateMoneyRecord;
      if(record.dataClass!=="STATE_COMMITTEE" || held.record_kind && held.record_kind!=="CAMPAIGN_FINANCE_FILING" || typeof record.totals.coveringPeriod!=="string" || !record.totals.coveringPeriod.trim() || record.jurisdiction!==options.state || held.ocd_id && held.ocd_id!==person.division || record.filingState!=="FILED" || !record.committeeId || !record.registeredName || !record.filingsUrl || !record.provenance.verifiedAt ||
        !record.match.allThreeAgree || campaignName(record.candidateNameAsFiled)!==campaignName(person.name) || campaignOffice(record.officeSought??"")!==campaignOffice(person.office) || record.electionYear<2020)continue;
      if(person.division!==campaignStateOcd(options.state) && !record.targetKeys.some(key=>key===person.id || person.aliases?.includes(key)) && record.detailSource?.ocdId!==person.division)continue;
      const dates=record.totals.coveringPeriod?.match(/\b(?:19|20)\d{2}\b/g)?.map(Number)??[record.electionYear];
      if(dates.some(year=>year<2020)||new Set(dates.map(year=>year+year%2)).size!==1)continue;
      const cycle=record.electionYear;
      const totals=[{label:"Receipts",amount:record.totals.receipts},{label:"Expenditures",amount:record.totals.expenditures},{label:"Cash on hand",amount:record.totals.cashOnHand}]
        .filter((amount):amount is {label:string;amount:number}=>typeof amount.amount==="number"&&Number.isFinite(amount.amount));
      if(!totals.length)continue;
      const proof={version:String(held.current_version_id),record},text=canonicalJson(proof),body=new TextEncoder().encode(text),rawHash=hash(text),vaultKey=`project/meanwhile/campaign-money/held/${rawHash}`;
      await options.vault.put(vaultKey,body,{contentHash:`sha256-${rawHash}`,contentType:"application/json",byteLength:body.length});
      const committee=`campaign-committee:${options.state}:${hash(JSON.stringify([record.agency,record.committeeId,person.id,person.seat]))}`;
      const source={url:record.provenance.sourceUrl,filingUrl:record.filingsUrl,publisher:record.agency,rawHash,vaultKey,byteLength:body.length,retrievedAt:record.provenance.collectedAt,
        publicationDate:null,checkedAt:record.checkedAt};
      await options.facts.transaction(async query=>{
        const [copy]=await query(`INSERT INTO source_copy(url,final_url,fetched_at,http_status,sha256,blob_key,is_archive) VALUES($1,$1,$2,NULL,$3,$4,false)
          ON CONFLICT(blob_key) DO UPDATE SET blob_key=EXCLUDED.blob_key RETURNING id`,[source.url,source.retrievedAt,rawHash,vaultKey]);
        await query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'committee',$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name`,[committee,record.registeredName,options.state,person.id]);
        const value={id:`${committee}:${cycle}`,person:{id:person.id,name:person.name,seat:person.seat},committee:record.registeredName,cycle,totals,sources:[source],
          organizations:filedOrganizations(record.funding),individualTotal:record.funding?.scope==="ELECTION_CYCLE"?record.funding.individualTotal:null,smallDonorShare:null};
        await query("CREATE TEMP TABLE money_cycles(entity_id text,field text,source_copy_id bigint,value jsonb,checked_at timestamptz) ON COMMIT DROP");
        await query("INSERT INTO money_cycles VALUES($1,$2,$3,$4,$5)",[person.id,`campaign-cycle:${committee}:${cycle}`,copy.id,JSON.stringify(value),record.provenance.verifiedAt]);
        await replaceCycles(query,at);
      });
      imported++;
      }
      if(records.length<500)break;
    }
  }
  if(imported)await invalidateReaderCache({states:[options.state]},options.purge);
  return imported;
}

function campaignStateOcd(state:string):string { const place=US_JURISDICTIONS.find(place=>place.usps===state)!;return `ocd-division/country:us/${place.prefix}:${place.slug}`; }
interface StateRefreshOptions {
  readonly state:string;readonly query:Query;readonly facts:FactDb&{readonly query:Query};readonly vault:EvidenceStore;
  readonly directory:string;readonly now?:()=>string;readonly fetch?:typeof fetch;
  readonly doors?:DoorRepository;
  readonly purge?:ReaderCachePurger;
}
async function moneyDoor(options:StateRefreshOptions,url:string,error:unknown,rows:number,at:string){
  if(!options.doors)return;
  const reason=error===null?null:sanitizedErrorDiagnostic(error);
  const draft=pageDoorDraft({url,recordClass:"CAMPAIGN_FINANCE",retrievedAt:at,ocdId:campaignStateOcd(options.state),foundBy:null});
  if(!draft)throw new Error("The campaign source has no public door address");
  const doorId=draft.doorId;
  await upsertDerivedDoor(options.doors,draft,at,at);
  await recordDoorOutcome(options.doors,doorId,reason?"FAILURE":"SUCCESS",at,false,reason??undefined);
  await recordDoorEvidence(options.doors,doorId,error===null?{kind:"GOOD",rows}:evidenceFromFailureCode(
    isSourceAcquisitionFailure(error)?error.code:"PUBLISHER_DOCUMENT_INVALID",reason?Number(/HTTP (\d{3})/.exec(reason)?.[1])||null:null),at);
}
export async function refreshCampaignMoneyState(options:StateRefreshOptions){
  const {state,facts,vault}=options,clock=options.now??(()=>new Date().toISOString()),at=clock();
  campaignFinanceSource(state);
  await facts.query(`INSERT INTO pass_cursor(name,position) VALUES($1,$2)
    ON CONFLICT(name) DO UPDATE SET position=jsonb_set(pass_cursor.position::jsonb,'{startedAt}',to_jsonb($3::text))::text`,
    [campaignFinanceNativeScope(state),JSON.stringify({state,startedAt:at}),at]);
  const people=await readCampaignMoneyPeople(options.query,state);
  const due=await campaignMoneyWork(facts.query,state,people,at);
  const aliasOwners=new Map<string,string|null>();
  for(const person of people)for(const alias of person.aliases??[]){
    const owner=aliasOwners.get(alias);aliasOwners.set(alias,owner===undefined || owner===person.id?person.id:null);
  }
  for(let start=0;start<due.length;start+=500){
    const batch=due.slice(start,start+500);
    const root=campaignStateOcd(state),places=[...new Set([root,...batch.map(person=>person.division)])];
    await facts.query(`INSERT INTO entity(id,kind,name,state) SELECT id,'place',id,$2 FROM unnest($1::text[]) id ON CONFLICT DO NOTHING`,[places,state]);
    const persons=[...new Map(batch.map(person=>[person.id,person])).values()];
    await facts.query(`INSERT INTO entity(id,kind,name,state) SELECT id,'person',name,$3 FROM unnest($1::text[],$2::text[]) p(id,name)
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name WHERE entity.state=EXCLUDED.state AND entity.kind='person' AND entity.name IS DISTINCT FROM EXCLUDED.name`,[persons.map(person=>person.id),persons.map(person=>person.name),state]);
    await facts.query(`INSERT INTO entity_place(entity_id,place_id) SELECT * FROM unnest($1::text[],$2::text[]) ON CONFLICT DO NOTHING`,[batch.flatMap(person=>person.division===root?[person.id]:[person.id,person.id]),batch.flatMap(person=>person.division===root?[root]:[person.division,root])]);
    const aliases=[...new Map(batch.flatMap(person=>(person.aliases??[]).filter(alias=>aliasOwners.get(alias)===person.id).map(alias=>[alias,{id:person.id,alias}] as const))).values()];
    if(aliases.length)await facts.query(`INSERT INTO entity_external_id(entity_id,scheme,value) SELECT id,$3,alias FROM unnest($1::text[],$2::text[]) a(id,alias)
      ON CONFLICT(scheme,value) DO UPDATE SET entity_id=EXCLUDED.entity_id WHERE entity_external_id.entity_id<>EXCLUDED.entity_id`,[aliases.map(row=>row.id),aliases.map(row=>row.alias),`campaign-person:${state}`]);
  }
  let loaded=await importHeldCampaignMoney(options,due,at),unmatched=0;
  const reasons:Record<string,number>={};
  const issue=(detail:string)=>{reasons[detail]=(reasons[detail]??0)+1;};
  const profiles=campaignMoneySourceResources(state);
  if(due.length && !profiles.length)issue("The official source has no supported committee-to-person and office binding yet");
  let failed=due.length>0&&!profiles.length;
  let sourceCheckedAt:string|null=null;
  const runId=randomUUID();
  let counted=false;
  for(const cohort of [due.filter(person=>person.incumbent),due.filter(person=>!person.incumbent)]){
    if(!cohort.length)continue;
    for await(const resource of campaignFinanceResources(state,{vault,profiles,signal:new AbortController().signal,fetch:options.fetch,onFailure:async(_resource,url,error)=>{const reason=sanitizedErrorDiagnostic(error);failed=true;issue(reason);await moneyDoor(options,url,error,0,clock());}})){
      try{
        const result=await publishCampaignFinanceResource(state,resource,{people:cohort,publishedPeople:people,countUnmatched:!counted,facts,vault,directory:options.directory,runId,releaseEveryMs:resource.kind==="SOCRATA"?60*60_000:DAY,now:clock,fetch:options.fetch,signal:new AbortController().signal,
          purge:options.purge,onPublished:async batch=>rebuildCampaignCycles(facts,state,batch.people,clock(),options.purge)});
        loaded+=result.records;unmatched+=result.unjoined;
        if(!sourceCheckedAt || result.sourceCheck.checkedAt<sourceCheckedAt)sourceCheckedAt=result.sourceCheck.checkedAt;
        for(const [reason,count]of Object.entries(result.reasons))reasons[reason]=(reasons[reason]??0)+count;
        await moneyDoor(options,resource.url,null,result.records,clock());
      }catch(error){const reason=sanitizedErrorDiagnostic(error);failed=true;issue(reason);await moneyDoor(options,resource.url,error,0,clock());}
    }
    counted=true;
  }
  let found=0;
  for(let start=0;start<due.length;start+=500){
    const batch=due.slice(start,start+500),held=await facts.query("SELECT DISTINCT f.entity_id FROM fact f JOIN entity e ON e.id=f.entity_id WHERE f.entity_id=ANY($1::text[]) AND f.field LIKE 'campaign-cycle:%' AND f.status='live' AND f.value#>>'{person,name}'=e.name",[batch.map(person=>person.id)]);
    const withMoney=new Set(held.map(row=>String(row.entity_id)));found+=withMoney.size;
    await facts.query(`INSERT INTO pass_cursor(name,position) SELECT name,position FROM unnest($1::text[],$2::text[]) checks(name,position)
      ON CONFLICT(name) DO UPDATE SET position=EXCLUDED.position`,[batch.map(person=>campaignPersonKey(state,person)),batch.map(person=>JSON.stringify({checkedAt:sourceCheckedAt??clock(),found:!failed && withMoney.has(person.id)}))]);
    const missing=batch.filter(person=>failed || !withMoney.has(person.id)),matched=batch.filter(person=>!failed && withMoney.has(person.id));
    if(matched.length)await facts.query(`DELETE FROM blank b USING unnest($1::text[],$2::text[]) p(id,field) WHERE b.entity_id=p.id AND b.field=p.field`,[matched.map(person=>person.id),matched.map(person=>`campaign-money:${person.seat}`)]);
    if(missing.length)await facts.query(`INSERT INTO blank(entity_id,field,stage,reason,detail,next_try_at,attempts)
      SELECT id,field,'ACQUIRE','MONEY_NOT_YET_JOINED',$3,now()+interval '1 hour',1 FROM unnest($1::text[],$2::text[]) p(id,field)
      ON CONFLICT(entity_id,field) DO UPDATE SET detail=EXCLUDED.detail,next_try_at=EXCLUDED.next_try_at,attempts=blank.attempts+1,updated_at=now()`,
      [missing.map(person=>person.id),missing.map(person=>`campaign-money:${person.seat}`),Object.keys(reasons)[0]??"No filed money has matched this published person and seat yet"]);
  }
  found=0;
  const publishedIds=[...new Set(people.map(person=>person.id))];
  for(let start=0;start<publishedIds.length;start+=500){
    const [held]=await facts.query("SELECT count(DISTINCT f.entity_id) AS count FROM fact f JOIN entity e ON e.id=f.entity_id WHERE f.entity_id=ANY($1::text[]) AND f.field LIKE 'campaign-cycle:%' AND f.status='live' AND f.value#>>'{person,name}'=e.name",[publishedIds.slice(start,start+500)]);
    found+=Number(held.count);
  }
  const report:CampaignFinanceWorkCheck={kind:"campaign-finance-work-check",state,resource:"people",records:[{id:`${state}:people`,state,startedAt:at,checkedAt:clock(),publishedPeople:new Set(people.map(person=>person.id)).size,peopleWorked:due.length,peopleWithMoney:found,loaded,unmatched,reasons,peakMemoryBytes:process.resourceUsage().maxRSS*1024}]};
  await facts.query("INSERT INTO pass_cursor(name,position) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET position=EXCLUDED.position",[campaignFinanceNativeScope(state),JSON.stringify(report.records[0])]);
  return {report};
}
async function main(){
  const state=process.argv.find(arg=>arg.startsWith("--state="))?.slice(8);
  if(!state || process.argv.length!==3)throw new Error("Campaign money requires one state");
  campaignFinanceSource(state);prepareProductionCivicDataWrite();
  const {createPgRepositories,controlPlaneUrlFromEnv}=await import("../control-plane/repository/pg-store.ts");
  const control=controlPlaneUrlFromEnv();
  if(!control)throw new Error("Campaign source doors require the configured control-plane database");
  const repos=await createPgRepositories(control,new Date().toISOString(),{skipBootstrap:true});
  const database=new URL(process.env.DATABASE_URL!);
  const cacheKey=createHash("sha256").update(database.hostname.replace("-pooler","")+database.pathname).digest("hex").slice(0,24);
  const facts=readerFactDb(),result=await refreshCampaignMoneyState({state,query:facts.query,facts,vault:rawCaptureVault(),
    doors:repos.doors,directory:join(tmpdir(),"meanwhile-campaign-finance",cacheKey)});
  await new Promise<void>(resolve=>process.stdout.write("CAMPAIGN_MONEY_STATE="+JSON.stringify(result.report.records[0])+"\n",()=>resolve()));
  process.exit(0);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
