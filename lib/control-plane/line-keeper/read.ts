import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { readHourCosts } from "../vital-signs.ts";
import { readOnSchedule } from "../../doors/registry.ts";
import { doorFactsAt, overdueDoors, type DoorSittings } from "../../doors/overdue.ts";
import { keeperState as stateCodeOf } from "./state.ts";
import { closedHour, type ClockDoor, type EmptyWork, type FamilyCount, type LineState } from "./model.ts";
import { readLinks } from "./links.ts";
import { readPostingWindow, STAMP_DELTA_SQL } from "./posting.ts";
import { readMeetingTargets } from "./public.ts";
import { readInventory } from "./inventory.ts";
import { readDestinationDelta } from "./destinations.ts";
import { readRecordTargets } from './records.ts';
import { readTransferCounters } from './transfer.ts';

export async function query(sql: Sql, operation: string, text: string, params: readonly unknown[] = []): Promise<Record<string, unknown>[]> {
  return await boundedQuery(sql, { operation: `line-keeper.${operation}`, callClass: "PAGE" }, text, params) as Record<string, unknown>[];
}
const DOOR_FIELDS = ["doorId", "kind", "bodyIds", "meeting", "status", "lastSuccessAt", "lastFailureAt", "updatedAt", "checkEveryMinutes", "observedChangeMinutes", "ocdId"];
const DOOR_VALUE = `jsonb_build_object(${DOOR_FIELDS.map(k => `'${k}', value->'${k}'`).join(",")})`;
export const DOOR_DELTA_SQL = `SELECT id, ${DOOR_VALUE} AS value FROM cp_doors WHERE changed_at >= $1::timestamptz AND changed_at <= greatest($2::timestamptz,statement_timestamp())`;
/** Deployment initialization only. Only scheduled sources, with no URLs, bodies' records, or source content transferred. */
export const SOURCE_SEED_SQL = `SELECT id, ${DOOR_VALUE} AS value FROM cp_doors
 WHERE value->'meeting' <> 'null'::jsonb OR value->>'kind' IN ('source-feed','derived-feed')`;

/** Only the changed canonical calendars. The database resolves packed payloads; the wire carries body, adapter and sitting dates. */
export const SITTINGS_SQL = `SELECT p.key, coalesce(jsonb_object_agg(s.key,s.sittings) FILTER (WHERE s.key IS NOT NULL),'{}'::jsonb) AS sittings
 FROM civic_data_promotions p LEFT JOIN LATERAL (
 SELECT coalesce(m->'carried'->>'source',split_part(m->>'id',':',1)) || chr(1) || (m->>'bodyId') AS key,
 jsonb_build_object('liveFacts',count(*),'starts',jsonb_agg(extract(epoch FROM (m->>'startsAt')::timestamptz)*1000)) AS sittings
 FROM reader_payload_members(reader_payload_node(p.payload)->'meetings') member
 CROSS JOIN LATERAL (SELECT reader_payload_node(member.item) AS m) item
 WHERE m->>'bodyId' IS NOT NULL AND m->>'startsAt' IS NOT NULL GROUP BY 1) s ON true
 WHERE p.record_class='MEETING' AND p.promoted_at >= $1::timestamptz AND p.promoted_at <= greatest($2::timestamptz,statement_timestamp()) GROUP BY p.key`;
export const SITTINGS_SEED_SQL = SITTINGS_SQL.replace(" AND p.promoted_at >= $1::timestamptz AND p.promoted_at <= greatest($2::timestamptz,statement_timestamp())", "");

/** New facts only. The old count treated every stored campaign row as delivered. These are the predicates of the live fact readers. */
export const FACT_HOUR_SQL = `WITH recent AS MATERIALIZED (
 SELECT f.id,f.entity_id,f.field,f.value,f.status,e.kind,e.state,e.parent_id,e.name FROM fact f JOIN entity e ON e.id=f.entity_id
 WHERE f.live_at >= $1::timestamptz AND f.live_at < $2::timestamptz
), counted AS (
 SELECT *, CASE
 WHEN field LIKE 'campaign-money:%' THEN 'Campaign money'
 WHEN field LIKE 'member:%' OR kind='person' THEN 'Officials and members'
 WHEN field LIKE 'comment:%' THEN 'Taking part'
 WHEN kind='meeting' AND field='agenda_url' THEN 'Agendas'
 WHEN kind='meeting' THEN 'Meetings'
 WHEN kind='body' THEN 'Government bodies' ELSE 'Other facts' END AS family,
 status='live' AND CASE
 WHEN field LIKE 'campaign-money:%' THEN kind='committee' AND parent_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM entity person WHERE person.id=recent.parent_id AND person.kind='person' AND person.state=recent.state)
   AND value#>>'{person,id}'=parent_id AND nullif(value#>>'{person,seat}','') IS NOT NULL
   AND value->>'filerName'=name AND value->>'filingState'='FILED'
   AND coalesce(substring(value->>'transactionDate' from '(20[0-9]{2})'),substring(value->>'period' from '(20[0-9]{2})'))::int >= 2020
   AND jsonb_typeof(value->'amounts')='array' AND jsonb_array_length(value->'amounts')>0
   AND EXISTS (SELECT 1 FROM entity_place ep WHERE ep.entity_id=recent.entity_id)
 WHEN kind='body' THEN field IN ('name','homepage','meeting_cadence','agenda_url','office_address','office_phone')
   OR field LIKE 'member:%' OR field IN ('comment:period','comment:detail','comment:signup','comment:written','comment:attend','comment:time_limit')
 WHEN kind='person' THEN (field IN ('name','email','phone','website') OR split_part(field,':',1) IN ('office','term_note','term_start','term_end'))
   AND EXISTS (SELECT 1 FROM fact member WHERE member.field='member:'||recent.entity_id AND member.status='live')
 WHEN kind='meeting' THEN field IN ('title','starts_at','location','agenda_url','video_url')
 ELSE false END AS reader_live FROM recent
) SELECT coalesce(state,'US') AS state,family,count(*)::int AS saved,
 coalesce(jsonb_agg(jsonb_build_object('id',id,'entityId',entity_id,'field',field,'value',value,'kind',kind,'state',state,'family',family,
 'bodyId',CASE WHEN kind='body' THEN entity_id WHEN kind='meeting' THEN parent_id ELSE
 (SELECT member.entity_id FROM fact member WHERE member.field='member:'||counted.entity_id AND member.status='live' LIMIT 1) END)) FILTER (WHERE reader_live),'[]'::jsonb) AS eligible_facts
 FROM counted GROUP BY 1,2 ORDER BY 1,2`;
export const EMPTY_WORK_SQL = `SELECT coalesce(record->>'jurisdiction',record->>'source','') AS place,
 coalesce(record->>'recordClass','Unknown work') AS family,coalesce(record->>'routeId','') AS route,
 count(DISTINCT coalesce(record->>'attemptId',c.record_id))::int AS runs,
 count(DISTINCT coalesce(record->>'attemptId',c.record_id)) FILTER (WHERE record->'cost'->>'bytesFetched'='0')::int AS fetched_nothing,
 count(DISTINCT coalesce(record->>'attemptId',c.record_id)) FILTER (WHERE a.value->'artifactIds'='[]'::jsonb)::int AS saved_nothing,
 count(DISTINCT coalesce(record->>'attemptId',c.record_id)) FILTER (WHERE record->'cost'->>'bytesFetched'='0' AND a.value->'artifactIds'='[]'::jsonb)::int AS empty,
 count(DISTINCT coalesce(record->>'attemptId',c.record_id)) FILTER (WHERE a.value->>'outcome' IS NOT NULL AND a.value->>'outcome'<>'COMPLETED')::int AS failed,
 count(DISTINCT coalesce(record->>'attemptId',c.record_id)) FILTER (WHERE record->'cost'->>'bytesFetched' IS NULL OR a.value->'artifactIds' IS NULL)::int AS unknown
 FROM cp_log_costs c LEFT JOIN cp_attempts a ON a.id=c.record->>'attemptId'
 WHERE c.recorded_at >= $1::timestamptz AND c.recorded_at < $2::timestamptz
 AND record->>'role' IS DISTINCT FROM 'ASK' AND record->'nonProduction' IS NULL
 GROUP BY 1,2,3 ORDER BY 1,2,3`;
export const RAW_VITAL_SQL = `SELECT facts_live,rounds_finished,rounds_killed,neon_bytes_read,neon_bytes_by_caller FROM cp_vital_signs WHERE hour=$1::timestamptz`;
export const HEARTBEAT_SQL = `SELECT value->>'beatAt' AS beat_at,value->'neonBytes'->'lastFullHour' AS bytes,
 value->'cycle' AS cycle,value->>'lastCycleOk' AS last_cycle_ok,
 jsonb_build_object('beatAt',value->'beatAt','pause',value->'pause','codeIdentity',value->'codeIdentity',
 'nextCycleDueAt',value->'nextCycleDueAt','lastCycleOk',value->'lastCycleOk') AS heartbeat FROM cp_runner_heartbeat WHERE id='pilot-runner'`;
/** Reuse the Scoreboard's publication-flow count; no box scan or seven-day rerun. */
export const RECORDS_SQL = `SELECT coalesce(sum((record->'publicationFlow'->>'changedRecords')::int),0)::int AS live,
 coalesce(jsonb_agg(record->'publicationFlow'->>'versionId'),'[]'::jsonb) AS versions,
 coalesce(jsonb_agg(jsonb_build_object('version',record->'publicationFlow'->>'versionId','live',(record->'publicationFlow'->>'changedRecords')::int)),'[]'::jsonb) AS by_version
 FROM cp_log_owner_digests WHERE log_key='publication-flow' AND record->'publicationFlow'->>'stage'='LIVE'
 AND recorded_at >= $1::timestamptz AND recorded_at < $2::timestamptz`;

export function foldClocks(state: LineState, doors: readonly Record<string, unknown>[], calendars: readonly Record<string, unknown>[]): Pick<LineState, "doors" | "sittings"> {
  const next = { ...state.doors }, sittings = { ...state.sittings };
  for (const row of doors) {
    const door = row.value as ClockDoor;
    if (readOnSchedule(door)) next[String(row.id)] = {...door,firstSeenAt:state.doors[String(row.id)]?.firstSeenAt??door.firstSeenAt??door.updatedAt};
    else delete next[String(row.id)];
  }
  for (const row of calendars) sittings[String(row.key)] = row.sittings as Record<string, DoorSittings>;
  return { doors: next, sittings };
}
export function sourceReading(state: LineState, at: string) {
  const all = Object.values(state.doors).map(d => ({formatVersion:1 as const,readNow:false,editedAt:null,hosts:[],config:{},holds:[],notes:"",shutSince:null,shutReason:null,origin:"DERIVED" as const,...d})), facts = new Map<string, DoorSittings>();
  for (const partition of Object.values(state.sittings)) for (const [key, row] of Object.entries(partition)) {
    const held = facts.get(key); facts.set(key, { liveFacts: (held?.liveFacts ?? 0) + row.liveFacts, starts: [...held?.starts ?? [], ...row.starts] });
  }
  const late = overdueDoors(all,
    new Map([...facts].map(([key, s]) => [key.replace("\x01", "\x00"), doorFactsAt(s, at)])), at);
  const ids = new Set(late.map(d => d.doorId));
  const byState = new Map<string, {state: string; scheduled: number; overdue: number}>();
  for (const door of all.filter(d => d.status === "OPEN")) {
    const key = stateCodeOf(door.doorId, door.ocdId ?? "")?.toUpperCase() ?? "US";
    const row = byState.get(key) ?? { state: key, scheduled: 0, overdue: 0 };
    row.scheduled++; if (ids.has(door.doorId)) row.overdue++; byState.set(key, row);
  }
  const byKind=new Map<string,{state:string;family:string;scheduled:number;overdue:number}>();
  for(const door of all.filter(d=>d.status==='OPEN')){
    const state=stateCodeOf(door.doorId,door.ocdId??'')?.toUpperCase()??'US',family=door.meeting?'Meetings':door.kind,key=`${state}:${family}`;
    const row=byKind.get(key)??{state,family,scheduled:0,overdue:0};row.scheduled++;if(ids.has(door.doorId))row.overdue++;byKind.set(key,row);
  }
  return { byKind:[...byKind.values()],scheduled: [...byState.values()].reduce((n,s) => n+s.scheduled,0), overdue: late.length, complete: state.seededAt !== null, byState: [...byState.values()] };
}
const READBACK_FIELDS = ['durable','attemptedTasks','verifiedSourceSuccesses','finishedAt','readerReadbackEvidence','readerReadbackDenominator','readerReadbacksRecordedPass','readerReadbacksRecordedFail','readerReadbacksCurrentFail','readerReadbackNoops','readerReadbackRepairFailures','readerReadbacks','failures','summary'];
export const READBACK_SQL = `SELECT jsonb_build_object(${READBACK_FIELDS.map(k=>`'${k}',record->'runtimeOutcome'->'${k}'`).join(',')}) AS outcome
 FROM cp_log_owner_digests WHERE log_key='owner-digest' AND record->'runtimeOutcome'->>'kind'='ROUTINE_CIVIC_DATA_SUPERVISOR'
 AND recorded_at >= $1::timestamptz AND recorded_at < $2::timestamptz ORDER BY recorded_at DESC LIMIT 1`;
export async function readHour(control: Sql, reader: Sql, at: string, options:{readonly window?:{from:string;through:string};readonly clocks?:boolean;readonly clockFrom?:string;readonly transferFrom?:string}={}) {
  const window = options.window ?? closedHour(at), args = [window.from, window.through];
  const clockArgs=options.clocks===false?args:[options.clockFrom??new Date(Date.parse(at)-3_600_000).toISOString(),at];
  const reads = await Promise.allSettled([
    query(reader, "facts", FACT_HOUR_SQL, args), readHourCosts(control, window.from),
    query(control, "empty-work", EMPTY_WORK_SQL, args), query(control, "vital", RAW_VITAL_SQL, [window.from]),
    query(control, "runner", HEARTBEAT_SQL), query(control, "records", RECORDS_SQL, args),
    options.clocks===false ? Promise.resolve([]) : query(control, "source-changes", DOOR_DELTA_SQL, clockArgs),
    options.clocks===false ? Promise.resolve([]) : query(reader, "calendar-changes", SITTINGS_SQL, clockArgs),
    query(control,"reader-readbacks",READBACK_SQL,args),
    readLinks(control,reader,window.from,window.through,options.clocks===false?null:clockArgs),
    options.clocks===false?Promise.resolve([]):readPostingWindow(reader,window.from,at),
    options.clocks===false?Promise.resolve([]):query(reader,"stamp-changes",STAMP_DELTA_SQL,[new Date(Date.parse(at)-3_600_000).toISOString(),at]),
    options.clocks===false?Promise.resolve([]):readMeetingTargets(reader,window.from,at),
    options.clocks===false?Promise.resolve(null):readInventory(control,clockArgs[0],clockArgs[1]),
    options.clocks===false?Promise.resolve([]):readRecordTargets(reader,window.from,at),
    options.clocks===false?Promise.resolve(null):readDestinationDelta(reader,clockArgs[0],clockArgs[1]),
    options.clocks===false?Promise.resolve(null):readTransferCounters(reader,at,false,options.transferFrom),
  ]);
  const get = <T>(i: number): T | null => reads[i].status === "fulfilled" ? (reads[i] as PromiseFulfilledResult<T>).value : null;
  const work = get<Record<string, unknown>[]>(2);
  const published=get<Record<string,unknown>[]>(5)?.[0];
  const versions=published?.versions as string[]|undefined??[];
  const recordKinds=versions.length?await query(reader,'live-record-identities','SELECT id,record_class,scope FROM civic_data_candidates WHERE id=ANY($1::text[])',[versions]).catch(()=>[]):[];
  return { window,recordDistribution:(published?.by_version as {version:string;live:number}[]|undefined??[]).map(r=>{const kind=recordKinds.find(k=>k.id===r.version);return {...r,scope:kind?.scope as string|undefined,record_class:kind?.record_class as string|undefined};}),destinations:get<Readonly<Record<string,string>>>(15),recordTargets:get<Awaited<ReturnType<typeof readRecordTargets>>>(14),inventory:get<Awaited<ReturnType<typeof readInventory>>>(13),targets:get<Awaited<ReturnType<typeof readMeetingTargets>>>(12),links:get<Awaited<ReturnType<typeof readLinks>>>(9),posting:get<Awaited<ReturnType<typeof readPostingWindow>>>(10),stamps:get<Record<string,unknown>[]>(11),readback:get<Record<string, unknown>[]>(8)?.[0]?.outcome ?? null,
    transferCounters:get<Awaited<ReturnType<typeof readTransferCounters>>>(16),
    facts:get<Record<string,unknown>[]>(0)?.map((r):FamilyCount=>({state:String(r.state),family:String(r.family),saved:Number(r.saved),live:0,eligibleFacts:r.eligible_facts as FamilyCount['eligibleFacts']}))??null,costs: get<Awaited<ReturnType<typeof readHourCosts>>>(1),
    work: work?.map((r): EmptyWork => ({ state: stateCodeOf(String(r.route),String(r.place))?.toUpperCase() ?? "US", family: String(r.family), route: String(r.route),
      runs: Number(r.runs), fetchedNothing: Number(r.fetched_nothing), savedNothing: Number(r.saved_nothing), empty: Number(r.empty), failed: Number(r.failed), unknown: Number(r.unknown) })) ?? null,
    rawVital: get<Record<string, unknown>[]>(3)?.[0] ?? null, heartbeat: get<Record<string, unknown>[]>(4)?.[0] ?? null,
    recordsLive: get<Record<string, unknown>[]>(5)?.[0]?.live as number | undefined ?? null,
    recordVersions:get<Record<string,unknown>[]>(5)?.[0]?.versions as string[]|undefined??[],
    doors: get<Record<string, unknown>[]>(6), calendars: get<Record<string, unknown>[]>(7),
    failures: reads.flatMap((r,i) => r.status === "rejected" ? [`Measurement ${i}: ${r.reason instanceof Error ? r.reason.name : "Error"}`] : []) };
}
