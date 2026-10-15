import type { ScoutResult } from '../lib/control-plane/scheduler/scout-result.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { plainAdapterFor, workAdapterQueue } from '../lib/control-plane/workers/engineering-adapter.ts';
import {createMemoryRepositories} from './helpers/playbooks.ts';
import {MODELS} from '../lib/models.ts';
import {SendBudgetRefusal} from '../lib/control-plane/expansion/spend-holds.ts';
import {readFieldManual} from '../lib/control-plane/field-manual.ts';
import { sourceReliabilityKey, reduceSourceReliability } from '../lib/control-plane/scheduler/scout-reliability.ts';
import { installedAdapters, runInstalledAdapter } from '../lib/control-plane/scheduler/scout-adapters.ts';
import { readClientSource } from '../lib/control-plane/scheduler/scout-clients.ts';
import { retryable } from '../lib/control-plane/scheduler/debt.ts';

test('source backoff is per Legistar tenant, not the vendor',()=>{
 assert.notEqual(sourceReliabilityKey('https://webapi.legistar.com/v1/pima/Events'),sourceReliabilityKey('https://webapi.legistar.com/v1/tucson/Events'));
 assert.equal(sourceReliabilityKey('https://webapi.legistar.com/v1/pima/Events'),sourceReliabilityKey('https://webapi.legistar.com/v1/pima/Bodies'));
});

test('Admin compact acquisitions share chronological source backoff and recovery',()=>{
 const rows = [
  {url:'https://webapi.legistar.com/v1/pima/Events',verdict:'FAILED',endedAt:'2026-09-30T02:00:00Z',blockerText:['Timeout','Try alternate route']},
  {url:'https://webapi.legistar.com/v1/tucson/Events',verdict:'ACQUIRED',endedAt:'2026-09-30T01:30:00Z',blockerText:[]},
  {url:'https://webapi.legistar.com/v1/pima/Bodies',verdict:'FAILED',endedAt:'2026-09-30T01:00:00Z',blockerText:['HTTP 503']},
 ];
 const original = structuredClone(rows);
 const sources = reduceSourceReliability(rows);
 const pima = sources.find(row=>row.source.endsWith('/pima'))!;
 assert.equal(pima.failures,2);assert.equal(pima.successes,0);assert.equal(pima.consecutiveFailures,2);
 assert.equal(pima.retryAt,'2026-09-30T02:30:00.000Z');assert.equal(pima.detail,'Timeout; Try alternate route');
 assert.equal(sources.find(row=>row.source.endsWith('/tucson'))!.retryAt,null);
 assert.deepEqual(rows,original);
 const recovered = reduceSourceReliability([...rows,{...rows[0],verdict:'ACQUIRED',endedAt:'2026-09-30T03:00:00Z'}])
  .find(row=>row.source.endsWith('/pima'))!;
 assert.equal(recovered.failures,2);assert.equal(recovered.successes,1);assert.equal(recovered.consecutiveFailures,0);
 assert.equal(recovered.retryAt,null);assert.equal(recovered.detail,'Source returned captured data');
 const capped = reduceSourceReliability(Array.from({length:2058},()=>rows[0]))[0];
 assert.equal(capped.retryAt,'2026-09-30T08:00:00.000Z');
 const robots = {...rows[0], blockerCodes:['PERMISSION_DENIED'], blockerText:['Legacy robots refusal']};
 assert.deepEqual(reduceSourceReliability([robots]),[], 'robots-only history is not a source outage');
 assert.equal(reduceSourceReliability([{...robots,blockerCodes:['PERMISSION_DENIED','TRANSPORT_FAILED']}])[0].failures,1,
  'a real retrieval failure still backs off when robots was also observed');
});
test('adapter work does not keep retrying',()=>{
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

test('an installed adapter reads every held link without a request',async()=>{
 assert.ok((await installedAdapters()).includes('uncapped-source-links'));
 for(const source of ['https://county.gov/','https://city.gov/']) {
  const links=await runInstalledAdapter('uncapped-source-links',Array.from({length:95},(_,i)=>'<a href="/record/'+i+'">Record '+i+'</a>').join(''),source) as {url:string;sourceUrl:string}[];
  assert.equal(links.length,95);assert.ok(links.every(row=>row.sourceUrl===source));
 }
 await assert.rejects(runInstalledAdapter('../private','', 'https://county.gov'),/NOT_INSTALLED/);
});

test('Engineer saves captured source URLs with its reusable adapter knowledge',async()=>{
 const repos=createMemoryRepositories(),now='2026-10-02T00:00:00Z';
 const source={refusal:null,outcome:'NEEDS_ADAPTER',subjectId:'first-tenant',recordClass:'meetings',attemptId:'failed',recordedAt:now,
  narrative:'A new calendar format needs a parser',artifactIds:['held'],nextRungs:[],findings:[],
  candidates:[{routeId:'test-uninstalled-source-parser',url:'https://platform.example/first-tenant/calendar',evidenceArtifactIds:['held']}],
  rungs:[{ok:true,target:'https://platform.example/sitemap.xml',artifactIds:['held']},
    {ok:false,target:'https://other.example/failed',artifactIds:[]},
    {ok:true,target:'https://other.example/uncaptured',artifactIds:[]}]} as unknown as ScoutResult;
 const files=[{path:'lib/sources/platform-adapters/test-uninstalled-source-parser.ts',content:'export const parser=true;'},
  {path:'lib/sources/platform-adapters/test-uninstalled-source-parser.test.ts',content:'export const test=true;'}];
 await workAdapterQueue({repos,results:[source],now,readEvidence:async()=>({text:'Saved calendar source',canonicalUrl:'https://platform.example/sitemap.xml',artifactId:'held'} as never),
  transportFor:()=>async()=>({model:MODELS.haiku.model,stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({files})}],
    usage:{input_tokens:100,output_tokens:10,cache_read_input_tokens:0,cache_creation_input_tokens:0}}),request:async(method,path)=>path.includes('/git/matching-refs/')?[]
  :path.endsWith('/git/ref/heads/river')?{object:{sha:'base'}}:path.endsWith('/git/commits/base')?{tree:{sha:'base-tree'}}:{sha:'created'}});
 const entry=(await readFieldManual(repos,{role:'DETECTIVE'})).store.entries.find(e=>e.kind==='ENGINEER_ADAPTER_PR' && (e.payload as {sourceAttemptId?:string}).sourceAttemptId===source.attemptId)!;
 assert.deepEqual(entry.recordClasses,['meetings']);
 assert.deepEqual((entry.payload as {sourceUrls:string[]}).sourceUrls,['https://platform.example/first-tenant/calendar','https://platform.example/sitemap.xml']);
});

test('the shared Legistar client preserves source bytes and date-window paging',async()=>{
 const requests:string[]=[];
 const calendar=await readClientSource('legistar_events',{tenant:'pima',from:'2026-09-29',to:'2026-12-28'},{fetchImpl:async(url)=>{requests.push(String(url));return new Response(JSON.stringify([{EventId:123,EventDate:'2026-10-01'}]));}});
 assert.equal(JSON.parse(calendar.text).data[0].EventId,123);assert.match(requests[0],/EventDate/);assert.equal(calendar.requests,1);
 await assert.rejects(readClientSource('legistar_events',{tenant:'../private',from:'2026-09-29',to:'2026-12-28'},{}),/WINDOW_REQUIRED/);
});

test('Engineer uses guarded named tiers, preserves held context, accounts requests and stops exhausted repeats',async()=>{
 const repos=createMemoryRepositories(),models:string[]=[];
 const source={refusal:null,outcome:'NEEDS_ADAPTER',subjectId:'county',recordClass:'officials',attemptId:'failed-parse',
   obligationId:'obligation',workItemId:'work',recordedAt:'2026-09-29',narrative:'A new civic feed needs a parser',rungs:[],candidates:[],nextRungs:[],findings:[],artifactIds:['held']} as unknown as ScoutResult;
 const input={repos,results:[source],now:'2026-09-30T00:00:00Z',readEvidence:async()=>({text:'Clerk Ada',canonicalUrl:'https://county.gov/clerk',artifactId:'held'} as never),
   transportFor:()=>async(request:import('../lib/control-plane/scheduler/scout-executor.ts').ModelRequest)=>{
     models.push(request.model);assert.match(JSON.stringify(request.messages),/Clerk Ada/);
     return {model:request.model,stop_reason:'end_turn',content:[{type:'text' as const,text:'{"files":[]}'}],usage:{input_tokens:100,output_tokens:10,cache_read_input_tokens:0,cache_creation_input_tokens:0}};
   }};
 await workAdapterQueue(input);
 assert.deepEqual(models,[MODELS.haiku.model,MODELS.sonnet.model,MODELS.opus.model]);
 const costs=await repos.costs.readAll();assert.equal(costs.length,3);assert.ok(costs.every(c=>c.role==='ENGINEERING' && c.cost.usd!>0));
 await workAdapterQueue(input);assert.equal(models.length,3);
});

test('Engineer does not escalate or publish when the existing budget transport refuses',async()=>{
 const repos=createMemoryRepositories();let calls=0;
 const source={refusal:null,outcome:'NEEDS_ADAPTER',subjectId:'county',recordClass:'officials',attemptId:'refused',recordedAt:'2026-09-29',
   narrative:'A new civic feed needs a parser',rungs:[],candidates:[],nextRungs:[],findings:[],artifactIds:['held']} as unknown as ScoutResult;
 const prs=await workAdapterQueue({repos,results:[source],now:'2026-09-30',readEvidence:async()=>({text:'Clerk Ada'} as never),
   transportFor:()=>async()=>{calls++;throw new SendBudgetRefusal('CEILING','already spent');},request:async()=>{throw Error('Must not publish');}});
 assert.deepEqual(prs,[]);assert.equal(calls,1);assert.equal((await repos.costs.readAll()).length,0);
});
