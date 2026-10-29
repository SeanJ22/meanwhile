import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {OWNER_STUCK_COUNTS_DDL,OWNER_STUCK_COUNTS_BACKFILL_DDL,readOwnerStuckSummary,readOwnerStuckRows,readOwnerDistrictStuckCounts} from '../lib/control-plane/repository/owner-stuck-counts.ts';
import {stuckViews} from '../lib/control-plane/admin-view/v6-stuck-read.ts';
import {placeKeyOfRow,stateOfRow,type StuckRowLike} from '../lib/control-plane/admin-view/blocker-causes.ts';
import type {StuckSummary} from '../lib/control-plane/admin-view/stuck-summary.ts';
import type {Sql} from '../lib/control-plane/repository/pg-store.ts';

const NOW='2026-10-28T12:00:00.000Z',LATER='2026-10-28T13:00:00.000Z';
const db=new PGlite();after(async()=>{await db.close();});
const row=(id:string,extra:Partial<StuckRowLike>={}):StuckRowLike=>({id,state:'FAILED',lane:'SCOUT',owner:'RUNNER',blocker:'operation timed out',
 label:'Sample',subjectName:null,stateCode:'az',overdue:false,band:2,waitingSince:'2026-10-20T00:00:00.000Z',eligibleAt:null,lastActivityAt:null,nextAction:null,
 assignmentKeys:['zcta:2020/85001'],...extra});
async function fixture(rows:readonly StuckRowLike[]=[]){
 await db.exec(`DROP SCHEMA public CASCADE;CREATE SCHEMA public;
 CREATE TABLE cp_owner_snapshots(id text PRIMARY KEY,updated_at timestamptz,value jsonb);
 CREATE TABLE cp_owner_assignment_rows(id text PRIMARY KEY,state_code text NOT NULL,index_segments jsonb NOT NULL);`);
 await db.query('INSERT INTO cp_owner_snapshots VALUES($1,$2,$3::jsonb)',['current',NOW,'{}']);
 for(const r of rows)await db.query('INSERT INTO cp_owner_assignment_rows VALUES($1,$2,$3::jsonb)',[r.id,stateOfRow(r)??'az',JSON.stringify([r])]);
 for(const ddl of OWNER_STUCK_COUNTS_DDL)await db.exec(ddl);
 await db.exec(OWNER_STUCK_COUNTS_BACKFILL_DDL);
 const calls:string[]=[];
 const sql:Sql={query:async(text,params=[])=>{calls.push(text);return(await db.query(text,[...params])).rows;}};
 return{sql,calls};
}
function population(raw:Record<string,unknown>){
 const rows=(raw.rows as Record<string,unknown>[]).map((r):StuckRowLike=>({id:String(r.id),state:String(r.state),lane:r.lane as string|null,owner:r.owner as string|null,
 blocker:r.blocker as string|null,label:r.label as string|null,subjectName:r.subject_name as string|null,stateCode:r.state_code as string|null,
 overdue:r.overdue as boolean|null,band:r.band as number|null,waitingSince:r.waiting_since as string|null,eligibleAt:r.eligible_at as string|null,
 lastActivityAt:r.last_activity_at as string|null,nextAction:r.next_action as string|null,assignmentKeys:r.assignment_keys as string[]}));
 const summary:StuckSummary={total:Number(raw.total),groups:raw.groups as StuckSummary['groups'],counts:{states:raw.states as Record<string,number>,places:raw.places as Record<string,number>}};
 return{rows,summary};
}
test('typed top rows and running cohorts preserve complete cause, state, place and district counts',async()=>{
 const rows=Array.from({length:1200},(_,i)=>row(`row:state:${i%2?'az':'nv'}:${String(i).padStart(4,'0')}`,{
  state:i%3?'FAILED':'WAITING',stateCode:i%2?'az':'nv',overdue:i%3===0,band:i%4+1,
  owner:i%7?'RUNNER':'OWNER',blocker:['operation timed out','SCOUT_POLICY_DENIED','no worker has reached it yet','unrecognized 123 https://example.gov/abc','unrecognized 456 https://example.gov/def',''][i%6],
  waitingSince:new Date(Date.parse(NOW)-(i%90)*86400000).toISOString(),assignmentKeys:[i%5?'zcta:2020/85001':'county:2020/04013'],
 }));
 for(const id of ['freshness:meetings-discovery:government:US-AZ:nces:123#own-site','freshness:meetings-discovery:az:state:arizona#find-own-site',
  'az-2026-general-amendment','source/ballot-az-example','state-zz-state-az','state:zz/state-az'])rows.push(row(id,{stateCode:null}));
 const{sql,calls}=await fixture(rows);
 for(const scope of ['us','st:az','geo:az.zcta.85001']){
  const raw=await readOwnerStuckSummary(sql,300,scope,NOW),read=population(raw);
  assert.deepEqual(await readOwnerStuckRows(sql,300,scope,NOW),raw.rows,'the decision strip receives the same ranked rows without unrelated cause cohorts');
  assert.doesNotMatch(calls.at(-1)!,/cp_owner_stuck_counts|samples AS/);
  assert.deepEqual(stuckViews(read.rows,scope,NOW,[],read.summary),stuckViews(rows,scope,NOW));
  assert.ok(read.rows.length<=300);
 }
 const summary=population(await readOwnerStuckSummary(sql,300,'us',NOW)).summary;
 const states:Record<string,Set<string>>={},places:Record<string,Set<string>>={};
 for(const r of rows){const st=stateOfRow(r);if(st)(states[st]??=new Set()).add(r.id);(places[placeKeyOfRow(r)]??=new Set()).add(r.id);}
 assert.deepEqual(summary.counts.states,Object.fromEntries(Object.entries(states).map(([key,ids])=>[key,ids.size])));
 assert.deepEqual(summary.counts.places,Object.fromEntries(Object.entries(places).map(([key,ids])=>[key,ids.size])));
 const districts=[{state:'az',placeKey:'first',zips:['85001']},{state:'az',placeKey:'second',zips:['85001','85002']}];
 const districtsRead=await readOwnerDistrictStuckCounts(sql,districts,NOW);
 const expected=new Set(rows.filter(r=>r.stateCode==='az'&&placeKeyOfRow(r)==='geo:az.zcta.85001').map(r=>r.id)).size;
 assert.equal(districtsRead.get('first'),expected);assert.equal(districtsRead.get('second'),expected);
 assert.ok(calls.every(text=>!/jsonb_array_elements|cp_owner_assignment_rows|regexp|pg_input_is_valid/.test(text)),'hot reads never expand or classify saved assignment JSON');
});
test('future starts and ends change counts and shown rows at the exact clock boundary',async()=>{
 const{sql}=await fixture();
 const a=row('clock-a'),b=row('clock-b',{blocker:'SCOUT_POLICY_DENIED',state:'WAITING',overdue:true});
 await db.query('INSERT INTO cp_owner_assignment_rows VALUES($1,$2,$3::jsonb)',['clock-a','az',JSON.stringify([{...a,until:LATER},{...b,id:a.id,from:LATER,until:null}])]);
 await db.query('INSERT INTO cp_owner_assignment_rows VALUES($1,$2,$3::jsonb)',['clock-b','az',JSON.stringify([{...b,from:LATER,until:null}])]);
 const before=population(await readOwnerStuckSummary(sql,300,'us',NOW));
 assert.equal(before.summary.total,1);assert.equal(before.rows[0].blocker,a.blocker);
 const after=population(await readOwnerStuckSummary(sql,300,'us',LATER));
 assert.equal(after.summary.total,2);assert.ok(after.rows.every(r=>r.blocker===b.blocker));
 assert.deepEqual(stuckViews(after.rows,'us',LATER,[],after.summary),stuckViews([{...b,id:a.id},b],'us',LATER));
});
test('source updates, deletions and bootstrap repeat update each cohort once',async()=>{
 const a=row('mutable');const{sql}=await fixture([a]);
 await db.exec(OWNER_STUCK_COUNTS_BACKFILL_DDL);
 assert.equal((await readOwnerStuckSummary(sql,300,'us',NOW)).total,1);
 const changed={...a,state:'SUCCEEDED'};
 await db.query('UPDATE cp_owner_assignment_rows SET index_segments=$2::jsonb WHERE id=$1',[a.id,JSON.stringify([changed])]);
 assert.equal((await readOwnerStuckSummary(sql,300,'us',NOW)).total,0);
 await db.query('UPDATE cp_owner_assignment_rows SET index_segments=$2::jsonb WHERE id=$1',[a.id,JSON.stringify([a])]);
 assert.equal((await readOwnerStuckSummary(sql,300,'us',NOW)).total,1);
 await db.query('DELETE FROM cp_owner_assignment_rows WHERE id=$1',[a.id]);
 assert.equal((await readOwnerStuckSummary(sql,300,'us',NOW)).total,0);
 assert.deepEqual((await db.query('SELECT * FROM cp_owner_stuck_counts')).rows,[]);
});
