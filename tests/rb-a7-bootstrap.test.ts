import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { factDb } from "./helpers/fact-db.ts";
import { lockFirstStatement } from "../scripts/apply-migrations.mts";

const US='ocd-division/country:us',AZ=`${US}/state:az`,CA=`${US}/state:ca`,NJ=`${US}/state:nj`;
const CITY=`${AZ}/place:tucson`,MESA=`${AZ}/place:mesa`,LOS_ANGELES=`${CA}/place:los_angeles`,NEWARK=`${NJ}/place:newark`;
const BODY=`${CITY}#board`,MESA_BODY=`${MESA}#board`,PERSON='person:member';
const everyday='US-AZ+US-NH+US-NJ:everyday-service-routing:v1';
const migration=(phase:string)=>readFileSync(new URL(`../lib/db/migrations/RB-A7_bootstrap_${phase}.sql`,import.meta.url),'utf8');
type Database=Awaited<ReturnType<typeof factDb>>;
const apply=(db:Database,phase:string)=>db.transaction(async query=>{
  for(const statement of migration(phase).split('--> statement-breakpoint'))await query(statement);
});
async function fixture() {
  const db=await factDb();
  await db.pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,current_version_id text,payload jsonb,promoted_at timestamptz DEFAULT now());
    CREATE TABLE civic_data_candidate_events(candidate_id text,sequence int,detail text);`);
  const counter=readFileSync(new URL('../lib/db/migrations/RB-A8_count_hour.sql',import.meta.url),'utf8')
    .split('--> statement-breakpoint').find(sql=>/CREATE FUNCTION count_state\(/.test(sql));
  await db.pg.exec(counter!);
  for(const [id,kind,state,parent] of [
    [US,'place','US',null],[AZ,'place','AZ',US],[CA,'place','CA',US],[NJ,'place','NJ',US],
    [CITY,'place','AZ',AZ],[MESA,'place','AZ',AZ],[LOS_ANGELES,'place','CA',CA],[NEWARK,'place','NJ',NJ],
    [BODY,'body','AZ',CITY],[MESA_BODY,'body','AZ',MESA],[PERSON,'person','AZ',null],
    ['zip:85701','place','AZ',AZ],['zip:85201','place','AZ',AZ],['zip:90001','place','CA',CA],['zip:07001','place','NJ',NJ],
  ])await db.query('INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,$2,$1,$3,$4)',[id,kind,state,parent]);
  for(const [zip,place] of [['85701',CITY],['85201',MESA],['90001',LOS_ANGELES],['07001',NEWARK]]) {
    await db.query('INSERT INTO place_page_dependency VALUES($1,$2),($1,$3)',[`zip:${zip}`,place,US]);
  }
  await db.query('INSERT INTO place_page_dependency VALUES($1,$2),($3,$2)',['zip:85701',AZ,'zip:85201']);
  await db.query('INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2),($3,$4)',[BODY,CITY,MESA_BODY,MESA]);
  await db.query("INSERT INTO entity_external_id VALUES($1,'body-alias','opaque-board')",[BODY]);
  await ownerFact(db,BODY,'name','Mayor and Council');
  await ownerFact(db,BODY,`member:${PERSON}`,{role:'Council member'});
  await apply(db,'expand');
  return db;
}
async function ownerFact(db:Database,entity:string,field:string,value:unknown) {
  await db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,quote,checked_at,produced_by)
    VALUES($1,$2,$3::jsonb,$4,'live','OWNER','',now(),'test')`,[entity,field,JSON.stringify(value),JSON.stringify(value)]);
}
async function queue(db:Database) {
  return new Map((await db.query('SELECT place_id,generation FROM rebuild_queue ORDER BY place_id')).map(r=>[String(r.place_id),Number(r.generation)]));
}
const clear=(db:Database)=>db.query('DELETE FROM rebuild_queue');
const publication=(db:Database,key:string,family:string,scope:string,version='v1')=>db.query(
  'INSERT INTO civic_data_promotions(key,record_class,scope,current_version_id,payload) VALUES($1,$2,$3,$4,$5::jsonb)',
  [key,family,scope,version,'{}']);

test('the migration runner locks all affected busy tables before either transition phase',()=>{
  for(const phase of ['expand','contract'])assert.ok(lockFirstStatement(`RB-A7_bootstrap_${phase}`).includes(
    'LOCK TABLE fact, civic_data_promotions, entity, entity_place, entity_host, entity_external_id, civic_data_candidate_events, rebuild_queue IN ACCESS EXCLUSIVE MODE;'));
});

test('the preceding door bumps active rebuild generations and queues only locally dependent ZIPs',async()=>{
  const db=await fixture();
  try {
    await db.query("INSERT INTO rebuild_queue(place_id,queued_at) VALUES($1,'2026-10-25T01:00:00Z') ON CONFLICT DO NOTHING",[CITY]);
    assert.deepEqual([...await queue(db)],[[CITY,1],['zip:85701',1]].sort(([a],[b])=>String(a).localeCompare(String(b))));
    await db.query("UPDATE rebuild_queue SET lease_token='building',lease_slot=1,lease_until=now()+interval '5 minutes' WHERE place_id=$1",[CITY]);
    await db.query('INSERT INTO rebuild_queue(place_id) VALUES($1) ON CONFLICT DO NOTHING',[CITY]);
    assert.equal((await queue(db)).get(CITY),2);
    assert.equal((await queue(db)).get('zip:85701'),2);
    const [held]=await db.query('SELECT queued_at,lease_token,lease_slot,next_queued_at::text AS pending FROM rebuild_queue WHERE place_id=$1',[CITY]);
    assert.equal(new Date(held!.queued_at as string).toISOString(),'2026-10-25T01:00:00.000Z');
    assert.equal(held!.lease_token,'building');
    assert.equal(held!.lease_slot,1);
    assert.ok(held!.pending,'the preceding door retains the first arrival after the active snapshot');
    await db.query('INSERT INTO rebuild_queue(place_id) VALUES($1) ON CONFLICT(place_id) DO UPDATE SET generation=rebuild_queue.generation+1',[CITY]);
    assert.equal((await queue(db)).get(CITY),3,'the new upsert is not counted twice by the compatibility hook');
    assert.equal((await db.query('SELECT next_queued_at::text AS pending FROM rebuild_queue WHERE place_id=$1',[CITY]))[0]!.pending,held!.pending);
    await clear(db);
    await db.query('INSERT INTO rebuild_queue(place_id) VALUES($1),($2)',[AZ,US]);
    assert.deepEqual([...await queue(db)],[[US,1],[AZ,1]],'local door ancestor inserts do not fan out through state or national ZIP dependencies');
  }finally{await db.pg.close();}
});

test('promotion changes queue pending pages by state, preserve removals and ignore unrelated or unchanged pointers',async()=>{
  const db=await fixture();
  try {
    await publication(db,'registry','REGISTRY_RUNTIME_BINDING','US-AZ:reader-registry-runtime');
    let pending=await queue(db);
    assert.ok(pending.has('zip:85701')&&pending.has('zip:85201')&&pending.has(BODY));
    assert.ok(!pending.has('zip:90001')&&!pending.has('zip:07001'));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM place_page'))[0]!.n,0,'unbuilt pages also get their generation bumped');
    await clear(db);
    await db.query("UPDATE civic_data_promotions SET promoted_at=now(),payload=payload WHERE key='registry'");
    assert.equal((await queue(db)).size,0);
    await publication(db,'funding','FEC_FUNDING','US-AZ:money');
    await publication(db,'other-curated','CURATED_READER_RECORD','US-AZ:some-other-record');
    assert.equal((await queue(db)).size,0);
    await db.query("UPDATE civic_data_promotions SET scope='US-NJ:reader-registry-runtime',current_version_id='v2' WHERE key='registry'");
    pending=await queue(db);
    assert.ok(pending.has('zip:85701')&&pending.has('zip:07001'));
    assert.ok(!pending.has('zip:90001'));
    await clear(db);
    await db.query("DELETE FROM civic_data_promotions WHERE key='registry'");
    assert.ok((await queue(db)).has('zip:07001'));
    await clear(db);
    await assert.rejects(db.transaction(async query=>{
      await query("INSERT INTO civic_data_promotions VALUES('rolled-back','REGISTRATION','US-AZ:registration:v1','v1','{}',now())");
      throw new Error('rollback');
    }),/rollback/);
    assert.equal((await queue(db)).size,0,'the queue change rolls back with the publication');
  }finally{await db.pg.close();}
});

test('meeting aliases and encoded scopes resolve their state while global page projections queue every state',async()=>{
  const db=await fixture();
  try {
    await publication(db,'meeting','MEETING','source:legistar:body:opaque-board');
    assert.ok((await queue(db)).has('zip:85701'));
    assert.ok(!(await queue(db)).has('zip:90001'));
    await clear(db);
    await publication(db,'encoded','MEETING',`source:legistar:body:${encodeURIComponent(MESA_BODY)}`);
    assert.ok((await queue(db)).has('zip:85201'));
    assert.ok(!(await queue(db)).has('zip:07001'));
    for(const [key,family,scope] of [
      ['unknown','MEETING','source:legacy:body:unlocated-board'],
      ['domains','DOTGOV_REFERENCE','US:current-full:domains'],
      ['routing','CURATED_READER_RECORD',everyday],
    ]) {
      await clear(db);
      await publication(db,key,family,scope);
      assert.ok((await queue(db)).has('zip:85701')&&(await queue(db)).has('zip:90001')&&(await queue(db)).has('zip:07001'));
    }
  }finally{await db.pg.close();}
});

test('only public confirmations on the pointed version queue a reader update',async()=>{
  const db=await fixture();
  try {
    await publication(db,'meeting','MEETING','source:derived:family:US-AZ');
    await clear(db);
    await db.query("INSERT INTO civic_data_candidate_events VALUES('v1',1,'checked'),('old-version',1,'UNCHANGED_CONFIRMATION_V1 {}')");
    assert.equal((await queue(db)).size,0);
    await db.query("INSERT INTO civic_data_candidate_events VALUES('v1',2,'UNCHANGED_CONFIRMATION_V1 {}')");
    assert.ok((await queue(db)).has('zip:85701'));
    assert.ok(!(await queue(db)).has('zip:90001'));
  }finally{await db.pg.close();}
});

test('preceding fact writers queue removals, member contacts and source checks without country-wide fanout',async()=>{
  const db=await fixture();
  try {
    await db.query("UPDATE fact SET value=value,cost_usd=cost_usd+1 WHERE entity_id=$1 AND field='name'",[BODY]);
    assert.equal((await queue(db)).size,0,'billing-only and exact replays do not change a reader page');
    await db.query("UPDATE fact SET checked_at=checked_at+interval '1 minute' WHERE entity_id=$1 AND field='name'",[BODY]);
    assert.ok((await queue(db)).has('zip:85701'));
    assert.ok(!(await queue(db)).has('zip:85201')&&!(await queue(db)).has('zip:90001'));
    await clear(db);
    await ownerFact(db,PERSON,'phone','520-555-0100');
    assert.ok((await queue(db)).has('zip:85701'),'a member fact reaches the body that serves their place');
    await clear(db);
    await db.query("UPDATE fact SET status='pulled' WHERE entity_id=$1 AND field='name'",[BODY]);
    assert.ok((await queue(db)).has('zip:85701'));
    await clear(db);
    await db.query('DELETE FROM fact WHERE entity_id=$1',[PERSON]);
    assert.ok((await queue(db)).has('zip:85701'));
  }finally{await db.pg.close();}
});

test('entity placement, host and alias writers retain both the old and new place footprints',async()=>{
  const db=await fixture();
  try {
    await db.query('UPDATE entity SET name=name WHERE id=$1',[BODY]);
    assert.equal((await queue(db)).size,0);
    await db.query('UPDATE entity_place SET place_id=$2 WHERE entity_id=$1',[BODY,MESA]);
    assert.ok((await queue(db)).has('zip:85701')&&(await queue(db)).has('zip:85201'));
    assert.ok(!(await queue(db)).has('zip:90001'));
    await clear(db);
    await db.query("UPDATE entity_external_id SET entity_id=$2 WHERE entity_id=$1 AND scheme='body-alias'",[BODY,MESA_BODY]);
    assert.ok((await queue(db)).has('zip:85701')&&(await queue(db)).has('zip:85201'));
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES('mesa-government','government','Mesa','AZ',$1),('orphan-board','body','A board','AZ',$2)",[MESA,AZ]);
    await db.query("INSERT INTO entity_host(entity_id,host) VALUES('mesa-government','mesa.gov'),('orphan-board','mesa.gov')");
    await clear(db);
    await db.query("DELETE FROM entity_host WHERE entity_id='orphan-board'");
    assert.ok((await queue(db)).has('zip:85201'),'the old host filing is queued before its edge disappears');
    assert.ok(!(await queue(db)).has('zip:90001'));
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES('retired-board','body','Retired board','AZ',$1)",[CITY]);
    await clear(db);
    await db.query("DELETE FROM entity WHERE id='retired-board'");
    assert.ok((await queue(db)).has('zip:85701'));
    assert.ok(!(await queue(db)).has('retired-board'),'removing an unused entity never strands an unbuildable request');
  }finally{await db.pg.close();}
});

test('the post-deploy contract retires every compatibility hook without changing reader facts or identities',async()=>{
  const db=await fixture();
  try {
    const before=await db.query('SELECT id,kind,name,parent_id,state FROM entity ORDER BY id');
    const facts=await db.query('SELECT * FROM fact ORDER BY id');
    await apply(db,'contract');
    assert.deepEqual(await db.query('SELECT id,kind,name,parent_id,state FROM entity ORDER BY id'),before);
    assert.deepEqual(await db.query('SELECT * FROM fact ORDER BY id'),facts);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'rb_a7_bootstrap_%'"))[0]!.n,0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'rb_a7_bootstrap_%'"))[0]!.n,0);
    await db.query('INSERT INTO rebuild_queue(place_id) VALUES($1) ON CONFLICT(place_id) DO UPDATE SET generation=rebuild_queue.generation+1',[CITY]);
    await db.query('INSERT INTO rebuild_queue(place_id) VALUES($1) ON CONFLICT(place_id) DO UPDATE SET generation=rebuild_queue.generation+1',[CITY]);
    assert.deepEqual([...await queue(db)],[[CITY,2]],'the new publisher controls its own queue after the transition');
  }finally{await db.pg.close();}
});


test('calendar CHECK retries leave verified reader pages intact during the initial build',async()=>{
  const db=await fixture();
  const field='calendar:source:fixture:body:'+encodeURIComponent(BODY);
  try {
    await db.query("INSERT INTO blank(entity_id,field,stage,reason,detail,next_try_at) VALUES($1,$2,'CHECK','PORTAL_AUTHORITY_UNCONFIRMED','portal',now())",[BODY,field]);
    assert.equal((await queue(db)).size,0,'a standing check does not change the held reader answer');
    await db.query('UPDATE blank SET attempts=attempts+1,next_try_at=now() WHERE entity_id=$1 AND field=$2',[BODY,field]);
    assert.equal((await queue(db)).size,0,'retry metadata does not change the held page');
    await db.query('DELETE FROM blank WHERE entity_id=$1 AND field=$2',[BODY,field]);
    assert.equal((await queue(db)).size,0,'closing a check leaves the unchanged held answer in place');
  }finally{await db.pg.close();}
});
