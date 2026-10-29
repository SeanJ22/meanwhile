import { readPassCursor, writePassCursor } from "../facts/db.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { vaultCapture } from "../facts/capture.ts";
import { publishMeetingPinFact } from "../facts/meeting-facts.ts";
import { readMeetingFacts, withSittingFacts } from "../facts/meeting-read.ts";
import type { Clocks, FactDb, Query } from "../facts/publish.ts";
import { repeatsPublishedVenue } from "../geo/address-query.ts";
import { placePublishedMeetingPins, publishedPinOffices } from "../meetings/publish-pins.ts";
import type { Meeting } from "../sources/types.ts";
import { runBoundedWorkPool } from "../ops/bounded-work-pool.ts";
import type { MeetingPinAddress } from "../meetings/pin-location.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import { openMissingPinBlanks } from "../meetings/pin-blanks.ts";
import { publishHeldOfficeFacts } from "../meetings/office-facts.ts";
import { readOfficeContexts,withMunicipalHallOffices } from "../meetings/municipal-office.ts";
import { meetingStateOf } from "../meetings/body-scope.ts";

/** A sitting with no attendance location, whose pin is missing, awaiting replacement, or withdrawn, and not yet live. */
const heldSitting = (p: string) => `${p}.record_class='MEETING' AND ${p}.body_id IS NOT NULL
    AND coalesce(${p}.value->'location','null'::jsonb)='null'::jsonb
    AND (coalesce(${p}.value->'mapPin','null'::jsonb)='null'::jsonb OR ${p}.value->'mapPin' ? 'pendingReplacement'
      OR reader_payload_node(${p}.value->'mapPin')->>'basis'='GOVERNMENT_OFFICE' AND EXISTS (SELECT 1 FROM fact retired WHERE retired.entity_id='meeting:'||${p}.row_id
        AND retired.field='map_pin' AND retired.status='pulled' AND retired.held_reason='GOVERNMENT_OFFICE_OWNER_CHANGED'
        AND retired.value->>'bodyId'=${p}.body_id AND retired.value->>'address'=reader_payload_node(${p}.value->'mapPin')->>'address'
        AND retired.value#>>'{provenance,sourceUrl}'=reader_payload_value(reader_payload_node(${p}.value->'mapPin')->'provenance')->>'sourceUrl'))
    AND NOT EXISTS(SELECT 1 FROM fact f WHERE f.entity_id='meeting:'||${p}.row_id AND f.field='map_pin' AND f.status='live' AND NOT f.value ? 'pendingReplacement'
      AND f.value->>'bodyId'=${p}.body_id AND f.value->>'publishedLocation' IS NOT DISTINCT FROM ${p}.value#>>'{venueGap,publishedText}')`;
/** Retry keys are `[promotion_key,row_id]`, read through the (promotion_key, collection, row_id) index. */
const keyedRetries = (keys: string) => `unnest(${keys}::text[]) retry(key) JOIN civic_data_rows p ON p.promotion_key=retry.key::jsonb->>0 AND p.collection='meetings' AND p.row_id=retry.key::jsonb->>1`;

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

/** Meeting rows one statement reads, in primary-key order; a pass walks on window by window. */
export const HELD_PIN_WINDOW = 256;
/** A window plus unfinished retries. A pin's fingerprint is its row hash and its body's inputs (owner, agenda and registry rows,
 * sibling sittings, matching governments, office addresses), read once per body in the window; unlike watermarks it sees late commits. */
export const HELD_PIN_ROWS_SQL = `WITH scan AS MATERIALIZED (
  (SELECT p.promotion_key,p.ordinal,true AS advances FROM civic_data_rows p WHERE (p.promotion_key,p.collection,p.ordinal)>($2::text,'meetings',$3::bigint) AND p.promotion_key<'MEETING;' AND p.collection='meetings'
    ORDER BY p.promotion_key,p.collection,p.ordinal LIMIT ${HELD_PIN_WINDOW})
  UNION ALL SELECT p.promotion_key,p.ordinal,false FROM ${keyedRetries("$4")}
), edge AS (SELECT promotion_key,ordinal FROM scan WHERE advances ORDER BY promotion_key DESC,ordinal DESC LIMIT 1
), held AS MATERIALIZED (
  SELECT DISTINCT ON (p.promotion_key,p.ordinal) p.promotion_key,p.ordinal,p.version_id,p.row_id,p.body_id,p.state,p.content_hash,p.promoted_at,p.value,
    scan.advances,jsonb_build_array(p.promotion_key,p.row_id)::text AS retry_key,'held-meeting-pins:row:'||md5(jsonb_build_array(p.promotion_key,p.row_id)::text) AS marker_name
  FROM scan JOIN civic_data_rows p ON p.promotion_key=scan.promotion_key AND p.collection='meetings' AND p.ordinal=scan.ordinal
  WHERE ${heldSitting("p")} ORDER BY p.promotion_key,p.ordinal,scan.advances DESC
), siblings AS MATERIALIZED (
  SELECT g.government,(SELECT md5(string_agg(concat_ws(' ',changed.promotion_key,changed.row_id,changed.content_hash),'|' ORDER BY changed.promotion_key,changed.ordinal))
    FROM civic_data_rows changed WHERE changed.collection='meetings' AND split_part(changed.body_id,'#',1)=g.government) AS rows
  FROM (SELECT DISTINCT split_part(body_id,'#',1) AS government FROM held) g
), signature AS MATERIALIZED (
  SELECT b.body_id,b.state,jsonb_build_array(jsonb_build_array(e.parent_id,owner.kind,owner.name),sibling.rows,
    coalesce((SELECT jsonb_agg(jsonb_build_array(changed.promotion_key,changed.collection,changed.row_id,changed.content_hash)
      ORDER BY changed.promotion_key,changed.collection,changed.ordinal) FROM civic_data_rows changed
      WHERE changed.body_id=b.body_id AND changed.collection IN ('agendaDocuments','registry.bodies')
        OR changed.collection='governments' AND changed.state=b.state AND changed.aliases && ARRAY[e.id,CASE WHEN owner.kind='government' THEN owner.id END,
          e.parent_id||'#governing',e.parent_id||'#board',CASE WHEN e.id NOT LIKE 'ocd-division/%' THEN split_part(e.id,'#',1) END]),'[]'::jsonb),
    coalesce((SELECT jsonb_agg(jsonb_build_array(f.entity_id,f.value,f.checked_at) ORDER BY f.entity_id,f.id)
      FROM fact f WHERE f.entity_id IN(b.body_id,e.parent_id) AND f.field='office_address' AND f.status='live'),'[]'::jsonb)) AS inputs
  FROM (SELECT DISTINCT body_id,state FROM held) b LEFT JOIN entity e ON e.id=b.body_id LEFT JOIN entity owner ON owner.id=e.parent_id
    JOIN siblings sibling ON sibling.government=split_part(b.body_id,'#',1)
)
SELECT edge.promotion_key AS edge_key,edge.ordinal AS edge_ordinal,owed.* FROM (SELECT) one LEFT JOIN edge ON true
  LEFT JOIN LATERAL (SELECT h.promotion_key AS key,h.version_id AS current_version_id,h.ordinal AS ordinal_index,
    reader_payload_value(h.value) AS value,h.retry_key,h.advances,h.marker_name,f.input_hash
    FROM held h JOIN signature s ON s.body_id=h.body_id AND s.state IS NOT DISTINCT FROM h.state LEFT JOIN pass_cursor marker ON marker.name=h.marker_name,
      LATERAL (SELECT encode(sha256(convert_to(jsonb_build_array('HELD_PIN_INPUTS_V4',h.content_hash,s.inputs)::text,'UTF8')),'hex') AS input_hash) f
    WHERE (marker.position IS DISTINCT FROM f.input_hash OR h.retry_key=ANY($5::text[])
        OR EXISTS(SELECT 1 FROM blank b WHERE b.entity_id='meeting:'||h.row_id AND b.field='map_pin' AND b.next_try_at<=$1::timestamptz))
      AND NOT EXISTS(SELECT 1 FROM blank b WHERE b.entity_id='meeting:'||h.row_id AND b.field='map_pin'
        AND b.next_try_at>$1::timestamptz AND b.updated_at>=h.promoted_at AND marker.position=f.input_hash)
    ORDER BY h.promotion_key,h.ordinal LIMIT 32) owed ON true WHERE edge.promotion_key IS NOT NULL OR owed.key IS NOT NULL`;

const PIN_CURSOR = "held-meeting-pins:window";
interface PinProgress { readonly after: readonly [string, number]; readonly pending: readonly string[] }
const firstPosition = (): PinProgress["after"] => ["MEETING:",0];
function readPinProgress(saved: string | null): PinProgress {
  if (saved === null) return { after: firstPosition(), pending: [] };
  const value = JSON.parse(saved) as PinProgress;
  if (!value || !Array.isArray(value.after) || value.after.length!==2 || typeof value.after[0]!=="string" || !Number.isSafeInteger(value.after[1])
    || !Array.isArray(value.pending) || !value.pending.every(key=>typeof key==="string")) throw Error("HELD_PIN_PROGRESS_INVALID");
  return value;
}

const byState=(ids: readonly string[]) => [...Map.groupBy(ids,meetingStateOf).values()];

/** Free field publication fills retained sittings of every age; calendar freshness is left at its original time. */
export async function publishHeldMeetingPins(input: {
  readonly facts: FactDb & { readonly query: Query }; readonly vault: EvidenceStore; readonly clocks: Clocks;
  readonly now: string; readonly deadlineMs: number; readonly fetchImpl?: typeof fetch; readonly clock?: () => number;
  readonly readCapture?: (url: string) => Promise<WorkerPublicationCapture | null>;
}): Promise<{ considered: number; published: number; unplaced: number; failures: readonly string[] }> {
  const {facts} = input, failures: string[] = [], now = input.clock ?? Date.now;
  await openMissingPinBlanks(facts,input.now,()=>now()<input.deadlineMs);
  const triedOffices = new Set<string>();
  // Office acquisition has its own standing blanks. A future pin retry cannot hold a newly found office back.
  const officePublication=(async()=>{while(now()<input.deadlineMs){
    const officeIds=(await facts.query(`SELECT e.id FROM blank b JOIN entity e ON e.id=b.entity_id
      WHERE b.field='office_address' AND e.kind IN ('body','government') AND b.next_try_at<=$1::timestamptz AND NOT e.id=ANY($2::text[])
      ORDER BY b.next_try_at,e.id LIMIT 32`,[input.now,[...triedOffices]])).map(row=>String(row.id));
    if(!officeIds.length)break;
    for(const group of byState(officeIds))for(let at=0;at<group.length&&now()<input.deadlineMs;at+=32){
      const ids=group.slice(at,at+32);
      for(const id of ids)triedOffices.add(id);
      try{
        let offices=await publishedPinOffices(facts.query,ids,detail=>failures.push(detail));
        offices=await withMunicipalHallOffices(facts.query,await readOfficeContexts(facts.query,ids),offices,detail=>failures.push(detail));
        const report=await publishHeldOfficeFacts({facts,vault:input.vault,clocks:input.clocks,now:input.now,clock:now,
          bodyIds:ids,offices,more:()=>now()<input.deadlineMs,readCapture:input.readCapture});
        failures.push(...report.failures);
      }catch(error){failures.push(`Office acquisition could not finish: ${error instanceof Error?error.message:String(error)}`);}
    }
  }})().catch(error=>{failures.push(`Office acquisition could not finish: ${error instanceof Error?error.message:String(error)}`);});
  let progress=readPinProgress(await readPassCursor(facts.query,PIN_CURSOR));
  const retryAtStart=new Set(progress.pending);
  const captures = new Map<string,WorkerPublicationCapture>();
  let previous: Meeting[] = [];
  let considered=0, published=0, unplaced=0;
  while (now()<input.deadlineMs) {
    const read = await facts.query(HELD_PIN_ROWS_SQL,[input.now,...progress.after,[...retryAtStart],progress.pending]);
    if (!read.length) {
      const pending=progress.pending.length ? (await facts.query(`SELECT retry.key AS retry_key FROM ${keyedRetries("$1")}
        WHERE ${heldSitting("p")}
          AND NOT EXISTS(SELECT 1 FROM blank b WHERE b.entity_id='meeting:'||p.row_id AND b.field='map_pin' AND b.next_try_at>$2::timestamptz)`,
      [progress.pending,input.now])).map(row=>String(row.retry_key)) : [];
      progress={after:firstPosition(),pending};
      await writePassCursor(facts.query,PIN_CURSOR,JSON.stringify(progress));
      break;
    }
    const rows=read.filter(row=>row.key!==null);
    const last=rows.length<32&&read[0]!.edge_key!==null?{key:read[0]!.edge_key,ordinal_index:read[0]!.edge_ordinal}:rows.filter(row=>row.advances).at(-1);
    const pending=new Set(progress.pending);
    for (const row of rows) {pending.add(String(row.retry_key));retryAtStart.delete(String(row.retry_key));}
    progress={...progress,after:last?[String(last.key),Number(last.ordinal_index)]:progress.after,pending:[...pending]};
    // Admission is durable before reading offices or opening Census. A crash keeps every unfinished row owed.
    await writePassCursor(facts.query,PIN_CURSOR,JSON.stringify(progress));if(!rows.length)continue;
    const meetings=rows.map(row=>row.value as Meeting);
    const bodyIds=[...new Set(meetings.flatMap(meeting=>meeting.bodyId??[]))];
    const officeFailures=new Set<string>(), registeredBodies=new Set<string>();
    const groups=byState(bodyIds);
    const officeReads=await runBoundedWorkPool(groups,8,async ids=>({ids,offices:await publishedPinOffices(facts.query,ids,detail=>{
      failures.push(detail);for(const id of ids)officeFailures.add(id);
    })}));
    const acquired=new Map<string,import("../meetings/pin-location.ts").MeetingPinBody>();
    for(const result of officeReads) {
      if(result.ok)for(const [id,office] of result.value.offices){acquired.set(id,office);registeredBodies.add(id);}
      else {failures.push(result.error);for(const id of groups[result.index]!)officeFailures.add(id);}
    }
    let offices=await withMunicipalHallOffices(facts.query,meetings,acquired,detail=>failures.push(detail));
    const discover=bodyIds.filter(id=>!triedOffices.has(id)||offices.get(id)?.governmentOfficeAlternatives?.length);
    if(discover.length){
      const officeReport=await publishHeldOfficeFacts({facts,vault:input.vault,clocks:input.clocks,now:input.now,clock:now,
        bodyIds:discover,offices,more:()=>now()<input.deadlineMs,readCapture:input.readCapture});
      failures.push(...officeReport.failures);
      for(const id of discover)triedOffices.add(id);
      if(officeReport.published||officeReport.confirmed)offices=await publishedPinOffices(facts.query,bodyIds,detail=>failures.push(detail));
    }
    const savedFacts=await readMeetingFacts(facts.query,meetings);
    const current=withSittingFacts(meetings,savedFacts)
      .filter(meeting=>!meeting.location&&(!meeting.mapPin||meeting.mapPin.pendingReplacement));
    const settled=new Set(rows.filter(row=>!current.some(meeting=>meeting.id===(row.value as Meeting).id)
      &&!officeFailures.has((row.value as Meeting).bodyId??"")).map(row=>String(row.retry_key)));
    const savedPrevious=meetings.flatMap(meeting=>{
      const fact=savedFacts.find(fact=>fact.meetingId===meeting.id&&fact.field==="mapPin"&&!fact.withdrawn);
      return fact?[{...meeting,mapPin:fact.value as Meeting["mapPin"]}]:[];
    });
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
    const census=await placePublishedMeetingPins({meetings:current,previous:[...previous,...savedPrevious],offices,retainedAddresses,query:facts.query,
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
      if(!meeting.mapPin&&officeFailures.has(meeting.bodyId??""))return;
      try {
        const outcome=await publishMeetingPinFact(facts,{meeting,capture,registered:registeredBodies.has(meeting.bodyId??""),geocodeAttempts:census.attempts.get(meeting.id)??[],
          producedBy:`held-meeting-pins:${row.current_version_id}`},
          input.clocks,new Date(now()));
        considered++;settled.add(String(row.retry_key));
        if("blank" in outcome){unplaced++;return;}
        if(outcome.decision==="PUBLISH"||outcome.decision==="CONFIRM")published++;
        else if(outcome.decision!=="KEEP_CURRENT")failures.push(`${meeting.id}: ${outcome.decision}`);
      } catch(error){failures.push(`${meeting.id}: ${error instanceof Error?error.message:String(error)}`);}
    });
    const completed=rows.filter(row=>settled.has(String(row.retry_key)));
    if(completed.length)await facts.query(`INSERT INTO pass_cursor(name,position) SELECT unnest($1::text[]),unnest($2::text[])
      ON CONFLICT(name) DO UPDATE SET position=excluded.position`,
      [completed.map(row=>String(row.marker_name)),completed.map(row=>String(row.input_hash))]);
    progress={...progress,pending:progress.pending.filter(key=>!settled.has(key))};
    await writePassCursor(facts.query,PIN_CURSOR,JSON.stringify(progress));
    // Keep only the admitted batch's checked points and their evidence, rather than a national meeting list.
    previous=census.meetings.filter(meeting=>meeting.mapPin).slice(-32);
    const keep=new Set(previous.flatMap(meeting=>meeting.mapPin?.coordinateSourceUrl??[]));
    for(const url of captures.keys())if(!keep.has(url))captures.delete(url);
  }
  await officePublication;
  return {considered,published,unplaced,failures};
}
