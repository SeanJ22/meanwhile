import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { Meeting } from "../sources/types.ts";
import { captureProvenance } from "./capture.ts";
import { boundedIndexOf, exactLine, lineOf, normalizeText, type CheckEntity, type SavedCopy } from "./check.ts";
import { retireAbsent, savedCopyFreshnessRefusal } from "../core/door.ts";
import { ensureEntity, learnDoorChannel } from "./entities.ts";
import { meetingEntityId } from "./meeting-read.ts";
import { readCheckEntity } from "./entity-read.ts";
import { openBlank, publishClaim, type Clocks, type FactDb, type PublishOutcome, type Query } from "./publish.ts";
import { saveCaptureCopy } from "./source-copy.ts";
import type { PinGeocodeAttempt } from "../meetings/publish-pins.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function localParts(startsAt: string, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(startsAt)).map(part => [part.type, part.value]));
  const [y, m, d, h, mi] = [parts.year!, Number(parts.month), Number(parts.day), Number(parts.hour), parts.minute!];
  const pad = (n: number) => String(n).padStart(2, "0");
  return { y, m, d, h, mi, mm: pad(m), dd: pad(d), hh: pad(h), h12: h % 12 || 12, pm: h >= 12 };
}

/** Where the page states this sitting's date (and, when it gives one, its start time), in the publisher's own writing. */
export function sittingOnPage(text: string, meeting: Pick<Meeting, "startsAt" | "startsAtOnPage" | "timeZone" | "startPrecision">): { readonly valueText: string; readonly quote: string } | null {
  const page = normalizeText(text);
  const p = localParts(meeting.startsAt, meeting.timeZone);
  const month = MONTHS[p.m - 1]!;
  const day = meeting.startPrecision === "DAY";
  if (meeting.startsAtOnPage && boundedIndexOf(page, meeting.startsAtOnPage) !== -1) return { valueText: meeting.startsAtOnPage, quote: meeting.startsAtOnPage };
  const utc = new Date(meeting.startsAt).toISOString();
  const together = day ? [] : [utc,utc.replace(/\.000Z$/,"Z"),utc.replace(/[-:]/g,"").replace(/\.000Z$/,"Z")];
  for (const token of together) if (boundedIndexOf(page,token)!==-1) return { valueText: token, quote: token };
  if (!day) for (const token of [`${p.y}${p.mm}${p.dd}T${p.hh}${p.mi}00`,`${p.y}-${p.mm}-${p.dd}T${p.hh}:${p.mi}`]) {
    for(let at=page.indexOf(token);at!==-1;at=page.indexOf(token,at+1)) {
      // A Z or numeric offset states an instant, not the body's local clock.
      if (/^(?::?\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})\b/.test(page.slice(at+token.length))) continue;
      return {valueText:token,quote:token};
    }
  }
  if (!day) for (const match of page.matchAll(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})\b/g)) {
    if (Date.parse(match[0])===Date.parse(meeting.startsAt)) return {valueText:match[0],quote:match[0]};
  }
  const dates = [`${p.y}-${p.mm}-${p.dd}T00:00:00`, `${p.y}-${p.mm}-${p.dd}`, `${p.y}${p.mm}${p.dd}`, `${p.m}/${p.d}/${p.y}`, `${p.mm}/${p.dd}/${p.y}`,
    `${month} ${p.d}, ${p.y}`, `${month.slice(0, 3)} ${p.d}, ${p.y}`, `${month.slice(0, 3)}. ${p.d}, ${p.y}`, `${p.d} ${month} ${p.y}`];
  const suffixes = p.pm ? ["PM", "pm", "p.m.", "P.M."] : ["AM", "am", "a.m.", "A.M."];
  const times = [...suffixes.flatMap(s => [`${p.h12}:${p.mi} ${s}`, `${p.h12}:${p.mi}${s}`, ...(p.mi === "00" ? [`${p.h12} ${s}`, `${p.h12}${s}`] : [])]), `${p.hh}:${p.mi}`];
  // The last place a page states it is the readable one: a JSON or calendar copy ends with its values written out.
  for (const date of dates) {
    for (let at = page.lastIndexOf(date); at !== -1; at = at ? page.lastIndexOf(date, at - 1) : -1) {
      if (day) return { valueText: date, quote: date };
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})\b/.test(page.slice(at))) continue;
      const window = page.slice(at, at + date.length + 200);
      const time = times.map(t => ({ t, i: window.indexOf(t, date.length) })).filter(row => row.i !== -1).sort((a, b) => a.i - b.i)[0];
      if (time) {
        const quote=window.slice(0,time.i+time.t.length);
        return {valueText:quote,quote};
      }
    }
  }
  return null;
}

const CANCELED_WORD = /\bcancell?ed\b|\bcancell?ation\b/i;

/** Where the page says this sitting is canceled: the publisher's own word beside the sitting's title, with the line that shows it. */
export function canceledOnPage(text: string, meeting: Pick<Meeting, "title">): { readonly valueText: string; readonly quote: string } | null {
  const page = normalizeText(text), title = normalizeText(meeting.title);
  if (!title) return null;
  for (let at = page.indexOf(title); at !== -1; at = page.indexOf(title, at + 1)) {
    const from = Math.max(0, at - 300), window = page.slice(from, at + title.length + 300), found = CANCELED_WORD.exec(window);
    if (found) {
      const start = from + found.index, quote = page.slice(Math.max(0, Math.min(start, at) - 40), Math.max(start + found[0].length, at + title.length) + 40);
      return { valueText: found[0], quote };
    }
  }
  return null;
}

export interface MeetingFactsReport { readonly live: number; readonly confirmed: number; readonly held: number; readonly blanks: number }

type MeetingFactDb = FactDb & { readonly query: Query };

async function keepJoinLinkWork(query:Query,meeting:Meeting,clocks:Clocks):Promise<void>{
  if(!meeting.online||meeting.online.joinUrl)return;
  await query(`INSERT INTO blank(entity_id,field,stage,reason,detail,next_try_at,attempts)
    VALUES($1,'online_access','ACQUIRE','ONLINE_JOIN_LINK_MISSING',$2,now()+make_interval(mins=>$3::int),0)
    ON CONFLICT(entity_id,field) DO NOTHING`,[meetingEntityId(meeting.id),meeting.online.label,clocks.retryMinutes("meeting")]);
}

async function meetingFactEntity(db: MeetingFactDb, meeting: Meeting, sourceUrl: string): Promise<CheckEntity> {
  const id = meetingEntityId(meeting.id);
  let state = /\/(?:state|district|territory):([a-z]{2})/.exec(meeting.ocdId ?? meeting.bodyId ?? "")?.[1]?.toUpperCase() ?? null;
  let owner = meeting.bodyId ?? meeting.ocdId;
  if (owner) {
    owner = await ensureEntity(db.query, { id: owner, kind: meeting.bodyId ? "body" : "place", name: meeting.bodyName, state, parentId: meeting.bodyId ? meeting.ocdId : null });
    if (owner !== (meeting.bodyId ?? meeting.ocdId)) state = (await db.query("SELECT state FROM entity WHERE id = $1", [owner]))[0]?.state as string | null;
    if(sourceUrl)await learnDoorChannel(db.query, owner, sourceUrl);
  }
  await ensureEntity(db.query, { id, kind: "meeting", name: meeting.bodyName, state, parentId: owner ?? null });
  return (await readCheckEntity(db.query, id))!;
}

/** A verified point's saved Census response, known by the line its first fact quoted from it. */
interface HeldPoint { readonly copy: SavedCopy; readonly quote: string }

async function publishPinClaim(db: MeetingFactDb, entity: CheckEntity, input: {
  readonly meeting: Meeting; readonly capture?: WorkerPublicationCapture; readonly held?: HeldPoint; readonly producedBy: string;
}, clocks: Clocks, now: Date): Promise<PublishOutcome> {
  const pin = input.meeting.mapPin!;
  const copy = input.held?.copy ?? await db.transaction(query => saveCaptureCopy(query, input.capture!));
  // A saved geocoder response quotes its matchedAddress line; a reused one is the line its first fact quoted.
  const line = input.held?.quote ?? exactLine(copy.text, "matchedAddress", pin.matchedAddress!);
  for(let attempt=0;;attempt++)try{
    return await publishClaim(db, {entity, field:"map_pin", fieldKind:"contact", provenance:"OFFICIAL", value:pin,
      valueText:pin.matchedAddress!, quote:line ?? pin.matchedAddress!, copy, producedBy:input.producedBy, acquisition:"checked", costUsd:0}, clocks, now);
  }catch(error){
    const conflict=error as {code?:string;constraint?:string}|null;
    // Re-read after a rolled-back deadlock or competing first publication, using the same saved Census copy.
    const retryable=conflict?.code==="40P01"||(conflict?.code==="23505"&&conflict.constraint==="fact_one_live");
    if(!retryable||attempt>=2)throw error;
  }
}

/** An already-published sitting can gain its checked point independently of another calendar read. */
export async function publishMeetingPinFact(db: MeetingFactDb, input: {
  readonly meeting: Meeting; readonly capture?: WorkerPublicationCapture; readonly producedBy: string;
  readonly geocodeAttempts?: readonly PinGeocodeAttempt[];
  readonly registered?: boolean;
  /** Asks Census the saved point's own request again when its saved response is older than a fact may be published from. */
  readonly refreshPoint?: (url: string) => Promise<WorkerPublicationCapture | null>;
}, clocks: Clocks, now: Date): Promise<PublishOutcome> {
  // The pin claim cites its saved Census copy; it does not register the old calendar as a new source door.
  const pin=input.meeting.mapPin;
  const entity = input.registered&&!pin?null:await meetingFactEntity(db, input.meeting, "");
  const entityId=entity?.id??meetingEntityId(input.meeting.id);
  await keepJoinLinkWork(db.query,input.meeting,clocks);
  let published: PublishOutcome | undefined;
  if(pin?.matchedAddress){
    if(input.capture)published=await publishPinClaim(db,entity!,input,clocks,now);
    else {
      // The saved response of an already verified point for this exact address is the copy, quoted by the line its first fact used.
      const [held]=await db.query(`SELECT s.id,s.final_url,s.fetched_at,f.quote FROM source_copy s JOIN fact f ON f.source_copy_id=s.id
        WHERE s.url=$1 AND f.field='map_pin' AND f.status='live'
          AND f.value->>'coordinateSourceUrl'=$1 AND f.value->>'matchedAddress'=$2
          AND (f.value->>'lat')::double precision=$3 AND (f.value->>'lng')::double precision=$4 ORDER BY s.fetched_at DESC LIMIT 1`,
        [pin.coordinateSourceUrl,pin.matchedAddress,pin.lat,pin.lng]);
      if(held){
        const fetchedAt=new Date(held.fetched_at as string);
        const stale=savedCopyFreshnessRefusal(fetchedAt,clocks.windowHours("contact"),now);
        const fresh=stale&&input.refreshPoint?await input.refreshPoint(pin.coordinateSourceUrl!):null;
        if(fresh)published=await publishPinClaim(db,entity!,{...input,capture:fresh},clocks,now);
        else if(!stale)published=await publishPinClaim(db,entity!,{...input,held:{quote:String(held.quote),
          copy:{id:Number(held.id),finalUrl:String(held.final_url),fetchedAt,text:String(held.quote),isArchive:false}}},clocks,now);
      }
    }
    if(published&&!pin.pendingReplacement)return published;
  }
  const attempts=input.geocodeAttempts;
  const transient=attempts?.filter(attempt=>attempt.outcome==="TRANSIENT");
  const reason=pin&&!pin.pendingReplacement?"PIN_EVIDENCE_UNAVAILABLE"
    :transient?.some(attempt=>attempt.httpStatus===429)?"GEOCODER_RATE_LIMITED"
    :transient?.length?"GEOCODER_RETRY_LATER"
    :attempts?.some(attempt=>attempt.outcome==="NO_MATCH")?"GEOCODER_NO_MATCH"
    :input.meeting.venueGap?.publishedText?"MEETING_ADDRESS_NOT_PLACED"
    :input.meeting.online?"ONLINE_OFFICE_ADDRESS_MISSING":"BODY_OFFICE_ADDRESS_MISSING";
  const retryMinutes=Math.max(clocks.retryMinutes("meeting"),...transient?.map(attempt=>
    attempt.retryAt?Math.max(0,Math.ceil((Date.parse(attempt.retryAt)-now.getTime())/60000)):0)??[]);
  // Calendar refreshes can omit geocoder diagnostics; preserve the attempts the pin worker learned.
  await db.query(`INSERT INTO blank(entity_id,field,stage,reason,detail,next_try_at,attempts)
    VALUES($1,'map_pin','ACQUIRE',$2,$3,now()+make_interval(mins=>$4::int),1)
    ON CONFLICT(entity_id,field) DO UPDATE SET reason=EXCLUDED.reason,stage='ACQUIRE',
      detail=CASE WHEN $5 THEN EXCLUDED.detail
        ELSE (coalesce(CASE WHEN left(blank.detail,1)='{' THEN blank.detail::jsonb END,'{}'::jsonb)||EXCLUDED.detail::jsonb)::text END,
      next_try_at=CASE WHEN $5 THEN EXCLUDED.next_try_at ELSE least(blank.next_try_at,EXCLUDED.next_try_at) END,
      attempts=blank.attempts+CASE WHEN $5 THEN 1 ELSE 0 END,updated_at=now()
    WHERE blank.reason IS DISTINCT FROM EXCLUDED.reason OR blank.stage<>'ACQUIRE'
      OR blank.detail::jsonb IS DISTINCT FROM CASE WHEN $5 THEN EXCLUDED.detail::jsonb
        ELSE coalesce(CASE WHEN left(blank.detail,1)='{' THEN blank.detail::jsonb END,'{}'::jsonb)||EXCLUDED.detail::jsonb END
      OR $5 AND blank.next_try_at<=now()`,
    [entityId,reason,JSON.stringify({publishedText:input.meeting.venueGap?.publishedText??null,
      online:input.meeting.online??null,...(attempts?{geocodeAttempts:attempts}:{})}),retryMinutes,attempts!==undefined]);
  return {blank:reason};
}

/** One sitting read from its body's door becomes facts, each found on the saved copy: title, start, place and links. */
export async function publishMeetingFacts(db: FactDb & { readonly query: Query }, input: {
  readonly meeting: Meeting; readonly capture: WorkerPublicationCapture; readonly pinCapture?: WorkerPublicationCapture; readonly producedBy: string;
  readonly geocodeAttempts?: readonly PinGeocodeAttempt[];
  /** The sitting holds a live canceled fact; when its source no longer says canceled, that fact moves to history. */
  readonly canceledHeld?: boolean;
}, clocks: Clocks, now: Date): Promise<MeetingFactsReport> {
  const { meeting, capture } = input;
  const id = meetingEntityId(meeting.id);
  const entity = await meetingFactEntity(db, meeting, capture.evidence.canonicalUrl);
  const copy = await db.transaction(query => saveCaptureCopy(query, capture));
  const provenance = captureProvenance(capture, entity.hosts);
  const tally = { live: 0, confirmed: 0, held: 0, blanks: 0 };
  const count = (outcome: PublishOutcome) => {
    if ("blank" in outcome) tally.blanks++;
    else if (outcome.decision === "PUBLISH") tally.live++;
    else if (outcome.decision === "CONFIRM") tally.confirmed++;
    else tally.held++;
  };
  // A value the saved copy shows keeps the line that shows it and is checked there; one it only implies (a link built from an id) stays unchecked until its line can be found.
  const claim = async (field: string, value: unknown, valueText: string, quote: string | null = lineOf(copy, valueText)) =>
    count(await publishClaim(db, { entity, field, fieldKind: field === "agenda_url" ? "agenda" : "meeting", provenance, value, valueText, quote: quote ?? valueText, copy,
      // Reviewed venue labels enrich the feed's location; they are claims, not the API's own field.
      acquisition: field === "location" ? "walker" : "checked", producedBy: input.producedBy, costUsd: 0 }, clocks, now));
  await claim("title", meeting.title, meeting.title);
  const sitting = sittingOnPage(copy.text, meeting);
  const start = { startsAt: meeting.startsAt, timeZone: meeting.timeZone, precision: meeting.startPrecision ?? "MINUTE" };
  if (sitting) await claim("starts_at", start, sitting.valueText, sitting.quote);
  else {
    await openBlank(db.query, { entityId: id, field: "starts_at", stage: "CHECK", reason: "CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY",
      detail: JSON.stringify({sourceUrl:copy.finalUrl,copyId:copy.id,fieldKind:"meeting",provenance,value:start,
        valueText:meeting.startsAt,quote:meeting.startsAt,producedBy:input.producedBy}), retryMinutes: clocks.retryMinutes("meeting") });
    tally.blanks++;
  }
  if (meeting.status === "CANCELED") {
    const canceled = canceledOnPage(copy.text, meeting);
    await claim("status", "CANCELED", canceled?.valueText ?? "canceled", canceled?.quote ?? null);
  } else if (input.canceledHeld) await retireAbsent(db, { subjectId: id, fieldPrefix: "status", copyId: copy.id, stillShown: [], at: copy.fetchedAt });
  if (meeting.location) await claim("location", {...meeting.location,...(meeting.mapPin?.coordinateSourceUrl ? {coordinateSourceUrl:meeting.mapPin.coordinateSourceUrl} : {})}, meeting.location.address ?? meeting.location.name);
  else if(meeting.venueGap?.publishedText)await claim("location",{name:meeting.venueGap.publishedText,address:null},meeting.venueGap.publishedText);
  if(meeting.online)await claim("online_access",meeting.online,meeting.online.label);
  if(meeting.mapPin?.pendingReplacement)count(await publishMeetingPinFact(db,{meeting,capture:input.pinCapture,registered:true,
    geocodeAttempts:input.geocodeAttempts,producedBy:input.producedBy},clocks,now));
  else if(meeting.mapPin?.matchedAddress&&input.pinCapture) count(await publishPinClaim(db,entity,{meeting,capture:input.pinCapture,producedBy:input.producedBy},clocks,now));
  else if(!meeting.mapPin&&!meeting.location) count(await publishMeetingPinFact(db,{meeting,registered:true,
    geocodeAttempts:input.geocodeAttempts,producedBy:input.producedBy},clocks,now));
  if (meeting.agendaUrl) await claim("agenda_url", meeting.agendaUrl, meeting.agendaUrl);
  if (meeting.videoUrl) await claim("video_url", meeting.videoUrl, meeting.videoUrl);
  await keepJoinLinkWork(db.query,meeting,clocks);
  return tally;
}
