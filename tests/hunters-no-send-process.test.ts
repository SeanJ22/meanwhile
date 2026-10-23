import {fileURLToPath} from "node:url";
import test from "node:test";
import assert from 'node:assert/strict';
import {routeProcessExecutor} from '../lib/control-plane/workers/route-process.ts';

const ROOT=fileURLToPath(new URL("../",import.meta.url));

test("descriptors that send no request use no worker process", async () => {
  const descriptor=(open:unknown)=>({routeId:'source',label:'source',executorClass:'DETERMINISTIC',executorReason:'checked descriptor',citation:'held source',open}) as never;
  let starts=0,requests=0;
  for(const route of [null,descriptor({kind:'NOT_MACHINE_EXECUTABLE',target:'open blank',reason:'no source address held'}),descriptor({kind:'ROUTINE_READ',target:'legacy',reason:'held',cadenceFailure:null,contractIds:['legacy']}),descriptor({kind:'HTTP_GET',url:'http://127.0.0.1/private'})]){
   const executor=routeProcessExecutor({root:ROOT,postgres:false,route,openOne:async()=>{requests++;throw Error('must not send');},spaceOut:async()=>{},vault:async()=>({stored:false,where:"",why:'unused'}),onStarted:()=>{starts++;}});
   assert.equal(executor.dispatch,undefined,'the canonical dispatcher handles this descriptor in its parent');
   const outcome=await executor.run({obligation:{obligation:{id:'isolated-no-send',subjectId:'example',routeId:'source'}},workItemId:'isolated',attemptId:'isolated',routeTaskId:'isolated'} as never);
   assert.equal(outcome.cost?.requestCount,0);assert.equal(outcome.cost?.usd,0);
  }
  assert.equal(starts,0);assert.equal(requests,0);
  const sends=routeProcessExecutor({root:ROOT,postgres:false,route:descriptor({kind:'HTTP_GET',url:'https://example.gov/council'}),openOne:async()=>{throw Error('not executed');},spaceOut:async()=>{},vault:async()=>({stored:false,where:"",why:'unused'})});
  assert.equal(typeof sends.dispatch,'function');
  console.log('Null, deferred, legacy routine and private-address routes complete in the parent with zero child processes and zero requests; public HTTP routes retain worker dispatch');

});
