import type {Query} from "../facts/publish.ts";
import type {DerivedInputRef} from "./derived-authority.ts";
import type {MeetingsSnapshot,SnapshotSourceReport} from "../meetings/snapshot.ts";
import {carriedFromAnswer,mark} from "../meetings/carry-forward.ts";
import {derivedMeetingFamilyScope,meetingHistoryScope,meetingPartitionScope} from "./meeting-partitions.ts";
import type {DerivedMeetingFamilyState} from "./contracts.ts";
import {statesForRegistryDivisions} from "./state-scopes.ts";
import {keyedSourceInput} from "./keyed-government-lookup.ts";

export interface DerivedMeetingBodySlice {
  readonly input:Extract<DerivedInputRef,{kind:"PROMOTED_VERSION"}>;
  /** Null when the retained body comes from the old state family; the new body's CAS still starts empty. */
  readonly expectedBaseVersionId:string|null;
  readonly snapshot:MeetingsSnapshot;
}

export function derivedBodyScope(bodyId:string,history=false,state?:DerivedMeetingFamilyState):string{
  const selected=state??`US-${statesForRegistryDivisions([bodyId])[0]??""}`;
  if(!/^US-[A-Z]{2}$/.test(selected))throw new Error(`DERIVED_MEETING_BODY_STATE_REQUIRED:${bodyId}`);
  const scope=meetingPartitionScope(`derived~${selected}`,bodyId);
  return history?meetingHistoryScope(scope):scope;
}

/** Source outcomes for one body's slice of a state family; matches the place reader's body attribution. */
export function derivedBodySources(snapshot:Pick<MeetingsSnapshot,"meetings"|"derivedMembers"|"sources">,bodyId:string):SnapshotSourceReport[]{
  const members=snapshot.derivedMembers?.filter(member=>member.bodyId===bodyId);
  if(!members?.length){
    const sources=new Set(snapshot.meetings.map(meeting=>meeting.carried?.source??meeting.id.split(":")[0]));
    return snapshot.sources.filter(source=>sources.has(source.source));
  }
  return members.flatMap(member=>{
    const own=snapshot.meetings.filter(meeting=>meeting.bodyId===bodyId&&(meeting.carried?.source??meeting.id.split(":")[0])===member.source);
    const fresh=own.filter(meeting=>!meeting.carried).length,answered=own.filter(meeting=>meeting.carried&&carriedFromAnswer(meeting.carried.reason)).length;
    const walled=own.filter(meeting=>meeting.carried&&!carriedFromAnswer(meeting.carried.reason)).length;
    const drops={placeless:0,unknownVenue:0,unplaceableInTime:0,notConfigured:0};
    return [
      ...(member.outcome==="FRESH"||fresh||answered?[{source:member.source,ok:true,error:null,fetched:fresh,normalized:fresh,drops,...(answered?{carriedForward:answered}:{})}]:[]),
      ...(member.outcome!=="FRESH"||walled?[{source:member.source,ok:false,error:member.detail??`${bodyId}: the last verified sittings are held`,failure:"WALL" as const,fetched:0,normalized:0,drops,
        ...(walled?{carriedForward:walled}:{}),unreachableOcdIds:[...new Set([...own.flatMap(meeting=>meeting.ocdId??[]),...(bodyId.startsWith("ocd-division/")?[bodyId.split("#")[0]!]:[])])]}]:[]),
    ];
  });
}

export function selectDerivedMeetingBodySnapshot(value:MeetingsSnapshot,bodyId:string,legacy:boolean):MeetingsSnapshot{
  if(!legacy){
    if(value.meetings.some(meeting=>meeting.bodyId!==bodyId))throw new Error(`DERIVED_MEETING_BODY_FOREIGN_ROWS:${bodyId}`);
    const ids=new Set(value.meetings.map(meeting=>meeting.id));
    if(value.agendaDocuments.some(document=>!ids.has(document.meetingId)))throw new Error(`DERIVED_MEETING_BODY_FOREIGN_DOCUMENTS:${bodyId}`);
    return value;
  }
  const meetings=value.meetings.filter(meeting=>meeting.bodyId===bodyId),ids=new Set(meetings.map(meeting=>meeting.id));
  const snapshot={...value,meetings,agendaDocuments:value.agendaDocuments.filter(document=>ids.has(document.meetingId)),
    derivedMembers:value.derivedMembers?.filter(member=>member.bodyId===bodyId),counts:{fresh:meetings.filter(meeting=>!meeting.carried).length,carried:meetings.filter(meeting=>meeting.carried).length,total:meetings.length,duplicatesCollapsed:0}};
  return {...snapshot,sources:derivedBodySources(snapshot,bodyId)};
}

/** Native body pointer wins atomically. Before its first write, only that body's legacy rows are decoded. */
export async function readDerivedMeetingBodyRows(query:Query,state:DerivedMeetingFamilyState,bodyId:string,history=false):Promise<DerivedMeetingBodySlice|null>{
  const own=derivedBodyScope(bodyId,history,state),legacy=history?meetingHistoryScope(derivedMeetingFamilyScope(state)):derivedMeetingFamilyScope(state);
  const [row]=await query(`WITH pointer AS MATERIALIZED (
    SELECT p.key,p.scope,p.current_version_id AS version_id,p.promoted_at,c.normalized_hash,reader_payload_node(p.payload) AS root,
      (p.source_id=$4 AND p.current_version_id=p.last_known_good_version_id AND c.state='PROMOTED' AND c.acquisition_succeeded
       AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id AND c.source_id=p.source_id
       AND c.record_class=p.record_class AND c.scope=p.scope AND (p.current_version_id=c.id AND p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint)
       AND c.validation_receipt=p.validation_receipt AND p.validation_receipt->>'decision'='GOOD'
       AND (c.read_model_fingerprint IS NULL OR c.read_model_fingerprint=c.normalized_hash)) AS valid
    FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
    WHERE p.record_class='MEETING' AND p.scope=ANY($1::text[]) ORDER BY (p.scope=$2) DESC LIMIT 1
  ), meetings AS MATERIALIZED (
    SELECT r.ordinal,r.row_id,r.value FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.version_id
      WHERE p.valid AND r.collection='meetings' AND (p.scope=$2 OR r.body_id=$3)
  ) SELECT p.scope,p.version_id,p.promoted_at,p.normalized_hash,p.valid,
    CASE WHEN p.scope=$2 THEN reader_payload_value(p.root-'meetings'-'agendaDocuments')
      ELSE jsonb_build_object('formatVersion',p.root->'formatVersion','generatedAt',p.root->'generatedAt','derivedMembers',coalesce((
        SELECT jsonb_agg(reader_payload_value(d.item) ORDER BY d.ordinal_index) FROM reader_payload_members(p.root->'derivedMembers') d
        WHERE reader_payload_node(d.item)->>'bodyId'=$3),'[]'::jsonb),
        'sources',coalesce((SELECT jsonb_agg(reader_payload_value(reader_payload_node(s.item)-'acquisitions') ORDER BY s.ordinal_index) FROM reader_payload_members(p.root->'sources') s
          WHERE reader_payload_node(s.item)->>'source' IN (SELECT coalesce(value#>>'{carried,source}',split_part(row_id,':',1)) FROM meetings)),'[]'::jsonb)) END AS header,
    coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal) FROM meetings),'[]'::jsonb) AS meetings,
    coalesce((SELECT jsonb_agg(reader_payload_value(r.value) ORDER BY r.ordinal) FROM civic_data_rows r WHERE p.valid
      AND r.promotion_key=p.key AND r.version_id=p.version_id AND r.collection='agendaDocuments'
      AND (p.scope=$2 OR r.value->>'meetingId' IN (SELECT row_id FROM meetings))),'[]'::jsonb) AS documents
    FROM pointer p`,[[own,legacy],own,bodyId,history?"meetings-history":"meetings-derived-routes"]);
  if(!row)return null;
  const input=keyedSourceInput(row,"MEETING"),isLegacy=row.scope!==own;
  const value={...(row.header as object),meetings:row.meetings,agendaDocuments:row.documents} as MeetingsSnapshot;
  return {input,expectedBaseVersionId:isLegacy?null:input.versionId,snapshot:selectDerivedMeetingBodySnapshot(value,bodyId,isLegacy)};
}

/** A route removed from wiring cannot silently erase facts already sourced for this body. */
export function retainUnwiredDerivedBodyFacts(current:MeetingsSnapshot,previous:MeetingsSnapshot|null):MeetingsSnapshot{
  if(!previous)return current;
  const currentMembers=current.derivedMembers??[];
  const oldMembers=(previous.derivedMembers??[]).filter(member=>!currentMembers.some(next=>next.id===member.id)&&!currentMembers.some(next=>next.source===member.source));
  const retained=previous.meetings.filter(meeting=>oldMembers.some(member=>meeting.id.startsWith(`${member.source}:`))&&!current.meetings.some(next=>next.id===meeting.id))
    .map(meeting=>mark(meeting,oldMembers.find(member=>meeting.id.startsWith(`${member.source}:`))!.source,previous.generatedAt));
  if(!retained.length)return current;
  const ids=new Set(retained.map(meeting=>meeting.id)),meetings=[...current.meetings,...retained];
  const heldMembers=oldMembers.map(member=>({...member,outcome:"HELD" as const,detail:"The held source route is absent from the current wiring; its exact facts remain retained."}));
  const heldSources=derivedBodySources({meetings:retained,derivedMembers:heldMembers,sources:previous.sources},retained[0]!.bodyId!);
  return {...current,meetings,agendaDocuments:[...current.agendaDocuments,...previous.agendaDocuments.filter(document=>ids.has(document.meetingId))],
    derivedMembers:[...currentMembers,...heldMembers],sources:[...current.sources,...heldSources],
    counts:{...current.counts,fresh:meetings.filter(meeting=>!meeting.carried).length,carried:meetings.filter(meeting=>meeting.carried).length,total:meetings.length}};
}

export interface DerivedMeetingFamilyProgress {
  readonly pending:readonly string[];
  readonly startedVersions?:Readonly<Record<string,string|null>>;
  readonly attemptedAt?:string;
  readonly completedAt?:string;
  readonly checkedAt?:string;
  readonly nextWorkAt?:string;
}
export const derivedMeetingProgressName=(scope:string)=>`derived-meeting-bodies:${scope}`;
