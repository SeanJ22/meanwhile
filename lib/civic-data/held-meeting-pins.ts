import { readPassCursor, writePassCursor } from "../facts/db.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { vaultCapture } from "../facts/capture.ts";
import { publishMeetingPinFact } from "../facts/meeting-facts.ts";
import { readSittingFacts, withSittingFacts, type SittingFact } from "../facts/meeting-read.ts";
import type { Clocks, FactDb, Query } from "../facts/publish.ts";
import { isOfficeStreetAddress } from "../map/office-locator.ts";
import { censusAddressQuery, repeatsPublishedVenue } from "../geo/address-query.ts";
import { placePublishedMeetingPins, publishedPinOffices } from "../meetings/publish-pins.ts";
import type { Meeting } from "../sources/types.ts";
import { runBoundedWorkPool } from "../ops/bounded-work-pool.ts";
import { meetingStateOf } from "../meetings/body-scope.ts";
import type { MeetingPinAddress, MeetingPinBody } from "../meetings/pin-location.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";

const withdrawnPin = (value: string) => `(reader_payload_node(${value}->'mapPin')->>'basis'='GOVERNMENT_OFFICE' AND EXISTS (
    SELECT 1 FROM fact retired WHERE retired.entity_id='meeting:'||p.row_id AND retired.field='map_pin'
      AND retired.status='pulled' AND retired.held_reason='GOVERNMENT_OFFICE_OWNER_CHANGED'
      AND retired.value->>'bodyId'=p.body_id AND retired.value->>'address'=reader_payload_node(${value}->'mapPin')->>'address'
      AND retired.value#>>'{provenance,sourceUrl}'=reader_payload_value(reader_payload_node(${value}->'mapPin')->'provenance')->>'sourceUrl'))`;

const heldRows = `WHERE p.record_class='MEETING' AND p.collection='meetings' AND p.body_id IS NOT NULL
    AND coalesce(sitting.value->'location','null'::jsonb)='null'::jsonb
    AND (coalesce(sitting.value->'mapPin','null'::jsonb)='null'::jsonb OR ${withdrawnPin("sitting.value")})
    AND (sitting.value->>'startsAt')::timestamptz BETWEEN $1::timestamptz-interval '90 days' AND $1::timestamptz+interval '90 days'`;

/** Previously promoted points keep the address already verified for this exact source sitting. */
export const HELD_PIN_PRIOR_VENUES_SQL = `SELECT DISTINCT ON (sitting.value->>'id')
  reader_payload_value(sitting.value) AS value
  FROM civic_data_promotions p JOIN civic_data_candidates c ON c.scope=p.scope AND c.source_id=p.source_id
    AND c.record_class='MEETING' AND c.state='PROMOTED' AND c.id<>p.current_version_id,
  LATERAL reader_payload_members(reader_payload_node(c.candidate->'readModel')->'meetings') m,
  LATERAL (SELECT reader_payload_node(m.item) AS value) sitting
  WHERE p.key=ANY($1::text[]) AND sitting.value->>'id'=ANY($2::text[])
    AND jsonb_typeof(sitting.value->'location')='object'
  ORDER BY sitting.value->>'id',c.retrieved_at DESC,c.id`;

const dependencyScope = `(
  changed.body_id=p.body_id AND changed.collection IN ('agendaDocuments','registry.bodies')
  OR changed.collection='meetings' AND split_part(changed.body_id,'#',1)=split_part(p.body_id,'#',1)
  OR changed.collection='governments' AND changed.state=p.state AND EXISTS(
    SELECT 1 FROM entity e LEFT JOIN entity owner ON owner.id=e.parent_id AND owner.kind='government'
      WHERE e.id=p.body_id AND changed.aliases && ARRAY[e.id,owner.id,e.parent_id||'#governing',e.parent_id||'#board',
        CASE WHEN e.id NOT LIKE 'ocd-division/%' THEN split_part(e.id,'#',1) END])
)`;
const retryKey = `jsonb_build_array(p.promotion_key,p.row_id)::text`;
const markerName = `'held-meeting-pins:row:'||md5(${retryKey})`;
const position = `(CASE WHEN jsonb_typeof(sitting.value->'online')='object' THEN 0 ELSE 1 END,p.promotion_key,p.ordinal)`;
const afterPosition = `($2::int,$3::text,$4::bigint)`;
const pinInputHash = `encode(sha256(convert_to(jsonb_build_array('ENTITY_OWNERSHIP_V2',p.content_hash,
  (SELECT parent_id FROM entity WHERE id=p.body_id),
  coalesce((SELECT jsonb_agg(jsonb_build_array(changed.promotion_key,changed.collection,changed.row_id,changed.content_hash)
    ORDER BY changed.promotion_key,changed.collection,changed.ordinal) FROM civic_data_rows changed WHERE ${dependencyScope}),'[]'::jsonb),
  coalesce((SELECT jsonb_agg(jsonb_build_array(f.entity_id,f.value,f.checked_at) ORDER BY f.entity_id,f.id)
    FROM fact f JOIN entity e ON e.id=p.body_id WHERE f.entity_id IN(e.id,e.parent_id)
      AND f.field='office_address' AND f.status='live'),'[]'::jsonb)
)::text,'UTF8')),'hex')`;

/** Exact input hashes, rather than allocation-order watermarks, also observe source transactions which commit late. */
const HELD_PIN_ROWS_SQL = `SELECT p.promotion_key AS key,p.version_id AS current_version_id,p.ordinal AS ordinal_index,
  reader_payload_value(sitting.value) AS value,${retryKey} AS retry_key,${position}>${afterPosition} AS advances,
  ${markerName} AS marker_name,signature.input_hash,
  CASE WHEN jsonb_typeof(sitting.value->'online')='object' THEN 0 ELSE 1 END AS online_order
  FROM civic_data_rows p,LATERAL (SELECT p.value) sitting,
    LATERAL (SELECT ${pinInputHash} AS input_hash OFFSET 0) signature
  ${heldRows}
    AND (${position}>${afterPosition} OR ${retryKey}=ANY($6::text[]))
    AND ((SELECT position FROM pass_cursor WHERE name=${markerName}) IS DISTINCT FROM signature.input_hash
      OR ${retryKey}=ANY($5::text[])
      OR EXISTS(SELECT 1 FROM blank b WHERE b.entity_id='meeting:'||p.row_id AND b.field='map_pin' AND b.next_try_at<=$1::timestamptz))
    AND NOT EXISTS(SELECT 1 FROM fact f WHERE f.entity_id='meeting:'||p.row_id AND f.field='map_pin' AND f.status='live'
      AND f.value->>'bodyId'=p.body_id AND f.value->>'publishedLocation' IS NOT DISTINCT FROM sitting.value#>>'{venueGap,publishedText}')
    AND NOT EXISTS(SELECT 1 FROM blank b WHERE b.entity_id='meeting:'||p.row_id AND b.field='map_pin'
      AND b.next_try_at>$1::timestamptz AND b.updated_at>=p.promoted_at
      AND (SELECT position FROM pass_cursor WHERE name=${markerName})=signature.input_hash)
  ORDER BY online_order,p.promotion_key,p.ordinal LIMIT 32`;

const PIN_CURSOR = "held-meeting-pins";
type PinPosition = [number, string, number];
interface PinProgress {
  readonly after: PinPosition;
  readonly pending: readonly string[];
}
const firstPosition = (): PinPosition => [-1,"",0];
function readPinProgress(saved: string | null): PinProgress {
  if (saved === null) return { after: firstPosition(), pending: [] };
  const value = JSON.parse(saved) as PinProgress;
  if (!value || !Array.isArray(value.after) || value.after.length!==3
    || !Number.isInteger(value.after[0]) || typeof value.after[1]!=="string" || !Number.isSafeInteger(value.after[2])
    || !Array.isArray(value.pending) || !value.pending.every(key=>typeof key==="string")) throw Error("HELD_PIN_PROGRESS_INVALID");
  return value;
}

/** Free field publication also fills old and carried sittings; calendar freshness is left at its original time. */
export async function publishHeldMeetingPins(input: {
  readonly facts: FactDb & { readonly query: Query }; readonly vault: EvidenceStore; readonly clocks: Clocks;
  readonly now: string; readonly deadlineMs: number; readonly fetchImpl?: typeof fetch; readonly clock?: () => number;
}): Promise<{ considered: number; published: number; unplaced: number; failures: readonly string[] }> {
  const {facts} = input, failures: string[] = [], now = input.clock ?? Date.now;
  let progress=readPinProgress(await readPassCursor(facts.query,PIN_CURSOR));
  const retryAtStart=new Set(progress.pending);
  const offices = new Map<string,MeetingPinBody>(), officeFailures = new Set<string>();
  const captures = new Map<string,WorkerPublicationCapture>(), knownFacts = new Map<string,readonly SittingFact[]>();
  const placed: Meeting[] = [];
  let considered=0, published=0, unplaced=0;
  while (now()<input.deadlineMs) {
    const rows = await facts.query(HELD_PIN_ROWS_SQL,[input.now,...progress.after,progress.pending,[...retryAtStart]]);
    if (!rows.length) {
      const pending=progress.pending.length ? (await facts.query(`SELECT jsonb_build_array(p.promotion_key,p.row_id)::text AS retry_key
        FROM civic_data_rows p WHERE p.collection='meetings' AND jsonb_build_array(p.promotion_key,p.row_id)::text=ANY($1::text[])
          AND coalesce(p.value->'location','null'::jsonb)='null'::jsonb
          AND (coalesce(p.value->'mapPin','null'::jsonb)='null'::jsonb OR ${withdrawnPin("p.value")})
          AND NOT EXISTS(SELECT 1 FROM fact f WHERE f.entity_id='meeting:'||p.row_id AND f.field='map_pin' AND f.status='live'
            AND f.value->>'bodyId'=p.body_id AND f.value->>'publishedLocation' IS NOT DISTINCT FROM p.value#>>'{venueGap,publishedText}')
          AND NOT EXISTS(SELECT 1 FROM blank b WHERE b.entity_id='meeting:'||p.row_id AND b.field='map_pin' AND b.next_try_at>$2::timestamptz)`,
      [progress.pending,input.now])).map(row=>String(row.retry_key)) : [];
      progress={after:firstPosition(),pending};
      await writePassCursor(facts.query,PIN_CURSOR,JSON.stringify(progress));
      break;
    }
    const last=rows.filter(row=>row.advances).at(-1);
    const pending=new Set(progress.pending);
    for (const row of rows) {pending.add(String(row.retry_key));retryAtStart.delete(String(row.retry_key));}
    progress={...progress,after:last?[Number(last.online_order),String(last.key),Number(last.ordinal_index)]:progress.after,pending:[...pending]};
    // Admission is durable before reading offices or opening Census. A crash keeps every unfinished row owed.
    await writePassCursor(facts.query,PIN_CURSOR,JSON.stringify(progress));
    const meetings=rows.map(row=>row.value as Meeting);
    const withdrawn = new Set(meetings.filter(meeting=>meeting.mapPin?.basis==="GOVERNMENT_OFFICE").map(meeting=>meeting.id));
    const bodyIds=[...new Set(meetings.flatMap(meeting=>meeting.bodyId??[]))].filter(id=>!offices.has(id)&&!officeFailures.has(id));
    const byState=new Map<string,string[]>();
    for (const id of bodyIds) { const state=meetingStateOf(id),ids=byState.get(state)??[];ids.push(id);byState.set(state,ids); }
    const officeReads=await runBoundedWorkPool([...byState.values()],8,async ids=>({ids,offices:await publishedPinOffices(facts.query,ids,detail=>{
      failures.push(detail);for(const id of ids)officeFailures.add(id);
    })}));
    for(const result of officeReads) {
      if(result.ok)for(const [id,office] of result.value.offices)offices.set(id,office);
      else {failures.push(result.error);for(const id of [...byState.values()][result.index]!)officeFailures.add(id);}
    }
    const eligible = (meeting: Meeting) => {
      const id=meeting.bodyId??"",body=offices.get(id);
      return withdrawn.has(meeting.id) || Boolean(meeting.venueGap?.publishedText?.match(/[0-9]/)) || /^ocd-division\/country:us\/state:[a-z]{2}\/place:[^/#]+#/.test(id)
        || [body?.officeContact?.address,body?.governmentOffice?.address].some(address=>address&&isOfficeStreetAddress(censusAddressQuery(address)))
        || Boolean(body?.meetingAddresses?.length);
    };
    const missing=[...new Set(meetings.flatMap(meeting=>meeting.bodyId && !knownFacts.has(meeting.bodyId)?[meeting.bodyId]:[]))];
    const read=await readSittingFacts(facts.query,missing);
    for(const id of missing)knownFacts.set(id,read.get(id)??[]);
    for (const facts of knownFacts.values()) for (const fact of facts) if (fact.field==="mapPin" && fact.withdrawn) withdrawn.add(fact.meetingId);
    const settled=new Set(rows.filter(row=>!eligible(row.value as Meeting)&&!officeFailures.has((row.value as Meeting).bodyId??"")).map(row=>String(row.retry_key)));
    const current=withSittingFacts(meetings,[...new Set(meetings.flatMap(meeting=>meeting.bodyId??[]))].flatMap(id=>knownFacts.get(id)??[]))
      .filter(meeting=>!meeting.location&&!meeting.mapPin&&eligible(meeting));
    for (const row of rows) if (!current.some(meeting=>meeting.id===(row.value as Meeting).id)&&!officeFailures.has((row.value as Meeting).bodyId??"")) settled.add(String(row.retry_key));
    const retainedAddresses = new Map<string,MeetingPinAddress>();
    const stated = new Map(current.filter(meeting=>!meeting.online && meeting.venueGap?.publishedText).map(meeting=>[meeting.id,meeting]));
    if(stated.size) try {
      const prior = await facts.query(HELD_PIN_PRIOR_VENUES_SQL,[[...new Set(rows.map(row=>String(row.key)))],[...stated.keys()]]);
      for(const row of prior) {
        const old=row.value as Meeting,meeting=stated.get(old.id);
        if(meeting && old.location?.address && Number.isFinite(old.location.lat) && Number.isFinite(old.location.lng) &&
          meeting.bodyId===old.bodyId && meeting.ocdId===old.ocdId && meeting.provenance.sourceUrl===old.provenance.sourceUrl &&
          repeatsPublishedVenue(meeting.venueGap!.publishedText!,old.location.name,old.location.address))
          retainedAddresses.set(meeting.id,{meetingId:meeting.id,bodyId:meeting.bodyId,name:old.location.name,
            address:old.location.address,basis:"MEETING",provenance:old.fieldSources?.location??old.provenance});
      }
    } catch(error) { failures.push(`Earlier meeting addresses could not be read: ${error instanceof Error?error.message:String(error)}`); }
    const census=await placePublishedMeetingPins({meetings:current,previous:placed,offices,retainedAddresses,query:facts.query,
      fetchImpl:input.fetchImpl,clock:()=>new Date(now()).toISOString()});
    failures.push(...census.held);
    for(const response of census.responses) {
      const saved=await vaultCapture({vault:input.vault,url:response.finalUrl,bytes:response.bytes,httpStatus:response.httpStatus,
        contentType:response.contentType,retrievedAt:response.retrievedAt});
      if("error" in saved)failures.push(`${response.finalUrl}: ${saved.error}`);
      else captures.set(response.finalUrl,saved.capture);
    }
    // Finish the admitted batch so a checked Census result is saved before another pass.
    await runBoundedWorkPool(census.meetings,8,async meeting=>{
      const row=rows.find(row=>(row.value as Meeting).id===meeting.id)!;
      const capture=meeting.mapPin?.coordinateSourceUrl?captures.get(meeting.mapPin.coordinateSourceUrl):undefined;
      if(meeting.mapPin&&!capture){failures.push(`The saved Census copy is unavailable for ${meeting.id}`);return;}
      if(!meeting.mapPin && meeting.bodyId && officeFailures.has(meeting.bodyId))return;
      try {
        const outcome=await publishMeetingPinFact(facts,{meeting,capture,producedBy:`held-meeting-pins:${row.current_version_id}`},
          input.clocks,new Date(now()));
        considered++;settled.add(String(row.retry_key));
        if("blank" in outcome){unplaced++;return;}
        if(outcome.decision==="PUBLISH"||outcome.decision==="CONFIRM"){published++;placed.push(meeting);}
        else if(outcome.decision!=="KEEP_CURRENT")failures.push(`${meeting.id}: ${outcome.decision}`);
      } catch(error){failures.push(`${meeting.id}: ${error instanceof Error?error.message:String(error)}`);}
    });
    const completed=rows.filter(row=>settled.has(String(row.retry_key)));
    if(completed.length)await facts.query(`INSERT INTO pass_cursor(name,position) SELECT unnest($1::text[]),unnest($2::text[])
      ON CONFLICT(name) DO UPDATE SET position=excluded.position`,
      [completed.map(row=>String(row.marker_name)),completed.map(row=>String(row.input_hash))]);
    progress={...progress,pending:progress.pending.filter(key=>!settled.has(key))};
    await writePassCursor(facts.query,PIN_CURSOR,JSON.stringify(progress));
  }
  return {considered,published,unplaced,failures};
}
