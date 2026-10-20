import type { Sql } from '../repository/pg-store.ts';
import { boundedQuery } from '../repository/request-bounds.ts';
import { civicRecordFacts } from '../../civic-data/changes.ts';
import type { RoutineRecordClass } from '../../civic-data/types.ts';
import { ageFrom,inSeatUntil } from '../../officials/tenure.ts';
import { readerOfficeTitle } from '../../officials/reader-office-title.ts';
import { socialAccountsOf } from '../../officials/social-platforms.ts';
import type { SocialAccounts } from '../../officials/types.ts';
import { ballotCandidateDisplayName } from '../../ballot/name-case.ts';
import { readerPartyLabel } from '../../text/reader-names.ts';
import { keeperState } from './state.ts';

export interface RecordTarget {
  readonly version:string;readonly recordKey:string;readonly kind:string;readonly state:string;readonly collectedAt:string;readonly publishedAt?:string;
  readonly id:string;readonly bodyId:string;readonly division:string;readonly memberId:string;readonly name:string;
  readonly expected:readonly (string|number|boolean)[];readonly displayValues?:readonly (string|number|boolean)[];
}
/** Quiet-path inventory only. Hourly work uses RECORD_TARGET_SQL below. */
export const RECORD_SAMPLE_SQL=`WITH heads AS MATERIALIZED (
 SELECT DISTINCT ON(p.record_class,coalesce(substring(p.scope from 'US-([A-Z]{2})'),substring(p.scope from '/state:([a-z]{2})'),'US'))
 c.id,c.record_class,c.scope,c.retrieved_at,p.promoted_at,c.candidate FROM civic_data_promotions p
 JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.promoted_at >= $1::timestamptz AND p.promoted_at <= greatest($2::timestamptz,statement_timestamp())
 AND p.record_class NOT IN ('OPERATIONAL_REFERENCE','DOTGOV_REFERENCE','CENSUS_REFERENCE','CENSUS_GEOGRAPHY','PRL_ARCHIVE')
 ORDER BY p.record_class,coalesce(substring(p.scope from 'US-([A-Z]{2})'),substring(p.scope from '/state:([a-z]{2})'),'US'),p.promoted_at DESC)
 SELECT c.id version,c.record_class,c.scope,c.retrieved_at,c.promoted_at,d->>'key' record_key,
 resolved.before,resolved.after, coalesce(binding.division,meeting_binding.division) division, meeting_binding.body_id, vote_member.officeholder_id FROM heads c
 CROSS JOIN LATERAL (SELECT reader_payload_node(c.candidate->'changeSet') changes) cs
 CROSS JOIN LATERAL (SELECT reader_payload_node(member.item) d FROM (SELECT item FROM reader_payload_members(coalesce(changes->'added','[]'::jsonb)) UNION ALL SELECT item FROM reader_payload_members(coalesce(changes->'changed','[]'::jsonb))) member CROSS JOIN LATERAL (SELECT reader_payload_node(member.item) delta) decoded
 WHERE (c.record_class<>'MEETING' OR delta->>'key' LIKE 'agenda-document:%')
 AND delta->>'key' NOT LIKE 'projection:%' AND delta->>'key' NOT LIKE '%checkpoint%' AND delta->>'key' NOT LIKE '%partition%' AND delta->>'key' NOT LIKE '%marker%' AND delta->>'key' NOT LIKE 'absence:%' AND jsonb_typeof(delta->'after')='object'
 ORDER BY CASE WHEN delta->>'key' LIKE 'officeholder:%' OR delta->>'key' LIKE 'body:%' OR delta->>'key' LIKE 'outcome:%' THEN 0 ELSE 1 END,delta->>'key' LIMIT 1) selected
 CROSS JOIN LATERAL (WITH RECURSIVE decoded(side,node,path,step) AS (
 SELECT side,CASE WHEN reader_payload_node(d->side) ? '$civicCandidatePath' THEN c.candidate->'readModel' ELSE d->side END,
 coalesce(reader_payload_node(d->side)->'$civicCandidatePath','[]'::jsonb),0 FROM (VALUES ('before'),('after')) sides(side)
 UNION ALL SELECT side,CASE WHEN jsonb_typeof(reader_payload_node(node))='array' OR reader_payload_node(node)->>'kind'='array'
 THEN (SELECT item FROM reader_payload_members(node) WHERE ordinal_index=(path->>step)::bigint+1)
 ELSE reader_payload_node(node)->(path->>step) END,path,step+1 FROM decoded WHERE step<jsonb_array_length(path)
 ) SELECT max(reader_payload_value(node)::text) FILTER (WHERE side='before')::jsonb before,
 max(reader_payload_value(node)::text) FILTER (WHERE side='after')::jsonb after FROM decoded WHERE step=jsonb_array_length(path)) resolved
 LEFT JOIN LATERAL (SELECT reader_payload_node(item)->>'ocdId' division FROM reader_payload_members(coalesce(reader_payload_node(reader_payload_node(c.candidate->'readModel')->'roster')->'divisions','[]'::jsonb))
 WHERE reader_payload_node(item)->>'officeholderId'=resolved.after->>'id'
 UNION ALL SELECT reader_payload_node(item)->>'ocdId' FROM reader_payload_members(coalesce(reader_payload_node(
 reader_payload_node(reader_payload_node(c.candidate->'readModel')->'ballots')->(reader_payload_node(d->'after')->'$civicCandidatePath'->>1))->'contests','[]'::jsonb))
 WHERE reader_payload_node(item)->>'id'=resolved.after->>'contestId' LIMIT 1) binding ON true
 LEFT JOIN LATERAL (SELECT reader_payload_node(item)->>'bodyId' body_id,reader_payload_node(item)->>'ocdId' division
 FROM reader_payload_members(CASE WHEN c.record_class='MEETING' THEN coalesce(reader_payload_node(c.candidate->'readModel')->'meetings','[]'::jsonb) ELSE '[]'::jsonb END)
 WHERE reader_payload_node(item)->>'id'=resolved.after->>'meetingId' LIMIT 1) meeting_binding ON true
 LEFT JOIN LATERAL (SELECT reader_payload_node(item)->>'officeholderId' officeholder_id
 FROM reader_payload_members(CASE WHEN c.record_class IN ('STATE_ROLL_CALL','FEDERAL_ROLL_CALL')
 THEN coalesce(reader_payload_node(c.candidate->'readModel')->'positions','[]'::jsonb) ELSE '[]'::jsonb END)
 WHERE reader_payload_node(item)->>'rollCallId'=coalesce(resolved.after->>'id',resolved.after->>'rollCallId') LIMIT 1) vote_member ON true`;

/** Hourly reads retain every changed record. Sampling is only for the one-time
 * inventory of quiet public paths; it never discards another new record. */
export const RECORD_TARGET_SQL=RECORD_SAMPLE_SQL
 .replace(RECORD_SAMPLE_SQL.slice(RECORD_SAMPLE_SQL.indexOf('SELECT DISTINCT ON'),RECORD_SAMPLE_SQL.indexOf(' c.id,c.record_class')), 'SELECT')
 .replace('LIMIT 1) selected',') selected');

const ignored=/^(?:id|bodyId|ocdId|personId|memberId|officeholderId|officialPersonId|rollCallId|officialRollCallId|divisionId|recordClass|kind|type|state|sourceId|provenance|fieldSources|sourceProjectionEvidence|raw|rawHash|contentHash|generatedAt|retrievedAt|collectedAt|verifiedAt|checkedAt|routesWalked|extraction|extractionNote|nativeIds|titleSource|publicationObservations|publication|minutesDocument)$/;
/** Only changed fact values. An unchanged title never conceals a changed phone, amount or vote. */
export function changedValues(before:unknown,after:unknown):readonly (string|number|boolean)[] {
  if(after===before||after===null||after===undefined)return [];
  if(typeof after==='string')return after.trim()?[after]:[];
  if(typeof after==='number'||typeof after==='boolean')return [after];
  if(typeof after!=='object')return [];
  const prior=before&&typeof before==='object'?before as Record<string,unknown>:{};
  return Object.entries(after).flatMap(([k,v])=>ignored.test(k)?[]:changedValues(prior[k],v));
}
export async function readRecordTargets(sql:Sql,from:string,through:string,sample=false):Promise<readonly RecordTarget[]> {
  const rows=await boundedQuery(sql,{operation:'line-keeper.record-targets',callClass:'PAGE'},sample?RECORD_SAMPLE_SQL:RECORD_TARGET_SQL,[from,through]) as Record<string,unknown>[];
  return rows.flatMap(r=>{
    let a=r.after as Record<string,unknown>;
    const recordClass=String(r.record_class),scope=String(r.scope),recordKey=String(r.record_key),agenda=recordKey.startsWith('agenda-document:');
    const kind=agenda?'AGENDA_DOCUMENT':recordClass;
    if(agenda){const versions=a.versions as Record<string,unknown>[]|undefined;a={...a,...versions?.at(-1)};}
    const facts=civicRecordFacts(recordClass as RoutineRecordClass,{key:recordKey,record:a}),before=civicRecordFacts(recordClass as RoutineRecordClass,{key:recordKey,record:r.before});
    const publicFields=/DIRECTORY|LEGISLATOR$/.test(kind)?['name','officeTitle','phone','email','websiteUrl','contactFormUrl','partyLabel','termStart','termEnd','birthDate','photo','social']:null;
    const select=(v:unknown,display=false)=>{
      const row=v as Record<string,unknown>|null;
      if(agenda)return row?{documentUrl:row.documentUrl,text:row.text}:null;
      if(kind==='BALLOT_CANDIDACY'&&recordKey.startsWith('candidacy:'))return row?{name:ballotCandidateDisplayName({givenName:String(row.givenName??''),familyName:String(row.familyName??'')}),party:readerPartyLabel(row.partyLabel as string|null),websiteUrl:row.websiteUrl}:null;
      return publicFields?Object.fromEntries(publicFields.map(k=>{
        const value=row?.[k];
        if(k==='photo')return [k,(value as {url?:string}|null)?.url??null];
        if(display&&k==='officeTitle')return [k,readerOfficeTitle(value as string|null)];
        if(display&&k==='partyLabel')return [k,readerPartyLabel(value as string|null)];
        if(display&&k==='termEnd')return [k,inSeatUntil(value as string|null)];
        if(display&&k==='birthDate'){const age=ageFrom(value as string|null,new Date(through));return [k,age===null?null:`Age ${age}`];}
        if(display&&k==='social')return [k,socialAccountsOf(value as SocialAccounts|undefined).map(a=>a.url)];
        return [k,value];
      })):v;
    };
    const expected=[...new Set(changedValues(select(before),select(facts)))],displayValues=publicFields?[...new Set(changedValues(select(before,true),select(facts,true)))]:undefined;
    if(!expected.length)return [];
    const bodyId=String(a.bodyId??r.body_id??(recordKey.startsWith('body:')?a.id:undefined)??''),division=String(a.ocdId??a.divisionId??r.division??bodyId.split('#')[0]??'');
    const id=String(a.id??a.meetingId??a.rollCallId??recordKey.replace(/^[^:]+:/,''));
    return [{version:String(r.version),recordKey,kind,state:(keeperState(scope,division)??keeperState(String(a.state??''),'')??'US').toUpperCase(),
      collectedAt:new Date(String(r.retrieved_at)).toISOString(),publishedAt:new Date(String(r.promoted_at)).toISOString(),id,bodyId,division,
      memberId:String((/DIRECTORY|LEGISLATOR/.test(kind)?a.id:undefined)??a.officeholderId??r.officeholder_id??a.personId??a.memberId??scope.match(/congress:[A-Z]\d{6}/)?.[0]??(recordKey.startsWith('officeholder:')?id:'')),name:String(a.name??a.title??''),expected,...(displayValues?{displayValues}:{})}];
  });
}
