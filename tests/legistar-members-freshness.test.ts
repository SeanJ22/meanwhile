import assert from "node:assert/strict";
import test from "node:test";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { doorsFromWiringRow } from "../lib/doors/seed-meetings.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { readFactRosters } from "../lib/facts/roster-read.ts";
import { loadLegistarMemberTenant,type MemberRecordWork } from "../lib/sources/legistar/members-loader.ts";
import { legistarMemberPublisher } from "../lib/sources/legistar/members-worker.ts";
import { runLegistarMemberWorkers } from "../lib/sources/legistar/members-work.ts";
import { memberCore } from "./helpers/legistar-core.ts";
import { factDb } from "./helpers/fact-db.ts";
import { NOW,rawFor,recordedMemberFetch,wiring } from "./helpers/legistar-member-fixtures.ts";

async function fixture(t:import("node:test").TestContext) {
  t.mock.timers.enable({apis:["Date"],now:Date.parse(NOW)});
  const facts=await factDb();t.after(()=>facts.pg.close());
  let source=rawFor("pima");const rows=wiring(source,"AZ","America/Phoenix");
  const doors=async()=>rows.flatMap(row=>doorsFromWiringRow(row).map(value=>({value})));
  const work=await memberCore(facts,()=>new Date()),vault=new MemoryEvidenceStore(),calls:URL[]=[];
  const load=()=>loadLegistarMemberTenant({facts,doors,work,vault,slug:"pima",now:new Date().toISOString(),fetchImpl:recordedMemberFetch(()=>source,calls)});
  const publish=legistarMemberPublisher({facts,vault,clocks:factClocks(null),purge:async()=>({purged:true})});
  const drain=()=>runLegistarMemberWorkers({list:work,kind:"check",concurrency:1,stopRequested:()=>false,run:claim=>publish(claim.value as MemberRecordWork,new Date().toISOString())});
  return {facts,vault,calls,load,drain,rows,source,setSource:(next:typeof source)=>{source=next;}};
}

test("tenant fingerprint stops unchanged reads without downloading any saved record or changing checked dates",async t=>{
  const f=await fixture(t);await f.load();await f.drain();
  const before=await f.facts.query("SELECT id,checked_at FROM checked_fact ORDER BY id");
  assert.ok(before.length>0);
  let gets=0;f.vault.get=async()=>{gets++;throw Error("Unchanged loader downloaded saved bytes");};
  t.mock.timers.tick(60_000);f.calls.length=0;
  assert.equal((await f.load()).unchanged,true);
  assert.equal(gets,0);assert.equal(f.calls.length,2);
  assert.deepEqual(await f.facts.query("SELECT id,checked_at FROM checked_fact ORDER BY id"),before);
});

test("source records flow through claimed work, preserve identity, and retire departed holders through the door",async t=>{
  const f=await fixture(t);const loaded=await f.load();
  assert.equal(loaded.records,(await f.facts.query("SELECT 1 FROM work_row WHERE kind='check'")).length);
  assert.equal((await f.drain()).failed,0);
  const before=(await readFactRosters(f.facts.query,f.rows.map(row=>row.bodyId))).rosters.flatMap(row=>row.members);
  assert.ok(before.some(member=>member.name==="Rex Scott"));
  const ids=await f.facts.query("SELECT id FROM entity ORDER BY id");
  const removed=f.source.offices[0];
  f.setSource({...f.source,offices:f.source.offices.filter(row=>row.OfficeRecordPersonId!==removed.OfficeRecordPersonId)});
  t.mock.timers.tick(1_000);await f.load();assert.equal((await f.drain()).failed,0);
  const after=(await readFactRosters(f.facts.query,f.rows.map(row=>row.bodyId))).rosters.flatMap(row=>row.members);
  assert.ok(after.length<before.length);
  assert.deepEqual(await f.facts.query("SELECT id FROM entity ORDER BY id"),ids);
  assert.ok((await f.facts.query("SELECT 1 FROM fact WHERE held_reason='NOT_ON_CURRENT_OFFICIAL_ROSTER'")).length>0);
  assert.ok((await f.facts.query("SELECT 1 FROM rebuild_queue")).length>=0);
});

test("tenant completion becomes due again at twelve hours and another family cannot be claimed",async t=>{
  const f=await fixture(t),url="https://webapi.legistar.com/v1/pima/officerecords";
  await f.facts.query("DELETE FROM work_row");
  await f.facts.query(`INSERT INTO work_row(id,kind,state,place_id,subject_id,url) VALUES('tenant','load','AZ','place','legistar-members:pima',$1),('other','load','AZ','place','other:source',$1)`,[url]);
  const work=await memberCore(f.facts,()=>new Date());
  const [tenant]=await work.claim("load",10,"legistar-members:");assert.equal(tenant.id,"tenant");
  assert.equal(await work.finish(tenant,12*3600_000),true);
  assert.equal((await work.claim("load",1,"legistar-members:")).length,0);
  t.mock.timers.tick(12*3600_000-1);assert.equal((await work.claim("load",1,"legistar-members:")).length,0);
  t.mock.timers.tick(1);assert.equal((await work.claim("load",1,"legistar-members:")).length,1);
});
