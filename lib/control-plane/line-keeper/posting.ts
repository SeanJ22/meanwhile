import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { postingToLiveFromVersion, readbackPassAt, type PostingToLiveRow } from "../../civic-data/posting-to-live.ts";
import type { RoutineChangeSet, RoutineRecordClass } from "../../civic-data/types.ts";

/** The Scoreboard’s current promoted changes, including outcomes. Only changed pointers and change fields cross the wire. */
export const POSTING_SQL = `SELECT c.id,c.record_class,c.retrieved_at,p.key AS pointer_key,
 jsonb_build_object('added',coalesce(jsonb_agg(d.delta) FILTER (WHERE d.kind='added'),'[]'::jsonb),
 'changed',coalesce(jsonb_agg(d.delta) FILTER (WHERE d.kind='changed'),'[]'::jsonb)) AS changes,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('detail',e.detail)),'[]'::jsonb) FROM civic_data_candidate_events e
 WHERE e.candidate_id=c.id AND e.detail LIKE 'READER_PROJECTION_READBACK_V2 %') AS events
 FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id LEFT JOIN LATERAL (
 SELECT kind,jsonb_build_object('key',x->'key','before',CASE WHEN x->'before' IS NULL OR x->'before'='null'::jsonb THEN NULL ELSE
 jsonb_build_object('status',x->'before'->'status','agendaUrl',x->'before'->'agendaUrl','postedAt',x->'before'->'postedAt') END,
 'after',jsonb_build_object('status',x->'after'->'status','agendaUrl',x->'after'->'agendaUrl',
 'postedAt',x->'after'->'postedAt','startsAt',x->'after'->'startsAt')) AS delta
 FROM (VALUES ('added'),('changed')) kinds(kind),
 LATERAL jsonb_array_elements(coalesce(reader_payload_node(c.candidate->'changeSet')->kind,'[]'::jsonb)) x
 WHERE x->>'key' LIKE 'meeting:%' OR x->>'key' LIKE 'outcome:%' OR x->>'key' LIKE 'roll-call:%') d ON true
 WHERE c.record_class IN ('MEETING','MEETING_OUTCOME') AND c.state='PROMOTED'
 AND p.promoted_at >= $1::timestamptz AND p.promoted_at <= greatest($2::timestamptz,statement_timestamp())
 GROUP BY c.id,c.record_class,c.retrieved_at,p.key`;
export const STAMP_DELTA_SQL = `SELECT candidate_id,detail FROM civic_data_candidate_events
 WHERE at >= $1::timestamptz AND at < $2::timestamptz AND detail LIKE 'READER_PROJECTION_READBACK_V2 %'`;

export async function readPostingWindow(sql: Sql, from: string, through: string): Promise<readonly KeeperPosting[]> {
  const rows = await boundedQuery(sql, {operation:"line-keeper.posting-changes",callClass:"PAGE"},POSTING_SQL,[from,through]) as Record<string,unknown>[];
  return rows.flatMap(r => postingToLiveFromVersion({versionId:String(r.id),recordClass:r.record_class as RoutineRecordClass,
    firstSeenAt:new Date(String(r.retrieved_at)).toISOString(),changeSet:r.changes as RoutineChangeSet,
    liveAt:readbackPassAt(r.events as {detail:string}[],String(r.id)),lastUnchangedAt:null}).map(p=>({...p,pointerKey:String(r.pointer_key)})));
}
export type KeeperPosting=PostingToLiveRow & {readonly pointerKey?:string;readonly pageSeenAt?:string};
export function foldPosting(held: readonly KeeperPosting[], added: readonly KeeperPosting[], stamps: readonly Record<string,unknown>[], at: string): readonly KeeperPosting[] {
  const changedPointers=new Map(added.filter(p=>p.pointerKey).map(p=>[p.pointerKey,p.versionId]));
  const by = new Map(held.filter(p=>!p.pointerKey||!changedPointers.has(p.pointerKey)||changedPointers.get(p.pointerKey)===p.versionId).map(p=>[`${p.versionId}:${p.recordKey}:${p.kind}`,p]));
  for(const p of added){const key=`${p.versionId}:${p.recordKey}:${p.kind}`;by.set(key,{...by.get(key),...p});}
  const since=Date.parse(at)-7*86_400_000;
  return [...by.values()].filter(p=>Date.parse(p.firstSeenAt)>=since||!p.liveAt||!p.pageSeenAt||p.pageSeenAt<p.liveAt).map(p=>{
    const liveAt=readbackPassAt(stamps.filter(e=>e.candidate_id===p.versionId) as {detail:string}[],p.versionId);
    if(!liveAt || p.liveAt && p.liveAt<=liveAt) return p;
    return {...p,liveAt,minutesToLive:Math.round((Date.parse(liveAt)-Date.parse(p.postedAt??p.firstSeenAt))/60_000)};
  });
}
