import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {openFactCopy,type FactSnapshot} from './rb-a3-copy.mts';
import {ensureFactEntities,registeredStates} from '../lib/facts/entities.ts';
import {ROUTINE_SOURCE_TASKS,routineTaskDue} from '../lib/civic-data/runner.ts';
import {readPlacePackage} from '../lib/reader/place.ts';
import {BOOTSTRAP_DDL} from '../lib/control-plane/repository/pg-schema.ts';
import {readPassCursor,writePassCursor} from '../lib/facts/db.ts';

const directory=process.argv[2] ?? '.scratch/rb-a4';
const out=process.argv[3] ?? 'docs/measurements/rb-a4/replay.json';
const cohort=JSON.parse(readFileSync(join(directory,'cohort.json'),'utf8')) as {id:string;state:string;parent_id:string;members:number}[];
const fields=['facts','entities','sourceCopies','hosts','externalIds','places'] as const;
const snapshots=[...new Set(cohort.map(b=>b.state))].map(state=>JSON.parse(readFileSync(join(directory,`${state}.json`),'utf8')) as FactSnapshot);
const combined:Record<string,unknown>={state:'ALL',capturedAt:snapshots[0]!.capturedAt};
for(const field of fields) combined[field]=[...new Map(snapshots.flatMap(s=>s[field] ?? []).map(row=>[JSON.stringify(field==='entities'||field==='facts'||field==='sourceCopies'?row.id:row),row])).values()];
const db=await openFactCopy(combined as unknown as FactSnapshot);
try {
  const states=registeredStates(process.cwd());
  // The real reader already holds the country's counties. Restore their exact held reference identities in this isolated subset.
  for(const state of states) {
    const reg=JSON.parse(readFileSync(`data/derived/registration/${state}.json`,'utf8'));
    for(const layer of ['state','county']) {
      const rows=reg.divisions.filter((d:string[])=>d[1]===layer).map((d:string[])=>({id:d[0],name:d[3],state:state.toUpperCase(),geoid:d[2]}));
      await db.query(`INSERT INTO entity(id,kind,name,state) SELECT id,'place',name,state FROM jsonb_to_recordset($1::jsonb) AS e(id text,name text,state char(2)) ON CONFLICT DO NOTHING`,[JSON.stringify(rows)]);
      await db.query(`INSERT INTO entity_external_id(entity_id,scheme,value) SELECT id,$2,geoid FROM jsonb_to_recordset($1::jsonb) AS e(id text,geoid text) ON CONFLICT DO NOTHING`,[JSON.stringify(rows),`census-geoid:${layer}`]);
    }
  }
  await db.pg.exec('CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,current_version_id text,promoted_at timestamptz,payload jsonb); CREATE TABLE civic_data_candidate_events(candidate_id text,sequence integer,detail text); CREATE TABLE civic_data_candidates(id text,scope text,record_class text,source_id text,retrieved_at timestamptz,candidate jsonb,state text,acquisition_succeeded boolean,promoted_version_id text,last_known_good_version_id text,normalized_hash text,validation_receipt jsonb)');
  await db.pg.exec(BOOTSTRAP_DDL.find(sql=>sql.startsWith('CREATE TABLE IF NOT EXISTS cp_work_items ('))!);
  await db.pg.exec('CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)');
  for(const statement of readFileSync('lib/db/migrations/0036_ne01.sql','utf8').split('--> statement-breakpoint'))
    if(/^\s*CREATE FUNCTION reader_payload_/.test(statement)) await db.pg.exec(statement);
  const pages=JSON.parse(readFileSync(join(directory,'portal-governments.json'),'utf8')) as {government:{state:string;jurisdictionId:string};versionId:string;promotedAt:string}[];
  for(const state of [...new Set(cohort.map(b=>b.state))]) {
    const ids=[...new Set(cohort.filter(b=>b.state===state).map(b=>b.parent_id))];
    const selected=pages.filter(page=>page.government.state===state && ids.includes(page.government.jurisdictionId));
    if(selected.length) await db.query('INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4,$5,$6::jsonb)',
      [`REGISTRATION:US-${state}:registration:v1`,'REGISTRATION',`US-${state}:registration:v1`,selected[0]!.versionId,selected[0]!.promotedAt,JSON.stringify({governments:selected.map(page=>page.government)})]);
  }
  const before=(await db.query('SELECT id,entity_id,field,value,status,source_copy_id FROM fact ORDER BY id'));
  const initial=await ensureFactEntities(db,process.cwd(),states);
  const next=await ensureFactEntities(db,process.cwd(),states);
  assert.deepEqual(next,[],'the next scheduled import preserves every association');
  const maintenance=[];
  for(let pass=0;pass<states.length;pass++) {
    const prior=await readPassCursor(db.query,'routine-fact-maintenance-state');
    const state=states[(states.indexOf(prior ?? '')+1)%states.length]!;
    const loaded=await ensureFactEntities(db,process.cwd(),[state]);
    assert.deepEqual(loaded,[]);
    await writePassCursor(db.query,'routine-fact-maintenance-state',state);
    maintenance.push(state);
  }
  assert.deepEqual(maintenance,states,'the existing maintenance cursor visits every state on subsequent scheduled passes');
  assert.deepEqual(await db.query('SELECT id,entity_id,field,value,status,source_copy_id FROM fact ORDER BY id'),before,'no held reader fact or permanent id is lost');
  const root="^ocd-division/country:us(/(state|district|territory):[a-z]{2})?$";
  const placements:{id:string;state:string;parent_id:string;members:number;places:readonly Record<string,unknown>[]}[]=[];
  for(const board of cohort) {
    const places=await db.query('SELECT place_id,boundary_year,placement_basis FROM entity_place WHERE entity_id=$1 AND place_id !~ $2 ORDER BY place_id,boundary_year',[board.id,root]);
    assert.ok(places.length,board.id);
    placements.push({...board,places});
  }
  const baseline=JSON.parse(readFileSync(join(directory,'districts.json'),'utf8')) as {id:string;state:string}[];
  baseline.push({id:'or:special:metro',state:'OR'}); // This original state-root district was already corrected in production before the new export.
  const unresolved=[],transfers=[];
  for(const district of baseline) {
    const [row]=await db.query('SELECT state,parent_id FROM entity WHERE id=$1',[district.id]);
    if(!row || !row.parent_id || new RegExp(root).test(String(row.parent_id))) unresolved.push(district);
    else if(row.state!==district.state) transfers.push({id:district.id,from:district.state,to:row.state,place:row.parent_id});
  }
  assert.deepEqual(unresolved,[],'every original production state-root district has a lower placement');
  const task=ROUTINE_SOURCE_TASKS.find(t=>t.id.startsWith('registration-'))!;
  const at=snapshots[0]!.capturedAt;
  const clock={lastAttemptedAt:at,lastSucceededAt:at,lastSucceededObservedAt:at,lastSucceededParserVersion:task.parserVersion};
  const due=Date.parse(at)+task.cadenceMs;
  assert.equal(routineTaskDue(task,clock,due-1),false);assert.equal(routineTaskDue(task,clock,due),true);
  const counts=states.map(state=>({state:state.toUpperCase(),boards:placements.filter(b=>b.state.toLowerCase()===state).length,
    members:placements.filter(b=>b.state.toLowerCase()===state).reduce((n,b)=>n+b.members,0),
    productionDistricts:baseline.filter(d=>d.state.toLowerCase()===state).length}));
  const connections=[];
  for(const board of placements.filter(b=>['AK','CA'].includes(b.state)).filter((_,i)=>i===0||i===1)) {
    const page=await readPlacePackage({state:board.state,divisionIds:[String(board.places[0]!.place_id)]},db.query);
    assert.ok(page.bodies.some(b=>b.id===board.id));
    connections.push({boardId:board.id,governmentId:board.parent_id,place:board.places[0],readerReturned:true});
  }
  mkdirSync(join(out,'..'),{recursive:true});
  writeFileSync(out,JSON.stringify({capturedAt:snapshots[0]!.capturedAt,productionRole:'readonly',databaseWrites:'local PostgreSQL copy only',
    boards:placements.length,members:cohort.reduce((n,b)=>n+b.members,0),productionDistricts:baseline.length,initialStates:initial.length,
    nextRun:{registrationSourceDueAt:new Date(due).toISOString(),scheduledDue:true,statesReloaded:next,maintenanceCursorCycle:maintenance,associationsPreserved:true,factsPreserved:before.length},counts,connections,placements,transfers},null,2)+'\n');
  console.log(JSON.stringify({boards:placements.length,members:cohort.reduce((n,b)=>n+b.members,0),districts:baseline.length,nextStates:next.length}));
} finally {await db.pg.close();}
