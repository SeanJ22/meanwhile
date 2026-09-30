import type { ScoutResult } from '../lib/control-plane/scheduler/scout-result.ts';
import { SCOUT_HELD_EVIDENCE_PROTOCOL_VERSION } from "../lib/control-plane/scheduler/scout-result.ts";
import test from 'node:test';
import assert from 'node:assert/strict';
import { publishAdapterPullRequest, plainAdapterFor } from '../lib/control-plane/workers/engineering-adapter.ts';
import { sourceReliabilityKey } from '../lib/control-plane/scheduler/scout-reliability.ts';
import { adapterWaitReason, investigationRole, subjectScoutHistory, reusableScoutCandidates, scoutFactGrounded, failureNeedsInvestigation, failureResponderExecutor } from '../lib/control-plane/workers/detective.ts';
import { installedAdapters, runInstalledAdapter } from '../lib/control-plane/scheduler/scout-adapters.ts';
import { readClientSource } from '../lib/control-plane/scheduler/scout-clients.ts';
import { retryable } from '../lib/control-plane/scheduler/debt.ts';

test('adapter PR publication creates only adapter files and applies the merge label',async()=>{
 const calls:{method:string;path:string;body:unknown}[]=[];
 const pr=await publishAdapterPullRequest({platform:'calendar-platform',reason:'Repair recurring parse failures',files:[{path:'lib/sources/platform-adapters/calendar.mjs',content:'export const adapter = true;'}],request:async(method,path,body)=>{
   calls.push({method,path,body});
   if(path.includes('/pulls?'))return [];
   if(path.endsWith('/git/ref/heads/main'))return {object:{sha:'base'}};
   if(path.endsWith('/git/commits/base'))return {tree:{sha:'base-tree'}};
   if(path.endsWith('/git/trees'))return {sha:'tree'};
   if(path.endsWith('/git/commits'))return {sha:'commit'};
   if(path.endsWith('/pulls'))return {html_url:'https://github.com/SeanJ22/meanwhile/pull/999',number:999};
   return {};
 }});
 assert.equal(pr.number,999);assert.deepEqual(calls.at(-1)?.body,{labels:['engineer-adapter']});
 assert.deepEqual((calls.find(c=>c.path.endsWith('/git/trees'))?.body as {tree:{path:string}[]}).tree.map(f=>f.path),['lib/sources/platform-adapters/calendar.mjs']);
});
test('Engineer refuses publication outside its adapter-only ownership',async()=>{
 let called=false;
 await assert.rejects(publishAdapterPullRequest({platform:'calendar',reason:'test',files:[{path:'.github/workflows/code.yml',content:'unsafe'}],request:async()=>{called=true;return {};}}),/ADAPTER_FILES_ONLY/);
 assert.equal(called,false);
});
test('source backoff is per Legistar tenant, not the vendor',()=>{
 assert.notEqual(sourceReliabilityKey('https://webapi.legistar.com/v1/pima/Events'),sourceReliabilityKey('https://webapi.legistar.com/v1/tucson/Events'));
 assert.equal(sourceReliabilityKey('https://webapi.legistar.com/v1/pima/Events'),sourceReliabilityKey('https://webapi.legistar.com/v1/pima/Bodies'));
});
test('failed roles select Detective and adapter work does not keep retrying',()=>{
 const result={recoveryCapabilityVersion:SCOUT_HELD_EVIDENCE_PROTOCOL_VERSION,refusal:null,outcome:'NEEDS_ADAPTER',narrative:'Parser for platform needed',subjectId:'county',recordClass:'meetings',recordedAt:'2026-09-29',workItemId:'other-job'} as unknown as ScoutResult;
 assert.equal(investigationRole([result],false),'DETECTIVE');
 assert.match(adapterWaitReason([result])!,/Engineer owns/);
 assert.equal(subjectScoutHistory([result],'county','meetings').length,1);
 assert.equal(subjectScoutHistory([result],'other-county','meetings').length,0);
 assert.deepEqual(retryable([{cause:'AWAITING_ADAPTER',retryAt:'2020-01-01'} as Parameters<typeof retryable>[0][number]],Date.now()),[]);
});
test('plain Engineer reuses a dated sitemap implementation across government subjects',async()=>{
 const candidate=plainAdapterFor({refusal:null,outcome:'NEEDS_ADAPTER',narrative:'Streamline dated sitemap needs adapter',candidates:[],nextRungs:[]} as unknown as ScoutResult)!;
 const source=candidate.files.find(file=>!file.path.includes('.test.'))!.content;
 const adapterModule=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 for(const publisherOrigin of ['https://first.gov','https://second.gov']) {
  const url=publisherOrigin+'/2026-09-30-board';
  const output=adapterModule.inventoryStreamlineSitemap({xml:'<urlset><url><loc>'+url+'</loc></url></urlset>',subjectId:publisherOrigin,publisherOrigin});
  assert.equal(output.entries[0].sourceUrl,url);
 }
});

test('facts-only Scout success supplies a source to every job for its subject, grounded in exact bytes',()=>{
 const result={refusal:null,subjectId:'county',recordClass:'officials',recordedAt:'2026-09-29T00:00:00Z',candidates:[],findings:[{field:'holder',value:'Ada Clerk',exactQuote:'Council holder: Ada Clerk',sourceUrl:'https://county.gov/council',artifactIds:['saved'],kind:'RECORD'}]} as unknown as ScoutResult;
 assert.equal(reusableScoutCandidates(result)[0].url,'https://county.gov/council');
 assert.equal(scoutFactGrounded(result,'https://county.gov/council','Council holder: Ada Clerk'),true);
 assert.equal(scoutFactGrounded(result,'https://county.gov/council','Different holder'),false);
 assert.equal(scoutFactGrounded(result,'https://other.gov/council','Council holder: Ada Clerk'),false);
 assert.equal(reusableScoutCandidates({...result,refusal:{issues:[]}} as unknown as ScoutResult).length,0);
});

test('an installed adapter wakes its class and reads every held link without a request',async()=>{
 assert.ok((await installedAdapters()).includes('uncapped-source-links'));
 const latest={refusal:null,outcome:'NEEDS_ADAPTER',recoveryCapabilityVersion:SCOUT_HELD_EVIDENCE_PROTOCOL_VERSION,narrative:'Need uncapped links from raw HTML extraction',nextRungs:[],candidates:[]} as unknown as ScoutResult;
 assert.match(adapterWaitReason([latest])!,/AWAITING_ADAPTER/);
 assert.equal(adapterWaitReason([latest],['uncapped-source-links']),null);
 assert.match(adapterWaitReason([latest],['other-platform'])!,/AWAITING_ADAPTER/);
 for(const source of ['https://county.gov/','https://city.gov/']) {
  const links=await runInstalledAdapter('uncapped-source-links',Array.from({length:95},(_,i)=>'<a href="/record/'+i+'">Record '+i+'</a>').join(''),source) as {url:string;sourceUrl:string}[];
  assert.equal(links.length,95);assert.ok(links.every(row=>row.sourceUrl===source));
 }
 await assert.rejects(runInstalledAdapter('../private','', 'https://county.gov'),/NOT_INSTALLED/);
});

test('failed acquisition and blank parse reach a Detective before another unchanged retry',()=>{
 for(const verdict of ['BLOCKED','REFUSED','AMBIGUOUS']) {
  const records=[{endedAt:'2026-09-29T01:00:00Z',result:{verdict,findings:[]}}] as unknown as Parameters<typeof failureNeedsInvestigation>[0];
  assert.equal(failureNeedsInvestigation(records,[]),true);
  const reply={researchRole:'DETECTIVE',refusal:null,recordedAt:'2026-09-29T02:00:00Z'} as ScoutResult;
  assert.equal(failureNeedsInvestigation(records,[reply]),false);
  assert.equal(failureNeedsInvestigation(records,[{...reply,recordedAt:'2026-09-28T02:00:00Z'}]),true);
 }
});

test('shared client tools preserve source bytes and date-window paging',async()=>{
 const rows=Array.from({length:90},(_,i)=>'person-'+i+',Member '+i+',lower,'+(i+1)).join('\n');
 const csv='id,name,current_chamber,current_district\n'+rows;
 const plural=await readClientSource('plural_roster',{state:'AZ'},{fetchImpl:async()=>new Response(csv) as never});
 assert.equal(JSON.parse(plural.text).data.length,90);assert.equal(JSON.parse(plural.text).captures[0].text,csv);
 assert.equal(plural.sourceUrl,'https://data.openstates.org/people/current/az.csv');
 const requests:string[]=[];
 const calendar=await readClientSource('legistar_events',{tenant:'pima',from:'2026-09-29',to:'2026-12-28'},{fetchImpl:async(url)=>{requests.push(String(url));return new Response(JSON.stringify([{EventId:123,EventDate:'2026-10-01'}]));}});
 assert.equal(JSON.parse(calendar.text).data[0].EventId,123);assert.match(requests[0],/EventDate/);assert.equal(calendar.requests,1);
 await assert.rejects(readClientSource('legistar_events',{tenant:'../private',from:'2026-09-29',to:'2026-12-28'},{}),/WINDOW_REQUIRED/);
});

test('the legacy research lane declares a failure responder before dispatch and assembles context once',()=>{
 for(const failed of [false,true]) {
  let reads=0;
  const executor=failureResponderExecutor({transport:async()=>{throw Error('No model call expected');},toolkitFor:()=>{throw Error('No tool call expected');},contextFor:()=>{
   reads++;return {route:null,providerId:null,reason:'fill missing field',decision:'BOUNDED_MODEL_WORKER',tools:{vault:async()=>{throw Error('No vault call expected');},spaceOut:async()=>{}},inherited:{artifactIds:[],summary:failed?'REFUSED: SCOUT_TRANSPORT_FAILED':''}};
  }});
  const args={obligation:{obligation:{id:'legacy-gap'}},holder:'worker',executor:'BOUNDED_MODEL_WORKER'} as Parameters<NonNullable<typeof executor.workerFor>>[0];
  assert.equal(executor.workerFor!(args).role,failed?'DETECTIVE':'SCOUT');
  executor.workerFor!(args);assert.equal(reads,1);
 }
});
