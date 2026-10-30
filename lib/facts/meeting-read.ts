import type { Meeting, Provenance } from "../sources/types.ts";
import type { Query } from "./publish.ts";
import { repeatsPublishedVenue } from "../geo/address-query.ts";
import { hasPendingPinReplacement, publishedVenueDescription, withPublishedPin } from "../meetings/pin-location.ts";
import { hasPublishedVenue } from "../meetings/venue-text.ts";
import { isOnlineOnly } from "../meetings/online.ts";

export const meetingEntityId = (meetingId: string) => `meeting:${meetingId}`;

const SITTING_FACTS_SQL = `SELECT m.parent_id AS body_id, m.id AS entity_id, f.field, f.value, f.quote, f.checked_at,f.status,
  (SELECT s.url FROM source_copy s WHERE s.id = f.source_copy_id) AS url
  FROM entity m JOIN checked_fact f ON f.entity_id = m.id
  WHERE m.parent_id = ANY($1::text[]) AND m.kind = 'meeting' AND (f.status = 'live'
    OR f.field='map_pin' AND f.status='pulled' AND f.held_reason='GOVERNMENT_OFFICE_OWNER_CHANGED')`;

const FIELD = { title: "title", status: "status", starts_at: "startsAt", location: "location", map_pin:"mapPin", online_access:"online", agenda_url: "agendaUrl", video_url: "videoUrl" } as const;

function publishedLocation(meeting: Meeting, value: unknown, source: Provenance, currentText?:string|null): Partial<Meeting> {
  let location = value as { name: string; address: string | null; lat?: number; lng?: number };
  if(currentText && Number.isFinite(location.lat) && Number.isFinite(location.lng))
    location={...location,...publishedVenueDescription(currentText,location.address)};
  if (Number.isFinite(location.lat) && Number.isFinite(location.lng)) return { location:location as Meeting["location"],online:undefined,venueGap:undefined };
  if (meeting.location && repeatsPublishedVenue(location.address || location.name,meeting.location.name,meeting.location.address))
    return { location:{...meeting.location,...location,address:location.address ?? meeting.location.address},online:undefined };
  return { location:null,online:undefined,venueGap: { kind:"STATED_NOT_PLACED",publishedText:location.address || location.name,publisher:source.sourceOrg } };
}

/** A current sitting field or a withdrawn office claim, citing its saved source. */
export interface SittingFact {
  readonly meetingId: string;
  readonly field: (typeof FIELD)[keyof typeof FIELD];
  readonly value: unknown;
  readonly source: Provenance;
  readonly withdrawn?: boolean;
}

/** Every live fact of the sittings under the given bodies that start at or after `$2`, with the saved page each was found on. */
export const MEETING_FACT_ROWS_SQL = `SELECT m.parent_id AS body_id, m.id AS entity_id, f.field, f.value, f.quote, f.checked_at, f.status,
  (SELECT s.url FROM source_copy s WHERE s.id = f.source_copy_id) AS url
  FROM entity m JOIN checked_fact f ON f.entity_id = m.id
  WHERE m.parent_id = ANY($1::text[]) AND m.kind = 'meeting' AND (f.status = 'live'
    OR f.field='map_pin' AND f.status='pulled' AND f.held_reason='GOVERNMENT_OFFICE_OWNER_CHANGED')
    AND EXISTS (SELECT 1 FROM fact t WHERE t.entity_id = m.id AND t.field = 'starts_at' AND t.status = 'live'
      AND t.value->>'startsAt' ~ '^\\d{4}-\\d{2}-\\d{2}T' AND (t.value->>'startsAt')::timestamptz >= $2::timestamptz)`;

export interface MeetingBodyHeader { readonly name: string; readonly ocdId: string | null; readonly jurisdiction: string }

/**
 * The sittings the fact store holds for some bodies: each one that has a live title and start, with every other live fact laid over it.
 * A sitting is concluded once it has started; a canceled one says so in its own fact.
 */
export function meetingsFromFactRows(rows: readonly Record<string, unknown>[], header: (bodyId: string) => MeetingBodyHeader, now: Date): Meeting[] {
  const byEntity = new Map<string, Map<string, Record<string, unknown>>>();
  for (const row of rows) {
    if (row.status !== "live") continue;
    const own = byEntity.get(String(row.entity_id)) ?? new Map<string, Record<string, unknown>>();
    own.set(String(row.field), row);
    byEntity.set(String(row.entity_id), own);
  }
  const bases: Meeting[] = [];
  for (const [entityId, own] of byEntity) {
    const title = own.get("title"), start = own.get("starts_at");
    if (!title || !start) continue;
    const date = start.value as { startsAt: string; timeZone: string; precision?: "DAY" | "MINUTE" };
    const bodyId = String(title.body_id), body = header(bodyId), sourceUrl = String(title.url), at = new Date(title.checked_at as string).toISOString();
    bases.push({ id: entityId.slice("meeting:".length), bodyId, bodyName: body.name, ocdId: body.ocdId, title: String(title.value), startsAt: date.startsAt,
      timeZone: date.timeZone, ...(date.precision === "DAY" ? { startPrecision: "DAY" as const } : {}), location: null, agendaUrl: null, jurisdiction: body.jurisdiction,
      status: Date.parse(date.startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED",
      provenance: { sourceUrl, sourceOrg: new URL(sourceUrl).hostname, collectedAt: at, verifiedAt: at } });
  }
  return withSittingFacts(bases, [...sittingFactsFromRows(rows).values()].flat());
}

/** The current fields and exact office withdrawals for each given body's sittings. */
export async function readSittingFacts(query: Query, bodyIds: readonly string[]): Promise<Map<string, SittingFact[]>> {
  return sittingFactsFromRows(bodyIds.length ? await query(SITTING_FACTS_SQL, [bodyIds]) : []);
}

/** Pin repair needs only its admitted sittings, including their merged source identities. */
export async function readMeetingFacts(query: Query, meetings: readonly Meeting[]): Promise<SittingFact[]> {
  const ids = [...new Set(meetings.flatMap(meeting => [meeting.id, ...meeting.mergedMeetingIds ?? []]).map(meetingEntityId))];
  if (!ids.length) return [];
  const rows = await query(SITTING_FACTS_SQL.replace("m.parent_id = ANY($1::text[])", "m.id = ANY($1::text[])"), [ids]);
  return [...sittingFactsFromRows(rows).values()].flat();
}

/** Sitting facts from already selected rows, grouped by their body. */
export function sittingFactsFromRows(rows: readonly Record<string, unknown>[]): Map<string, SittingFact[]> {
  const byBody = new Map<string, SittingFact[]>();
  for (const row of rows) {
    const field = FIELD[String(row.field) as keyof typeof FIELD];
    if (!field) continue;
    const at = new Date(row.checked_at as string).toISOString();
    const fact: SittingFact = { meetingId: String(row.entity_id).slice("meeting:".length), field, value: row.value,
      ...(row.status === "pulled" ? {withdrawn:true} : {}),
      source: { sourceUrl: String(row.url), sourceOrg: new URL(String(row.url)).hostname, collectedAt: at, verifiedAt: at, quote: String(row.quote) } };
    const held = byBody.get(String(row.body_id));
    if (held) held.push(fact);
    else byBody.set(String(row.body_id), [fact]);
  }
  return byBody;
}

/** Each sitting with its live facts in place of what its partition carried, every one citing its saved page. */
export function withSittingFacts(meetings: readonly Meeting[], facts: readonly SittingFact[]): Meeting[] {
  const out = [...meetings];
  if (!facts.length) return out;
  const owner = new Map<string, number>();
  meetings.forEach((meeting, index) => { for (const id of [meeting.id, ...meeting.mergedMeetingIds ?? []]) owner.set(id, index); });
  const ordered=[...facts].sort((a,b)=>Date.parse(a.source.collectedAt)-Date.parse(b.source.collectedAt)
    || Number(a.field==="online")-Number(b.field==="online"));
  for (const { meetingId, field, value, source, withdrawn } of ordered) {
    const index = owner.get(meetingId);
    if (index === undefined) continue;
    const meeting = out[index]!;
    const published = meetings[index]!;
    if (withdrawn) {
      const pin = value as NonNullable<Meeting["mapPin"]>, current = meeting.mapPin;
      if (field === "mapPin" && current?.basis === "GOVERNMENT_OFFICE" && current.bodyId === pin.bodyId &&
        current.address === pin.address && current.provenance?.sourceUrl === pin.provenance?.sourceUrl) {
        const {mapPin:_withdrawn,...rest}=meeting;
        if (rest.fieldSources?.mapPin) { const {mapPin:_source,...sources}=rest.fieldSources; rest.fieldSources=sources; }
        out[index]=rest;
      }
      continue;
    }
    if (field === "location" && !hasPublishedVenue((value as {address?:string;name?:string}).address || (value as {name?:string}).name)) continue;
    const factAt = Date.parse(source.collectedAt);
    const locationAt = Date.parse(published.fieldSources?.location?.collectedAt ?? published.provenance.collectedAt);
    const attendanceAt = Date.parse(published.fieldSources?.venueGap?.collectedAt ?? published.fieldSources?.location?.collectedAt ?? published.provenance.collectedAt);
    const stated=published.venueGap?.kind==="STATED_NOT_PLACED"?published.venueGap.publishedText:null;
    if(factAt<attendanceAt) {
      if(field==="online"&&(stated||published.location))continue;
      if(field==="location") {
        const prior=value as {name?:string;address?:string|null;lat?:number;lng?:number};
        if(published.online||published.location||stated&&!repeatsPublishedVenue(stated,prior.name??"",prior.address??null))continue;
        if(stated && publishedVenueDescription(stated,null).address && (!Number.isFinite(prior.lat)||!Number.isFinite(prior.lng)))continue;
      }
    }
    if (published.mapPin) {
      const pinAt = Math.max(...[locationAt,Date.parse(published.provenance.collectedAt),
        Date.parse(published.mapPin.coordinateCheckedAt ?? "")].filter(Number.isFinite));
      // A once-saved point remains older than later calendar reads. Its old fact row cannot roll back a newer publication.
      if (field === "mapPin" && factAt <= pinAt || (field === "location" || field === "online") && factAt < attendanceAt) continue;
    }
    const patch: Partial<Meeting> = field === "startsAt" ? { startsAt: (value as { startsAt: string }).startsAt }
      : field === "location" ? publishedLocation(meeting,value,source,factAt<attendanceAt?stated:null)
      : field==="mapPin" ? {mapPin:{...value as NonNullable<Meeting["mapPin"]>,meetingId:meeting.id}}
      : field==="online" ? {online:value as Meeting["online"],location:null,venueGap:undefined} : { [field]: value as string };
    out[index] = { ...meeting, ...patch, fieldSources: { ...meeting.fieldSources, [field]: source } };
  }
  return out.map(meeting=>{
    const pin=meeting.mapPin;
    if(!pin)return meeting;
    const agrees=meeting.location ? pin.basis==="MEETING"&&repeatsPublishedVenue(pin.address,meeting.location.name,meeting.location.address)
      :pin.publishedLocation===(meeting.venueGap?.publishedText??null);
    if(agrees||hasPendingPinReplacement(meeting,pin))return withPublishedPin(meeting,pin);
    if(!meeting.location&&!pin.pendingReplacement&&pin.bodyId===meeting.bodyId)
      return withPublishedPin(meeting,{...pin,pendingReplacement:{publishedLocation:meeting.venueGap?.publishedText??null,
        onlineOnly:isOnlineOnly(meeting)}});
    const {mapPin:_stale,...rest}=meeting;return rest;
  });
}
