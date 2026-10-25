import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {doorRepositoryForRun} from '../lib/doors/run.ts';
import {createMemoryRepositories} from '../lib/control-plane/repository/memory.ts';
import {saveVotingSourceDoor,registeredVotingSourceDoors,votingSourceReadOrder,recordVotingSourceRead} from '../lib/ballot/voting-source-publication.ts';
import type {VotingSourceDoor,VotingSourceRead} from '../lib/ballot/voting-source-types.ts';
import {CivicReadCache} from '../lib/db/civic-read-cache.ts';

const at='2026-10-25T06:00:00.000Z';
const sources=JSON.parse(readFileSync('data/reference/voting-source-doors.json','utf8')) as VotingSourceDoor[];
const source=sources.find(door=>door.scope.state==='ND')!;

test('a state run reads its doors once and shares them through ordering, registration and outcomes',async()=>{
 const base=createMemoryRepositories();await saveVotingSourceDoor(base.doors,source,at);
 const other=sources.find(door=>door.scope.state==='AZ')!;await saveVotingSourceDoor(base.doors,other,at);
 let lists=0,reads=0;
 const repos={doors:{...base.doors,listWhere:async(path:readonly string[],value:string)=>{lists++;return base.doors.listWhere(path,value);},
  read:async(id:string)=>{reads++;return base.doors.read(id);}}};
 const run=await doorRepositoryForRun(repos,'ND',null);
 const registered=await registeredVotingSourceDoors(run,'ND');
 assert.equal(registered.length,1);await votingSourceReadOrder(run,'ND',registered);await saveVotingSourceDoor(run,source,at);
 const read={rawBodies:[],blanks:[],sources:[],fileUpdatedAt:null} as unknown as VotingSourceRead;
 await recordVotingSourceRead(run,source,read,at);
 assert.equal(lists,1,'one state query for the entire run');assert.equal(reads,0,'held rows serve every point read');
 assert.equal((await run.list()).length,1,'the neighboring state never enters the snapshot');
 const row=(await run.list())[0];(row.value.config as Record<string,unknown>).url='mutated';
 assert.notEqual((await run.read(row.id))!.value.config.url,'mutated');
 assert.equal((await base.doors.read(row.id))!.value.lastSuccessAt,at);
});

test('a concurrent registration is retained when a run retries its mapping merge',async()=>{
 const base=createMemoryRepositories();await saveVotingSourceDoor(base.doors,source,at);
 const run=await doorRepositoryForRun(base,'ND',null);
 const concurrent={...source,id:source.id+':concurrent',title:'Another independently saved mapping'};
 await saveVotingSourceDoor(base.doors,concurrent,at);
 const ours={...source,id:source.id+':ours',title:'This run mapping'};
 await saveVotingSourceDoor(run,ours,at);
 assert.deepEqual((await registeredVotingSourceDoors(base.doors,'ND')).map(row=>row.id).sort(),[source.id,concurrent.id,ours.id].sort());
});

test('row-owned revisions cache a racing update without a confirmation read',async()=>{
 const held=new Map<string,string>();const cache=()=>new CivicReadCache({read:async key=>held.get(key)??null,write:async(key,value)=>{held.set(key,value);}});
 let revision='1',versionReads=0,valueReads=0;
 const input={namespace:'doors:test',keys:['door'],versions:async()=>{versionReads++;return [{key:'door',etag:revision}];},
  values:async()=>{valueReads++;revision='2';return [{id:'door',revision,text:'new data'}];},keyOf:(row:{id:string})=>row.id,etagOf:(row:{revision:string})=>row.revision};
 assert.equal((await cache().rows(input))[0].text,'new data');assert.equal(versionReads,1);
 assert.equal((await cache().rows(input))[0].text,'new data');assert.equal(versionReads,2);assert.equal(valueReads,1);
});
