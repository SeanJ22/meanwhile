import assert from 'node:assert/strict';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {readStuckPopulation,stuckViews} from '../lib/control-plane/admin-view/v6-stuck-read.ts';
import {readOwnerDistrictStuckCounts,OWNER_STUCK_COUNTS_DDL,OWNER_STUCK_COUNTS_BACKFILL_DDL} from '../lib/control-plane/repository/owner-stuck-counts.ts';
import {placeKeyOfRow,stateOfRow,type StuckRowLike} from '../lib/control-plane/admin-view/blocker-causes.ts';

test('stuck summaries return the same top rows, complete cause totals and distinct place counts without loading the population',async()=>{
 const db=new PGlite();await db.exec(`CREATE TABLE cp_owner_snapshots(id text PRIMARY KEY,revision int,updated_at timestamptz,value jsonb);
 CREATE TABLE cp_owner_assignment_rows(id text PRIMARY KEY,state_code text NOT NULL,index_segments jsonb NOT NULL);`);
 const [{at}]= (await db.query<{at:string}>('SELECT now()::text AS at')).rows;
 const now=new Date(at).toISOString();
 const rows:StuckRowLike[]=Array.from({length:1200},(_,i)=>({
  id:`row:state:${i%2?'az':'nv'}:${String(i).padStart(4,'0')}`,state:i%3?'FAILED':'WAITING',lane:null,owner:i%7?'RUNNER':'OWNER',
  blocker:['operation timed out','SCOUT_POLICY_DENIED','no worker has reached it yet','unrecognized 123 https://example.gov/abc','unrecognized 456 https://example.gov/def',''][i%6],
  label:'Sample',subjectName:null,stateCode:i%2?'az':'nv',overdue:i%3===0,band:i%4+1,
  waitingSince:new Date(Date.parse(now)-(i%90)*86400000).toISOString(),eligibleAt:null,lastActivityAt:null,nextAction:null,
  assignmentKeys:[i%5?'zcta:2020/85001':'county:2020/04013'],
 }));
 for(const id of ['freshness:meetings-discovery:government:US-AZ:nces:123#own-site',
   'freshness:meetings-discovery:az:state:arizona#find-own-site','az-2026-general-amendment',
   'source/ballot-az-example','state-zz-state-az','state:zz/state-az'])rows.push({...rows[1],id,stateCode:null});
 await db.query('INSERT INTO cp_owner_snapshots VALUES($1,1,$2,$3::jsonb)',['current',now,'{}']);
 for(const row of rows)await db.query('INSERT INTO cp_owner_assignment_rows VALUES($1,$2,$3::jsonb)',[row.id,stateOfRow(row)??'az',JSON.stringify([row])]);
 for(const ddl of OWNER_STUCK_COUNTS_DDL)await db.exec(ddl);
 await db.exec(OWNER_STUCK_COUNTS_BACKFILL_DDL);
 const sql={query:async(text:string,params:readonly unknown[]=[]) => (await db.query(text,[...params])).rows};
 const summary=await readStuckPopulation(sql);
 assert.equal(summary.rows.length,300);assert.equal(summary.summary!.total,rows.length);
 assert.deepEqual(stuckViews(summary.rows,'us',now,[],summary.summary),stuckViews(rows,'us',now));
 for(const scope of ['st:az','geo:az.zcta.85001']){
  const part=await readStuckPopulation(sql,scope);
  assert.deepEqual(stuckViews(part.rows,scope,now,[],part.summary),stuckViews(rows,scope,now));
 }
 const byState:Record<string,Set<string>>={},byPlace:Record<string,Set<string>>={};
 for(const r of rows){const st=stateOfRow(r);if(st!==null)(byState[st]??=new Set()).add(r.id);(byPlace[placeKeyOfRow(r)]??=new Set()).add(r.id);}
 assert.deepEqual(summary.summary!.counts.states,Object.fromEntries(Object.entries(byState).map(([k,v])=>[k,v.size])));
 assert.deepEqual(summary.summary!.counts.places,Object.fromEntries(Object.entries(byPlace).map(([k,v])=>[k,v.size])));
 const districts=[{state:'az',geoid:'0401',placeKey:'geo:az.congressional_district.0401',label:'First',divisionId:'first',zips:['85001']},
  {state:'az',geoid:'0402',placeKey:'geo:az.congressional_district.0402',label:'Second',divisionId:'second',zips:['85001','85002']}];
 const counts=await readOwnerDistrictStuckCounts(sql,districts);
 const expected=new Set(rows.filter(r=>r.stateCode==='az'&&placeKeyOfRow(r)==='geo:az.zcta.85001').map(r=>r.id)).size;
 assert.equal(counts.get(districts[0].placeKey),expected);assert.equal(counts.get(districts[1].placeKey),expected);
 await db.close();
});
