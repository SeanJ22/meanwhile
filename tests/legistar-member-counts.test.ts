import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {factDb} from "./helpers/fact-db.ts";
import {memberCore,memberMigrationSql,publishLegistarFixture} from "./helpers/legistar-core.ts";
import {rawFor,wiring,storeMemberFixtures,NOW} from "./helpers/legistar-member-fixtures.ts";
import {MemoryEvidenceStore} from "../lib/control-plane/evidence/store.ts";
import {COUNT_HOUR_SQL} from "../lib/counts/hour.ts";
import {factClocks} from "../lib/facts/clocks.ts";
import {door} from "../lib/core/door.ts";
import {legistarMemberCapture} from "../lib/sources/legistar/members-cache.ts";
import {saveCaptureCopy} from "../lib/facts/source-copy.ts";

test("Legistar hourly Admin rows equal SQL transitions and publication counts",async t=>{
  const db=await factDb({withHourlyCounts:true});t.after(()=>db.pg.close());
  await memberCore(db,()=>new Date());await db.pg.exec(memberMigrationSql());
  await db.pg.exec(readFileSync(new URL("../lib/db/migrations/RB-A9_legistar_members.sql",import.meta.url),"utf8").replaceAll("--> statement-breakpoint",""));
  const raw=rawFor("pima"),vault=new MemoryEvidenceStore();await storeMemberFixtures(vault,raw);
  await publishLegistarFixture({facts:db,raw,rows:wiring(raw,"AZ","America/Phoenix"),vault,clocks:factClocks(null),now:NOW,purge:async()=>({purged:true})});
  const [expected]=await db.query("SELECT count(*)::int n FROM work_row WHERE kind='check' AND status='done'");
  const [published]=await db.query("SELECT count(*)::int n FROM fact WHERE status='live' AND produced_by='legistar-members:pima'");
  const at=new Date(),hour=new Date(Math.floor(at.getTime()/3600000)*3600000),through=new Date(hour.getTime()+3600000);
  const admin=(await db.query(COUNT_HOUR_SQL,[hour.toISOString(),through.toISOString(),new Date(through.getTime()-1).toISOString()])).filter(row=>row.family==='Legistar members');
  assert.equal(Number(admin.find(row=>row.stage==='rows in')?.observed_in),expected.n);
  assert.equal(Number(admin.find(row=>row.stage==='done')?.observed_in),expected.n);
  assert.equal(Number(admin.find(row=>row.stage==='published')?.observed_in),published.n);
});

test("the door refuses a value supplied under a different saved JSON field",async t=>{
  const db=await factDb();t.after(()=>db.pg.close());
  const raw=rawFor('pima'),rows=wiring(raw,'AZ','America/Phoenix'),vault=new MemoryEvidenceStore();await storeMemberFixtures(vault,raw);
  const page=raw.readings.find(r=>{const url=new URL(r.artifact.canonicalUrl);return url.pathname.endsWith('/bodies');})!;
  const capture=await legistarMemberCapture(vault,page.artifact),copy=await db.transaction(q=>saveCaptureCopy(q,capture));
  await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body','Council','AZ')",[rows[0].bodyId]);
  const result=await door(db,{subjectId:rows[0].bodyId,field:'name',fieldKind:'officeholder',value:'Invented Board',valueText:'Invented Board',quote:'Invented Board',
    provenance:'OFFICIAL',acquisition:'loader',producedBy:'legistar-members:pima',costUsd:0,copy,capture,
    savedField:{idField:'BodyId',id:raw.bodies[0].BodyId,key:'BodyName'}},factClocks(null),new Date(NOW));
  assert.deepEqual(result,{refused:'SOURCE_FIELD_MISMATCH'});assert.equal((await db.query('SELECT 1 FROM fact')).length,0);
});

test("a page pointer change retains unchanged work; one changed record alone becomes ready",async t=>{
  const db=await factDb();t.after(()=>db.pg.close());const work=await memberCore(db,()=>new Date());
  const input={kind:'check' as const,state:'AZ',placeId:'place',subjectId:'legistar-members:pima',field:'member:1',source:{source:'Legistar members'},
    sources:['source_copy:1'],value:{$sourceFingerprint:'a'.repeat(64),source:{copyId:1}}};
  await work.addMany([input]);const [claim]=await work.claim('check',1,'legistar-members:');await work.finish(claim);
  await work.addMany([{...input,sources:['source_copy:2'],value:{...input.value,source:{copyId:2}}}]);assert.equal((await work.claim('check',1,'legistar-members:')).length,0);
  assert.deepEqual((await db.query('SELECT sources FROM work_row'))[0].sources,['source_copy:2']);
  await work.addMany([{...input,state:'WA',placeId:'corrected-place',value:{$sourceFingerprint:'b'.repeat(64),source:{copyId:3}}}]);
  const [changed]=await work.claim('check',1,'legistar-members:');assert.equal(changed.state,'WA');assert.equal(changed.placeId,'corrected-place');
});

test("a bounded worker turn finishes its claims and leaves later rows ready, without leased rows waiting for a worker",async t=>{
  const {runLegistarMemberWorkers}=await import("../lib/sources/legistar/members-work.ts");
  const db=await factDb();t.after(()=>db.pg.close());const list=await memberCore(db,()=>new Date());
  await list.addMany(Array.from({length:103},(_,i)=>({kind:'check' as const,state:'AZ',placeId:'place',subjectId:'legistar-members:pima',field:`member:${i}`,source:{source:'Legistar members'},value:{id:i}})));
  const result=await runLegistarMemberWorkers({list,kind:'check',concurrency:4,maxClaims:100,stopRequested:()=>false,run:async()=>({})});
  assert.equal(result.done,100);
  assert.deepEqual(await db.query("SELECT status,count(*)::int n FROM work_row GROUP BY status ORDER BY status"),[{status:'done',n:100},{status:'ready',n:3}]);
});
