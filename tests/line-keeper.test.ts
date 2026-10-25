import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HourlyCounts } from "../app/(admin)/_mw/admin-v6/scoreboard-hourly-counts.tsx";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { COUNT_SCHEMA_SOURCE, countHourMigrationDefinition } from "../lib/control-plane/repository/migrations/RB-A8.ts";
import { SHARED_WORK_DDL } from "../lib/control-plane/repository/migrations/RB-A1.ts";
import { workMigrationDefinition } from "../lib/control-plane/repository/migrations/RB-A5.ts";
import { workList } from "../lib/core/work.ts";
import { REJECT_REWRITE_FUNCTION_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { CONTROL_READS_BACKFILL_DDL } from "../lib/control-plane/repository/control-reads-backfill.ts";
import { readCounts, readOldest } from "../lib/control-plane/line-keeper/read.ts";
import { runLineKeeper, withKeeperFixes } from "../lib/control-plane/line-keeper/keep.ts";
import { keeperRows } from "../lib/control-plane/line-keeper/admin.ts";
import { readLineReport } from "../lib/control-plane/line-keeper/report.ts";
import { keeperStatus } from "../lib/control-plane/line-keeper/model.ts";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { countProblems, countWindow } from "../lib/counts/hour.ts";
import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";
import { groupCountProblems, compactKeeperProblems } from "../lib/counts/problem-groups.ts";
import { BriefParts } from "../app/(admin)/_mw/admin-v6/brief-view.tsx";
import { readVitalSigns } from "../lib/control-plane/admin-view/vital-signs-read.ts";
import { config as schedule } from "../netlify/functions/line-keeper.mts";
const migration=readFileSync(COUNT_SCHEMA_SOURCE,'utf8');
const query=(db:PGlite)=>({query:async(text:string,params:readonly unknown[]=[])=> (await db.query<Record<string,unknown>>(text,[...params])).rows});
async function readerDatabase() {
  const db=new PGlite();
  await db.exec(`CREATE TABLE entity(id text PRIMARY KEY,kind text,state text);
    CREATE TABLE fact(id serial PRIMARY KEY,entity_id text REFERENCES entity(id),field text,status text,value jsonb);
    CREATE TABLE civic_data_promotions(scope text,record_class text,current_version_id text);
    INSERT INTO entity VALUES('az:body','body','AZ'),('ny:person','person','NY');
    INSERT INTO fact(entity_id,field,status) VALUES('az:body','name','live'),('ny:person','name','held');
    INSERT INTO civic_data_promotions VALUES('AZ:test','NEW_FAMILY','version-1');`);
  await db.exec(migration.replaceAll('--> statement-breakpoint',''));
  return db;
}
async function controlDatabase(withLeasedWork = false) {
  const db=new PGlite();
  for(const table of ['cp_work_items','cp_work_items_archive','cp_doors','cp_box_findings','cp_owner_snapshots'])
    await db.exec(`CREATE TABLE ${table}(id text PRIMARY KEY,revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),value jsonb NOT NULL)`);
  await db.exec(`CREATE VIEW cp_work_items_history AS SELECT * FROM cp_work_items UNION ALL SELECT * FROM cp_work_items_archive;
    CREATE TABLE cp_admin_config(id text PRIMARY KEY,revision integer NOT NULL,updated_at timestamptz,value jsonb);
    CREATE TABLE cp_admin_fix_list(config_id text,id text,updated_at timestamptz,value jsonb,PRIMARY KEY(config_id,id));`);
  await db.exec(CONTROL_READS_BACKFILL_DDL[0]);
  await db.exec(REJECT_REWRITE_FUNCTION_DDL);
  await db.exec(`CREATE TRIGGER cp_owner_snapshots_no_rewrite BEFORE DELETE ON cp_owner_snapshots
    FOR EACH ROW EXECUTE FUNCTION cp_reject_rewrite();`);
  for(const statement of SHARED_WORK_DDL)await db.exec(statement);
  if(withLeasedWork)await db.exec(workMigrationDefinition());
  await db.exec(countHourMigrationDefinition());
  await db.query(`INSERT INTO cp_admin_config VALUES('current',1,now(),$1::jsonb)`,[JSON.stringify(defaultAdminConfig(new Date().toISOString()))]);
  return db;
}

test('688 state problems become one brief group, agree with direct state SQL, and keep every repair in Queue',async()=>{
  const [control,reader]=await Promise.all([controlDatabase(),readerDatabase()]);
  try {
    const states=[...REGISTRY_STATES,'US'];
    const since=new Date(Date.now()-2*3_600_000).toISOString();
    for(const [index,state] of states.entries()) {
      const allRowsIndex=Array.from({length:index<4?13:12},(_,family)=>Array.from({length:family%3+1},(_,item)=>({id:`${state}-${family}-${item}`,state:'WAITING',
        lane:`Family ${family}`,stateCode:state,waitingSince:since,owner:'FLEET'}))).flat();
      await control.query('INSERT INTO cp_owner_snapshots(id,value) VALUES($1,$2::jsonb)',[`current:${state.toLowerCase()}`,JSON.stringify({allRowsIndex})]);
    }
    const at=new Date().toISOString();
    const {hour}=await runLineKeeper(query(control),query(reader),at);
    assert.equal(hour.problems.length,688);
    const groups=groupCountProblems(hour.problems);
    assert.equal(groups.length,1);
    assert.equal(groups[0].group!.items,1372);
    assert.equal(groups[0].group!.states.length,57);
    const direct=(await control.query<{state:string;n:number}>(`SELECT r->>'stateCode' AS state,count(*)::int AS n
      FROM cp_owner_snapshots s CROSS JOIN LATERAL jsonb_array_elements(s.value->'allRowsIndex') r
      WHERE s.id LIKE 'current:%' GROUP BY 1 ORDER BY 1`)).rows;
    for(const row of direct)assert.equal(groups[0].group!.states.find(s=>s.state===row.state)!.items,row.n,row.state);
    assert.equal((await control.query<{n:number}>('SELECT count(*)::int AS n FROM cp_admin_fix_list')).rows[0].n,688);
    const config=withKeeperFixes(defaultAdminConfig(at),hour);
    const brief=config.latestBrief!;
    const html=renderToStaticMarkup(createElement(BriefParts,{brief}));
    assert.ok(html.length<6000);
    assert.match(html,/Alaska/);assert.match(html,/scope=ak/);assert.doesNotMatch(html,/diggers/);
    const clear=withKeeperFixes(config,{...hour,problems:[]});
    assert.equal(clear.latestBrief!.problems.length,0,'the brief does not retain stale hourly findings');
    assert.equal(clear.fixList!.length,688,'a quiet hour never closes owned repair work');
    const old=hour.problems.map(p=>({key:`line-keeper:${p.key}`,what:p.says,owner:'diggers',next:p.next}));
    assert.deepEqual(compactKeeperProblems(old),groups,'saved snapshots compact immediately too');
  } finally {await Promise.all([control.close(),reader.close()]);}
});

test('Now agrees with SQL for three full hours and reports the completed check across the hour boundary',async()=>{
  const [control,reader]=await Promise.all([controlDatabase(),readerDatabase()]);
  try {
    await control.exec(`CREATE TABLE cp_vital_signs(hour timestamptz,facts_live bigint,spend_usd numeric,
      neon_bytes_read bigint,rounds_finished int,rounds_killed int,paid_jobs_ended_empty int,paid_jobs_ended int);`);
    const first=countWindow(new Date().toISOString()).from;
    // Controlled hour keys avoid waiting three hours. The counters and Admin use their real SQL.
    await reader.query("UPDATE count_hour SET hour=$1::timestamptz - interval '1 hour' WHERE step='counter start'",[first]);
    for(let index=0;index<3;index++) {
      const from=new Date(Date.parse(first)+index*3_600_000).toISOString();
      const at=new Date(Date.parse(from)+3_600_000+9*60_000).toISOString();
      const amount=[0,229,1878][index];
      if(amount)await reader.query("SELECT count_hour_at('AZ','Officials','fact:live',$1::timestamptz,$2,$2,0,0)",[from,amount]);
      await control.query('INSERT INTO cp_vital_signs VALUES($1,NULL,1,100,0,0,0,0)',[from]);
      await runLineKeeper(query(control),query(reader),at);
      const report=await readLineReport(query(control),query(reader));
      assert.equal(keeperStatus(report,at),'The line keeper is checking every hour.');
      const numbers=await readVitalSigns(query(control),at,query(reader));
      const direct=(await reader.query<{n:number}>(`SELECT coalesce(sum(n),0)::int AS n FROM count_hour
        WHERE hour=$1::timestamptz AND step LIKE 'v1:%' AND substring(step FROM 4)::jsonb->>1='fact:live'
        AND substring(step FROM 4)::jsonb->>2 IN ('in','changed')`,[from])).rows[0].n;
      assert.equal(numbers[0].factsLive,direct);
      assert.equal(numbers[0].factsLive,amount);
      assert.equal(numbers[0].costPerFactUsd,amount?Math.round(1/amount*1e6)/1e6:null);
      const boundary=new Date(Date.parse(at)+51*60_000).toISOString();
      assert.match(keeperStatus(report,boundary),/last reported.*next full-hour report is pending/);
    }
  }finally{await Promise.all([control.close(),reader.close()]);}
});

test('Now shows observed facts from the installation hour as a lower bound and earlier hours as unknown',async()=>{
  const reader=await readerDatabase();
  try {
    await reader.exec("UPDATE count_hour SET hour='2026-10-25T03:26:46.189Z' WHERE step='counter start'; DELETE FROM count_hour WHERE step<>'counter start';");
    await reader.query("SELECT count_hour_at('AZ','Officials','fact:live','2026-10-25T03:00:00Z',229,229,0,0)");
    const empty={query:async()=>[]};
    const rows=await readVitalSigns(empty,'2026-10-25T04:09:00Z',query(reader));
    assert.deepEqual(rows.map(r=>[r.factsLive,r.factsLiveAtLeast,r.costPerFactUsd]),[[229,true,null],[null,false,null]]);
  }finally{await reader.close();}
});

test('the merged work list counts completed work as done and delayed retries as scheduled',async()=>{
  const db=await controlDatabase(true);
  try {
    const at=new Date(Date.now()+5*60_000),list=workList(async(text,params=[])=>query(db).query(text,params),{owner:'counter-test',now:()=>at});
    const input={kind:'check' as const,placeId:'ocd-division/country:us/state:az/county:pima',subjectId:'body:pima',url:'https://www.pima.gov/contact',field:'phone',value:'520-724-4330',quote:'Phone: 520-724-4330',source:{report:'one'}};
    const first=await list.add(input);
    const [leased]=await list.claim('check',1);
    assert.equal(leased!.id,first.id);assert.equal(await list.finish(leased!),true);
    assert.equal((await list.add({...input,source:{report:'repeat'}})).status,'done');
    const window=countWindow(new Date(at.getTime()+3_600_000).toISOString());
    let rows=await readCounts(query(db),window.from,window.through);
    assert.equal(rows.find(r=>r.family==='check'&&r.stage==='work list:DONE')!.total,1);
    assert.equal((await readOldest(query(db))).filter(r=>r.family==='check').length,0,'done work never becomes a waiting pile');
    await list.add({...input,field:'address'});
    const [retry]=await list.claim('check',1);
    assert.equal(await list.later(retry!,'Source offline'),true);
    rows=await readCounts(query(db),window.from,window.through);
    assert.equal(rows.find(r=>r.family==='check'&&r.stage==='work list:SCHEDULED')!.total,1);
    assert.ok(!rows.some(r=>r.family==='check'&&r.stage==='work list:REFUSED'&&r.total>0),'a retry reason is not a terminal refusal');
    const due=(await db.query<{not_before:Date}>('SELECT not_before FROM work_row WHERE id=$1',[retry!.id])).rows[0]!.not_before;
    rows=await readCounts(query(db),window.from,window.through,new Date(due).toISOString());
    assert.equal(rows.find(r=>r.family==='check'&&r.stage==='work list:WAITING')!.total,1);
    const direct=(await db.query<{n:number}>("SELECT count(*)::int n FROM work_row WHERE status='done'")).rows[0]!.n;
    assert.equal(rows.filter(r=>r.stage==='work list:DONE').reduce((n,r)=>n+r.total,0),direct);
  }finally{await db.close();}
});

test('every fact state and new pointer family agrees with direct SQL through inserts, transitions, deletes and rollback',async()=>{
  const db=await readerDatabase();
  try {
    await db.exec(`INSERT INTO fact(entity_id,field,status) VALUES('az:body','agenda_url','live');
      UPDATE fact SET status='live' WHERE entity_id='ny:person';
      UPDATE civic_data_promotions SET current_version_id='version-2';
      INSERT INTO civic_data_promotions VALUES('US-CA:new','FUTURE_FAMILY','version-3');
      INSERT INTO civic_data_promotions VALUES('source:clerksboards:body:ocd-division%2Fcountry%3Aus%2Fstate%3Aaz%2Fplace%3Atucson%232018-parks-connections-bond-oversight-commission','MEETING','cv-9ae69ffd18df730d6e995424f31e95b2');
      UPDATE fact SET value='"new words"' WHERE entity_id='az:body' AND field='name';
      DELETE FROM fact WHERE field='agenda_url';
      UPDATE entity SET state='CA' WHERE id='ny:person';`);
    const window=countWindow(new Date(Date.now()+3_600_000).toISOString());
    const counts=await readCounts(query(db),window.from,window.through);
    const direct=(await db.query<{state:string;stage:string;total:number}>(`SELECT e.state,'fact:'||f.status AS stage,count(*)::int AS total
      FROM fact f JOIN entity e ON e.id=f.entity_id GROUP BY 1,2`)).rows;
    for(const row of direct)assert.equal(counts.filter(c=>c.state===row.state&&c.stage===row.stage).reduce((n,c)=>n+c.total,0),row.total);
    assert.equal(counts.find(c=>c.family==='NEW_FAMILY')!.total,1);
    assert.equal(counts.find(c=>c.family==='FUTURE_FAMILY')!.state,'CA');
    assert.equal(counts.find(c=>c.family==='MEETING')!.state,'AZ','real production pointer scopes keep their state through encoding');
    assert.equal(counts.find(c=>c.family==='NEW_FAMILY')!.observedIn,1,'baseline invents no writer activity');
    const before=JSON.stringify((await db.query('SELECT * FROM count_hour ORDER BY state,hour,step')).rows);
    await db.exec(`BEGIN; INSERT INTO fact(entity_id,field,status) VALUES('az:body','name','live'); ROLLBACK;`);
    assert.equal(JSON.stringify((await db.query('SELECT * FROM count_hour ORDER BY state,hour,step')).rows),before);
  }finally{await db.close();}
});

test('door and work changes are atomic, retries add no movement, and archival preserves totals',async()=>{
  const db=await controlDatabase();
  try {
    const value={id:'az:work',subject:'ocd-division/country:us/state:az/place:phoenix',state:'OPEN',createdAt:'2026-10-20T07:00:00Z',autonomousPlan:{contract:{recordClass:'MEETING'}}};
    await db.query(`INSERT INTO cp_work_items(id,value) VALUES($1,$2::jsonb)`,[value.id,JSON.stringify(value)]);
    await db.query(`UPDATE cp_work_items SET value=$1::jsonb WHERE id=$2`,[JSON.stringify({...value,obligation:'same waiting work'}),value.id]);
    await db.exec(`INSERT INTO cp_doors(id,value) VALUES('door', '{"doorId":"AZ:door","status":"OPEN","holds":["MEETING","FUTURE_FAMILY"],"updatedAt":"2026-10-20T07:00:00Z"}');
      UPDATE cp_doors SET value=value||'{"lastSuccessAt":"2026-10-24T08:00:00Z"}'::jsonb;
      INSERT INTO cp_work_items_archive SELECT * FROM cp_work_items; DELETE FROM cp_work_items;`);
    const w=countWindow(new Date(Date.now()+3_600_000).toISOString());
    const rows=await readCounts(query(db),w.from,w.through);
    assert.equal(rows.find(r=>r.stage==='work:OPEN')!.total,1);
    assert.equal(rows.filter(r=>r.stage==='door:OPEN').reduce((n,r)=>n+r.total,0),1,'a source that serves two families still counts as one door');
    assert.equal(rows.find(r=>r.stage==='door family:OPEN'&&r.family==='FUTURE_FAMILY')!.total,1);
    await db.query(`INSERT INTO cp_owner_snapshots(id,value) VALUES('current:az',$1::jsonb)`,[JSON.stringify({allRowsIndex:[{id:'queue-row',state:'WAITING',lane:'CREATED',stateCode:'AZ',waitingSince:value.createdAt,owner:'FLEET'}]})]);
    const waiting=await readOldest(query(db));
    assert.equal(waiting.find(r=>r.stage==='work list:WAITING')!.oldestAt,'2026-10-20T07:00:00.000Z');
    await db.query(`UPDATE cp_owner_snapshots SET value=$1::jsonb WHERE id='current:az'`,[JSON.stringify({allRowsIndex:[
      {id:'queue-row',state:'WAITING',lane:'CREATED',stateCode:'AZ',waitingSince:value.createdAt,owner:'FLEET'},
      {id:'untimed-row',state:'WAITING',lane:'CREATED',stateCode:'AZ',owner:'FLEET'},
    ]})]);
    const mixed=await readOldest(query(db));
    assert.equal(mixed.find(r=>r.stage==='work list:WAITING')!.oldestAt,null,'a dated row cannot hide another row whose age is unknown');
  }finally{await db.close();}
});

test('a waiting pile becomes owned Admin work and a brief item on the next hourly invocation, with a tiny saved state',async()=>{
  const [control,reader]=await Promise.all([controlDatabase(),readerDatabase()]);
  try {
    await control.exec(`INSERT INTO cp_owner_snapshots(id,value) VALUES('line-keeper:current',jsonb_build_object('inventory',repeat('x',1000000)));
      INSERT INTO cp_box_findings(id,value) VALUES('AZ:pile','{"subjectId":"AZ:body","state":"waiting","origins":[{"recordedAt":"2026-10-20T07:00:00Z"}],"fact":{"recordClass":"MEETING"}}');`);
    const first=new Date(Date.now()+3_600_000).toISOString();
    const result=await runLineKeeper(query(control),query(reader),first);
    assert.ok(result.hour.problems.some(p=>p.owner==='The research team'&&p.key==='counts:AZ:MEETING:box:waiting'));
    assert.equal((await control.query<{n:number}>("SELECT count(*)::int AS n FROM cp_owner_snapshots")).rows[0].n,0);
    await control.exec(`INSERT INTO cp_owner_snapshots(id,value) VALUES('other-owner','{}');`);
    await assert.rejects(()=>control.exec(`DELETE FROM cp_owner_snapshots WHERE id='other-owner'`),/only the retired/);
    const fixes=(await control.query<{value:{owner:string}}>('SELECT value FROM cp_admin_fix_list')).rows;
    assert.ok(fixes.some(r=>(r.value as {owner:string}).owner==='The research team'));
    const [config]=(await control.query<{value:{latestBrief:{problems:{owner:string}[]}}}>(`SELECT value FROM cp_admin_config WHERE id='current'`)).rows;
    assert.ok((config.value as {latestBrief:{problems:{owner:string}[]}}).latestBrief.problems.some(p=>p.owner==='The research team'));
    // Exercise the same scheduled path at its next hourly time, retaining the waiting repair.
    const next=new Date(Date.parse(first)+3_600_000).toISOString();
    await runLineKeeper(query(control),query(reader),next);
    const report=await readLineReport(query(control),query(reader));
    assert.equal(report!.hours.length,2);
    assert.equal(keeperStatus(report,next),'The line keeper is checking every hour.');
    assert.match(keeperStatus(report,new Date(Date.parse(next)+3_600_001).toISOString()),/stopped reporting/);
    const saved=(await control.query<{bytes:number}>(`SELECT sum(octet_length(row_to_json(r)::text))::int AS bytes FROM line_keeper_run r`)).rows[0];
    assert.ok(Number(saved.bytes)<1000);
    assert.equal((await control.query('SELECT count(*)::int AS n FROM cp_admin_fix_list')).rows.length,1);
    assert.equal(schedule.schedule,'5 * * * *');
    const rows=new Map(keeperRows(report,next));
    assert.match(renderToStaticMarkup(createElement(HourlyCounts,{data:rows.get('Facts live per hour (fact store)')!.hourlyCounts!})),/Oldest work waiting/);
    const states=[...REGISTRY_STATES,'US'];
    await control.query(`INSERT INTO work_row(id,kind,state,not_before)
      SELECT 'pile:'||state,'read',state,$2::timestamptz FROM unnest($1::text[]) AS s(state)`,[states,'2026-10-20T07:00:00Z']);
    for(let hour=2;hour<=4;hour++)await runLineKeeper(query(control),query(reader),new Date(Date.parse(first)+hour*3_600_000).toISOString());
    const retained=(await control.query<{n:number;states:number;bytes:number}>(`SELECT count(*)::int AS n,
      min((SELECT count(*) FROM jsonb_object_keys(oldest)))::int AS states,
      sum(octet_length(row_to_json(r)::text))::int AS bytes FROM line_keeper_run r`)).rows[0];
    assert.equal(retained.n,3,'hourly retention stays bounded');
    assert.equal(retained.states,57,'the saved oldest summaries cover every state, territory and national queue');
    assert.ok(retained.bytes<100_000,`${retained.bytes} bytes saved with waiting work in every state`);
    const finalAt=new Date(Date.parse(first)+4*3_600_000).toISOString(),window=countWindow(finalAt);
    const counts=await readCounts(query(control),window.from,window.through,finalAt);
    const direct=(await control.query<{state:string;n:number}>('SELECT state,count(*)::int AS n FROM work_row GROUP BY state')).rows;
    assert.equal(direct.length,57);
    for(const row of direct)assert.equal(counts.filter(c=>c.state===row.state&&c.family==='read'&&c.stage==='work list:WAITING')
      .reduce((n,c)=>n+c.total,0),row.n,`${row.state}: hourly Admin counts equal direct SQL`);
  }finally{await Promise.all([control.close(),reader.close()]);}
});

test('the two Eastern fall-back hours remain separate and a growing pile keeps its owner without closing older fixes',()=>{
  const old={hour:'2026-11-01T05:00:00Z',state:'AZ',family:'new family',stage:'work:OPEN',total:1,closedTotal:1,incoming:0,outgoing:0,changed:0};
  const current={...old,hour:'2026-11-01T06:00:00Z',total:2,closedTotal:2};
  const waiting={state:'AZ',family:'new family',stage:'work:OPEN',count:2,oldestAt:'2026-11-01T05:30:00Z',owner:'diggers'};
  const problems=countProblems([current],[old],[waiting],'2026-11-01T07:05:00Z');
  assert.match(problems[0].says,/pile grew/);
  const h={from:current.hour,through:'2026-11-01T07:00:00Z',measuredAt:'2026-11-01T07:05:00Z',counts:[current],waiting:[waiting],problems,own:{bytesRead:0}};
  const config=defaultAdminConfig(h.measuredAt),saved=withKeeperFixes(config,h);
  assert.deepEqual(saved.settings,config.settings);
  assert.equal(withKeeperFixes(saved,h).fixList!.length,saved.fixList!.length);
  const details=new Map(keeperRows({version:2,checkedAt:h.measuredAt,hours:[h,{...h,from:old.hour,counts:[old]}]},h.measuredAt)).get('Facts live per hour (fact store)')!.hourlyCounts!;
  const markup=renderToStaticMarkup(createElement(HourlyCounts,{data:details}));
  assert.match(markup,/1:00 AM EDT/);
  assert.match(markup,/1:00 AM EST/);
  const cache={...current,family:'Reader cache',stage:'cache',total:0,closedTotal:0,incoming:null,outgoing:null,observedIn:2,observedOut:1};
  const failed=countProblems([cache],[],[],h.measuredAt);
  assert.equal(failed[0].owner,'the runner');
  assert.match(failed[0].says,/1 reader update failed/);
  assert.equal(countProblems([{...cache,observedOut:2}],[],[],h.measuredAt).length,0);
});

test('a pile arriving after the hour closes is caught on the first tick while installation coverage is partial',()=>{
  const current={hour:'2026-10-24T16:00:00Z',state:'AZ',family:'read',stage:'work list:WAITING',
    total:1,closedTotal:0,incoming:null,outgoing:null,changed:null,observedIn:0,observedOut:0};
  const previous={...current,hour:'2026-10-24T15:00:00Z',total:0,closedTotal:null};
  const waiting={state:'AZ',family:'read',stage:'work list:WAITING',count:1,oldestAt:'2026-10-24T17:02:00Z',owner:'diggers'};
  const problems=countProblems([current],[previous],[waiting],'2026-10-24T17:05:00Z');
  assert.equal(problems.length,1);
  assert.equal(problems[0].owner,'The research team');
  assert.match(problems[0].says,/pile grew/);
});

test('growth uses the whole counted pile when waiting ages are split between owners',()=>{
  const current={hour:'2026-10-24T16:00:00Z',state:'AZ',family:'read',stage:'work list:WAITING',
    total:3,closedTotal:2,incoming:0,outgoing:0,changed:0};
  const previous={...current,hour:'2026-10-24T15:00:00Z',total:2,closedTotal:2};
  const waiting={state:'AZ',family:'read',stage:'work list:WAITING',count:1,oldestAt:'2026-10-24T17:02:00Z',owner:'Sean'};
  const problems=countProblems([current],[previous],[waiting],'2026-10-24T17:05:00Z');
  assert.equal(problems.length,1);
  assert.equal(problems[0].owner,'Sean');
  assert.match(problems[0].says,/3 items are waiting; the pile grew/);
  const both=countProblems([current],[previous],[waiting,{...waiting,count:2,owner:'diggers'}],'2026-10-24T17:05:00Z');
  assert.equal(both.length,1,'one pile split across owners is counted once');
  assert.equal(both[0].items,3);
});

test('clearing an older large pile cannot hide new work arriving after the latest hour closes',()=>{
  const current={hour:'2026-10-24T16:00:00Z',state:'AZ',family:'read',stage:'work list:WAITING',
    total:1,closedTotal:0,incoming:0,outgoing:100,changed:0};
  const previous={...current,hour:'2026-10-24T15:00:00Z',total:100,closedTotal:100};
  const waiting={state:'AZ',family:'read',stage:'work list:WAITING',count:1,oldestAt:'2026-10-24T17:02:00Z',owner:'diggers'};
  const problems=countProblems([current],[previous],[waiting],'2026-10-24T17:05:00Z');
  assert.equal(problems.length,1);
  assert.equal(problems[0].owner,'The research team');
  assert.match(problems[0].says,/1 items are waiting; the pile grew/);
});


test('work-list counts follow lease and due-time boundaries without another snapshot or an inventory read',async()=>{
  const db=await controlDatabase();
  try {
    const now=new Date().toISOString(),boundary=new Date(Date.parse(now)+5*60_000).toISOString(),later=new Date(Date.parse(boundary)+1).toISOString();
    const rows=[{id:'work',lane:'STANDING',state:'WORKING',from:null,until:boundary,stateCode:'AZ',owner:'FLEET'},
      {id:'work',lane:'STANDING',state:'FAILED',from:boundary,until:null,stateCode:'AZ',owner:'FLEET',waitingSince:boundary}];
    await db.query(`INSERT INTO cp_owner_snapshots(id,value) VALUES('current:az',$1::jsonb)`,[JSON.stringify({allRowsIndex:rows})]);
    const window=countWindow(later);
    const before=await readCounts(query(db),window.from,window.through,new Date().toISOString());
    const after=await readCounts(query(db),window.from,window.through,later);
    assert.equal(before.find(r=>r.stage==='work list:WORKING')!.total,1);
    assert.equal(before.find(r=>r.stage==='work list:FAILED')!.total,0);
    assert.equal(after.find(r=>r.stage==='work list:WORKING')!.total,0);
    assert.equal(after.find(r=>r.stage==='work list:FAILED')!.total,1);
    assert.equal((await readOldest(query(db),later)).find(r=>r.stage==='work list:FAILED')!.oldestAt,boundary);
    // A same-snapshot retry cannot manufacture work moving on.
    await db.query(`UPDATE cp_owner_snapshots SET value=$1::jsonb WHERE id='current:az'`,[JSON.stringify({allRowsIndex:rows})]);
    assert.deepEqual(await readCounts(query(db),window.from,window.through,later),after);
  }finally{await db.close();}
});


test('RB-A1 work rows feed the same counters and oldest ages through scheduling, leasing, refusal and completion',async()=>{
  const db=await controlDatabase();
  try {
    const due=new Date(Date.now()-2*3_600_000).toISOString();
    await db.query(`INSERT INTO work_row(id,kind,state,not_before) VALUES('new-work','read','AZ',$1::timestamptz)`,[due]);
    const window=countWindow(new Date().toISOString());
    let rows=await readCounts(query(db),window.from,window.through);
    assert.equal(rows.find(r=>r.family==='read'&&r.stage==='work list:WAITING')!.total,1);
    assert.equal((await readOldest(query(db))).find(r=>r.family==='read')!.oldestAt,due);
    const full=countWindow(new Date(Date.now()+2*3_600_000).toISOString());
    const recorded=await readCounts(query(db),full.from,full.through,full.through);
    assert.equal(recorded.find(r=>r.family==='read'&&r.stage==='work list:WAITING')!.incoming,0,'the first complete control-plane hour is measured');
    const lease=new Date(Date.now()+5*60_000).toISOString();
    await db.query(`UPDATE work_row SET lease_until=$1::timestamptz,lease_owner='runner' WHERE id='new-work'`,[lease]);
    rows=await readCounts(query(db),window.from,window.through);
    assert.equal(rows.find(r=>r.family==='read'&&r.stage==='work list:WAITING')!.total,0);
    assert.equal(rows.find(r=>r.family==='read'&&r.stage==='work list:LEASED')!.total,1);
    const expired=new Date(Date.parse(lease)+1).toISOString();
    rows=await readCounts(query(db),window.from,window.through,expired);
    assert.equal(rows.find(r=>r.family==='read'&&r.stage==='work list:EXPIRED')!.total,1);
    await db.exec(`UPDATE work_row SET lease_until=NULL,lease_owner=NULL,refusal='Source unavailable' WHERE id='new-work'`);
    rows=await readCounts(query(db),window.from,window.through);
    assert.equal(rows.find(r=>r.family==='read'&&r.stage==='work list:REFUSED')!.total,1);
    await db.exec(`DELETE FROM work_row WHERE id='new-work'`);
    rows=await readCounts(query(db),window.from,window.through,expired);
    assert.ok(rows.filter(r=>r.family==='read').every(r=>r.total===0),'removing a row cancels its future clock changes too');
    assert.ok((await db.query<{n:number}>('SELECT n FROM count_hour')).rows.every(r=>Number(r.n)>=0),'the shared nonnegative CountHour contract holds');
  }finally{await db.close();}
});


test('a partial first hour stays unmeasured and unchanged checks never count as new information',async()=>{
  const db=await readerDatabase();
  try {
    const now=new Date().toISOString(),window=countWindow(new Date(Date.parse(now)+3_600_000).toISOString());
    let rows=await readCounts(query(db),window.from,window.through,now);
    assert.equal(rows.find(r=>r.stage==='fact:live')!.incoming,null);
    assert.equal(rows.find(r=>r.stage==='fact:live')!.closedTotal,1);
    const before=JSON.stringify((await db.query('SELECT * FROM count_hour ORDER BY state,hour,step')).rows);
    await db.exec(`UPDATE fact SET value=value; UPDATE civic_data_promotions SET current_version_id=current_version_id;`);
    assert.equal(JSON.stringify((await db.query('SELECT * FROM count_hour ORDER BY state,hour,step')).rows),before);
    await db.exec(`ALTER TABLE fact ADD COLUMN checked_at timestamptz; UPDATE fact SET checked_at=now();`);
    assert.equal(JSON.stringify((await db.query('SELECT * FROM count_hour ORDER BY state,hour,step')).rows),before);
    const fullFrom=new Date(Date.parse(window.through)).toISOString(),fullThrough=new Date(Date.parse(fullFrom)+3_600_000).toISOString();
    rows=await readCounts(query(db),fullFrom,fullThrough,fullThrough);
    assert.equal(rows.find(r=>r.stage==='fact:live')!.incoming,0);
    assert.equal(rows.find(r=>r.stage==='fact:live')!.outgoing,0);
  }finally{await db.close();}
});
