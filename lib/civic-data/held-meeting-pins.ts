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

const heldRows = `FROM civic_data_promotions p,
  LATERAL reader_payload_members(reader_payload_node(p.payload)->'meetings') m,
  LATERAL (SELECT reader_payload_node(m.item) AS value) sitting
  WHERE p.record_class='MEETING' AND sitting.value->>'bodyId' IS NOT NULL
    AND coalesce(sitting.value->'location','null'::jsonb)='null'::jsonb
    AND (coalesce(sitting.value->'mapPin','null'::jsonb)='null'::jsonb OR sitting.value->'mapPin' ? 'pendingReplacement')`;

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

/** Only already-promoted sittings participate. Existing points and unchanged retry blanks stay out. */
export const HELD_PIN_ROWS_SQL = `SELECT p.key,p.current_version_id,m.ordinal_index,reader_payload_value(sitting.value) AS value,
  CASE WHEN jsonb_typeof(sitting.value->'online')='object' THEN 0 ELSE 1 END AS online_order
  ${heldRows}
    AND ($5::text[] IS NULL OR sitting.value->>'bodyId'=ANY($5::text[]))
    AND (CASE WHEN jsonb_typeof(sitting.value->'online')='object' THEN 0 ELSE 1 END,p.key,m.ordinal_index)>($2::int,$3::text,$4::int)
    AND NOT EXISTS(SELECT 1 FROM checked_fact f WHERE f.entity_id='meeting:'||(sitting.value->>'id') AND f.field='map_pin' AND f.status='live'
      AND NOT f.value ? 'pendingReplacement'
      AND f.value->>'bodyId'=sitting.value->>'bodyId' AND f.value->>'publishedLocation' IS NOT DISTINCT FROM sitting.value#>>'{venueGap,publishedText}')
    AND NOT EXISTS(SELECT 1 FROM blank b WHERE b.entity_id='meeting:'||(sitting.value->>'id') AND b.field='map_pin'
      AND b.next_try_at>$1::timestamptz AND b.updated_at>=p.promoted_at
      AND b.updated_at>=coalesce((SELECT max(f.checked_at) FROM checked_fact f JOIN entity e ON e.id=sitting.value->>'bodyId'
        WHERE f.entity_id IN(e.id,e.parent_id) AND f.field='office_address' AND f.status='live'),'-infinity'::timestamptz)
      AND b.updated_at>=coalesce((SELECT max(r.promoted_at) FROM civic_data_promotions r WHERE r.record_class='REGISTRATION'
        AND r.scope LIKE 'US-'||upper(substring(sitting.value->>'bodyId' FROM '/state:([a-z]{2})'))||'%'),'-infinity'::timestamptz))
  ORDER BY online_order,p.key,m.ordinal_index LIMIT 32`;

/** Free field publication fills retained sittings of every age; calendar freshness is left at its original time. */
export async function publishHeldMeetingPins(input: {
  readonly facts: FactDb & { readonly query: Query }; readonly vault: EvidenceStore; readonly clocks: Clocks;
  readonly now: string; readonly deadlineMs: number; readonly fetchImpl?: typeof fetch; readonly clock?: () => number;
  readonly readCapture?: (url: string) => Promise<WorkerPublicationCapture | null>;
  readonly bodyIds?: readonly string[];
}): Promise<{ considered: number; published: number; unplaced: number; failures: readonly string[] }> {
  const {facts} = input, failures: string[] = [], now = input.clock ?? Date.now;
  await openMissingPinBlanks(facts,input.now,()=>now()<input.deadlineMs);
  const triedOffices = new Set<string>();
  // Office acquisition has its own standing blanks. A future pin retry cannot hold a newly found office back.
  const officePublication=(async()=>{while(now()<input.deadlineMs){
    const officeIds=input.bodyIds??(await facts.query(`SELECT e.id FROM blank b JOIN entity e ON e.id=b.entity_id
      WHERE b.field='office_address' AND e.kind IN ('body','government') AND b.next_try_at<=$1::timestamptz AND NOT e.id=ANY($2::text[])
      ORDER BY b.next_try_at,e.id LIMIT 32`,[input.now,[...triedOffices]])).map(row=>String(row.id));
    if(!officeIds.length)break;
    const groups=new Map<string,string[]>();
    for(const id of officeIds){const state=meetingStateOf(id),ids=groups.get(state)??[];ids.push(id);groups.set(state,ids);}
    for(const group of groups.values())for(let at=0;at<group.length&&now()<input.deadlineMs;at+=32){
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
    if(input.bodyIds)break;
  }})().catch(error=>{failures.push(`Office acquisition could not finish: ${error instanceof Error?error.message:String(error)}`);});
  let previous: Meeting[] = [];
  const captures = new Map<string,WorkerPublicationCapture>();
  let cursor: [number,string,number] = [-1,"",0], considered=0, published=0, unplaced=0;
  while (now()<input.deadlineMs) {
    const rows = await facts.query(HELD_PIN_ROWS_SQL,[input.now,...cursor,input.bodyIds??null]);
    if (!rows.length) break;
    const last=rows.at(-1)!;
    cursor=[Number(last.online_order),String(last.key),Number(last.ordinal_index)];
    const meetings=rows.map(row=>row.value as Meeting);
    const bodyIds=[...new Set(meetings.flatMap(meeting=>meeting.bodyId??[]))];
    let offices:ReadonlyMap<string,import("../meetings/pin-location.ts").MeetingPinBody>=new Map();
    try{offices=await publishedPinOffices(facts.query,bodyIds,detail=>failures.push(detail));}
    catch(error){failures.push(`Office addresses could not be read: ${error instanceof Error?error.message:String(error)}`);}
    const registeredBodies=new Set(offices.keys());
    offices=await withMunicipalHallOffices(facts.query,meetings,offices,detail=>failures.push(detail));
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
    const savedPrevious=meetings.flatMap(meeting=>{
      const fact=savedFacts.find(fact=>fact.meetingId===meeting.id&&fact.field==="mapPin");
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
      try {
        const outcome=await publishMeetingPinFact(facts,{meeting,capture,registered:registeredBodies.has(meeting.bodyId??""),geocodeAttempts:census.attempts.get(meeting.id)??[],
          producedBy:`held-meeting-pins:${row.current_version_id}`},
          input.clocks,new Date(now()));
        considered++;
        if("blank" in outcome){unplaced++;return;}
        if(outcome.decision==="PUBLISH"||outcome.decision==="CONFIRM")published++;
        else if(outcome.decision!=="KEEP_CURRENT")failures.push(`${meeting.id}: ${outcome.decision}`);
      } catch(error){failures.push(`${meeting.id}: ${error instanceof Error?error.message:String(error)}`);}
    });
    // Keep only the admitted batch's checked points and their evidence, rather than a national meeting list.
    previous=census.meetings.filter(meeting=>meeting.mapPin).slice(-32);
    const keep=new Set(previous.flatMap(meeting=>meeting.mapPin?.coordinateSourceUrl??[]));
    for(const url of captures.keys())if(!keep.has(url))captures.delete(url);
  }
  await officePublication;
  return {considered,published,unplaced,failures};
}
