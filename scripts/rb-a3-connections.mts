import assert from 'node:assert/strict';
import { readFileSync,statSync,writeFileSync } from 'node:fs';
import { openFactCopy,type FactSnapshot } from './rb-a3-copy.mts';
import { indexReportedFinding } from '../lib/control-plane/box.ts';
import { createMemoryRepositories } from '../lib/control-plane/repository/memory.ts';
import { publishBoxFindings } from '../lib/facts/box-publication.ts';
import { MemoryRoutineDataStore } from '../lib/civic-data/store.ts';
import { IndependentRuntimeLaneScheduler } from '../lib/ops/independent-runtime-pass.ts';
import { publishNowLane,PUBLISH_NOW_INTERVAL_MS } from '../lib/civic-data/publish-now.ts';
import { door } from '../lib/core/door.ts';
import { vaultCapture } from '../lib/facts/capture.ts';
import { DurableEvidenceStore } from '../lib/control-plane/evidence/durable-store.ts';
import { pageCopy } from '../lib/facts/source-copy.ts';
import { factClocks } from '../lib/facts/clocks.ts';
import { readBodyFacts } from '../lib/facts/registry-overlay.ts';
import { stateCoverage } from '../lib/reader/coverage.ts';
import { readFactStore } from '../lib/facts/admin-read.ts';
import { districtCardSources } from '../lib/officials/card-sources.ts';
import type { RegistryRuntimeReadModel } from '../lib/registry/runtime-data-plane.ts';
const dir=process.argv[2]??'.scratch/rb-a3';
const wallClock=process.argv.includes('--wall-clock');
const snapshot=JSON.parse(readFileSync(`${dir}/snapshots/AZ.json`,'utf8')) as FactSnapshot;
const db=await openFactCopy(snapshot);
try {
 const vault=new DurableEvidenceStore(`${dir}/connection-vault`);
 const id='ocd-division/country:us/state:az/place:mesa#governing';
 const sources=[{file:'mesa-api.txt',url:'https://webapi.legistar.com/v1/mesa/Bodies?$filter=BodyActiveFlag%20eq%201'},
  {file:'mesa-gov.txt',url:'https://www.mesaaz.gov/Government/Mayor-City-Council'}];
 const captures=[];
 for(const source of sources){const file=`${dir}/${source.file}`;const bytes=readFileSync(file);const observedAt=statSync(file).mtime.toISOString();
  const saved=await vaultCapture({vault,url:source.url,bytes,httpStatus:200,contentType:'text/plain',retrievedAt:observedAt});
  if('error' in saved)throw Error(saved.error); captures.push({record:saved.record,capture:saved.capture,copy:pageCopy({finalUrl:source.url,body:bytes.toString('utf8'),contentType:'text/plain',fetchedAt:observedAt})});
 }
 const api=readFileSync(`${dir}/mesa-api.txt`,'utf8');
 const recordXml=[...api.matchAll(/<GranicusBody>([\s\S]*?)<\/GranicusBody>/g)].find(m=>m[1].includes('<BodyId>138</BodyId>'))![1];
 const record=Object.fromEntries([...recordXml.matchAll(/<(Body\w+)>([^<]*)<\//g)].map(m=>[m[1],m[2]]));
 assert.equal(record.BodyName,'City Council');
 const gov=readFileSync(`${dir}/mesa-gov.txt`,'utf8');
 const address=/20 E\. Main Street\nMesa, AZ 85201/.exec(gov)![0];
 // Controlled runs stay after the captures in one hour; wall-clock runs use the real minute timer.
 const capturedAt=Math.max(...captures.map(held=>Date.parse(held.capture.observedAt)));
 const now=wallClock?new Date():new Date(Math.ceil(capturedAt/3_600_000)*3_600_000+5*60_000);
 const official=await door(db,{subjectId:id,field:'name',fieldKind:'officeholder',value:record.BodyName,valueText:record.BodyName,quote:'',
  provenance:'OFFICIAL',producedBy:'rb-a3-copy-api',acquisition:'loader',costUsd:0,...captures[0],sourceField:{record,key:'BodyName'}},factClocks(null),now,{purge:async()=>({purged:true})});
 assert.equal('decision' in official&&official.decision,'PUBLISH');
 const repos=createMemoryRepositories(),store=new MemoryRoutineDataStore();
 for(const held of captures)await repos.artifacts.append(held.record.workItemId,held.record.artifactId,held.record,held.record.recordedAt);
 let at=wallClock?Date.now():now.getTime();const passes:unknown[]=[];const startedAt:string[]=[];
 const scheduler=new IndependentRuntimeLaneScheduler([publishNowLane(async()=>{
  startedAt.push(new Date(at).toISOString());
  passes.push(await publishBoxFindings({repos,store,facts:db,vault,fetch:async()=>{throw Error('Both source copies are saved inside their clocks');},
   clocks:factClocks(null),now:new Date(at).toISOString(),limit:10,audit:false,purge:async()=>({purged:true})}));
 })]);
 const nextTick=async()=>{
  if(!wallClock){at+=PUBLISH_NOW_INTERVAL_MS;assert.deepEqual(scheduler.tick(at),['publish-now']);await scheduler.waitForIdle();return;}
  await new Promise<void>((resolve,reject)=>{const timer=setInterval(()=>{
   at=Date.now();if(scheduler.tick(at).length){clearInterval(timer);void scheduler.waitForIdle().then(resolve,reject);}
  },250);});
 };
 assert.deepEqual(scheduler.tick(at),['publish-now']);await scheduler.waitForIdle();
 await indexReportedFinding(repos.boxFindings,{workItemId:captures[1].record.workItemId,attemptId:'copy-hunter',obligationId:`hunt:packet:${id}`,missionPart:null,
  finding:{subjectId:id,field:'district.address',value:address,exactQuote:address,sourceUrl:sources[1].url,artifactIds:[captures[1].record.artifactId],subjectHint:null,index:0}},new Date(at).toISOString());
 assert.deepEqual(scheduler.tick(at+PUBLISH_NOW_INTERVAL_MS-1),[]);
 await nextTick();
 const [checked]=await db.query("SELECT id,value,quote_start FROM fact WHERE entity_id=$1 AND field='office_address' AND status='live'",[id]);
 assert.equal(checked?.value,address);assert.equal(typeof checked?.quote_start,'number');
 const unchanged=()=>db.query(`SELECT jsonb_build_object('facts',(SELECT jsonb_agg(f) FROM fact f),'sources',(SELECT jsonb_agg(s) FROM source_copy s),
  'counts',(SELECT jsonb_agg(c) FROM count_hour c),'queue',(SELECT jsonb_agg(q) FROM rebuild_queue q)) value`);
 const before=await unchanged();await nextTick();
 assert.deepEqual(await unchanged(),before);
 assert.equal(startedAt.length,3);
 for(let i=1;i<startedAt.length;i++)assert(Date.parse(startedAt[i])-Date.parse(startedAt[i-1])>=PUBLISH_NOW_INTERVAL_MS);
 const facts=await readBodyFacts(db.query,[id],true);
 const runtime:RegistryRuntimeReadModel={formatVersion:1,registry:JSON.parse(readFileSync(`${dir}/mesa-runtime.json`,'utf8')),
  bodyRosters:[],rosterReaderDispositions:[],statewideExecutives:[],officialPhotos:{photos:[]},rosterPhotos:{},
  officialCandidacies:{formatVersion:1,rule:'EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE',rows:[]}};
 const baseline=JSON.parse(readFileSync(`${dir}/mesa-meetings.json`,'utf8'));
 const coverage=stateCoverage({state:'AZ',registry:runtime,version:runtime.registry.generatedAt},[id.split('#')[0]],baseline.center.lat,baseline.center.lng,[],facts);
 const generated=coverage.bodies.find(b=>b.bodyId===id)!;
 assert.equal(generated.name,record.BodyName);assert.equal(generated.officeContact?.address,address);
 const sourcesOnCard=districtCardSources([],[],generated.officeContact?.provenance,generated.fieldSources);
 assert(sourcesOnCard.some(s=>s.provenance.sourceUrl===sources[0].url));assert(sourcesOnCard.some(s=>s.provenance.sourceUrl===sources[1].url));
 const projected=structuredClone(baseline);
 projected.coverage.bodies=baseline.coverage.bodies.map((b:{bodyId:string})=>b.bodyId===id?{...b,name:generated.name,officeContact:generated.officeContact,fieldSources:generated.fieldSources}:b);
 assert.deepEqual(projected.stateResponse,baseline.stateResponse);assert.deepEqual(projected.meetings,baseline.meetings);assert.deepEqual(projected.coverage.seats,baseline.coverage.seats);
 assert.deepEqual(projected.coverage.bodies.map((b:{bodyId:string})=>b.bodyId),baseline.coverage.bodies.map((b:{bodyId:string})=>b.bodyId));
 writeFileSync(`${dir}/mesa-copy-meetings.json`,JSON.stringify(projected));
 const admin=await readFactStore(async statements=>Promise.all(statements.map(s=>db.query(s.text,s.params))),now);
 writeFileSync(`${dir}/copy-admin-hours.json`,JSON.stringify(admin.hours));
 const report={observedAt:new Date().toISOString(),clockStart:now.toISOString(),official,checked,nextRun:{intervalMs:PUBLISH_NOW_INTERVAL_MS,mode:wallClock?'wall-clock timer':'controlled clock',startedAt,passes,repeatUnchanged:true},sources:sources.map(s=>s.url),subject:id,
  reader:{name:generated.name,address:generated.officeContact?.address,bodiesRetained:baseline.coverage.bodies.length,meetingsRetained:baseline.meetings.length,seatsRetained:baseline.coverage.seats.length+baseline.stateResponse.value.coverage.seats.length},
  counts:await db.query('SELECT state,hour,step,n::int FROM count_hour ORDER BY state,hour,step'),queue:await db.query('SELECT place_id FROM rebuild_queue ORDER BY place_id')};
 writeFileSync(`${dir}/connections.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await db.pg.close();}
