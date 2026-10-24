import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { BOOTSTRAP_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { PGlite } from "@electric-sql/pglite";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { closedHour, emptyState, keeperStatus } from "../lib/control-plane/line-keeper/model.ts";
import { composeHour, withKeeperFixes, runLineKeeper,configGrowth,measuredConfigGrowth } from "../lib/control-plane/line-keeper/keep.ts";
import { keeperRows, keeperVital } from "../lib/control-plane/line-keeper/admin.ts";
import { FACT_HOUR_SQL, EMPTY_WORK_SQL, SOURCE_SEED_SQL, SITTINGS_SEED_SQL, sourceReading } from "../lib/control-plane/line-keeper/read.ts";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { fixItems, withFixCompleted } from "../lib/control-plane/fix-list.ts";
import { v6FixesView } from "../lib/control-plane/admin-view/v6-fixes-read.ts";
import { fixQueueView } from "../lib/control-plane/fix-queue.ts";
import { completeLinks,handoffProblems,waitingAt } from '../lib/control-plane/line-keeper/links.ts';
import { WORKER_ROLES } from '../lib/control-plane/attempt.ts';
import { inventoryProblems } from '../lib/control-plane/line-keeper/inventory.ts';
import { readerDestinations } from '../lib/control-plane/line-keeper/destinations.ts';
import { transferSince,type TransferSample,type TransferCounter } from '../lib/control-plane/line-keeper/transfer.ts';
import { foldPosting,type KeeperPosting } from '../lib/control-plane/line-keeper/posting.ts';
import { publishCountryScores } from '../lib/control-plane/line-keeper/country.ts';
import { US_STATES } from '../lib/control-plane/readiness/catalog.ts';
import { config as schedule } from "../netlify/functions/line-keeper.mts";
async function keeperDatabase(){
 const db=new PGlite();
 for(const name of ['0025_typical_fixer.sql','0030_database_transfer_daily.sql','0031_civic_payload_parts.sql','0035_r1_fact_store.sql','0036_ne01.sql','0037_r1_fact_scale.sql'])
  for(const statement of readFileSync(new URL(`../lib/db/migrations/${name}`,import.meta.url),'utf8').split('--> statement-breakpoint'))await db.exec(statement);
 for(const statement of BOOTSTRAP_DDL)await db.exec(statement.replace('CREATE INDEX CONCURRENTLY','CREATE INDEX'));
 return db;
}
const at="2026-10-20T07:05:00.000Z",from="2026-10-20T06:00:00.000Z",through="2026-10-20T07:00:00.000Z";
const input=()=>({transferCounters:null,recordDistribution:[],destinations:null,recordTargets:[],inventory:null,recordVersions:[],targets:[],links:{links:[],waiting:[],errors:[]},posting:[],stamps:[],readback:null,window:{from,through},facts:[{state:"MD",family:"Campaign money",saved:10000,live:0}],costs:{spendUsd:2,unpricedCharges:0,paidJobsEnded:2,paidJobsEndedEmpty:1},
 work:[{state:"AZ",family:"meetings-discovery",route:"own-site",runs:12,fetchedNothing:12,savedNothing:12,empty:12,failed:0,unknown:0}],
 rawVital:{rounds_finished:3,rounds_killed:1,neon_bytes_read:1000000000},heartbeat:{beat_at:"2026-10-20T06:00:00Z",bytes:{hour:from,readerBytes:14000000000,controlPlaneBytes:1000000000,byCaller:[{caller:"reader: query",bytes:14000000000}]}},recordsLive:0,doors:[],calendars:[],failures:[]});
const state=()=>({...emptyState(at),seededAt:at});
test("wrong stored money earns no delivery; both databases count; free observer still finds a stopped runner",()=>{
 const hour=composeHour(input(),state(),at),held={...state(),hours:[hour]};
 assert.equal(keeperVital(held)![0].factsLive,0);assert.equal(keeperVital(held)![0].neonGb,15);assert.equal(keeperVital(held)![0].costPerFactUsd,null);
 for(const key of ["runner-stopped","database-over-target","stored-not-delivered:MD:Campaign money","empty:AZ:meetings-discovery","paid-ended-empty"]) assert.ok(hour.problems.some(p=>p.key===key));
 const rows=new Map(keeperRows(held,at));assert.equal(rows.get("Facts live per hour (fact store)")!.value,"0");assert.ok(rows.get("Facts live per hour (fact store)")!.items!.includes("Meetings: 0"));
 assert.equal(schedule.schedule,"5 * * * *");assert.match(keeperStatus(held,"2026-10-20T08:06:00Z"),/stopped reporting/);
});
test("fixes keep accountable owners in the existing list and brief, deduplicate, reopen, and preserve all switches",()=>{
 const hour=composeHour(input(),state(),at),config=defaultAdminConfig(at),once=withKeeperFixes(config,hour),twice=withKeeperFixes(once,hour);
 assert.equal(fixItems(once).length,fixItems(twice).length);assert.deepEqual(twice.settings,config.settings);assert.deepEqual(twice.apiFallback,config.apiFallback);
 assert.equal(twice.latestBrief!.alerts.length,0);assert.ok(twice.latestBrief!.problems.some(p=>p.owner==="River"));
 const views=v6FixesView(fixQueueView([]),fixItems(once));assert.ok(views.open.some(f=>f.owner==="hunters"));
 const id=fixItems(once)[0].id;
 assert.equal(withFixCompleted(once,id,{whatChanged:'Looks fixed',changedBy:'The owner',before:'Broken',after:'Reported fixed'},at),once,'a manual completion cannot replace the keeper’s next live check');
 const done=withFixCompleted(once,id,{whatChanged:"Fixed",changedBy:"The line keeper",before:"Broken",after:"Seen live"},at);
 assert.equal(fixItems(withKeeperFixes(done,hour)).find(f=>f.id===id)!.state,"CAME_BACK");
});
test("a failed source read does not become zero or refresh a missing inventory",()=>{
 const i=input();const h=composeHour({...i,recordsLive:null,facts:null,costs:null,doors:null,failures:["Measurement 6: Error"]},emptyState(at),at);
 assert.equal(keeperVital({...state(),hours:[h]})![0].factsLive,null);assert.equal(h.sources!.complete,false);assert.ok(h.problems.some(p=>p.key==='source-clock-inventory'));
 assert.equal(closedHour("2026-11-01T06:05:00Z").through,"2026-11-01T06:00:00.000Z");
});
test("source clocks keep ageing while the runner is absent and reuse the hot meeting window",()=>{
 const door={doorId:"meeting",kind:"ical",bodyIds:["body"],meeting:{},status:"OPEN",lastSuccessAt:"2026-10-20T05:30:00Z",updatedAt:at,checkEveryMinutes:null,observedChangeMinutes:null,ocdId:"ocd-division/country:us/state:az"};
 const s={...state(),doors:{meeting:door},sittings:{p:{["ical\x01body"]:{liveFacts:1,starts:[Date.parse("2026-10-21T06:00:00Z")]}}}} as never;
 assert.equal(sourceReading(s,at).overdue,1);assert.equal(sourceReading(s,at).scheduled,1);
});

test('an independent page recheck keeps the completed byte measurement for that same hour without copying it into another hour',()=>{
 const previous={...composeHour(input(),state(),at),transfer:{control:2e9,reader:3e9,complete:true,byCaller:[]}};
 const s={...state(),hours:[previous]};
 assert.equal(composeHour(input(),s,at).transfer!.reader,3e9);
 const next=composeHour({...input(),window:{from:through,through:'2026-10-20T08:00:00Z'}},s,'2026-10-20T08:05:00Z');
 assert.notEqual(next.transfer?.reader,3e9);
});
test("hourly dry run uses only bounded deltas, never seeds, and never writes even on missing state",async()=>{
 const calls:{text:string;params:readonly unknown[]}[]=[];
 const sql={query:async(text:string,params:readonly unknown[]=[])=>{calls.push({text,params});if(text.includes('hourAggregate'))return [];return [];}} as never;
 const read=await runLineKeeper(sql,sql,at,{readOnly:true});assert.equal(read.state.hours.length,1);
 assert.ok(calls.every(c=>!/^\s*(?:INSERT|UPDATE|DELETE|CREATE)/.test(c.text)));assert.ok(!calls.some(c=>c.text===SOURCE_SEED_SQL||c.text===SITTINGS_SEED_SQL));
 for(const c of calls.filter(c=>/FROM (?:fact f|cp_log_costs|cp_log_owner_digests)|FROM cp_doors|FROM civic_data_promotions/.test(c.text))) assert.ok(c.params.length>=1,c.text);
 const clocks=calls.find(c=>c.text.includes('FROM cp_doors'))!;
 assert.equal(clocks.params[0],'2026-10-20T06:05:00.000Z');
 assert.match(clocks.text,/greatest\(\$2::timestamptz,statement_timestamp\(\)\)/,'an actively updated source is not lost behind the last closed hour');
 const records=calls.find(c=>c.text.startsWith('WITH heads AS MATERIALIZED'))!;
 assert.equal(records.params[0],from,'new public records from the counted hour are retained independently of the inventory clock');
 assert.equal(records.params[1],at);
 const gap=await runLineKeeper(sql,sql,at,{readOnly:true,initialState:{...state(),seededAt:'2026-10-20T05:00:00Z'}});
 assert.equal(gap.hour.sources!.complete,false,'a resumed observer does not silently bless clocks from a missed interval');
});
test("SQL excludes hidden old money and old hours, counts identities and each run once",async()=>{
 const db=await keeperDatabase();try{
 await db.exec(`INSERT INTO entity(id,kind,state,parent_id,name) VALUES ('person','person','MD',null,'Person'),('old','committee','MD',null,'Wrong filer'),('good','committee','MD','person','Filed name'),('place','place','MD',null,'Place');INSERT INTO entity_place VALUES ('good','place');`);
 const value={person:{id:'person',seat:'seat'},filerName:'Filed name',filingState:'FILED',period:'2026',amounts:[{label:'Contribution',amount:10}]};
 for(const [id,entity,time] of [[1,'old',from],[2,'good',from],[3,'good','2026-10-19T01:00:00Z']] as const) await db.query(`INSERT INTO fact(id,entity_id,field,value,status,live_at,value_text,provenance_kind,quote,checked_at,produced_by) VALUES ($1::bigint,$2,'campaign-money:test:'||($1::bigint)::text,$3::jsonb,'live',$4,'Filed contribution','OWNER','Filed contribution',$4,'test')`,[id,entity,JSON.stringify(value),time]);
 const rows=await db.query<{state:string;family:string;saved:number;eligible_facts:unknown[]}>(FACT_HOUR_SQL,[from,through]);assert.equal(rows.rows[0].saved,2);assert.equal(rows.rows[0].eligible_facts.length,1,'eligible storage is counted separately from observed live facts');
 const record={attemptId:'a',recordClass:'meetings-discovery',jurisdiction:'AZ',routeId:'own-site',cost:{bytesFetched:0}};
 await db.query(`INSERT INTO cp_attempts(id,revision,updated_at,value) VALUES ('a',1,'2026-10-20T06:00:00Z','{"artifactIds":[],"outcome":"COMPLETED"}')`);
 for(const id of ['one','two']) await db.query(`INSERT INTO cp_log_costs(log_key,record_id,position,recorded_at,record) VALUES ('costs',$1,CASE $1 WHEN 'one' THEN 1 ELSE 2 END,$2,$3::jsonb)`,[id,from,JSON.stringify(record)]);
 const empty=await db.query<{runs:number;empty:number}>(EMPTY_WORK_SQL,[from,through]);assert.equal(empty.rows[0].runs,1);assert.equal(empty.rows[0].empty,1);
 }finally{await db.close();}
});

test('every link stays visible; a handoff with no intake is a break in its own state and kind',()=>{
 const rows=completeLinks([{state:'AZ',kind:'MEETING',link:'Check',incoming:2,outgoing:2,unit:'records'}]);
 assert.equal(rows.length,8);
 assert.ok(handoffProblems(rows).some(p=>p.after==='Check'&&p.before==='Fact table'));
 const other={state:'NH',kind:'MEETING',link:'Fact table' as const,incoming:2,outgoing:2,unit:'records'};
 assert.ok(handoffProblems([...rows,other]).some(p=>p.state==='AZ'&&p.after==='Check'));
});
test('unchanged waiting work crosses its clock without a database rescan, including never dispatched work',()=>{
 const index={'current:az':[{id:'work',state:'WAITING',lane:'CREATED',subjectName:'ZIP 85122',waitingSince:'2026-10-20T05:00:00Z',overdue:null,from:null,until:null}]};
 assert.equal(waitingAt(index,'2026-10-20T05:30:00Z').length,0);
 const waiting=waitingAt(index,at);assert.equal(waiting.length,1);assert.equal(waiting[0].state,'AZ');assert.equal(waiting[0].owner,'the runner');
 assert.equal(waitingAt({'current:az':[{...index['current:az'][0],eligibleAt:'2026-10-21T00:00:00Z'}]},at).length,0);
});
test('fix completion requires a later window, the same link carrying work, and matching live evidence',()=>{
 const hour={...composeHour(input(),state(),at),problems:[{key:'link:AZ:MEETING:Source',where:'AZ · MEETING',says:'Source stopped',owner:'hunters',next:'Repair the source'}]};
 const config=withKeeperFixes(defaultAdminConfig(at),hour),id=fixItems(config)[0].id;
 const proof={version:'v',recordKey:'meeting:x',state:'AZ',kind:'Meetings',api:true,live:true,checkedAt:'2026-10-20T08:05:00Z',url:PUBLIC_SITE_ORIGIN,reason:'Exact record seen'};
 const resumed={...hour,from:through,through:'2026-10-20T08:00:00.000Z',measuredAt:'2026-10-20T08:05:00Z',problems:[],links:[{state:'AZ',kind:'MEETING',link:'Source' as const,incoming:1,outgoing:1,unit:'pages'}],pageProofs:[proof]};
 assert.equal(fixItems(withKeeperFixes(config,{...resumed,from})).find(f=>f.id===id)!.state,'OPEN');
 assert.equal(fixItems(withKeeperFixes(config,{...resumed,pageProofs:[{...proof,kind:'Campaign money'}]})).find(f=>f.id===id)!.state,'OPEN');
 assert.equal(fixItems(withKeeperFixes(config,{...resumed,links:[{...resumed.links[0],link:'Check'}]})).find(f=>f.id===id)!.state,'OPEN');
 const done=withKeeperFixes(config,resumed);assert.equal(fixItems(done).find(f=>f.id===id)!.state,'FIXED');
 assert.ok(!done.latestBrief!.problems.some(p=>p.key==='line-keeper:link:AZ:MEETING:Source'));
});
test('active jobs and registered workers that never ran become owned repair work without holding publication',()=>{
 const problems=inventoryProblems({jobs:{job:{id:'job',kind:'MEETING',subject:'body',state:'AZ',active:true,due:'2026-10-20T05:00:00Z',lastRun:null,opened:0,occurrence:null}},workers:{}},[],at);
 assert.ok(problems.some(p=>p.key==='job-clock:AZ:MEETING'&&p.owner==='the runner'));
 assert.ok(problems.some(p=>p.key==='worker-clock:ACQUIRER'&&p.owner==='hunters'));
 assert.equal(inventoryProblems({jobs:{},workers:Object.fromEntries(WORKER_ROLES.map(role=>[role,at]))},[],at).length,0);
});
test('configuration amplification is measured in UTF-8 bytes and four whole-record readers per round',()=>{
 const before=defaultAdminConfig(at),after=withKeeperFixes(before,{...composeHour(input(),state(),at),problems:[{key:'one',where:'AZ',says:'An empty source',owner:'diggers',next:'Read its next output'}]});
 const growth=configGrowth(before,after,12);assert.ok(growth.totalBytes>0);assert.equal(growth.fourCallersBytesPerHour,growth.totalBytes*48);
 const again=configGrowth(after,withKeeperFixes(after,{...composeHour(input(),state(),at),problems:[{key:'one',where:'AZ',says:'An empty source',owner:'diggers',next:'Read its next output'}]}),12);
 assert.equal(again.totalBytes,0);
 assert.equal(measuredConfigGrowth({revision:1,bytes:100,value:before},after,composeHour(input(),state(),at)).fourCallersBytesPerHour,null,"finished rounds cannot substitute for missing caller read counts");
});
test('reader destinations prefer whole-division residential ZIPs over partial boundary ZIPs',async()=>{
 const destinations=await readerDestinations('AZ');
 assert.notEqual(destinations.get('ocd-division/country:us/state:az/place:tucson'),'85641');
 assert.equal(destinations.get('ocd-division/country:us/state:az/place:tucson'),destinations.get('ocd-division/country:us/state:az/school_district:tucson_unified_district'));
 assert.match((await readerDestinations('US')).get('ocd-division/country:us')!,/^\d{5}$/,'a national fact can be checked at an ordinary residential destination without a prepared test place');
});

test('SQL follows packed state record references and counts source, Box, check and promotion without metadata progress',async()=>{
 const {RECORD_TARGET_SQL,RECORD_SAMPLE_SQL,readRecordTargets}=await import('../lib/control-plane/line-keeper/records.ts');
 const {WORK_LINKS_SQL,CHECK_LINKS_SQL}=await import('../lib/control-plane/line-keeper/links.ts');
 const db=await keeperDatabase();try{
 const candidate={readModel:{positions:{formatVersion:1},roster:{officeholders:[{id:'person',name:'A real name',phone:'555-0100'}],divisions:[{officeholderId:'person',ocdId:'ocd-division/country:us/state:az'}]}},changeSet:{added:[{key:'officeholder:person',before:null,after:{$civicCandidatePath:['roster','officeholders','0']}},{key:'projection:counts',after:{count:20000}}],changed:[]}};
 await db.query(`INSERT INTO civic_data_candidates(id,source_id,record_class,scope,retrieved_at,state,acquisition_succeeded,source_through,parser_version,identity,validation_receipt,candidate) VALUES ('v','official','FEDERAL_DIRECTORY','US-AZ:directory',$1,'PROMOTED',true,'2026','test','{}','{"decision":"GOOD"}',$2)`,[from,JSON.stringify(candidate)]);
 await db.query(`INSERT INTO civic_data_promotions(key,record_class,scope,current_version_id,promoted_at,source_id,last_known_good_version_id,payload,validation_receipt) VALUES ('pointer','FEDERAL_DIRECTORY','US-AZ:directory','v',$1,'official','v','{}','{}')`,[from]);
 await db.query(`INSERT INTO civic_data_candidate_events(candidate_id,at,state,sequence,detail) VALUES ('v',$1,'PROMOTED',1,'Promoted')`,[from]);
 await db.query(`INSERT INTO civic_data_candidate_events(candidate_id,at,state,sequence,detail) VALUES ('v',$1,'VALIDATED',2,'Validated')`,[from]);
 const targets=(await db.query<{after:{name:string};division:string}>(RECORD_TARGET_SQL,[from,through])).rows;
 assert.equal(targets.length,1);assert.equal(targets[0].after.name,'A real name');assert.equal(targets[0].division,'ocd-division/country:us/state:az');
 const quiet=(await db.query<{record_key:string;after:{id:string}}>(RECORD_SAMPLE_SQL,[from,through])).rows;assert.equal(quiet[0].record_key,'officeholder:person');assert.equal(quiet[0].after.id,'person');
 const selected={query:async(text:string,params:readonly unknown[]=[]) => (await db.query<Record<string,unknown>>(text,[...params])).rows};
 assert.deepEqual((await readRecordTargets(selected,from,through,true))[0].expected,['A real name']);
 assert.ok((await readRecordTargets(selected,from,through))[0].expected.includes('555-0100'),'a changed phone is still checked in full; quiet identity checks do not hide actual changes');
 const links=(await db.query<{link:string;incoming:number;outgoing:number}>(CHECK_LINKS_SQL,[from,through])).rows;
 assert.equal(links.find(l=>l.link==='Check')!.outgoing,1);assert.equal(links.find(l=>l.link==='Fact table')!.outgoing,1);
 await db.query(`UPDATE civic_data_candidate_events SET at='2026-10-19T01:00:00Z' WHERE state='VALIDATED'`);
 const laterLinks=(await db.query<{link:string;incoming:number;outgoing:number}>(CHECK_LINKS_SQL,[from,through])).rows;
 assert.equal(laterLinks.find(l=>l.link==='Check')!.incoming,0,'a prior-hour validation is not counted again when its fact is promoted');
 assert.equal(laterLinks.find(l=>l.link==='Fact table')!.outgoing,1);
 await db.query(`INSERT INTO civic_data_candidates(id,source_id,record_class,scope,retrieved_at,state,acquisition_succeeded,source_through,parser_version,identity,validation_receipt,candidate) SELECT 'bad',source_id,record_class,scope,retrieved_at,'SEMANTIC_INVALID',true,source_through,parser_version,identity,'{"decision":"BAD"}',candidate FROM civic_data_candidates WHERE id='v'`);
 await db.query(`INSERT INTO civic_data_candidate_events(candidate_id,at,state,sequence,detail) VALUES ('bad',$1,'SEMANTIC_INVALID',1,'Invalid')`,[from]);
 const failedLinks=(await db.query<{link:string;incoming:number;outgoing:number}>(CHECK_LINKS_SQL,[from,through])).rows;
 assert.equal(failedLinks.find(l=>l.link==='Check')!.incoming,1,'failed checks still count the records they took in');
 assert.equal(failedLinks.find(l=>l.link==='Check')!.outgoing,0);
 await db.query(`INSERT INTO cp_attempts(id,revision,updated_at,value) VALUES ('a',1,'2026-10-20T06:00:00Z','{"artifactIds":["page"]}')`);
 await db.query(`INSERT INTO cp_log_costs(log_key,record_id,position,recorded_at,record) VALUES ('costs','one',1,$1,'{"attemptId":"a","recordClass":"MEETING","jurisdiction":"AZ"}')`,[from]);
 await db.query(`INSERT INTO cp_box_findings(id,revision,updated_at,value,changed_at) VALUES ('b',1,$2,$1,$2)`,[JSON.stringify({subjectId:'AZ',fact:{recordClass:'MEETING'},origins:[{recordedAt:from}],claim:null,attempts:[{takenAt:from,endedAt:from,outcome:'built'}]}),from]);
 const work=(await db.query<{link:string;incoming:number;outgoing:number}>(WORK_LINKS_SQL,[from,through])).rows;
 assert.equal(work.find(l=>l.link==='Source')!.outgoing,1);assert.equal(work.find(l=>l.link==='Box')!.outgoing,1);assert.equal(work.find(l=>l.link==='Builder')!.outgoing,1);
 candidate.changeSet.added.push({key:'officeholder:second',before:null,after:{$civicCandidatePath:['roster','officeholders','0']}});
 await db.query(`UPDATE civic_data_candidates SET candidate=$1`,[JSON.stringify(candidate)]);
 await db.query(`INSERT INTO civic_data_candidates(id,source_id,record_class,scope,retrieved_at,state,acquisition_succeeded,source_through,parser_version,identity,validation_receipt,candidate) SELECT 'v2',source_id,record_class,scope,retrieved_at,state,true,source_through,parser_version,identity,validation_receipt,candidate FROM civic_data_candidates WHERE id='v'`);
 await db.query(`INSERT INTO civic_data_promotions(key,record_class,scope,current_version_id,promoted_at,source_id,last_known_good_version_id,payload,validation_receipt) VALUES ('pointer-2','FEDERAL_DIRECTORY','US-AZ:other','v2',$1,'official','v2','{}','{}')`,[from]);
 assert.equal((await db.query(RECORD_TARGET_SQL,[from,through])).rows.length,4,'every changed record in every changed pointer is checked, even in the same state and kind');
 }finally{await db.close();}
});

test('only a later exact meeting stamp and page check closes its fix, independently of another family’s failure',()=>{
 const identity={version:'meeting-version',recordKey:'meeting:exact'};
 const hour={...composeHour(input(),state(),at),problems:[{key:`meeting-stamp:${identity.version}:${identity.recordKey}`,where:'Meeting delivery checks',says:'No stamp after 90 minutes',owner:'diggers',next:'Repair the writer',technical:[JSON.stringify(identity)]}]};
 const config=withKeeperFixes(defaultAdminConfig(at),hour),id=fixItems(config)[0].id,later='2026-10-20T08:05:00Z';
 const proof={...identity,state:'AZ',kind:'Meetings',api:true,live:true,checkedAt:later,url:PUBLIC_SITE_ORIGIN,reason:'Exact meeting observed'};
 const resumed={...hour,from:through,through:'2026-10-20T08:00:00Z',measuredAt:later,problems:[],posting:[{versionId:identity.version,recordKey:identity.recordKey,kind:'MEETING_CHANGED' as const,postedAt:null,firstSeenAt:from,lastUnchangedAt:null,liveAt:later,basis:'FIRST_SEEN' as const,minutesToLive:125,startsAt:null,insideSevenDayWindow:null}],pageProofs:[proof,{...proof,version:'unrelated',recordKey:'money',kind:'Campaign money',live:false}]};
 assert.equal(fixItems(withKeeperFixes(config,{...resumed,posting:[]})).find(f=>f.id===id)!.state,'OPEN');
 assert.equal(fixItems(withKeeperFixes(config,{...resumed,pageProofs:[]})).find(f=>f.id===id)!.state,'OPEN');
 assert.equal(fixItems(withKeeperFixes(config,resumed)).find(f=>f.id===id)!.state,'FIXED');
});

test('retained country inputs replay unchanged sources without reads, reload changed scopes and preserve good inputs on failure',async()=>{
 const {retainedInputs}=await import('../lib/control-plane/line-keeper/inputs.ts');
 let calls=0;const load=async()=>{calls++;return {kind:'PROMOTED',value:{facts:[1,2]},metadata:{scope:'AZ'}};};
 const seed=retainedInputs(undefined,()=>false,true);const first=await seed.memo('MEETING','AZ',load);assert.equal(calls,1);
 const next=retainedInputs(seed.inputs,(_class,scope)=>scope==='NH');assert.deepEqual(await next.memo('MEETING','AZ',load),first);assert.equal(calls,1);
 await next.memo('MEETING','NH',load);assert.equal(calls,2);
 const failed=retainedInputs(seed.inputs,()=>true);await assert.rejects(()=>failed.memo('MEETING','AZ',async()=>{throw Error('store unavailable');}));assert.deepEqual(failed.inputs,seed.inputs);
 const missing=retainedInputs({},()=>false);await assert.rejects(()=>missing.memo('MEETING','AZ',load),/Missing retained/);assert.equal(calls,2,'a missing input never silently causes an hourly seed');
});

test('the deployment seed accepts the Netlify event schema and refuses unpublished or non-production deploys',async()=>{
 const {isPublishedProductionDeploy}=await import('../netlify/functions/line-keeper-initialize.mts');
 assert.equal(isPublishedProductionDeploy({deploy:{context:'production',publishedAt:at}}),true);
 assert.equal(isPublishedProductionDeploy({deploy:{context:'production',publishedAt:null}}),false);
 assert.equal(isPublishedProductionDeploy({deploy:{context:'deploy-preview',publishedAt:at}}),false);
});

test('reader value comparison never confuses 20 with 2000, and exact native aliases keep their record wrapper',async()=>{
 const {carries,recordsWithIdentity}=await import('../lib/control-plane/line-keeper/record-pages.ts');
 assert.equal(carries({amount:2000},[20]),false);assert.equal(carries({amount:20},[20]),true);
 const vote={roll:{id:'roll',title:'Question'},position:{value:'YEA'}};assert.deepEqual(recordsWithIdentity(vote,'roll'),[vote]);
 assert.equal(recordsWithIdentity({id:'canonical',name:'Person',nativeIds:{reader:['old-id']}},'old-id').length,1);
});

test('one unavailable reader response is retained for the hourly batch instead of being fetched again for every record',async()=>{
 const {observeRecord}=await import('../lib/control-plane/line-keeper/record-pages.ts');let requests=0;
 const page={setDefaultTimeout:()=>{},request:{get:async()=>{requests++;return {status:()=>503};}}} as never;
 const target={version:'v',recordKey:'money:one',kind:'CAMPAIGN_FINANCE',state:'US',collectedAt:from,id:'one',bodyId:'',division:'missing-division',memberId:'',name:'A record',expected:[1]};
 await observeRecord(page,target,at);await observeRecord(page,{...target,id:'two',recordKey:'money:two'},at);
 assert.equal(requests,1);
});

test('a place 503 is observed immediately while the independently working state reader stays available',async()=>{
 const {readPublicPlace}=await import('../lib/control-plane/line-keeper/reader-page.ts');let opens=0,waits=0;
 const coverage={bodies:[],seats:[{ocdId:'ocd-division/country:us',representatives:[{id:'person'}]}],divisions:[],senators:[],statewideExecutives:[],stateLegislatorAuthorities:[]};
 const values=[{path:'/api/reader/state',status:200,value:{coverage,zipPlaces:{'85701':{ids:['ocd-division/country:us'],partial:[]}}}},{path:'/api/meetings',status:503,value:{dataState:'STORE_UNREACHABLE'}}];
 const replies=values.map(v=>({url:()=>`${PUBLIC_SITE_ORIGIN}${v.path}?zip=85701`,status:()=>v.status,json:async()=>v.value}));
 const page={on:()=>{},addInitScript:async()=>{},goto:async()=>{opens++;return {status:()=>200};},waitForResponse:async(predicate:(r:typeof replies[number])=>boolean)=>{waits++;return replies.find(predicate)!;}} as never;
 const read=await readPublicPlace(page,'85701');assert.equal(read.placeStatus,503);assert.match(read.placeError,/STORE_UNREACHABLE/);assert.equal(read.stateStatus,200);
 assert.equal(read.coverage!.seats[0].representatives[0].id,'person');
 assert.equal(await readPublicPlace(page,'85701'),read);assert.equal(opens,1);assert.equal(waits,2);
});

test('TX-01 hourly differences include web and runner clients across Eastern midnight without rescanning old rows',()=>{
 const counter=(day:string,database:string,client:string,bytes:number):TransferCounter=>({day,database,client,bytes,callers:client==='reader'?{'/api/meetings\tcivic_data_promotions':bytes}:{}});
 const sample=(at:string,rows:TransferCounter[],complete=true):TransferSample=>({at,complete,counters:Object.fromEntries(rows.map(r=>[JSON.stringify([r.day,r.database,r.client]),r]))});
 const previous=sample('2026-10-20T03:05:00Z',[counter('2026-10-19','reader','runner',100),counter('2026-10-19','reader','reader',200)]);
 const current=sample('2026-10-20T04:05:00Z',[counter('2026-10-19','reader','runner',150),counter('2026-10-20','reader','runner',50),counter('2026-10-20','reader','reader',300),counter('2026-10-20','control-plane','reader',40)],false);
 const result=transferSince(previous,current);assert.equal(result.reading!.reader,400);assert.equal(result.reading!.control,40);
 assert.ok(result.reading!.byCaller.some(c=>c.caller.includes('/api/meetings')&&c.bytes===300));
 assert.equal(Object.keys(result.sample!.counters).length,5,'unchanged counters remain in the keeper’s cache');
 assert.equal(transferSince(undefined,current).reading,null,'a first partial read never claims a full hour');
 assert.equal(transferSince(previous,{...current,at:'2026-10-20T05:05:00Z'}).sample!.complete,false,'a missed hour invalidates the baseline rather than inventing its split');
});

test('an unresolved meeting delivery check does not expire with the weekly display window',()=>{
 const row:KeeperPosting={versionId:'old',recordKey:'meeting:old',kind:'MEETING_CHANGED',postedAt:null,firstSeenAt:'2026-10-01T00:00:00Z',lastUnchangedAt:null,liveAt:null,basis:'FIRST_SEEN',minutesToLive:null,startsAt:null,insideSevenDayWindow:null};
 assert.equal(foldPosting([row],[],[],at).length,1);
 assert.equal(foldPosting([{...row,liveAt:from}],[],[],at).length,1,'a stamp alone does not end the independent live-page obligation');
 assert.equal(foldPosting([{...row,liveAt:from,pageSeenAt:at}],[],[],at).length,0);
});

test('a quiet hour preserves a failed country input as unavailable instead of blessing the old score as fresh',async()=>{
 const caches=US_STATES.map(s=>({state:s.code,score:0,measuredAt:from,error:s.code==='az'?'The source read failed':null,capture:{subjects:[],held:[]}}));
 const control={query:async()=>[{overlay:null}]} as never,reader={query:async()=>[]} as never;
 const scores=await publishCountryScores(control,reader,from,through,at,{readOnly:true,previewCache:caches});
 assert.equal(scores.find(s=>s.state==='az')!.error,'The source read failed');
 assert.equal(scores.find(s=>s.state==='nh')!.error,null);
});

test('real migrated Admin storage keeps keeper fixes outside config and preserves current settings and other repairs',async()=>{
 const {writeFixes,readFixConfig}=await import('../lib/control-plane/line-keeper/keep.ts');
 const db=await keeperDatabase();try{
 const config={...defaultAdminConfig(at),settings:{'alerts.on':false,'research.paid':false},unrelated:'retained'};
 await db.query(`INSERT INTO cp_admin_config(id,revision,updated_at,value) VALUES ('current',1,$1,$2)`,[at,JSON.stringify(config)]);
 await db.query(`INSERT INTO cp_admin_fix_list(config_id,id,updated_at,value) VALUES ('current','other',$1,$2)`,[from,JSON.stringify({id:'other',addedBy:'Owner',state:'OPEN'})]);
 const sql={query:async(text:string,params:readonly unknown[]=[]) => (await db.query<Record<string,unknown>>(text,[...params])).rows};
 const hour=composeHour(input(),state(),at),saved=await writeFixes(sql,hour);
 assert.ok(saved.growth.fixBytes>0);assert.ok(saved.growth.totalBytes<saved.growth.fixBytes+saved.growth.briefBytes);
 const stored=(await db.query<{value:typeof config & {fixList?:unknown}}> ('SELECT value FROM cp_admin_config')).rows[0].value;
 assert.equal(stored.fixList,undefined);assert.deepEqual(stored.settings,config.settings);assert.equal(stored.unrelated,'retained');
 assert.equal((await db.query<{n:number}>("SELECT count(*)::int n FROM cp_admin_fix_list WHERE id='other'")).rows[0].n,1);
 const later=await readFixConfig(sql,'2026-10-20T09:05:00Z',saved.fixes);assert.equal(later.value.fixList!.length,saved.fixes.length,'old open fixes survive outside the changed-row interval');
 }finally{await db.close();}
});

test('a missed country input interval stays unread until the separate initializer repairs it',async()=>{
 const caches=US_STATES.map(s=>({state:s.code,score:0,measuredAt:'2026-10-20T04:00:00Z',error:null,capture:{subjects:[],held:[]}}));
 const sql={query:async(text:string)=>text.includes('civic_data_promotions')?[{place:'US-AZ:directory',record_class:'FEDERAL_DIRECTORY',scope:'US-AZ:directory'}]:[]} as never;
 const result=await publishCountryScores(sql,sql,from,through,at,{readOnly:true,previewCache:caches});
 assert.ok(result.every(s=>s.error?.startsWith('The country inputs missed an hourly interval.')));
});
