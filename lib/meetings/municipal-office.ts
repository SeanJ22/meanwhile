import type { Query } from "../facts/publish.ts";
import { censusAddressQuery } from "../geo/address-query.ts";
import type { RegistryProvenance } from "../registry/types.ts";
import type { Meeting } from "../sources/types.ts";
import { streetKeyOf } from "./agenda-address.ts";
import { meetingStateOf } from "./body-scope.ts";
import type { MeetingPinBody, MeetingPinLocation } from "./pin-location.ts";

/** The real owner metadata needed to acquire an office independently of any sitting's pin retry. */
export type OfficeMeetingContext = Pick<Meeting,"id"|"bodyId"|"ocdId"|"bodyName"|"jurisdiction"|"provenance">
  & Partial<Pick<Meeting,"location"|"mapPin"|"venueGap"|"fieldSources">>;

const OFFICE_CONTEXTS_SQL = `WITH partitions AS MATERIALIZED (
  SELECT payload FROM civic_data_promotions WHERE record_class='MEETING' AND (
    left(scope,7)='source:' AND split_part(scope,':',3)='body' AND split_part(scope,':',4)=ANY($2::text[])
    OR key=ANY($3::text[])
  )
)
SELECT DISTINCT ON(s.value->>'bodyId') s.value->>'id' AS id,s.value->>'bodyId' AS body_id,
  s.value->>'ocdId' AS ocd_id,s.value->>'bodyName' AS body_name,s.value->>'jurisdiction' AS jurisdiction,
  reader_payload_value(s.value->'provenance') AS provenance
FROM partitions p,LATERAL reader_payload_members(reader_payload_node(p.payload)->'meetings') m,
  LATERAL (SELECT reader_payload_node(m.item) AS value) s
WHERE s.value->>'bodyId'=ANY($1::text[]) AND s.value->>'id' IS NOT NULL
  AND s.value->>'bodyName' IS NOT NULL AND s.value->>'jurisdiction' IS NOT NULL
  AND jsonb_typeof(reader_payload_value(s.value->'provenance'))='object'
ORDER BY s.value->>'bodyId',s.value->>'startsAt' DESC NULLS LAST,s.value->>'id'`;

/** One narrow held-source projection per admitted body; calendars and full meeting records are never reread. */
export async function readOfficeContexts(query:Query,bodyIds:readonly string[]):Promise<readonly OfficeMeetingContext[]> {
  const ids=[...new Set(bodyIds)];
  if(!ids.length)return [];
  const states=[...new Set(ids.map(meetingStateOf))].filter(state=>state!=="US");
  const rows=await query(OFFICE_CONTEXTS_SQL,[ids,ids.map(id=>encodeURIComponent(id)),states.map(state=>`MEETING:source:derived:family:US-${state}`)]);
  return rows.flatMap(row=>typeof row.id==="string"&&typeof row.body_id==="string"&&typeof row.body_name==="string"
    &&typeof row.jurisdiction==="string"&&row.provenance&&typeof row.provenance==="object"
    ?[{id:row.id,bodyId:row.body_id,ocdId:typeof row.ocd_id==="string"?row.ocd_id:null,bodyName:row.body_name,
      jurisdiction:row.jurisdiction,provenance:row.provenance as RegistryProvenance}]:[]);
}

const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function municipality(jurisdiction: string): string | null {
  return /^(?:city|town|village|borough|municipality) of (.+)$/i.exec(jurisdiction)?.[1]
    ?? /^(.+) (?:city|town|village|borough)$/i.exec(jurisdiction)?.[1] ?? null;
}

function county(jurisdiction:string):string|null {
  const name=jurisdiction.replace(/,\s*[A-Z]{2}$/i,"").trim();
  return /^county of (.+)$/i.exec(name)?.[1]??/^(.+) county$/i.exec(name)?.[1]??null;
}

function boundOwner(bodyId:string|undefined,ocdId:string|null|undefined,division:string,state:string):boolean {
  const root=bodyId?.split("#")[0];
  if(!root||ocdId&&ocdId!==division)return false;
  if(root===division)return true;
  return ocdId===division&&new RegExp(`^government:US-${state}:[^#]+$`).test(root);
}

// Only published hall/courthouse venue and address fields leave Postgres, in bounded pages.
const HALL_ADDRESSES_SQL = `WITH partitions AS MATERIALIZED (
  SELECT payload FROM civic_data_promotions WHERE record_class='MEETING' AND (
    left(split_part(scope,':',4),length($2))=$2 AND left(scope,7)='source:' AND split_part(scope,':',3)='body' AND right(scope,8)<>':history'
    OR key='MEETING:source:derived:family:US-'||$3
    OR $1 ~ '/(place|county):' AND split_part(scope,':',4) LIKE 'government%3AUS-'||$3||'%3A%'
      AND left(scope,7)='source:' AND split_part(scope,':',3)='body' AND right(scope,8)<>':history'
  )
), venues AS (
  SELECT s.value->>'bodyId' AS body_id,s.value->>'ocdId' AS ocd_id,
    s.value->>'jurisdiction' AS jurisdiction,s.value->>'startsAt' AS starts_at,
    reader_payload_value(s.value->'location') AS location,
    reader_payload_value(s.value->'venueGap') AS venue_gap,
    reader_payload_value(s.value->'provenance') AS provenance,
    reader_payload_value(s.value->'fieldSources')->'location' AS location_source,
    coalesce(nullif(reader_payload_value(s.value->'mapPin'),'null'::jsonb),
      (SELECT f.value FROM fact f WHERE f.entity_id='meeting:'||(s.value->>'id') AND f.field='map_pin' AND f.status='live')) AS map_pin
  FROM partitions p,LATERAL reader_payload_members(reader_payload_node(p.payload)->'meetings') m,
    LATERAL (SELECT reader_payload_node(m.item) AS value) s
  WHERE split_part(s.value->>'bodyId','#',1)=$1
    OR $1 ~ '/(place|county):' AND s.value->>'ocdId'=$1
), halls AS (
SELECT DISTINCT ON (coalesce(location->>'address',location->>'name',venue_gap->>'publishedText'),ocd_id,jurisdiction)
  body_id,ocd_id,jurisdiction,starts_at,location,venue_gap,provenance,location_source,map_pin FROM venues
WHERE coalesce(location->>'name',venue_gap->>'publishedText','') ~* '(^((city|town|village|borough) hall|((.+ )?county )?courthouse)\\M|^.+ courthouse\\M)'
  AND coalesce(location_source->>'sourceUrl',map_pin#>>'{provenance,sourceUrl}',provenance->>'sourceUrl') IS NOT NULL
ORDER BY coalesce(location->>'address',location->>'name',venue_gap->>'publishedText'),ocd_id,jurisdiction,
  (map_pin->>'coordinateSourceUrl' IS NOT NULL AND map_pin->'lat'=location->'lat' AND map_pin->'lng'=location->'lng') DESC NULLS LAST,
  starts_at DESC,body_id,provenance
)
SELECT body_id,ocd_id,jurisdiction,starts_at,location,venue_gap,provenance,location_source,map_pin FROM halls
ORDER BY starts_at DESC,body_id,location,venue_gap,provenance,ocd_id,jurisdiction
LIMIT 64 OFFSET $4`;

/** An explicitly owned municipal hall or county courthouse supplies its government office. */
export async function withMunicipalHallOffices(
  query: Query | undefined,
  meetings: readonly OfficeMeetingContext[],
  offices: ReadonlyMap<string, MeetingPinBody>,
  onFailure: (detail: string) => void,
  previous: ReadonlyMap<string, Meeting> = new Map(),
): Promise<ReadonlyMap<string, MeetingPinBody>> {
  const groups = new Map<string, { name: string; state: string; kind:"place"|"county"; bodies: Set<string> }>();
  for (const meeting of meetings) {
    if (meeting.location || !meeting.bodyId) continue;
    const pin = previous.get(meeting.id)?.mapPin ?? meeting.mapPin;
    const body = offices.get(meeting.bodyId);
    if(body?.governmentOfficeAlternatives)continue;
    if (pin?.bodyId === meeting.bodyId && (
      pin.basis === "BODY_OFFICE" && pin.address === body?.officeContact?.address ||
      pin.basis === "GOVERNMENT_OFFICE" && pin.address === body?.governmentOffice?.address
    )) continue;
    const root=meeting.bodyId.split("#")[0];
    const division=/^ocd-division\/country:us\/state:[a-z]{2}\/(?:place|county):[^/#]+$/.test(root)?root:meeting.ocdId??root;
    const scope=/^ocd-division\/country:us\/state:([a-z]{2})\/(place|county):([^/#]+)$/.exec(division);
    const name=scope?.[2]==="county"?county(meeting.jurisdiction):municipality(meeting.jurisdiction);
    if(!scope||!name||words(scope[3].replace(/_(?:city|town|village|borough)$/, ""))!==words(name))continue;
    if(!boundOwner(meeting.bodyId,meeting.ocdId,division,scope[1].toUpperCase()))continue;
    const group=groups.get(division)??{name,state:scope[1].toUpperCase(),kind:scope[2] as "place"|"county",bodies:new Set<string>()};
    group.bodies.add(meeting.bodyId);
    groups.set(division, group);
  }
  if (!groups.size) return offices;
  const result = new Map(offices);
  for (const [division, group] of groups) {
    const halls: NonNullable<MeetingPinBody["governmentOffice"]>[] = [];
    const seen = new Map<string,number>();
    const consider = (source: Pick<OfficeMeetingContext, "bodyId" | "ocdId" | "jurisdiction" | "location" | "venueGap" | "provenance" | "fieldSources" | "mapPin">) => {
      if(!boundOwner(source.bodyId,source.ocdId,division,group.state))return;
      if(words((group.kind==="place"?municipality:county)(source.jurisdiction)??"")!==words(group.name))return;
      const venue=source.location?.name??source.venueGap?.publishedText??"";
      if(group.kind==="place"){
        if(!/^(?:city|town|village|borough) hall\b/i.test(venue)||/\bhall\s+meeting\b/i.test(venue))return;
      }else{
        const named=words(venue),owner=words(group.name);
        if(!["courthouse","county courthouse",`${owner} courthouse`,`${owner} county courthouse`]
          .some(label=>named===label||named.startsWith(`${label} `))||/\bcourthouse\s+meeting\b/i.test(venue))return;
      }
      const address = source.location?.address ?? venue;
      const parsed = censusAddressQuery(address), street = streetKeyOf(parsed);
      if (!street || street.index !== 0) return;
      const locality = /^,\s*([^,]+),\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/i.exec(parsed.slice(street.length));
      if(!locality||group.kind==="place"&&words(locality[1])!==words(group.name)||locality[2].toUpperCase()!==group.state)return;
      const provenance=source.fieldSources?.location??source.mapPin?.provenance??source.provenance;
      if (!provenance?.sourceUrl || !Number.isFinite(Date.parse(provenance.collectedAt))) return;
      const key = words(parsed);
      const pin=source.mapPin;
      const verified=pin&&pin.bodyId===source.bodyId&&pin.matchedAddress&&pin.coordinateSourceUrl&&pin.coordinateCheckedAt
        &&Number.isFinite(pin.lat)&&Math.abs(pin.lat)<=90&&Number.isFinite(pin.lng)&&Math.abs(pin.lng)<=180
        &&Number.isFinite(Date.parse(pin.coordinateCheckedAt))&&Number.isFinite(source.location?.lat)&&Number.isFinite(source.location?.lng)
        &&pin.lat===source.location!.lat&&pin.lng===source.location!.lng&&words(censusAddressQuery(pin.address))===key
        &&URL.canParse(pin.coordinateSourceUrl)&&new URL(pin.coordinateSourceUrl).hostname==="geocoding.geo.census.gov"
        ?{lat:pin.lat,lng:pin.lng,matchedAddress:pin.matchedAddress,coordinateSourceUrl:pin.coordinateSourceUrl,
          coordinateCheckedAt:pin.coordinateCheckedAt}:undefined;
      const existing=seen.get(key);
      if(existing!==undefined){
        if(verified&&!halls[existing].verifiedPoint)halls[existing]={...halls[existing],verifiedPoint:verified};
        return;
      }
      seen.set(key,halls.length);
      halls.push({name:source.jurisdiction,address:parsed,provenance,
        ...(group.kind==="county"?{quote:source.fieldSources?.location?.quote??address}:{}),
        ...(verified?{verifiedPoint:verified}:{})});
    };
    for (const meeting of meetings) consider(meeting);
    if (query) try {
      for (let offset = 0; ; offset += 64) {
        const rows = await query(HALL_ADDRESSES_SQL, [division, encodeURIComponent(`${division}#`), group.state, offset]);
        for (const row of rows) consider({ bodyId: String(row.body_id), ocdId: typeof row.ocd_id === "string" ? row.ocd_id : null,
          jurisdiction: String(row.jurisdiction), location: row.location as Meeting["location"],
          venueGap: row.venue_gap as Meeting["venueGap"], provenance: row.provenance as RegistryProvenance,
          fieldSources:row.location_source?{location:row.location_source as NonNullable<Meeting["fieldSources"]>["location"]}:undefined,
          mapPin:row.map_pin as MeetingPinLocation|undefined });
        if (rows.length < 64) break;
      }
    } catch (error) {
      onFailure(`Published municipal office addresses could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const bodyId of group.bodies) {
      const body = result.get(bodyId) ?? { bodyId, name: meetings.find(meeting => meeting.bodyId === bodyId)?.bodyName ?? null };
      result.set(bodyId, { ...body, governmentOfficeAlternatives: halls });
    }
  }
  return result;
}
