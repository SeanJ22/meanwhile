import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { vaultCapture } from "../facts/capture.ts";
import { publishMeetingPinFact } from "../facts/meeting-facts.ts";
import { readSittingFacts, withSittingFacts, type SittingFact } from "../facts/meeting-read.ts";
import type { Clocks, FactDb, Query } from "../facts/publish.ts";
import { isOfficeStreetAddress } from "../map/office-locator.ts";
import { censusAddressQuery } from "../geo/address-query.ts";
import { placePublishedMeetingPins, publishedPinOffices } from "../meetings/publish-pins.ts";
import type { Meeting } from "../sources/types.ts";
import { runBoundedWorkPool } from "../ops/bounded-work-pool.ts";
import { meetingStateOf } from "../meetings/body-scope.ts";
import type { MeetingPinBody } from "../meetings/pin-location.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";

const heldRows = `FROM civic_data_promotions p,
  LATERAL reader_payload_members(reader_payload_node(p.payload)->'meetings') m,
  LATERAL (SELECT reader_payload_node(m.item) AS value) sitting
  WHERE p.record_class='MEETING' AND sitting.value->>'bodyId' IS NOT NULL
    AND coalesce(sitting.value->'location','null'::jsonb)='null'::jsonb
    AND coalesce(sitting.value->'mapPin','null'::jsonb)='null'::jsonb
    AND (sitting.value->>'startsAt')::timestamptz BETWEEN $1::timestamptz-interval '90 days' AND $1::timestamptz+interval '90 days'`;

export const HELD_PIN_BODIES_SQL = `SELECT DISTINCT sitting.value->>'bodyId' AS body_id ${heldRows}`;

/** Only already-promoted sittings participate. Existing points and unchanged retry blanks stay out. */
export const HELD_PIN_ROWS_SQL = `SELECT p.key,p.current_version_id,m.ordinal_index,reader_payload_value(sitting.value) AS value,
  CASE WHEN jsonb_typeof(sitting.value->'online')='object' THEN 0 ELSE 1 END AS online_order
  ${heldRows}
    AND (sitting.value->>'bodyId'=ANY($2::text[]) OR sitting.value#>>'{venueGap,publishedText}' ~ '[0-9]')
    AND (CASE WHEN jsonb_typeof(sitting.value->'online')='object' THEN 0 ELSE 1 END,p.key,m.ordinal_index)>($3::int,$4::text,$5::int)
    AND NOT EXISTS(SELECT 1 FROM fact f WHERE f.entity_id='meeting:'||(sitting.value->>'id') AND f.field='map_pin' AND f.status='live'
      AND f.value->>'bodyId'=sitting.value->>'bodyId' AND f.value->>'publishedLocation' IS NOT DISTINCT FROM sitting.value#>>'{venueGap,publishedText}')
    AND NOT EXISTS(SELECT 1 FROM blank b WHERE b.entity_id='meeting:'||(sitting.value->>'id') AND b.field='map_pin'
      AND b.next_try_at>$1::timestamptz AND b.updated_at>=p.promoted_at
      AND b.updated_at>=coalesce((SELECT max(f.checked_at) FROM fact f JOIN entity e ON e.id=sitting.value->>'bodyId'
        WHERE f.entity_id IN(e.id,e.parent_id) AND f.field='office_address' AND f.status='live'),'-infinity'::timestamptz)
      AND b.updated_at>=coalesce((SELECT max(r.promoted_at) FROM civic_data_promotions r WHERE r.record_class='REGISTRATION'
        AND r.scope LIKE 'US-'||upper(substring(sitting.value->>'bodyId' FROM '/state:([a-z]{2})'))||'%'),'-infinity'::timestamptz))
  ORDER BY online_order,p.key,m.ordinal_index LIMIT 32`;

/** Free field publication also fills old and carried sittings; calendar freshness is left at its original time. */
export async function publishHeldMeetingPins(input: {
  readonly facts: FactDb & { readonly query: Query }; readonly vault: EvidenceStore; readonly clocks: Clocks;
  readonly now: string; readonly deadlineMs: number; readonly fetchImpl?: typeof fetch; readonly clock?: () => number;
}): Promise<{ considered: number; published: number; unplaced: number; failures: readonly string[] }> {
  const {facts} = input, failures: string[] = [], now = input.clock ?? Date.now;
  const bodyIds = (await facts.query(HELD_PIN_BODIES_SQL,[input.now])).map(row=>String(row.body_id));
  const byState = new Map<string,string[]>();
  for(const id of bodyIds){const state=meetingStateOf(id),ids=byState.get(state)??[];ids.push(id);byState.set(state,ids);}
  const offices = new Map<string,MeetingPinBody>(), officeFailures = new Set<string>();
  const officeReads = await runBoundedWorkPool([...byState.values()],8,async ids=>({ids,offices:await publishedPinOffices(facts.query,ids)}));
  for(const result of officeReads) {
    if(result.ok)for(const [id,office] of result.value.offices)offices.set(id,office);
    else {failures.push(result.error);for(const id of [...byState.values()][result.index]!)officeFailures.add(id);}
  }
  const eligibleBodies = [...offices].filter(([,body])=>[body.officeContact?.address,body.governmentOffice?.address]
    .some(address=>address && isOfficeStreetAddress(censusAddressQuery(address)))).map(([id])=>id);
  const captures = new Map<string,WorkerPublicationCapture>(), knownFacts = new Map<string,readonly SittingFact[]>();
  const placed: Meeting[] = [];
  let cursor: [number,string,number] = [-1,"",0], considered=0, published=0, unplaced=0;
  while (now()<input.deadlineMs) {
    const rows = await facts.query(HELD_PIN_ROWS_SQL,[input.now,eligibleBodies,...cursor]);
    if (!rows.length) break;
    const last=rows.at(-1)!;
    cursor=[Number(last.online_order),String(last.key),Number(last.ordinal_index)];
    const meetings=rows.map(row=>row.value as Meeting);
    const missing=[...new Set(meetings.flatMap(meeting=>meeting.bodyId && !knownFacts.has(meeting.bodyId)?[meeting.bodyId]:[]))];
    const read=await readSittingFacts(facts.query,missing);
    for(const id of missing)knownFacts.set(id,read.get(id)??[]);
    const current=withSittingFacts(meetings,[...new Set(meetings.flatMap(meeting=>meeting.bodyId??[]))].flatMap(id=>knownFacts.get(id)??[]))
      .filter(meeting=>!meeting.location&&!meeting.mapPin);
    const census=await placePublishedMeetingPins({meetings:current,previous:placed,offices,
      fetchImpl:input.fetchImpl,clock:()=>new Date(now()).toISOString()});
    failures.push(...census.held);
    for(const response of census.responses) {
      const saved=await vaultCapture({vault:input.vault,url:response.finalUrl,bytes:response.bytes,httpStatus:response.httpStatus,
        contentType:response.contentType,retrievedAt:response.retrievedAt});
      if("error" in saved)failures.push(`${response.finalUrl}: ${saved.error}`);
      else captures.set(response.finalUrl,saved.capture);
    }
    await runBoundedWorkPool(census.meetings,8,async meeting=>{
      if(now()>=input.deadlineMs)return;
      const row=rows.find(row=>(row.value as Meeting).id===meeting.id)!;
      const capture=meeting.mapPin?.coordinateSourceUrl?captures.get(meeting.mapPin.coordinateSourceUrl):undefined;
      if(meeting.mapPin&&!capture){failures.push(`The saved Census copy is unavailable for ${meeting.id}`);return;}
      if(!meeting.mapPin && meeting.bodyId && officeFailures.has(meeting.bodyId))return;
      try {
        const outcome=await publishMeetingPinFact(facts,{meeting,capture,producedBy:`held-meeting-pins:${row.current_version_id}`},
          input.clocks,new Date(now()));
        considered++;
        if("blank" in outcome){unplaced++;return;}
        if(outcome.decision==="PUBLISH"||outcome.decision==="CONFIRM"){published++;placed.push(meeting);}
        else failures.push(`${meeting.id}: ${outcome.decision}`);
      } catch(error){failures.push(`${meeting.id}: ${error instanceof Error?error.message:String(error)}`);}
    });
  }
  return {considered,published,unplaced,failures};
}
