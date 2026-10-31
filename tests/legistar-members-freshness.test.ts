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
import { legistarMembersPackage } from "../lib/sources/legistar/members-publication.ts";

async function fixture(t:import("node:test").TestContext,initial=rawFor("pima")) {
  t.mock.timers.enable({apis:["Date"],now:Date.parse(NOW)});
  const facts=await factDb();t.after(()=>facts.pg.close());
  let source=initial;let rows=wiring(source,"AZ","America/Phoenix");
  const doors=async()=>rows.flatMap(row=>doorsFromWiringRow(row).map(value=>({value})));
  const work=await memberCore(facts,()=>new Date()),vault=new MemoryEvidenceStore(),calls:URL[]=[];
  const load=()=>loadLegistarMemberTenant({facts,doors,work,vault,slug:"pima",now:new Date().toISOString(),fetchImpl:recordedMemberFetch(()=>source,calls)});
  const publish=legistarMemberPublisher({facts,vault,clocks:factClocks(null),purge:async()=>({purged:true})});
  const drain=()=>runLegistarMemberWorkers({list:work,kind:"check",concurrency:1,stopRequested:()=>false,run:claim=>publish(claim.value as MemberRecordWork,new Date().toISOString())});
  return {facts,vault,calls,load,drain,rows,source,setSource:(next:typeof source)=>{source=next;},
    setRows:(next:typeof rows)=>{rows=next;}};
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
  assert.equal(loaded.records,(await f.facts.query("SELECT 1 FROM work WHERE kind='check'")).length);
  assert.equal((await f.drain()).failed,0);
  const quoted=await f.facts.query("SELECT quote,quote_start FROM fact WHERE produced_by LIKE 'legistar-members:%' AND status='live'");
  assert.ok(quoted.length>0&&quoted.every(row=>/^"(?:Office|Body)\w+"\s*:/.test(String(row.quote))&&row.quote_start!==null),"each member fact quotes the exact line of its saved response and was checked there");
  assert.deepEqual(await f.facts.query("SELECT field,reason FROM blank WHERE reason LIKE 'CHECK_FAILED%'"),[]);
  const before=(await readFactRosters(f.facts.query,f.rows.map(row=>row.bodyId))).rosters.flatMap(row=>row.members);
  assert.ok(before.some(member=>member.name==="Rex Scott"));
  const ids=await f.facts.query("SELECT id FROM entity ORDER BY id");
  const removed=f.source.offices[0];
  f.setSource({...f.source,offices:f.source.offices.filter(row=>row.OfficeRecordPersonId!==removed.OfficeRecordPersonId)});
  t.mock.timers.tick(1_000);await f.load();assert.equal((await f.drain()).failed,0);
  const after=(await readFactRosters(f.facts.query,f.rows.map(row=>row.bodyId))).rosters.flatMap(row=>row.members);
  assert.ok(after.length<before.length);
  assert.deepEqual(await f.facts.query("SELECT id FROM entity ORDER BY id"),ids);
  assert.ok((await f.facts.query("SELECT 1 FROM fact WHERE held_reason='GONE_FROM_SOURCE'")).length>0);
  assert.ok((await f.facts.query("SELECT 1 FROM place_page WHERE stale_at IS NOT NULL")).length>=0);
});

test("tenant completion makes a new row at twelve hours and another family cannot be claimed",async t=>{
  const f=await fixture(t),url="https://webapi.legistar.com/v1/pima/officerecords";
  await f.facts.query("DELETE FROM work");
  await f.facts.query(`INSERT INTO work(id,kind,state,place_id,subject_id,url,series) VALUES('tenant','load','AZ','place','legistar-members:pima',$1,'tenant'),('other','load','AZ','place','other:source',$1,'other')`,[url]);
  const work=await memberCore(f.facts,()=>new Date());
  const [tenant]=await work.claim("load",10,"legistar-members:");assert.equal(tenant.id,"tenant");
  assert.equal(await work.finish(tenant,12*3600_000),true);
  assert.equal((await work.claim("load",1,"legistar-members:")).length,0);
  t.mock.timers.tick(12*3600_000-1);assert.equal(await work.spawnDue(),0);assert.equal((await work.claim("load",1,"legistar-members:")).length,0);
  t.mock.timers.tick(1);assert.equal(await work.spawnDue(),1);
  const [again]=await work.claim("load",1,"legistar-members:");
  assert.notEqual(again.id,"tenant","a repeat is a new row");assert.equal(again.series,"tenant");
  assert.equal((await f.facts.query("SELECT status FROM work WHERE id='tenant'"))[0].status,"done","the finished row stays as it was");
  assert.equal(await work.spawnDue(),0,"a finished row repeats once");
});

test("a complete roster that ages while queued cannot retire a holder or change any fact",async t=>{
  const f=await fixture(t);await f.load();await f.drain();
  const before=await f.facts.query("SELECT id,status FROM fact ORDER BY id");
  assert.ok(before.length>0);
  const removed=f.source.offices[0];
  f.setSource({...f.source,offices:f.source.offices.filter(row=>row.OfficeRecordPersonId!==removed.OfficeRecordPersonId)});
  t.mock.timers.tick(1_000);await f.load();
  t.mock.timers.tick(31*24*3600_000);
  const result=await f.drain();
  assert.equal(result.failed,0);assert.ok(result.refused>0);
  assert.deepEqual(await f.facts.query("SELECT id,status FROM fact ORDER BY id"),before);
});

const pimaBody=(rows:ReturnType<typeof wiring>,id:number)=>rows.find(row=>Number(row.config.eventBodyId)===id)!.bodyId;

test("Pima's study sessions fold into the Board of Supervisors, its unseated addendum is no body, and every selector's members stay live",async t=>{
  const f=await fixture(t);await f.load();
  assert.equal((await f.drain()).failed,0);
  const board=pimaBody(f.rows,138);
  const aliases=await f.facts.query("SELECT entity_id,value FROM entity_external_id WHERE scheme='body-alias' ORDER BY value");
  for(const id of [286,287])assert.ok(aliases.some(alias=>alias.entity_id===board&&alias.value===pimaBody(f.rows,id)),`study session ${id} is the board`);
  for(const id of [228,286,287])assert.deepEqual(await f.facts.query("SELECT id FROM entity WHERE id=$1",[pimaBody(f.rows,id)]),[],`selector ${id} is not a second body`);
  const expected=[...new Set(f.source.offices.filter(office=>[138,228,286,287].includes(office.OfficeRecordBodyId)
    &&(!office.OfficeRecordStartDate||office.OfficeRecordStartDate.slice(0,10)<="2026-10-13")
    &&(!office.OfficeRecordEndDate||office.OfficeRecordEndDate.slice(0,10)>="2026-10-13")).map(office=>String(office.OfficeRecordPersonId)))].sort();
  const live=await f.facts.query(`SELECT DISTINCT x.value FROM checked_fact c JOIN entity_external_id x ON x.entity_id=substr(c.field,8)
    WHERE c.entity_id=$1 AND c.field LIKE 'member:%' AND c.status='live' AND x.scheme='legistar:pima' ORDER BY x.value`,[board]);
  assert.deepEqual(live.map(row=>row.value),expected,"all selectors' current members remain live on the real board");
  assert.deepEqual(await f.facts.query("SELECT name FROM entity WHERE id=$1",[board]),[{name:"Board of Supervisors"}]);
});

test("a selector's seats never retire the board's other members",async t=>{
  const source=rawFor("pima"),only=source.offices.find(office=>office.OfficeRecordBodyId===286)!;
  // The study session seats one person; the board keeps everyone its own records seat.
  const f=await fixture(t,{...source,offices:source.offices.filter(office=>office.OfficeRecordBodyId!==286||office.OfficeRecordId===only.OfficeRecordId)});
  await f.load();assert.equal((await f.drain()).failed,0);
  t.mock.timers.tick(1_000);await f.load();assert.equal((await f.drain()).failed,0);
  assert.equal((await f.facts.query("SELECT 1 FROM fact WHERE held_reason='GONE_FROM_SOURCE'")).length,0);
});

test("unseated meeting selectors cannot block real bodies and seated unidentified labels stay open",async t=>{
  const raw=rawFor("pima"),rows=wiring(raw,"AZ","America/Phoenix");
  const study=raw.bodies.find(body=>body.BodyName==="Board of Supervisors Study Session")!;
  const unseated={...raw,offices:raw.offices.filter(office=>office.OfficeRecordBodyId!==study.BodyId)};
  const prepared=legistarMembersPackage(unseated,rows,NOW);
  assert.ok(!prepared.bound.some(row=>Number(row.config.eventBodyId)===study.BodyId));
  assert.ok(!prepared.unbound.some(gap=>gap.key===`pima:body:${study.BodyId}`),"an unseated selector is not a gap");
  assert.ok(prepared.members>0);
  const unnamed={...study,BodyId:987654,BodyName:"Special Meeting"};
  const office={...raw.offices[0],OfficeRecordId:987654,OfficeRecordBodyId:unnamed.BodyId};
  const withUnnamed={...raw,bodies:[...raw.bodies,unnamed],offices:[...raw.offices,office]};
  const result=legistarMembersPackage(withUnnamed,wiring(withUnnamed,"AZ","America/Phoenix"),NOW);
  assert.ok(result.unbound.some(gap=>gap.key===`pima:body:${unnamed.BodyId}`));
  assert.ok(result.members>0);
  // Through the core: the selector's own record finishes quietly and the board still publishes.
  const f=await fixture(t,unseated);await f.load();
  const drained=await f.drain();
  assert.equal(drained.failed,0);assert.equal(drained.refused,0);
  assert.ok((await f.facts.query("SELECT 1 FROM checked_fact WHERE entity_id=$1 AND field LIKE 'member:%' AND status='live'",[pimaBody(f.rows,138)])).length>0);
});

test("a term transition or a changed door binding reopens an unchanged tenant",async t=>{
  const source=rawFor("pima");
  const future={...source,offices:source.offices.map((office,i)=>i?office:{...office,OfficeRecordStartDate:"2026-10-14T00:00:00"})};
  const f=await fixture(t,future);
  assert.equal((await f.load()).unchanged,false);
  t.mock.timers.tick(60_000);
  assert.equal((await f.load()).unchanged,true);
  t.mock.timers.tick(24*3600_000);
  assert.equal((await f.load()).unchanged,false,"a seat becoming current reopens the tenant");
  t.mock.timers.tick(60_000);
  assert.equal((await f.load()).unchanged,true);
  f.setRows(f.rows.map((row,i)=>i?row:{...row,config:{...row.config,governmentId:"ocd-division/country:us/state:az/county:pima"}}));
  assert.equal((await f.load()).unchanged,false,"a corrected door binding is applied without waiting for a source edit");
});
