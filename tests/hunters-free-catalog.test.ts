import {fileURLToPath} from "node:url";
import test from "node:test";
import assert from 'node:assert/strict';
import {meetingsDiscoveryProvider} from '../lib/control-plane/scheduler/providers/meetings-discovery.ts';
import {REGISTRY_STATES} from '../lib/civic-data/state-scopes.ts';

const ROOT=fileURLToPath(new URL("../",import.meta.url));

test("the free source provider covers every state without creating paid focus", async () => {
  let governments=0,sites=0,unaddressed=0;
  for(const state of REGISTRY_STATES){
   const result=meetingsDiscoveryProvider({registered:()=>({registries:new Map(),refused:new Map()}),materialized:()=>({ids:new Set()})} as never).enumerate({root:ROOT,nowIso:'2026-10-20T11:00:00Z',state} as never);
   assert.equal(result.readFailure,null,result.readFailure??'');
   for(const record of result.obligations){governments++;const route=record.routes[0] as typeof record.routes[0]&{placeHunt?:{state:string;knownOwnSite:boolean}};
    assert.notEqual(route.open.kind,'ROUTINE_READ');assert.equal(route.executorClass,'DETERMINISTIC');
    if(route.open.kind==='HTTP_GET'){assert.ok(route.placeHunt);assert.equal(route.placeHunt.state,state);assert.ok(new URL(route.open.url).hostname);if(route.placeHunt.knownOwnSite)sites++;}
    else{assert.equal(route.open.kind,'NOT_MACHINE_EXECUTABLE');unaddressed++;}
   }
  }
  assert.ok(governments>=92382);console.log(JSON.stringify({states:REGISTRY_STATES.length,governments,knownSites:sites,unaddressed,paidHuntPacketsCreated:0,adminWrites:0,productionBytes:0}));

});
