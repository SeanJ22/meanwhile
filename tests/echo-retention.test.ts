import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryEvidenceStore, type EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { saveOpenDataPartition } from "../lib/sources/open-data/artifacts.ts";
import { echoMinimumGap, retainEchoMinimumGaps } from "../lib/sources/open-data/echo-gaps.ts";
import { facilityCell, facilityPoint } from "../lib/sources/open-data/geography.ts";
import { ECHO_EXPORT } from "../lib/sources/open-data/model.ts";
import { echoReaderArtifactRecord, normalizeEcho } from "../lib/sources/open-data/normalize.ts";
import type { OpenDataCapture } from "../lib/sources/open-data/publication.ts";

const at="2026-10-23T09:06:56.174Z";
const native=JSON.parse(readFileSync(new URL("./fixtures/src-so/echo-program-identities.json",import.meta.url),"utf8"))[0];
const deferred=()=>{let resolve!:()=>void,reject!:(error:Error)=>void;const promise=new Promise<void>((yes,no)=>{resolve=()=>yes();reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));

async function held(count:number){
  const vault=new MemoryEvidenceStore(),rows=Array.from({length:count},(_,index)=>normalizeEcho({...native,REGISTRY_ID:String(110000000000+index),FAC_NAME:`Facility ${index}`},at,null));
  const capture:OpenDataCapture={url:ECHO_EXPORT,retrievedAt:at,rawHash:"a".repeat(64),sourceRows:rows.map(row=>row.sourceRow),archive:{sha256:"a".repeat(64),member:"ECHO_EXPORTER.csv",publishedAt:null}};
  const references=[];
  for(let index=0;index<rows.length;index++)references.push(await saveOpenDataPartition({source:"epa-echo",partition:`zip:85016:state:AZ:part:${index}`,rows:[rows[index]],captures:[capture],now:at},vault));
  const gaps=rows.map(row=>{const gap=echoMinimumGap({...row.sourceRow,FAC_NAME:""});assert.ok(gap);return gap;});
  return {vault,rows,capture,references,gaps};
}

test("four retained-source reads stay bounded and retain reference and cell order despite reverse completions",{timeout:5000},async()=>{
  const input=await held(9),gates=input.references.map(()=>deferred()),milestones=[deferred(),deferred(),deferred()];
  const started:number[]=[];let active=0,peak=0;
  const vault:EvidenceStore={put:input.vault.put.bind(input.vault),head:input.vault.head.bind(input.vault),list:input.vault.list.bind(input.vault),async get(key){
    const index=input.references.findIndex(reference=>reference.key===key);assert.ok(index>=0);started.push(index);active++;peak=Math.max(peak,active);
    if(started.length===4)milestones[0].resolve();if(started.length===8)milestones[1].resolve();if(started.length===9)milestones[2].resolve();
    try{await gates[index].promise;return await input.vault.get(key);}finally{active--;}
  }};
  const point=facilityPoint(input.rows[0]);assert.ok(point);const cell=`${facilityCell(point.lat,point.lng)}:state:AZ`;
  const cellReference={...input.references[0],id:cell};
  const result=retainEchoMinimumGaps(input.gaps,[cellReference,...input.references.slice(0,3),cellReference,...input.references.slice(3)],[input.capture],vault);
  await milestones[0].promise;assert.deepEqual(started,[0,1,2,3]);
  for(const index of [3,2,1])gates[index].resolve();await flush();
  assert.equal(active,1);assert.equal(started.length,4,"completed slices must not open a fifth slot before the bounded batch is consumed");
  gates[0].resolve();await milestones[1].promise;
  for(const index of [7,6,5,4])gates[index].resolve();await milestones[2].promise;gates[8].resolve();
  const retained=await result;
  assert.equal(peak,4);assert.equal(active,0);assert.deepEqual(started,[0,1,2,3,4,5,6,7,8]);
  assert.deepEqual([...retained.keys()],[input.references[0].id,cell,...input.references.slice(1).map(reference=>reference.id)]);
  assert.deepEqual(retained.get(cell)!.rows,input.rows.map(echoReaderArtifactRecord));
  for(let index=0;index<input.rows.length;index++){
    const part=retained.get(input.references[index].id)!;
    assert.deepEqual(part.rows,[echoReaderArtifactRecord(input.rows[index])]);
    assert.deepEqual(part.captures,[{...input.capture,sourceRows:[part.rows[0].sourceRow]}]);
  }
});

test("retention settles every pending read and propagates the first failure in reference order",{timeout:5000},async()=>{
  const input=await held(6),gates=input.references.map(()=>deferred()),started:number[]=[],firstBatch=deferred();let active=0,settled=false;
  const vault:EvidenceStore={put:input.vault.put.bind(input.vault),head:input.vault.head.bind(input.vault),list:input.vault.list.bind(input.vault),async get(key){
    const index=input.references.findIndex(reference=>reference.key===key);started.push(index);active++;if(started.length===4)firstBatch.resolve();
    try{await gates[index].promise;return await input.vault.get(key);}finally{active--;}
  }};
  const result=retainEchoMinimumGaps(input.gaps,input.references,[input.capture],vault).then(()=>{settled=true;return null;},error=>{settled=true;return error;});
  await firstBatch.promise;
  const firstError=new Error("earlier reference read failed"),laterError=new Error("later reference failed sooner");
  gates[3].reject(laterError);gates[1].reject(firstError);gates[0].resolve();await flush();
  assert.equal(settled,false,"the remaining pending read must settle before failure returns");
  gates[2].resolve();assert.equal(await result,firstError);assert.equal(active,0);assert.deepEqual(started,[0,1,2,3]);
});

test("an earlier retained-capture failure wins over a later read failure",async()=>{
  const input=await held(5),laterError=new Error("later read failed");let started=0,completed=0;
  const vault:EvidenceStore={put:input.vault.put.bind(input.vault),head:input.vault.head.bind(input.vault),list:input.vault.list.bind(input.vault),async get(key){
    started++;try{if(key===input.references[3].key)throw laterError;return await input.vault.get(key);}finally{completed++;}
  }};
  await assert.rejects(retainEchoMinimumGaps(input.gaps,input.references,[],vault),new RegExp(`Prior EPA source capture is missing for retained identity ${input.rows[0].id}`));
  assert.equal(started,4);assert.equal(completed,4);
});
