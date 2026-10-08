import assert from 'node:assert/strict';
import test from 'node:test';
import {createMemoryRepositories} from '../lib/control-plane/repository/memory.ts';
import {readFieldManual,writeFieldManual} from '../lib/control-plane/field-manual.ts';
import {installedAdapterGuides,installedAdapterVersion} from '../lib/control-plane/scheduler/scout-adapters.ts';
import {learnInstalledAdapters,workAdapterQueue} from '../lib/control-plane/workers/engineering-adapter.ts';
import {hasUntriedAdapter} from '../lib/control-plane/workers/detective.ts';
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
 const manual=await readFieldManual(repos,{role:'DETECTIVE'});
 for(const result of results)assert.equal(hasUntriedAdapter(result,['sparqdata-policy'],manual.store.entries),true);
 assert.equal(hasUntriedAdapter({...results[0],recordClass:'officials'},['sparqdata-policy'],manual.store.entries),false);
});
