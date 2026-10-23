/** PB-01: one state per worker, production READ ONLY; isolated local publication and next-day scheduler. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {mock} from 'node:test';
import {gzipSync} from 'node:zlib';
import {neon} from '@neondatabase/serverless';
import {factDb} from '../tests/helpers/fact-db.ts';
import {recordedMemberFetch} from '../tests/helpers/legistar-member-fixtures.ts';
import {refreshLegistarMembers} from '../lib/sources/legistar/members-refresh.ts';
import {loadLegistarMembers} from '../lib/sources/legistar/members-cache.ts';
import {legistarMemberTasks,legistarMemberClocks} from '../lib/sources/legistar/members-tasks.ts';
import {routineTaskDue} from '../lib/civic-data/runner.ts';
import {DurableEvidenceStore} from '../lib/control-plane/evidence/durable-store.ts';
import {factClocks} from '../lib/facts/clocks.ts';
import {readBodyFacts} from '../lib/facts/registry-overlay.ts';
import {installFactReader} from '../lib/facts/db.ts';
import {installReaderDatabaseQuery} from '../lib/reader/database.ts';
import {PLACE_PACKAGE_SQL} from '../lib/reader/place.ts';
import {decodeReaderValue} from '../lib/reader/wire.ts';
import {shardEntry} from '../lib/geo/zip-division-index.ts';
import {lookupZcta} from '../lib/geo/zcta.ts';
import {postalArea} from '../lib/geo/postal.ts';
import type {Query} from '../lib/facts/publish.ts';
import type {BodySourceWiring} from '../lib/registry/source-wiring.ts';
interface Tenant { slug: string; states: string[]; bindings?: BodySourceWiring[] }
interface HeldSeat { body: string; person: string; source: string }
interface ShownBoard { id: string; name: string | null; members: { id: string; name: string }[] }
interface Answer { phase: string; zip: string; bytes: number; gzipBytes: number; ms: number; serverTiming: string | null;
 status: number; boards: number; legistar: ShownBoard[]; empty: { id: string; name: string | null }[] }
interface Failure { stage: string; slug?: string; error?: string; phase?: string; zip?: string; status?: number;
 bytes?: number; gzipBytes?: number; ms?: number; empty?: Answer['empty'] }
interface Summary { boardsNamed: number; boardsShown: number; emptyShown: number; seatsShown: number; heldSeatsShown: number; missing: HeldSeat[] }
type Run = Awaited<ReturnType<typeof refreshLegistarMembers>> & { phase: string; slug: string; at: string; dueBoundary?: string; requests?: number };
interface Report { state: string; identities: Record<string,unknown>[]; tenants: string[]; heldSeats: number; runs: Run[]; answers: Answer[];
 failures: Failure[]; at: string; placeFootprints?: number; retired?: readonly Record<string,unknown>[]; retiredRetained?: boolean;
 first?: Summary; tomorrow?: Summary; membershipStatus?: readonly Record<string,unknown>[]; productionReadBytes?: number }
const stateArg=process.argv.find(a=>a.startsWith('--state='))?.slice(8);assert.match(stateArg??'',/^[A-Z]{2}$/);const state=stateArg!;
const base='.scratch/pb01/national',directory=`${base}/${state}`;await mkdir(directory,{recursive:true});
const census=JSON.parse(await readFile(base+'/census.json','utf8')) as {tenants:Tenant[]};
const tenants=await Promise.all(census.tenants.filter(t=>t.states.includes(state)).map(async t=>({...t,bindings:t.bindings ?? JSON.parse(await readFile(`${base}/tenants/${t.slug}.json`,'utf8')) as BodySourceWiring[]})));
const slugs=tenants.map((t:{slug:string})=>t.slug),bindings:BodySourceWiring[]=tenants.flatMap((t:{bindings:BodySourceWiring[]})=>t.bindings).filter((b:BodySourceWiring)=>b.ocdId?.includes('/state:'+state!.toLowerCase()));
assert.ok(slugs.length);
process.env.DATABASE_URL=process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;process.env.WTP_VITAL_SIGNS_REPORT='1';
let readBytes=0;
const readonly=(url:string):Query=>{const sql=neon(url);return async(t,p=[])=>{const [rows]=await sql.transaction([sql.query(t,[...p])],{readOnly:true});readBytes+=Buffer.byteLength(JSON.stringify(rows));return rows as Record<string,unknown>[];};};
const production=readonly(process.env.DATABASE_URL!),doors=readonly(process.env.WTP_CONTROL_PLANE_DATABASE_URL_READONLY!);
const identities=[];for(const query of [production,doors]){const [r]=await query(`SELECT current_user AS role,current_setting('transaction_read_only') AS read_only,EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE,DELETE')) AS can_write`);assert.equal(r.read_only,'on');assert.equal(r.can_write,false);identities.push(r);}
let snapshot:Record<string,Record<string,unknown>[]>;
try{snapshot=JSON.parse(await readFile(directory+'/snapshot.json','utf8'));}catch{
 const facts=await production(`WITH bodies AS (SELECT id FROM entity WHERE kind='body' AND state=$1::char(2) AND (id=ANY($2::text[]) OR id IN(SELECT entity_id FROM fact WHERE status='live' AND produced_by=ANY($3::text[])))), own AS (SELECT id FROM bodies UNION SELECT substr(field,8) FROM fact WHERE entity_id IN(SELECT id FROM bodies) AND status='live' AND field LIKE 'member:%') SELECT f.* FROM fact f WHERE f.entity_id IN(SELECT id FROM own) AND status='live'`,[state,bindings.map(b=>b.bodyId),slugs.map(s=>'legistar-members:'+s)]);
 const ids=[...new Set([...bindings.map(b=>b.bodyId),...facts.map(f=>String(f.entity_id))])];
 snapshot={fact:[...facts],entity:[...await production(`WITH RECURSIVE own AS(SELECT * FROM entity WHERE id=ANY($1::text[]) UNION SELECT e.* FROM entity e JOIN own ON own.parent_id=e.id) SELECT * FROM own`,[ids])],entity_external_id:[...await production('SELECT * FROM entity_external_id WHERE entity_id=ANY($1::text[])',[ids])],entity_host:[...await production('SELECT * FROM entity_host WHERE entity_id=ANY($1::text[])',[ids])],entity_place:[...await production('SELECT * FROM entity_place WHERE entity_id=ANY($1::text[])',[ids])],source_copy:[...await production('SELECT * FROM source_copy WHERE id=ANY($1::bigint[])',[[...new Set(facts.flatMap(f=>[f.source_copy_id,f.second_copy_id].filter(Boolean)))]])],fact_store_load:[...await production('SELECT * FROM fact_store_load WHERE source=ANY($1::text[])',[slugs.map(s=>'legistar-members:'+s)])]};
 await writeFile(directory+'/snapshot.json',JSON.stringify(snapshot));
}
const db=await factDb();
const insert=async(table:string,rows:Record<string,unknown>[],columns:string[])=>{if(!rows.length)return;const keys=columns.filter(k=>k in rows[0]);await db.query(`INSERT INTO "${table}" (${keys.map(k=>'"'+k+'"').join(',')}) SELECT ${keys.map(k=>'"'+k+'"').join(',')} FROM jsonb_populate_recordset(NULL::"${table}",$1::jsonb) ON CONFLICT DO NOTHING`,[JSON.stringify(rows)]);};
for(const table of ['entity','entity_host','entity_external_id','entity_place','source_copy','fact','fact_store_load']){
 const columns=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",[table])).map(r=>String(r.column_name));
 if(table==='entity'){let pending=[...snapshot.entity];const inserted=new Set<string>();while(pending.length){const ready=pending.filter(r=>!r.parent_id||inserted.has(String(r.parent_id)));assert.ok(ready.length);await insert(table,ready,columns);for(const r of ready)inserted.add(String(r.id));pending=pending.filter(r=>!inserted.has(String(r.id)));}}
 else await insert(table,table==='entity_place' ? snapshot[table].filter(r=>String(r.place_id).startsWith('ocd-division/country:us/state:'+state!.toLowerCase())) : snapshot[table],columns);
}
for(const table of ['fact','source_copy'])await db.query(`SELECT setval(pg_get_serial_sequence('${table}','id'),coalesce((SELECT max(id) FROM ${table}),1),true)`);
const held=snapshot.fact.filter(f=>String(f.field).startsWith('member:')&&slugs.includes(String(f.produced_by).slice('legistar-members:'.length))).map(f=>({body:String(f.entity_id),person:String(f.field).slice(7),source:String(f.produced_by)}));
const result:Report={state,identities,tenants:slugs,heldSeats:held.length,runs:[],answers:[],failures:[],at:new Date().toISOString()};
const save=async()=>writeFile(directory+'/results.json',JSON.stringify(result,null,2)+'\n');
const raws=new Map();
for(const slug of slugs){try{
 const vault=new DurableEvidenceStore(directory+'/vault');
 const prior=process.argv.includes('--reuse-captures') ? await loadLegistarMembers(vault,slug) : null;const raw=prior ? await prior.read() : null;
 const report=await refreshLegistarMembers({facts:db,clocks:factClocks(null),slug,now:new Date().toISOString(),vault,doors,purge:async()=>({purged:true}),...(raw ? {fetchImpl:recordedMemberFetch(()=>raw,[])} : {})});
 const saved=await loadLegistarMembers(vault,slug);assert.ok(saved);raws.set(slug,await saved.read());
 result.runs.push({phase:'first',slug,at:new Date().toISOString(),...report});console.log(JSON.stringify({state,slug,phase:'first',members:report.members,held:report.held,gaps:report.gaps.length}));
 }catch(e){result.failures.push({stage:'refresh',slug,error:String(e)});console.log(JSON.stringify({state,slug,error:String(e)}));}await save();}
let fields:Record<string,unknown>[]=[],rosters:Record<string,unknown>[]=[],entities:Record<string,unknown>[]=[],hosts:Record<string,unknown>[]=[];
const prepare=async()=>{
 entities=[...await db.query(`SELECT id,kind,name,parent_id,state FROM entity WHERE kind='body' AND state=$1::char(2)`,[state])];
 hosts=[...await db.query(`SELECT h.entity_id,h.host FROM entity_host h JOIN entity e ON e.id=h.entity_id WHERE e.kind='body' AND e.state=$1::char(2)`,[state])];
 fields=[];rosters=[];await readBodyFacts(async(t,p)=>{const rows=await db.query(t,p);if(t.includes('WITH members AS'))rosters.push(...rows);if(t.includes("f.field IN ('name', 'homepage'"))fields.push(...rows);return rows;},[...new Set(entities.map(e=>String(e.id)))],true);
};
let linked:Record<string,unknown>[]=[];
const handlerQuery:Query=async(t,p=[])=>{
 if(t!==PLACE_PACKAGE_SQL)return production(t,p);
 const divisions=p[1] as string[],ownLinks=linked.filter(e=>divisions.includes(String(e.division)));
 const extra=entities.filter(e=>divisions.includes(String(e.parent_id))||ownLinks.some(l=>l.id===e.id));
 const args=[...p];args[2]=[...new Set([...(p[2] as string[]),...extra.map(e=>String(e.id))])];
 const rows=await production(t,args),row=rows[0],own=row.entities as Record<string,unknown>[];
 for(const e of own){const link=ownLinks.find(l=>l.id===e.id);if(link)Object.assign(e,{division:link.division,placed:true});}
 const ids=new Set(own.map(e=>String(e.id))),replaced=new Set(entities.map(e=>String(e.id)));
 row.fields=[...(row.fields as Record<string,unknown>[]).filter(f=>!replaced.has(String(f.entity_id))),...fields.filter(f=>ids.has(String(f.entity_id)))];
 row.rosters=[...(row.rosters as Record<string,unknown>[]).filter(f=>!replaced.has(String(f.body_id))),...rosters.filter(f=>ids.has(String(f.body_id)))];return rows;
};
const prepareLinks=async()=>{
 // This is the existing place SQL's website join, applied to locally published host indexes.
 // Prepare the fixture projection before timing, just like the local fact-row projection.
 linked=[...await production(`WITH new_hosts AS (SELECT * FROM jsonb_to_recordset($2::jsonb) AS h(entity_id text,host text)),
 registration AS(SELECT payload FROM civic_data_promotions WHERE key='REGISTRATION:US-'||$1||':registration:v1' AND record_class='REGISTRATION'),
 governments AS(SELECT g FROM registration,LATERAL jsonb_array_elements(coalesce(payload->'governments','[]'::jsonb)) g),
 domains AS(SELECT d FROM civic_data_promotions,LATERAL jsonb_array_elements(coalesce(payload->'domains','[]'::jsonb)) d WHERE key='DOTGOV_REFERENCE:US:current-full:domains' AND record_class='DOTGOV_REFERENCE' AND upper(d->>'state')=$1)
 SELECT DISTINCT h.entity_id AS id,a->>'divisionId' AS division FROM governments lg
 CROSS JOIN LATERAL jsonb_array_elements(lg.g->'associations') a
 JOIN entity_host gh ON gh.entity_id=lg.g->>'jurisdictionId'
 JOIN new_hosts h ON h.host=gh.host
 JOIN entity b ON b.id=h.entity_id AND b.kind='body' AND b.parent_id=$3 AND b.state=$1::char(2)
 WHERE NOT EXISTS(SELECT 1 FROM entity_host o JOIN entity og ON og.id=o.entity_id AND og.kind='government' WHERE o.host=gh.host AND o.entity_id<>gh.entity_id)
 AND NOT EXISTS(SELECT 1 FROM domains d WHERE d.d->>'domain'=gh.host AND d.d->>'type' ~ '^(State|Federal|Interstate)')`,[state,JSON.stringify(hosts),'ocd-division/country:us/state:'+state!.toLowerCase()])];
};
installFactReader(handlerQuery);installReaderDatabaseQuery(async statements=>Promise.all(statements.map(s=>handlerQuery(s.text,s.params))));
const {GET}=await import('../app/api/meetings/route.ts');
await prepare();await prepareLinks();
const divisions=new Set([...bindings.flatMap(b=>b.ocdId??[]),...linked.map(e=>String(e.division)),...entities.flatMap(e=>[e.place_id,e.parent_id].filter(Boolean).map(String))]);
// Enumerate one ZIP for each distinct local-government footprint touching these tenants, inside this state.
const manifest=JSON.parse(await readFile('data/derived/zip-divisions/index.json','utf8')),zips=new Map<string,string>();
for(const name of manifest.statesToShards[state!]??[]){const shard=JSON.parse(await readFile(`data/derived/zip-divisions/${name}.json`,'utf8'));for(const zip of Object.keys(shard.zips).sort()){
 if(postalArea(zip)?.state!==state||!lookupZcta(zip))continue;const e=shardEntry(shard,zip)!;
 const ids=e.ids.filter(id=>! /\/(?:cd|sldu|sldl):/.test(id));if(!ids.some(id=>divisions.has(id)))continue;
 const key=JSON.stringify([ids.filter(id=>id.split('/').length>3).sort(),(e.fringe??[]).filter(id=>! /\/(?:cd|sldu|sldl):/.test(id)).sort()]);if(!zips.has(key))zips.set(key,zip);
}}
if(state==='WI'){zips.set('required-Madison','53703');zips.set('required-Milwaukee','53202');}
const zipList=[...new Set(zips.values())];result.placeFootprints=zipList.length;await save();
const answer=async(phase:string,zip:string)=>{
 const start=performance.now(),response=await GET(new Request('http://localhost/api/meetings?zip='+zip)),text=await response.text(),ms=performance.now()-start;
 const decoded=decodeReaderValue(JSON.parse(text)) as {coverage?:{bodies:{bodyId:string;name:string|null;readerRoster:{members:{id:string;name:string}[]}}[]}};const bodies=decoded.coverage?.bodies??[];
 const localIds=new Set(entities.map(e=>String(e.id))),own=bodies.filter((b)=>localIds.has(b.bodyId));
 const shown=own.map((b)=>({id:b.bodyId,name:b.name,members:b.readerRoster.members.map((m)=>({id:m.id,name:m.name}))}));
 const r={phase,zip,bytes:Buffer.byteLength(text),gzipBytes:gzipSync(text,{level:6}).length,ms,serverTiming:response.headers.get('server-timing'),status:response.status,boards:bodies.length,legistar:shown,empty:own.filter((b)=>!b.readerRoster.members.length).map((b)=>({id:b.bodyId,name:b.name}))};
 result.answers.push(r);await writeFile(`${directory}/${phase}-${zip}.json`,text);
 if(response.status!==200||r.bytes>=1_000_000||r.gzipBytes>=100_000||ms>=3000||r.empty.length)result.failures.push({stage:'answer',phase,zip,status:response.status,bytes:r.bytes,gzipBytes:r.gzipBytes,ms,empty:r.empty});
 console.log(JSON.stringify({state,phase,zip,bytes:r.bytes,gzip:r.gzipBytes,ms:Math.round(ms),boards:bodies.length,legistar:shown.length,empty:r.empty.length,status:response.status}));
};
await writeFile(directory+'/projection-first.json',JSON.stringify({fields,rosters,entities,hosts,linked}));for(const zip of zipList){await answer('first',zip);await save();}
const retired=await db.query(`SELECT entity_id,produced_by FROM fact WHERE held_reason='NOT_A_CURRENT_LEGISTAR_BOARD' ORDER BY entity_id`);result.retired=retired;
const tomorrow=Date.now()+24*3600_000;mock.timers.enable({apis:['Date'],now:tomorrow});
try{for(const slug of slugs){if(!raws.has(slug))continue;try{
 const task=legistarMemberTasks([slug])[0],clock=(await legistarMemberClocks(db.query,[task.id])).get(task.id)!;
 const boundary=Date.parse(clock.lastSucceededAt!)+task.cadenceMs;
 assert.equal(routineTaskDue(task,clock,boundary-1),false);assert.equal(routineTaskDue(task,clock,boundary),true);assert.equal(routineTaskDue(task,clock,Date.now()),true);
 const calls:URL[]=[],report=await refreshLegistarMembers({facts:db,clocks:factClocks(null),slug,now:new Date().toISOString(),vault:new DurableEvidenceStore(directory+'/vault'),doors,purge:async()=>({purged:true}),fetchImpl:recordedMemberFetch(()=>raws.get(slug),calls)});
 result.runs.push({phase:'tomorrow',slug,at:new Date().toISOString(),dueBoundary:new Date(boundary).toISOString(),requests:calls.length,...report});
 console.log(JSON.stringify({state,slug,phase:'tomorrow',members:report.members,held:report.held,gaps:report.gaps.length}));
 }catch(e){result.failures.push({stage:'tomorrow',slug,error:String(e)});}await save();}
 await prepare();await prepareLinks();await writeFile(directory+'/projection-tomorrow.json',JSON.stringify({fields,rosters,entities,hosts,linked}));for(const zip of zipList){await answer('tomorrow',zip);await save();}
}finally{mock.timers.reset();}
result.retiredRetained=retired.every(r=>!fields.some(f=>f.entity_id===r.entity_id&&f.field==='name'));
for(const phase of ['first','tomorrow'] as const){
 const shown=new Map<string,ShownBoard>(result.answers.filter((a)=>a.phase===phase).flatMap((a)=>a.legistar.map((b)=>[b.id,b])));
 const shownSeats=new Set([...shown.values()].flatMap((b)=>b.members.map((m)=>b.id+'\0'+(m.id.match(/^(legistar:[^:]+:person:\d+)/)?.[1]??m.id))));
 const missing=held.filter(h=>{const native=snapshot.entity_external_id.find(x=>x.entity_id===h.person&&x.scheme===h.source.replace('legistar-members:','legistar:'));return !shownSeats.has(h.body+'\0'+(native ? h.source.replace('legistar-members:','legistar:')+':person:'+native.value : h.person));});
 const named=fields.filter(f=>f.field==='name'&&entities.some(e=>e.id===f.entity_id));
 result[phase]={boardsNamed:new Set(named.map(f=>f.entity_id)).size,boardsShown:shown.size,emptyShown:[...shown.values()].filter((b)=>!b.members.length).length,seatsShown:shownSeats.size,heldSeatsShown:held.length-missing.length,missing};
}
result.membershipStatus=await db.query("SELECT f.entity_id,f.field,f.status,f.held_reason,f.produced_by FROM fact f WHERE f.field LIKE 'member:%' AND f.produced_by=ANY($1::text[])",[slugs.map(s=>'legistar-members:'+s)]);result.productionReadBytes=readBytes;await save();await db.pg.close();console.log(JSON.stringify({state,finished:true,held:held.length,first:{...result.first,missing:result.first!.missing.length},tomorrow:{...result.tomorrow,missing:result.tomorrow!.missing.length},failures:result.failures.length}));
