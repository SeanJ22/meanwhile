import { sql,type SQLWrapper } from "drizzle-orm";
import type { RoutineCandidate } from "./types.ts";

export interface SourceWorkClock {
  readonly nextWorkAt?:string;
  readonly workPending?:boolean;
}
export interface SourceWorkClockMetadata {
  readonly nextDates:readonly string[];
  readonly workPending?:boolean;
}
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const nextKeys=["nextTermAt","nextDueAt","nextWorkAt"]as const;

/** Source plans retain their own term/blank retry boundaries even when unchanged hashes learn a slower cadence. */
export function sourceWorkClock(candidate:RoutineCandidate):SourceWorkClock{
  const payload=object(candidate.normalizedPayload),probe=object(payload.sourceProbe);
  const facts=candidate.excludedFacts??[];
  const next=[...nextKeys.flatMap(key=>[probe[key],payload[key]]),
    ...facts.filter(fact=>fact.code==="PEOPLE_PORTRAIT_SCHEDULE").map(fact=>object(fact.record).nextDueAt)]
    .flatMap(value=>typeof value==="string"&&Number.isFinite(Date.parse(value))?[new Date(value).toISOString()]:[]).sort()[0];
  const workPending=probe.continuationPending===true||probe.deferred===true||payload.continuationPending===true||
    facts.some(fact=>/^(STATE|CONGRESS)_PORTRAIT_WORK_REMAINS$/.test(fact.code));
  return{...(next?{nextWorkAt:next}:{}),...(workPending?{workPending:true}:{})};
}

/** The compact raw dates preserve PostgreSQL's existing aggregation and collation semantics. */
export function sourceWorkClockMetadata(candidate:RoutineCandidate):SourceWorkClockMetadata{
  const payload=object(candidate.normalizedPayload),probe=object(payload.sourceProbe),facts=candidate.excludedFacts??[];
  const nextDates=[...new Set([...nextKeys.flatMap(key=>[probe[key],payload[key]]),
    ...facts.filter(fact=>fact.code==="PEOPLE_PORTRAIT_SCHEDULE").map(fact=>object(fact.record).nextDueAt)]
    .filter((value):value is string=>typeof value==="string"&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(value)))];
  const workPending=probe.continuationPending===true||probe.deferred===true||payload.continuationPending===true||
    facts.some(fact=>/^(STATE|CONGRESS)_PORTRAIT_WORK_REMAINS$/.test(fact.code));
  return{nextDates,...(workPending?{workPending:true}:{})};
}

/** The Postgres twin selects only scalar work metadata; source plans and evidence remain in the database. */
export function sourceWorkClockSql(column:SQLWrapper){
  const payload=sql`reader_payload_node(${column}->'normalizedPayload')`;
  const probe=sql`reader_payload_node(${payload}->'sourceProbe')`;
  const facts=sql`reader_payload_members(CASE WHEN ${column}->'excludedFacts'IS NULL OR ${column}->'excludedFacts'='null'::jsonb
    THEN'[]'::jsonb ELSE ${column}->'excludedFacts'END)`;
  const nextWorkAt=sql`(SELECT min(value)FROM(
    SELECT value FROM(VALUES(${probe}->>'nextTermAt'),(${probe}->>'nextDueAt'),(${probe}->>'nextWorkAt'),
      (${payload}->>'nextTermAt'),(${payload}->>'nextDueAt'),(${payload}->>'nextWorkAt'))next(value)
    UNION ALL SELECT reader_payload_node(f.item)#>>'{record,nextDueAt}'FROM ${facts}f
      WHERE reader_payload_node(f.item)->>'code'='PEOPLE_PORTRAIT_SCHEDULE'
  )dates WHERE value~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T')`;
  const workPending=sql`CASE WHEN ${probe}->>'continuationPending'='true'OR ${probe}->>'deferred'='true'OR ${payload}->>'continuationPending'='true'
    OR EXISTS(SELECT 1 FROM ${facts}f WHERE reader_payload_node(f.item)->>'code'IN('STATE_PORTRAIT_WORK_REMAINS','CONGRESS_PORTRAIT_WORK_REMAINS'))
    THEN true END`;
  const held=sql`${column}->'vault' ? 'workClock'`;
  return{nextWorkAt:sql`CASE WHEN ${held} THEN (SELECT min(value) FROM jsonb_array_elements_text(${column}#>'{vault,workClock,nextDates}') date(value)) ELSE ${nextWorkAt} END`,
    workPending:sql`CASE WHEN ${held} THEN CASE WHEN ${column}#>>'{vault,workClock,workPending}'='true' THEN true END ELSE ${workPending} END`};
}
