import type { ScoutResult } from '../lib/control-plane/scheduler/scout-result.ts';
import { SCOUT_HELD_EVIDENCE_PROTOCOL_VERSION } from "../lib/control-plane/scheduler/scout-result.ts";
import test from 'node:test';
import assert from 'node:assert/strict';
import { publishAdapterPullRequest, plainAdapterFor, workAdapterQueue } from '../lib/control-plane/workers/engineering-adapter.ts';
import {createMemoryRepositories} from '../lib/control-plane/repository/memory.ts';
import {MODELS} from '../lib/models.ts';
import {SendBudgetRefusal} from '../lib/control-plane/expansion/spend-holds.ts';
import {solvedScoutResult,readSubjectScoutHistory,wakeInstalledAdapterDebts,adapterWaitReasonFromKnowledge} from '../lib/control-plane/workers/detective.ts';
import {newFieldManualEntry,writeFieldManual,readFieldManual} from '../lib/control-plane/field-manual.ts';
import { sourceReliabilityKey, reduceSourceReliability } from '../lib/control-plane/scheduler/scout-reliability.ts';
import { adapterWaitReason, investigationRole, subjectScoutHistory, reusableScoutCandidates, scoutFactGrounded, failureResponderExecutor } from '../lib/control-plane/workers/detective.ts';
import { installedAdapters, installedAdapterVersion, runInstalledAdapter } from '../lib/control-plane/scheduler/scout-adapters.ts';
import { readClientSource } from '../lib/control-plane/scheduler/scout-clients.ts';
import { retryable } from '../lib/control-plane/scheduler/debt.ts';
import { sourceFailureRecovery } from '../lib/control-plane/workers/detective.ts';
import type { FreshnessDebt } from '../lib/control-plane/scheduler/debt.ts';
import type { RouteDescriptor } from '../lib/control-plane/scheduler/registry.ts';

test('a passing outage stays a free retry; a shut door reaches Detective with the failed route',()=>{
 const decision={kind:'DETERMINISTIC' as const,why:'Known HTTP_GET shape',disagreement:null};
 const debt={obligationId:'owed',cause:'UPSTREAM_ERROR',target:'search-provider',detail:'HTTP 504',
   lastFailedAt:'2026-10-01T05:27:35Z',consecutiveFailures:1,retryAt:'2026-10-01T05:42:35Z'} as FreshnessDebt;
 for(const cause of ['RATE_LIMITED','UPSTREAM_ERROR','TRANSPORT_FAILED'] as const) {
  assert.equal(sourceFailureRecovery(decision,{...debt,cause}),decision,`${cause} once is a plain retry`);
  assert.equal(sourceFailureRecovery(decision,{...debt,cause,consecutiveFailures:2}),decision);
  const shut=sourceFailureRecovery(decision,{...debt,cause,consecutiveFailures:3});
  assert.equal(shut.kind,'BOUNDED_MODEL_WORKER');
  assert.match(shut.why,/search-provider.*2026-10-01T05:27:35Z/);assert.match(shut.why,/HTTP 504/);
  assert.equal(sourceFailureRecovery(decision,{...debt,cause,consecutiveFailures:2},2).kind,'BOUNDED_MODEL_WORKER','the threshold is a parameter');
 }
 for(const cause of ['REFUSED_BY_HOST','EXTRACTION_FAILED'] as const)
  assert.equal(sourceFailureRecovery(decision,{...debt,cause}).kind,'BOUNDED_MODEL_WORKER',`${cause} goes at once`);
 for(const cause of ['AWAITING_ADAPTER','AWAITING_ROUTINE_READ','NEVER_DISPATCHED','WORKER_LOST'] as const)
  assert.equal(sourceFailureRecovery(decision,{...debt,cause,consecutiveFailures:9}),decision);
 assert.equal(sourceFailureRecovery(decision,{...debt,cause:'REFUSED_BY_HOST',consecutiveFailures:0}),decision);
 assert.equal(sourceFailureRecovery(decision,null),decision);
 assert.equal(debt.retryAt,'2026-10-01T05:42:35Z','recovery does not change source backoff');
});

test('a source failure after discovery reopens Detective; a later solved route remains reusable',async()=>{
 const solved={attemptId:'solved',recordedAt:'2026-10-01T00:00:00Z',refusal:null,candidates:[],findings:[]} as unknown as ScoutResult;
 const debt={obligationId:'owed',cause:'UPSTREAM_ERROR',target:'api.example.gov',detail:'HTTP 504',
   lastFailedAt:'2026-10-01T01:00:00Z',consecutiveFailures:3} as FreshnessDebt;
 const input={obligation:{obligation:{id:'owed'}},holder:'worker'} as Parameters<NonNullable<ReturnType<typeof failureResponderExecutor>['workerFor']>>[0];
 const make=(recordedAt:string)=>failureResponderExecutor({solved:{...solved,recordedAt},sourceFailure:debt,
  transport:async()=>{throw Error('No model expected in selection');},toolkitFor:()=>{throw Error('No tools');},
  contextFor:()=>({route:null,providerId:null,reason:'failed source',decision:'BOUNDED_MODEL_WORKER',inherited:{artifactIds:[],summary:''},
   tools:{vault:async()=>({stored:true,where:'test',why:'saved'}),spaceOut:async()=>{}}})});
 const failed=make(solved.recordedAt);
 assert.equal(failed.lane,'BOUNDED_MODEL_WORKER');assert.equal(failed.workerFor!(input).role,'DETECTIVE');
 const recovered=make('2026-10-01T02:00:00Z');
 assert.equal(recovered.lane,'DETERMINISTIC');assert.equal(recovered.workerFor!(input).role,'ACQUIRER');
 assert.equal((await recovered.run(input as Parameters<typeof recovered.run>[0])).cost?.requestCount,0);
});

test('failed search sources preserve held alternatives before paid admission and omit failed sources from the handoff',async()=>{
 const debt={obligationId:'owed',cause:'UPSTREAM_ERROR',target:'search-index',detail:'HTTP 504',
   lastFailedAt:'2026-10-01T01:00:00Z',consecutiveFailures:3} as FreshnessDebt;
 const input={obligation:{obligation:{id:'owed'}},holder:'worker'} as Parameters<NonNullable<ReturnType<typeof failureResponderExecutor>['workerFor']>>[0];
 const candidate=(url:string)=>({url,evidenceArtifactIds:['captured'],routeId:url});
 const solved={attemptId:'solved',recordedAt:'2026-10-01T00:00:00Z',refusal:null,
   candidates:[candidate('https://search.example.org/results?q=candidate'),candidate('https://campaign.example.org/about')],findings:[]} as unknown as ScoutResult;
 const sourceRoute={open:{kind:'HTTP_GET',url:'https://search.example.org/results?q=candidate'}} as RouteDescriptor;
 const make=(value:ScoutResult,route:RouteDescriptor|null=sourceRoute)=>failureResponderExecutor({solved:value,sourceFailure:debt,sourceRoute:route,
  transport:async()=>{throw Error('Held source must not buy a model request');},toolkitFor:()=>{throw Error('No research tools expected');},
  contextFor:()=>({route,providerId:null,reason:'failed source',decision:'BOUNDED_MODEL_WORKER',inherited:{artifactIds:[],summary:''},
   tools:{vault:async()=>({stored:true,where:'test',why:'saved'}),spaceOut:async()=>{}}})});
 const executor=make(solved);
 assert.equal(executor.lane,'DETERMINISTIC');assert.equal(executor.workerFor!(input).role,'ACQUIRER');
 const outcome=await executor.run(input as Parameters<typeof executor.run>[0]);
 assert.equal(outcome.kind,'DISPOSED');
 if(outcome.kind==='DISPOSED') {
  assert.ok(outcome.disposition);
  assert.equal(outcome.disposition.disposition,'DISCOVERED');
  assert.match(outcome.disposition.note,/https:\/\/campaign.example.org\/about/);
  assert.doesNotMatch(outcome.disposition.note,/search.example.org/);
 }
 assert.equal(outcome.cost?.requestCount,0);assert.equal(outcome.cost?.usd,0);
 assert.equal(solved.candidates.length,2,'do not rewrite held source history');
 const sameSource=make({...solved,candidates:[solved.candidates[0]]});
 assert.equal(sameSource.lane,'BOUNDED_MODEL_WORKER');assert.equal(sameSource.workerFor!(input).role,'DETECTIVE');
 assert.equal(make(solved,null).lane,'BOUNDED_MODEL_WORKER','an unidentified failed source cannot exempt older routes');
});

test('source recovery preserves captured facts and separates Legistar tenants',async()=>{
 const debt={obligationId:'owed',cause:'UPSTREAM_ERROR',target:'https://webapi.legistar.com/v1/pima/Events',detail:'HTTP 503',
   lastFailedAt:'2026-10-01T01:00:00Z',consecutiveFailures:3} as FreshnessDebt;
 const solved={attemptId:'solved',recordedAt:'2026-10-01T00:00:00Z',refusal:null,candidates:[],findings:[
  {kind:'RECORD',field:'name',value:'Meeting',exactQuote:'Meeting',sourceUrl:'https://webapi.legistar.com/v1/tucson/Events',artifactIds:['tucson']},
  {kind:'RECORD',field:'name',value:'Meeting',exactQuote:'Meeting',sourceUrl:'https://webapi.legistar.com/v1/pima/Events',artifactIds:['pima']},
 ]} as unknown as ScoutResult;
 const executor=failureResponderExecutor({solved,sourceFailure:debt,
  transport:async()=>{throw Error('No model');},toolkitFor:()=>{throw Error('No tools');},
  contextFor:()=>({route:null,providerId:null,reason:'failed source',decision:'BOUNDED_MODEL_WORKER',inherited:{artifactIds:[],summary:''},
   tools:{vault:async()=>({stored:true,where:'test',why:'saved'}),spaceOut:async()=>{}}})});
 assert.equal(executor.lane,'DETERMINISTIC');
 const outcome=await executor.run({} as Parameters<typeof executor.run>[0]);
 assert.equal(outcome.kind,'DISPOSED');
 if(outcome.kind==='DISPOSED') {
  assert.ok(outcome.disposition);
  assert.match(outcome.disposition.note,/\/v1\/tucson\/Events/);assert.doesNotMatch(outcome.disposition.note,/\/v1\/pima\/Events/);
 }
 assert.equal(solved.findings.length,2);
});

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
 const archive={...result,findings:result.findings.map(f=>({...f,sourceUrl:'https://web.archive.org/web/20211027002420/https://county.gov/council'}))};
 assert.equal(reusableScoutCandidates(archive).length,0,'legacy archival findings cannot keep a current blank marked solved');
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

test('legacy adapter debts wake for installed code and stay held after that same implementation was tried',async()=>{
 const repos=createMemoryRepositories(),name='uncapped-source-links',now='2026-09-30T00:00:00Z';
 const pending={refusal:null,outcome:'NEEDS_ADAPTER',narrative:'Need uncapped links from raw HTML extraction',nextRungs:[],candidates:[],rungs:[]} as unknown as ScoutResult;
 const debt={obligationId:'pending',cause:'AWAITING_ADAPTER',retryAt:'2026-10-01',consecutiveFailures:2058} as Parameters<typeof wakeInstalledAdapterDebts>[1][number];
 await repos.scoutResults.append('pending','old',pending,now);
 const reopened=(await wakeInstalledAdapterDebts(repos,[debt],now))[0];
 assert.equal(reopened.cause,'EXTRACTION_FAILED');assert.equal(reopened.retryAt,now);assert.equal(reopened.consecutiveFailures,2058);
 await repos.scoutResults.append('pending','tried',{...pending,rungs:[{tool:'run_adapter',observed:'Installed adapter '+name+'@'+installedAdapterVersion(name)} as never]},now);
 assert.equal((await wakeInstalledAdapterDebts(repos,[debt],now))[0].cause,'AWAITING_ADAPTER');
});

test('Engineer knowledge resumes a failure whose narrative predates the generated adapter name',async()=>{
 const repos=createMemoryRepositories(),name='uncapped-source-links',now='2026-10-02T00:00:00Z';
 const pending={attemptId:'failed-attempt',refusal:null,outcome:'NEEDS_ADAPTER',recoveryCapabilityVersion:SCOUT_HELD_EVIDENCE_PROTOCOL_VERSION,
  narrative:'The source template needs code to extract its document routes',nextRungs:[],candidates:[],rungs:[]} as unknown as ScoutResult;
 const debt={obligationId:'pending',cause:'AWAITING_ADAPTER',retryAt:'2026-10-03',consecutiveFailures:7} as Parameters<typeof wakeInstalledAdapterDebts>[1][number];
 await repos.scoutResults.append('pending','old',pending,now);
 const entry=(sourceAttemptId:string,files:unknown)=>newFieldManualEntry('engineer-adapter','platform',{
  role:'SHARED',kind:'ENGINEER_ADAPTER_PR',title:'generated-platform',summary:'Generated reusable adapter',outcome:'REFERENCE',
  payload:{sourceAttemptId,files}});
 for(const knowledge of [entry('another-attempt',['lib/sources/platform-adapters/'+name+'.ts']),
   entry(pending.attemptId,['lib/sources/platform-adapters/'+name+'.test.ts']),
   entry(pending.attemptId,['lib/sources/platform-adapters/not-installed.ts']),entry(pending.attemptId,null)]) {
  assert.match(adapterWaitReason([pending],[name],[knowledge])!,/AWAITING_ADAPTER/);
 }
 assert.match((await adapterWaitReasonFromKnowledge(repos,[pending]))!,/AWAITING_ADAPTER/);
 await writeFieldManual(repos,[entry(pending.attemptId,['lib/sources/platform-adapters/'+name+'.ts'])],now);
 assert.equal(await adapterWaitReasonFromKnowledge(repos,[pending]),null);
 const reopened=(await wakeInstalledAdapterDebts(repos,[debt],now))[0];
 assert.equal(reopened.cause,'EXTRACTION_FAILED');assert.equal(reopened.retryAt,now);assert.equal(reopened.consecutiveFailures,7);
 const tried={...pending,rungs:[{tool:'run_adapter',observed:'Installed adapter '+name+'@'+installedAdapterVersion(name)} as never]};
 await repos.scoutResults.append('pending','tried',tried,now);
 assert.match((await adapterWaitReasonFromKnowledge(repos,[tried]))!,/AWAITING_ADAPTER/);
 assert.equal((await wakeInstalledAdapterDebts(repos,[debt],now))[0].cause,'AWAITING_ADAPTER');
 assert.equal(await adapterWaitReasonFromKnowledge(repos,[{...tried,rungs:[{tool:'run_adapter',observed:'Installed adapter '+name+'@old-version'} as never]}]),null);
});

test('learned adapter source classes resume other tenants without reopening unrelated or already tried work',async()=>{
 const repos=createMemoryRepositories(),name='uncapped-source-links',now='2026-10-02T00:00:00Z';
 const entry=newFieldManualEntry('engineer-adapter','portable',{
  role:'SHARED',kind:'ENGINEER_ADAPTER_PR',title:'portable',summary:'Shared source parser',outcome:'REFERENCE',recordClasses:['meetings'],
  payload:{sourceAttemptId:'first-tenant-attempt',files:['lib/sources/platform-adapters/'+name+'.ts'],sourceUrls:['https://platform.example/first-tenant/calendar']},
 });
 await writeFieldManual(repos,[entry],now);
 const pending={attemptId:'second-tenant-attempt',recordClass:'meetings',refusal:null,outcome:'NEEDS_ADAPTER',recoveryCapabilityVersion:SCOUT_HELD_EVIDENCE_PROTOCOL_VERSION,
  narrative:'The source needs a parser',nextRungs:[],candidates:[],rungs:[{tool:'fetch_public',target:'https://platform.example/second-tenant/calendar',observed:'Saved source'}]} as unknown as ScoutResult;
 assert.equal(await adapterWaitReasonFromKnowledge(repos,[pending]),null);
 for(const other of [{...pending,recordClass:'officials'},
  {...pending,rungs:[{tool:'fetch_public',target:'https://another.example/calendar',observed:'Saved source'} as never]},
  {...pending,rungs:[{tool:'search',target:'https://platform.example/second-tenant/calendar policy',observed:'No pointers'} as never]},
  {...pending,rungs:[...pending.rungs,{tool:'run_adapter',observed:name+'@'+installedAdapterVersion(name)} as never]}]) {
  assert.match((await adapterWaitReasonFromKnowledge(repos,[other]))!,/AWAITING_ADAPTER/);
 }
 const debt={obligationId:'other-tenant',cause:'AWAITING_ADAPTER',retryAt:'2026-10-03',consecutiveFailures:3} as Parameters<typeof wakeInstalledAdapterDebts>[1][number];
 await repos.scoutResults.append(debt.obligationId,pending.attemptId,pending,now);
 assert.equal((await wakeInstalledAdapterDebts(repos,[debt],now))[0].cause,'EXTRACTION_FAILED');
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
    usage:{input_tokens:100,output_tokens:10,cache_read_input_tokens:0,cache_creation_input_tokens:0}}),request:async(method,path)=>path.includes('/pulls?')
  ?[{html_url:'https://github.com/SeanJ22/meanwhile/pull/999',number:999}]:{}});
 const entry=(await readFieldManual(repos,{role:'DETECTIVE'})).store.entries.find(e=>e.kind==='ENGINEER_ADAPTER_PR' && (e.payload as {sourceAttemptId?:string}).sourceAttemptId===source.attemptId)!;
 assert.deepEqual(entry.recordClasses,['meetings']);
 assert.deepEqual((entry.payload as {sourceUrls:string[]}).sourceUrls,['https://platform.example/first-tenant/calendar','https://platform.example/sitemap.xml']);
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

test('unrelated failed manual entries do not turn new discovery into a Detective assignment',()=>{
 const executor=failureResponderExecutor({transport:async()=>{throw Error('No model');},toolkitFor:()=>{throw Error('No tools');},contextFor:()=>({
   route:null,providerId:null,reason:'new discovery',inherited:{artifactIds:[],summary:'FIELD MANUAL — shared knowledge\n  A BLOCKED or FAILED door is a wall only when access controls stop it.\n  • SHARED/SOURCE_DEAD_END FAILED (az): another district archive'},
   tools:{vault:async()=>({stored:true,where:'test',why:'saved'}),spaceOut:async()=>{}},
 })});
 assert.equal(executor.workerFor!({obligation:{obligation:{id:'new-discovery'}},holder:'worker'} as Parameters<NonNullable<typeof executor.workerFor>>[0]).role,'SCOUT');
});

test('legacy jobs reuse solved subjects without refreshing old facts or calling a model',async()=>{
 const solved={refusal:null,outcome:'EVIDENCE_FOUND',subjectId:'county',recordClass:'officials',attemptId:'first',recordedAt:'2026-09-29',
   candidates:[],findings:[{kind:'RECORD',field:'holder',value:'Ada',exactQuote:'Clerk Ada',sourceUrl:'https://county.gov/clerk',artifactIds:['held']}]} as unknown as ScoutResult;
 assert.equal(solvedScoutResult([solved],'other','officials'),null);
 assert.equal(solvedScoutResult([solved,{...solved,outcome:'BLOCKED',recordedAt:'2026-09-30'}],'county','officials'),null);
 const executor=failureResponderExecutor({solved:solvedScoutResult([solved],'county','officials'),transport:async()=>{throw Error('No model');},toolkitFor:()=>{throw Error('No tools');},contextFor:()=>{throw Error('No new research');}});
 const output=await executor.run({} as Parameters<typeof executor.run>[0]);
 assert.equal(executor.lane,'DETERMINISTIC');assert.equal(output.disposition?.disposition,'DISCOVERED');
 assert.equal(output.cost?.requestCount,0);assert.equal(output.cost?.usd,0);assert.deepEqual(output.artifacts,[]);
});

test('requests refused without research do not erase a solved source, while source failures still reopen it',async()=>{
 const solved={refusal:null,outcome:'EVIDENCE_FOUND',subjectId:'county',recordClass:'officials',attemptId:'solved',recordedAt:'2026-09-29',
  candidates:[],findings:[{kind:'RECORD',field:'holder',value:'Ada',exactQuote:'Clerk Ada',sourceUrl:'https://county.gov/clerk',artifactIds:['held']}]} as unknown as ScoutResult;
 const denied={...solved,attemptId:'not-sent',recordedAt:'2026-10-01',outcome:'NO_PROGRESS',
  refusal:[{code:'SCOUT_POLICY_DENIED',detail:'ASSIGNMENT_BUDGET'}],rungs:[],artifactIds:[],candidates:[],findings:[],sourceDeadEnds:[]} as ScoutResult;
 for(const code of ['SCOUT_POLICY_DENIED','SCOUT_TRANSPORT_FAILED'] as const) {
  const latest={...denied,refusal:[{code,detail:'request could not be sent'}]};
  assert.equal(solvedScoutResult([solved,latest],'county','officials'),solved);
  assert.equal(solvedScoutResult([latest],'county','officials'),null,'no accepted source is invented');
  const recovered=failureResponderExecutor({solved:solvedScoutResult([solved,latest],'county','officials'),
   transport:async()=>{throw Error('No model request');},toolkitFor:()=>{throw Error('No research');},contextFor:()=>{throw Error('No new brief');}});
  assert.equal(recovered.lane,'DETERMINISTIC');
  const outcome=await recovered.run({} as Parameters<typeof recovered.run>[0]);
  assert.equal(outcome.cost?.usd,0);assert.equal(outcome.cost?.requestCount,0);
  assert.match(outcome.detail!,/original observation 2026-09-29/);
 }
 const failed={...denied,recordedAt:'2026-09-30',rungs:[{tool:'fetch_public',ok:false}]} as unknown as ScoutResult;
 assert.equal(solvedScoutResult([solved,failed,denied],'county','officials'),null,'do not skip an earlier source failure');
 assert.equal(solvedScoutResult([solved,{...denied,artifactIds:['new-evidence']}],'county','officials'),null);
 assert.equal(solvedScoutResult([solved,{...denied,sourceDeadEnds:[{artifactId:'held',url:'https://county.gov/clerk',sourceDate:null,reason:'Source no longer supports the record'}]}],'county','officials'),null);
 assert.equal(solvedScoutResult([solved,{...denied,rungs:undefined} as unknown as ScoutResult],'county','officials'),null,'unknown history is not zero research');
 assert.equal(solvedScoutResult([solved,{...denied,refusal:[{code:'SCOUT_RESULT_REFUSED',detail:'invalid finish'}]} as unknown as ScoutResult],'county','officials'),null);
});

test('batch history finds the same subject under other job keys without downloading the full log',async()=>{
 const repos=createMemoryRepositories();
 const base={refusal:null,outcome:'EVIDENCE_FOUND',recordClass:'officials',rungs:[],findings:[],candidates:[],sourceDeadEnds:[{artifactId:'failed-source',url:'https://county.gov/clerk',sourceDate:null,reason:'Source no longer supports the record'}],recordedAt:'2026-09-29'} as unknown as ScoutResult;
 for(const [key,subjectId] of [['old-job','county'],['other-job','city']])await repos.scoutResults.append(key,key,{...base,subjectId,obligationId:key},'2026-09-29');
 const rows=await readSubjectScoutHistory(repos,[{subjectId:'county',recordClass:'officials'}]);
 assert.deepEqual(rows.map(r=>r.obligationId),['old-job']);
 assert.deepEqual(rows[0].sourceDeadEnds,base.sourceDeadEnds);
});

test('legacy discovery reuses the solved field across jobs without closing other blanks',()=>{
 const solved={refusal:null,outcome:'EVIDENCE_FOUND',subjectId:'county',recordClass:'local-jurisdiction',attemptId:'roster',
   obligationId:'old-job#coverage-discovery:officeholders',routeId:'coverage-discovery:officeholders',recordedAt:'2026-09-29',
   candidates:[],findings:[{kind:'RECORD',field:'holder',value:'Ada',exactQuote:'Clerk Ada',sourceUrl:'https://county.gov/clerk',artifactIds:['held']}]} as unknown as ScoutResult;
 const unrelatedFailure={...solved,routeId:'coverage-discovery:public-comment',outcome:'BLOCKED' as const,recordedAt:'2026-09-30'};
 assert.equal(solvedScoutResult([solved],'county','local-jurisdiction','coverage-discovery:public-comment'),null);
 assert.equal(solvedScoutResult([solved,unrelatedFailure],'county','local-jurisdiction','coverage-discovery:officeholders'),solved);
 assert.equal(solvedScoutResult([solved,{...unrelatedFailure,routeId:solved.routeId}],'county','local-jurisdiction',solved.routeId),null);
 const legacy={...solved,routeId:undefined} as unknown as ScoutResult;
 assert.equal(solvedScoutResult([legacy],'county','local-jurisdiction','coverage-discovery:officeholders'),legacy);
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
