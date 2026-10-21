import test from "node:test";
import assert from 'node:assert/strict';
import {exaAgentEnabled} from '../lib/hunt/exa-admission.ts';
import {defaultAdminConfig,ADMIN_CONFIG_ID} from '../lib/control-plane/gateway/admin-config.ts';
import {createMemoryRepositories} from '../lib/control-plane/repository/memory.ts';

test("tool availability preserves explicit Admin values and unread settings grant no paid work", async () => {
  const now='2026-10-20T10:00:00.000Z';
  for(const value of [undefined,false,true]){
   const repos=createMemoryRepositories(),config=defaultAdminConfig(now);
   await repos.adminConfig.put(ADMIN_CONFIG_ID,{...config,settings:{...config.settings,...(value===undefined?{}:{'hunting.exaAgent':value})}},now);
   const before=await repos.adminConfig.read(ADMIN_CONFIG_ID);
   assert.equal(await exaAgentEnabled(repos),value??true);
   assert.deepEqual(await repos.adminConfig.read(ADMIN_CONFIG_ID),before,'tool availability reads do not change an Admin setting');
  }
  const repos=createMemoryRepositories();await assert.rejects(exaAgentEnabled({...repos,adminConfig:{...repos.adminConfig,read:async()=>{throw new Error('config unreadable');}}}));
  console.log('unset Exa availability uses the provided hunter; explicit owner off/on remain unchanged; unread settings do not authorize paid work');

});
