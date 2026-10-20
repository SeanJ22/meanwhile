import assert from 'node:assert/strict';
import test from 'node:test';
import {createMemoryRepositories} from '../lib/control-plane/repository/memory.ts';
import {readFieldManual,writeFieldManual,newFieldManualEntry,fieldManualEntryId} from '../lib/control-plane/field-manual.ts';
import {installedAdapterGuides,installedAdapterVersion} from '../lib/control-plane/scheduler/scout-adapters.ts';
import {learnInstalledAdapters,workAdapterQueue} from '../lib/control-plane/workers/engineering-adapter.ts';
import type {ScoutResult} from '../lib/control-plane/scheduler/scout-result.ts';

test('installed code teaches a new bank once per implementation version through the shared calls',async()=>{
 const repos=createMemoryRepositories(),now='2026-10-02T00:00:00Z';
 const guide=(await installedAdapterGuides()).find(row=>row.name==='sparqdata-policy')!;
 assert.equal(guide.file,'lib/sources/platform-adapters/sparqdata-policy.ts');
 assert.ok(guide.guide.sourceUrls.includes('https://policies.sparqdata.com'));
 await learnInstalledAdapters(repos,now);
 const first=await readFieldManual(repos,{role:'SCOUT'});
 const entry=first.store.entries.find(row=>row.source==='installed-adapter' && row.title==='sparqdata-policy')!;
 assert.equal(entry.kind,'PLATFORM_ADAPTER','installed code is a capability entry, not an invented PR record');
 assert.ok(first.projection.lines.some(line=>line.includes('/sopapi/document/getdocument/')));
 assert.equal((entry.payload as {implementationVersion:string}).implementationVersion,installedAdapterVersion('sparqdata-policy'));
 const revision=(await repos.fieldManual.read(entry.id))!.revision;
 await learnInstalledAdapters(repos,'2026-10-02T00:01:00Z');
 assert.equal((await repos.fieldManual.read(entry.id))!.revision,revision,'unchanged installed code does not rewrite knowledge each cycle');
 await writeFieldManual(repos,[{...entry,observedAt:'2026-10-02T00:02:00Z',payload:{...(entry.payload as object),implementationVersion:'older-code'}}],'2026-10-02T00:02:00Z');
 await learnInstalledAdapters(repos,'2026-10-02T00:03:00Z');
 const changed=(await repos.fieldManual.read(entry.id))!.value;
 assert.equal((changed.payload as {implementationVersion:string}).implementationVersion,guide.version);
});

test('Engineer offers installed extraction to other tenants before buying another implementation',async()=>{
 const repos=createMemoryRepositories();let models=0,pulls=0;
 const results=['first','second'].map((tenant)=>({attemptId:tenant,subjectId:tenant,recordClass:'local-jurisdiction',
  refusal:null,outcome:'NEEDS_ADAPTER',recordedAt:'2026-10-02T00:00:00Z',narrative:'The policy portal needs extraction',
  candidates:[],nextRungs:[],rungs:[{tool:'browse',target:'https://policies.sparqdata.com/partner/browse/'+tenant,observed:'Saved portal'}],
 } as unknown as ScoutResult));
 const opened=await workAdapterQueue({repos,results,now:'2026-10-02T00:00:00Z',
  transportFor:()=>async()=>{models++;throw Error('Installed code comes first');},
  request:async()=>{pulls++;throw Error('No duplicate adapter PR');}});
 assert.deepEqual(opened,[]);assert.equal(models,0);assert.equal(pulls,0);
});

test('Engineer folds country bookkeeping metadata and opens only installed guide identities',async()=>{
 const repos=createMemoryRepositories(),now='2026-10-02T00:00:00Z';
 const platform='custom-unimplemented-platform',attempt='own-attempt';
 const saved=await writeFieldManual(repos,[...Array.from({length:180},(_,index)=>newFieldManualEntry('engineer-investigation',`other-${index}`,{
  role:'ENGINEER',kind:'ENGINEER_INVESTIGATION',title:`other-${index}`,platforms:[`other-${index}`],outcome:'BLOCKED',
  summary:'A different place history',payload:{sourceAttemptId:`other-attempt-${index}`,tried:['country narrative '.repeat(1000)]},
 })),newFieldManualEntry('engineer-investigation',platform,{role:'ENGINEER',kind:'ENGINEER_INVESTIGATION',title:platform,
  platforms:[platform],outcome:'BLOCKED',summary:'Already exhausted this exact evidence',payload:{sourceAttemptId:attempt,tried:['Already exhausted this exact evidence']}})],now);
 assert.equal(saved.error,undefined,'the investigation fixture must actually persist');
 const guideIds=new Set((await installedAdapterGuides()).map(guide=>fieldManualEntryId('installed-adapter',guide.name)));
 let scans=0,models=0,evidenceReads=0;
 const watched={...repos,fieldManual:{...repos.fieldManual,
  readMany:async(ids:readonly string[])=>{assert.ok(ids.every(id=>guideIds.has(id)));return repos.fieldManual.readMany(ids);},
  visitSlice:async(...args:Parameters<typeof repos.fieldManual.visitSlice>)=>{
   scans++;assert.ok(args[2]);assert.notEqual(args[2]?.payload,true,'country payloads never cross bookkeeping selection');
   await repos.fieldManual.visitSlice(args[0],async row=>{assert.doesNotMatch(JSON.stringify(row.value),/country narrative/);await args[1](row);},args[2]);
  },
 }};
 const result={attemptId:attempt,subjectId:'ocd-division/country:us/state:az/county:pima',recordClass:'OFFICIAL_ROSTER',refusal:null,
  outcome:'NEEDS_ADAPTER',recordedAt:now,narrative:'Need this exact publisher adapter',candidates:[{routeId:platform,procedure:''}],nextRungs:[],rungs:[],artifactIds:['own-capture']} as unknown as ScoutResult;
 const opened=await workAdapterQueue({repos:watched,results:[result],now,
  readEvidence:async()=>{evidenceReads++;throw Error('An exhausted exact attempt never reopens source bytes');},
  transportFor:()=>async()=>{models++;throw Error('An exhausted exact attempt never buys another model');}});
 assert.deepEqual(opened,[]);assert.equal(models,0);assert.equal(evidenceReads,0);assert.equal(scans,1);
});
