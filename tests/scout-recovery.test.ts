import { SCOUT_HELD_EVIDENCE_PROTOCOL_VERSION } from "../lib/control-plane/scheduler/scout-result.ts";
import test from 'node:test';
import assert from 'node:assert/strict';
import { publishAdapterPullRequest, plainAdapterFor } from '../lib/control-plane/workers/engineering-adapter.ts';
import { sourceReliabilityKey } from '../lib/control-plane/scheduler/scout-reliability.ts';
import { adapterWaitReason, investigationRole, subjectScoutHistory } from '../lib/control-plane/workers/detective.ts';
import { retryable } from '../lib/control-plane/scheduler/debt.ts';

test('adapter PR publication creates only adapter files and applies the merge label',async()=>{
 const calls:{method:string;path:string;body:any}[]=[];
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
 assert.deepEqual(calls.find(c=>c.path.endsWith('/git/trees'))?.body.tree.map((f:any)=>f.path),['lib/sources/platform-adapters/calendar.mjs']);
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
 const result={recoveryCapabilityVersion:SCOUT_HELD_EVIDENCE_PROTOCOL_VERSION,refusal:null,outcome:'NEEDS_ADAPTER',narrative:'Parser for platform needed',subjectId:'county',recordClass:'meetings',recordedAt:'2026-09-29',workItemId:'other-job'} as any;
 assert.equal(investigationRole([result],false),'DETECTIVE');
 assert.match(adapterWaitReason([result])!,/Engineer owns/);
 assert.equal(subjectScoutHistory([result],'county','meetings').length,1);
 assert.equal(subjectScoutHistory([result],'other-county','meetings').length,0);
 assert.deepEqual(retryable([{cause:'AWAITING_ADAPTER',retryAt:'2020-01-01'} as any],Date.now()),[]);
});
test('plain Engineer reuses a dated sitemap implementation across government subjects',async()=>{
 const candidate=plainAdapterFor({refusal:null,outcome:'NEEDS_ADAPTER',narrative:'Streamline dated sitemap needs adapter',candidates:[],nextRungs:[]} as any)!;
 const source=candidate.files.find(file=>!file.path.includes('.test.'))!.content;
 const module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 for(const publisherOrigin of ['https://first.gov','https://second.gov']) {
  const url=publisherOrigin+'/2026-09-30-board';
  const output=module.inventoryStreamlineSitemap({xml:'<urlset><url><loc>'+url+'</loc></url></urlset>',subjectId:publisherOrigin,publisherOrigin});
  assert.equal(output.entries[0].sourceUrl,url);
 }
});
