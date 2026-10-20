import test from "node:test";
import assert from 'node:assert/strict';
import {durableSearchBudget,withSearchBudgets} from '../lib/control-plane/discovery/search-runtime.ts';
import {createLedger} from '../lib/control-plane/budget.ts';
import {createMemoryRepositories} from '../lib/control-plane/repository/memory.ts';

test("long research requests keep their host slot and expired holders cannot release replacements", async () => {
  const repos=createMemoryRepositories(),host='api.exa.ai';let clock=Date.parse('2026-10-20T09:00:00Z');const now=()=>new Date(clock).toISOString();
  await repos.budget.install(withSearchBudgets(createLedger({hosts:[]}),200),now());
  const options={repos,perCycle:200,perDay:200,admit:()=>null,now};
  const long=durableSearchBudget(options),other=durableSearchBudget(options);
  assert.equal(await long.take(host,16*60000),null);clock+=3*60000;assert.notEqual(await other.take(host),null,'a running Exa agent still holds its one host slot after normal search expiry');
  clock+=14*60000;assert.equal(await other.take(host),null,'a crashed agent slot eventually expires');
  await long.done(host);assert.notEqual(await durableSearchBudget(options).take(host),null,'a late old holder cannot release its replacement');
  await other.done(host);clock+=1001;assert.equal(await other.take(host),null);await other.done(host);
  const ledger=await repos.budget.read();assert.equal(ledger.value.vendors['discovery-search'].dailyRequestCap,200);assert.equal(ledger.value.hosts[host].maxConcurrent,1);
  console.log('long Exa runs retain the existing host concurrency slot; expired holders recover; late releases preserve replacements; Admin request and concurrency limits are unchanged');

});
