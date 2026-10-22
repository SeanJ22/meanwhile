import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { keeperState as stateCodeOf } from "./state.ts";
import { causeOf } from '../admin-view/blocker-causes.ts';

export const LINK_NAMES = ["Source", "Worker", "Box", "Builder", "Check", "Fact table", "Reader API", "Live page"] as const;
export interface LinkCount { readonly state:string; readonly kind:string; readonly link:typeof LINK_NAMES[number]; readonly incoming:number; readonly outgoing:number; readonly unit:string }
export interface WaitingWork { readonly id:string; readonly place:string; readonly kind:string; readonly state:string; readonly since:string|null; readonly eligibleAt:string|null; readonly owner:string; readonly reason:string }
const length=(path:string)=>`CASE WHEN jsonb_typeof(${path})='array' THEN jsonb_array_length(${path}) ELSE 0 END`;
/** Every large relation is restricted by its changed/recorded clock before JSON is opened. Joined aggregates are exact IDs. */
export const WORK_LINKS_SQL = `WITH costs AS MATERIALIZED (SELECT record FROM cp_log_costs
 WHERE recorded_at >= $1::timestamptz AND recorded_at < $2::timestamptz AND record->>'role' IS DISTINCT FROM 'ASK' AND record->'nonProduction' IS NULL),
 workers AS MATERIALIZED (SELECT record FROM cp_log_worker_results WHERE recorded_at >= $1::timestamptz AND recorded_at < $2::timestamptz),
 box AS MATERIALIZED (SELECT id,value FROM cp_box_findings WHERE changed_at >= $1::timestamptz AND changed_at <= greatest($2::timestamptz,statement_timestamp())),
 events AS (
 SELECT coalesce(c.record->>'jurisdiction',c.record->>'source','US') place,coalesce(c.record->>'recordClass','Unknown') kind,
 'Source' link,count(DISTINCT coalesce(c.record->>'attemptId',c.record::text))::int incoming,
 count(DISTINCT artifact_id) FILTER (WHERE artifact_id IS NOT NULL)::int outgoing,'requested runs / pages saved' unit
 FROM costs c LEFT JOIN cp_attempts a ON a.id=c.record->>'attemptId'
 LEFT JOIN LATERAL jsonb_array_elements_text(coalesce(a.value->'artifactIds','[]'::jsonb)) artifact_id ON true GROUP BY 1,2
 UNION ALL SELECT coalesce(w.value->'autonomousPlan'->>'jurisdiction',r.record->'result'->>'subjectId',r.record->>'workItemId'),
 coalesce(w.value->'autonomousPlan'->'contract'->>'recordClass',r.record->'result'->>'recordClass',r.record->'worker'->>'role','Unknown'),
 'Worker',sum(${length("r.record->'inputArtifactIds'")})::int,
 sum(coalesce(nullif(r.record->'result'->>'actualRowCount','')::int,nullif(r.record->'result'->>'validatedRecordCount','')::int,
 nullif(r.record->'result'->>'fetchedCount','')::int,${length("r.record->'result'->'findings'")}))::int,'pages in / records out'
 FROM workers r LEFT JOIN cp_work_items w ON w.id=r.record->>'workItemId' GROUP BY 1,2
 UNION ALL SELECT value->>'subjectId',coalesce(value->'fact'->>'recordClass','Unknown'),'Box',
 count(*) FILTER (WHERE (SELECT min((o->>'recordedAt')::timestamptz) FROM jsonb_array_elements(value->'origins') o) >= $1::timestamptz AND (SELECT min((o->>'recordedAt')::timestamptz) FROM jsonb_array_elements(value->'origins') o) < $2::timestamptz)::int,
 count(*) FILTER (WHERE ((value->'claim'->>'takenAt')::timestamptz >= $1::timestamptz AND (value->'claim'->>'takenAt')::timestamptz < $2::timestamptz) OR EXISTS
 (SELECT 1 FROM jsonb_array_elements(value->'attempts') a WHERE (a->>'takenAt')::timestamptz >= $1::timestamptz AND (a->>'takenAt')::timestamptz < $2::timestamptz))::int,'findings in / taken by builders' FROM box GROUP BY 1,2
 UNION ALL SELECT b.value->>'subjectId',coalesce(b.value->'fact'->>'recordClass','Unknown'),'Builder',
 (count(*) FILTER (WHERE (a->>'takenAt')::timestamptz >= $1::timestamptz AND (a->>'takenAt')::timestamptz < $2::timestamptz)+
 count(DISTINCT b.id) FILTER (WHERE (b.value->'claim'->>'takenAt')::timestamptz >= $1::timestamptz AND (b.value->'claim'->>'takenAt')::timestamptz < $2::timestamptz))::int,
 count(*) FILTER (WHERE a->>'outcome'='built' AND (a->>'endedAt')::timestamptz >= $1::timestamptz AND (a->>'endedAt')::timestamptz < $2::timestamptz)::int,'findings taken / built'
 FROM box b LEFT JOIN LATERAL jsonb_array_elements(b.value->'attempts') a ON true GROUP BY 1,2
 ) SELECT place,kind,link,sum(incoming)::int incoming,sum(outgoing)::int outgoing,unit FROM events GROUP BY 1,2,3,6`;

export const CHECK_LINKS_SQL = `WITH changed AS MATERIALIZED (
 SELECT candidate_id,bool_or(state<>'PROMOTED') checked,bool_or(state='PROMOTED') promoted FROM civic_data_candidate_events WHERE at >= $1::timestamptz AND at < $2::timestamptz
 AND state IN ('VALIDATED','PROMOTED','IDENTITY_UNRESOLVED','TEMPORAL_INVALID','SEMANTIC_INVALID','HORIZON_UNRESOLVED','DEPENDENT_CONSUMER_INVALID','CANNOT_TELL') GROUP BY candidate_id), records AS MATERIALIZED (
 SELECT c.scope,c.record_class,changed.checked,changed.promoted,c.validation_receipt,
 (SELECT count(*) FROM (SELECT item FROM reader_payload_members(coalesce(changes->'added','[]'::jsonb)) UNION ALL SELECT item FROM reader_payload_members(coalesce(changes->'changed','[]'::jsonb))) members
 WHERE reader_payload_node(item)->>'key' NOT LIKE 'projection:%' AND reader_payload_node(item)->>'key' NOT LIKE '%checkpoint%'
 AND reader_payload_node(item)->>'key' NOT LIKE '%partition%' AND reader_payload_node(item)->>'key' NOT LIKE '%marker%' AND reader_payload_node(item)->>'key' NOT LIKE 'absence:%') n
 FROM changed JOIN civic_data_candidates c ON c.id=changed.candidate_id,
 LATERAL (SELECT reader_payload_node(c.candidate->'changeSet') changes) d)
 SELECT scope place,record_class kind,'Check' link,coalesce(sum(n) FILTER (WHERE checked),0)::int incoming,
 coalesce(sum(n) FILTER (WHERE checked AND validation_receipt->>'decision'='GOOD'),0)::int outgoing,'changed records checked / passed' unit
 FROM records GROUP BY 1,2
 UNION ALL SELECT scope,record_class,'Fact table',coalesce(sum(n) FILTER (WHERE checked AND validation_receipt->>'decision'='GOOD'),0)::int,
 coalesce(sum(n) FILTER (WHERE promoted),0)::int,'passed records / promoted records' FROM records GROUP BY 1,2`;

/** Keep every link visible even in an empty hour. Different kinds retain separate denominators. */
export function completeLinks(links:readonly LinkCount[]):readonly LinkCount[] {
  const groups=new Map<string,LinkCount[]>();
  for(const l of links){const key=`${l.state}:${l.kind}`;groups.set(key,[...groups.get(key)??[],l]);}
  return [...groups.values()].flatMap(rows=>LINK_NAMES.flatMap(link=>{
    const present=rows.filter(r=>r.link===link);
    return present.length?present:[{state:rows[0].state,kind:rows[0].kind,link,incoming:0,outgoing:0,unit:'recorded intake / output'}];
  }));
}
export function handoffProblems(links:readonly LinkCount[],family:(kind:string)=>string=(kind)=>kind):readonly {state:string;kind:string;after:string;before:string;count:number}[] {
  const result:{state:string;kind:string;after:string;before:string;count:number}[]=[];
  for(let n=0;n<LINK_NAMES.length-1;n++)for(const l of links.filter(l=>l.link===LINK_NAMES[n]&&l.outgoing>0)){
    if(!links.some(next=>next.state===l.state&&family(next.kind)===family(l.kind)&&next.link===LINK_NAMES[n+1]&&next.incoming>0))result.push({state:l.state,kind:l.kind,after:l.link,before:LINK_NAMES[n+1],count:l.outgoing});
  }
  return result;
}

/** Reuse the published assignment index, including clock-driven transitions on unchanged work.
 * A changed state index is cached; every check re-evaluates from/until locally. */
export const WAITING_SQL = `SELECT s.id,coalesce(jsonb_agg(x) FILTER (WHERE x IS NOT NULL),'[]'::jsonb) AS rows
 FROM cp_owner_snapshots s LEFT JOIN LATERAL (
 SELECT jsonb_build_object('id',r->'id','state',r->'state','lane',r->'lane','owner',r->'owner','stateCode',r->'stateCode',
 'subjectName',r->'subjectName','label',r->'label','blocker',r->'blocker','nextAction',r->'nextAction',
 'overdue',r->'overdue','waitingSince',r->'waitingSince','eligibleAt',r->'eligibleAt','from',r->'from','until',r->'until') x
 FROM jsonb_array_elements(s.value->'allRowsIndex') r WHERE r->>'state' IN ('WAITING','FAILED','BLOCKED','UNKNOWN')) waiting ON true
 WHERE s.id LIKE 'current:%' AND s.updated_at >= $1::timestamptz AND s.updated_at <= greatest($2::timestamptz,statement_timestamp()) GROUP BY s.id`;
export const WAITING_SEED_SQL=WAITING_SQL.replace(" AND s.updated_at >= $1::timestamptz AND s.updated_at <= greatest($2::timestamptz,statement_timestamp())","");

export async function readLinks(control:Sql,reader:Sql,from:string,through:string,clockArgs:readonly string[]|null=[from,through]) {
  const args=[from,through];
  const reads=await Promise.allSettled([
    boundedQuery(control,{operation:"line-keeper.work-links",callClass:"PAGE"},WORK_LINKS_SQL,args),
    boundedQuery(reader,{operation:"line-keeper.check-links",callClass:"PAGE"},CHECK_LINKS_SQL,args),
    clockArgs?boundedQuery(control,{operation:"line-keeper.waiting-changes",callClass:"PAGE"},WAITING_SQL,clockArgs):Promise.resolve([]),
  ]);
  const links=reads.slice(0,2).flatMap(read=>read.status==='fulfilled'?(read.value as Record<string,unknown>[]).map((r):LinkCount=>({
    state:stateCodeOf(String(r.place),'')?.toUpperCase()??'US',kind:String(r.kind),link:r.link as LinkCount['link'],incoming:Number(r.incoming),outgoing:Number(r.outgoing),unit:String(r.unit)})):[]);
  const grouped=new Map<string,LinkCount>();
  for(const l of links){const key=JSON.stringify([l.state,l.kind,l.link,l.unit]),held=grouped.get(key);grouped.set(key,held?{...l,incoming:held.incoming+l.incoming,outgoing:held.outgoing+l.outgoing}:l);}
  return {links:[...grouped.values()],waiting:reads[2].status==='fulfilled'?reads[2].value as Record<string,unknown>[]:null,
    errors:reads.flatMap((r,i)=>r.status==='rejected'?[`Link measurement ${i} failed: ${r.reason instanceof Error?r.reason.message:'unread'}`]:[])};
}
export function foldWaiting(held:Readonly<Record<string,readonly Record<string,unknown>[]>>,delta:readonly Record<string,unknown>[]) {
  return {...held,...Object.fromEntries(delta.map(r=>[String(r.id),r.rows as Record<string,unknown>[]]))};
}
export function waitingAt(index:Readonly<Record<string,readonly Record<string,unknown>[]>>,at:string):readonly WaitingWork[] {
  return Object.entries(index).flatMap(([id,rows])=>rows.map((r):Record<string,unknown>&{indexState:string}=>({...r,indexState:id.slice('current:'.length)}))).filter(r=>(!r.from||String(r.from)<=at)&&(!r.until||String(r.until)>at)&&
    (['FAILED','BLOCKED','UNKNOWN'].includes(String(r.state))||r.state==='WAITING'&&(r.overdue===true||
      typeof r.waitingSince==='string'&&Date.parse(at)-Date.parse(r.waitingSince)>3_600_000&&(!r.eligibleAt||String(r.eligibleAt)<=at)))).map(r=>{
      const cause=causeOf({state:String(r.state),owner:typeof r.owner==='string'?r.owner:null,blocker:typeof r.blocker==='string'?r.blocker:null,overdue:r.overdue===true});
      const owner=cause.lane==='software'?'River':r.owner==='SCOUT_LANE'?'hunters':r.owner==='FLEET'||r.owner==='SOURCE'?'diggers':'the runner';
      return {
      id:String(r.id),place:String(r.subjectName??r.label??r.id),kind:String(r.lane??'work'),state:String(r.stateCode??stateCodeOf(r.indexState,'')??'US').toUpperCase(),
      since:typeof r.waitingSince==='string'?r.waitingSince:null,eligibleAt:typeof r.eligibleAt==='string'?r.eligibleAt:null,
      owner,reason:String(r.blocker??r.nextAction??'Waiting with no dispatch') };});
}
