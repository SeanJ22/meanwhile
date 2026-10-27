import { runBoundedWorkPool } from "../ops/bounded-work-pool.ts";
import { createHash } from "node:crypto";
import type { Query } from "../facts/publish.ts";
import { meetingEntityId } from "../facts/meeting-read.ts";
import type { RetainedSourceResponse } from "../civic-data/retained-meeting-bytes.ts";
import {
  censusAddressQuery,
  repeatsPublishedVenue,
} from "../geo/address-query.ts";
import { verifiedCensusVenuePoint } from "../geo/census-address-match.ts";
import {
  CENSUS_GEOCODER_URL,
  CENSUS_BENCHMARK,
} from "../geo/census-geocoder.ts";
import { politeGetText, SourceHttpError, SourceReadDeferred } from "../sources/http.ts";
import { trackSourceTransport } from "../sources/host-transport.ts";
import { isOfficeStreetAddress } from "../map/office-locator.ts";
import type { Meeting } from "../sources/types.ts";
import type { RegistryProvenance } from "../registry/types.ts";
import { agendaLetterheadOfficeEvidence, agendaMeetingAddress, streetKeyOf } from "./agenda-address.ts";
import { meetingStateOf } from "./body-scope.ts";
import { addressWords } from "../geo/address-words.ts";
import { withMunicipalHallOffices } from "./municipal-office.ts";
import { isOnlineOnly } from "./online.ts";
import {
  meetingPinAddresses,
  withPublishedPin,
  publishedVenueDescription,
  type MeetingPinAddress,
  type MeetingPinLocation,
  type MeetingPinBody,
} from "./pin-location.ts";

/** Exact board and owning-government addresses; territorial neighbours never supply an office. */
export const PIN_OFFICES_SQL = `WITH selected AS MATERIALIZED (
  SELECT id,name,state,parent_id FROM entity WHERE id=ANY($1::text[]) AND kind='body'
), inventory AS MATERIALIZED (
  SELECT g FROM civic_data_promotions p,LATERAL jsonb_array_elements(coalesce(p.payload->'governments','[]'::jsonb)) g
  WHERE p.record_class='REGISTRATION' AND p.key=ANY(ARRAY(SELECT 'REGISTRATION:US-'||state||':registration:v1' FROM selected))
), owners AS MATERIALIZED (
  SELECT b.id,b.parent_id,g FROM selected b LEFT JOIN LATERAL (
    SELECT g FROM (SELECT g,count(*) OVER() AS owners FROM inventory WHERE g->>'state'=b.state AND (g->>'jurisdictionId'=b.parent_id OR g->>'id'=b.parent_id
      OR g->>'id'=split_part(b.id,'#',1) OR g->>'jurisdictionId'=split_part(b.id,'#',1)
      OR g->'aliases' ? b.id OR g->'bodyIds' ? b.id OR g->'aliases' ? (b.parent_id||'#governing')
      OR g->'aliases' ? (b.parent_id||'#board'))) matched WHERE owners=1
  ) owned ON true
)
SELECT b.id,b.name,office.value#>>'{}' AS board_address,office.checked_at AS board_checked,office_source.url AS board_source,
  o.g->>'mailingAddress' AS postal_alias,o.g->'provenance' AS postal_alias_source,
  coalesce(government.name,o.g->>'name') AS government_name,
  coalesce(government.value#>>'{}',o.g->>'officeAddress') AS government_address,
  coalesce(CASE WHEN government.value IS NOT NULL THEN jsonb_build_object('sourceUrl',government.url,
    'sourceOrg',government.name,'collectedAt',government.checked_at,'verifiedAt',government.checked_at) END,
    o.g#>'{contactProvenance,officeAddress}',o.g->'provenance') AS government_source
FROM selected b JOIN owners o ON o.id=b.id
LEFT JOIN LATERAL (SELECT value,checked_at,source_copy_id FROM checked_fact WHERE entity_id=b.id AND field='office_address' AND status='live' ORDER BY checked_at DESC LIMIT 1) office ON true
LEFT JOIN source_copy office_source ON office_source.id=office.source_copy_id
LEFT JOIN LATERAL (
  SELECT e.name,f.value,f.checked_at,s.url FROM entity e JOIN checked_fact f ON f.entity_id=e.id AND f.status='live' AND f.field='office_address'
    JOIN source_copy s ON s.id=f.source_copy_id WHERE e.kind='government' AND e.state=b.state
      AND e.id IN (b.parent_id,o.g->>'jurisdictionId',o.g->>'id') ORDER BY f.checked_at DESC,e.id LIMIT 1
) government ON true`;

const AGENDA_PIN_OFFICES_SQL = `WITH owned AS MATERIALIZED (
  SELECT p.key,s.value->>'id' AS meeting_id,s.value->>'bodyId' AS body_id,
    s.value->>'ocdId' AS ocd_id,s.value->>'jurisdiction' AS jurisdiction,s.value->>'startsAt' AS starts_at
  FROM civic_data_promotions p,LATERAL reader_payload_members(reader_payload_node(p.payload)->'meetings') m,
    LATERAL (SELECT reader_payload_node(m.item) AS value) s
  WHERE p.record_class='MEETING' AND s.value->>'bodyId'=ANY($1::text[])
), headers AS MATERIALIZED (
SELECT p.key,p.current_version_id,d.value->>'meetingId' AS meeting_id,d.value->>'ocdId' AS ocd_id,
  reader_payload_value(d.value->'contentHash')#>>'{}' AS content_hash,
  reader_payload_value(d.value->'documentUrl')#>>'{}' AS url,
  reader_payload_value(d.value->'sourceOrg')#>>'{}' AS source_org,
  reader_payload_value(d.value->'collectedAt')#>>'{}' AS collected_at,
  left(reader_payload_value(d.value->'text')#>>'{}',700) AS header
FROM (SELECT DISTINCT key FROM owned) keys JOIN civic_data_promotions p ON p.key=keys.key,
  LATERAL reader_payload_members(reader_payload_node(p.payload)->'agendaDocuments') a,
  LATERAL (SELECT reader_payload_node(a.item) AS value) d
WHERE d.value->>'extraction' IN ('pdf','html') AND EXISTS(SELECT 1 FROM owned o WHERE o.key=p.key
  AND d.value->>'meetingId'=o.meeting_id AND d.value->>'ocdId' IS NOT DISTINCT FROM o.ocd_id)
)
SELECT o.body_id,o.meeting_id,o.jurisdiction,h.current_version_id,h.content_hash,h.url,h.source_org,h.collected_at,h.header
FROM owned o JOIN headers h ON h.key=o.key AND h.meeting_id=o.meeting_id AND h.ocd_id IS NOT DISTINCT FROM o.ocd_id
ORDER BY o.body_id,o.starts_at DESC,h.collected_at DESC`;

export async function publishedPinOffices(
  query: Query | undefined,
  bodyIds: readonly string[],
  onFailure?: (detail:string)=>void,
): Promise<ReadonlyMap<string, MeetingPinBody>> {
  if (!query || !bodyIds.length) return new Map();
  const rows = await query(PIN_OFFICES_SQL, [[...new Set(bodyIds)]]);
  const bodies = new Map(
    rows.map((row) => {
      const boardSource: RegistryProvenance | null =
        typeof row.board_source === "string"
          ? {
              sourceUrl: row.board_source,
              sourceOrg: new URL(row.board_source).hostname,
              collectedAt: new Date(row.board_checked as string).toISOString(),
              verifiedAt: null,
            }
          : null;
      return [
        String(row.id),
        {
          bodyId: String(row.id),
          name: String(row.name),
          ...(typeof row.postal_alias==="string"&&row.postal_alias_source?{postalAliases:[{address:row.postal_alias,provenance:row.postal_alias_source as RegistryProvenance}]}:{}),
          ...(boardSource && row.board_address
            ? {
                officeContact: {
                  address: String(row.board_address),
                  phone: null,
                  provenance: boardSource,
                },
              }
            : {}),
          ...(row.government_address && row.government_source
            ? {
                governmentOffice: {
                  name: String(row.government_name),
                  address: String(row.government_address),
                  provenance: row.government_source as RegistryProvenance,
                },
              }
            : {}),
        } as MeetingPinBody,
      ];
    }),
  );
  if(bodies.size)try{
    for(const row of await query(AGENDA_PIN_OFFICES_SQL,[[...bodies.keys()]])){
      const id=String(row.body_id),body=bodies.get(id);
      if(!body||typeof row.header!=="string"||typeof row.url!=="string")continue;
      const state=meetingStateOf(id),provenance={sourceUrl:row.url,sourceOrg:String(row.source_org),
        collectedAt:new Date(row.collected_at as string).toISOString(),verifiedAt:null};
      const venue=agendaMeetingAddress(row.header,state);
      if(venue&&typeof row.meeting_id==="string"&&!body.meetingAddresses?.some(address=>address.meetingId===row.meeting_id))
        (body.meetingAddresses??=[]).push({meetingId:row.meeting_id,bodyId:id,name:venue,address:venue,basis:"MEETING",provenance});
      if(!body.officeContact?.address||!isOfficeStreetAddress(censusAddressQuery(body.officeContact.address))){
        const office=agendaLetterheadOfficeEvidence(row.header,String(row.jurisdiction),state);
        if(office)body.officeContact={address:office.address,quote:office.quote,phone:null,provenance,
          ...(typeof row.current_version_id==="string"&&typeof row.content_hash==="string"&&/^[a-f0-9]{64}$/.test(row.content_hash)
            ?{savedSource:{versionId:row.current_version_id,sha256:row.content_hash,text:row.header}}:{})};
      }
    }
  }catch(error){onFailure?.(`Published agenda office addresses could not be read: ${error instanceof Error?error.message:String(error)}`);}
  return bodies;
}

/** Failed normalized inputs stay with the open map-pin blank, so the next pass seeks new evidence. */
export interface PinGeocodeAttempt {
  readonly query: string;
  readonly benchmark: string;
  readonly outcome: "NO_MATCH" | "REJECTED" | "TRANSIENT";
  readonly checkedAt: string;
  readonly retryAt?: string;
  readonly httpStatus?: number;
}

export interface PublishedPinResult {
  readonly meetings: readonly Meeting[];
  readonly placedCount: number;
  readonly held: readonly string[];
  readonly responses: readonly RetainedSourceResponse[];
  readonly attempts: ReadonlyMap<string, readonly PinGeocodeAttempt[]>;
}

/** A published physical address can use a postal alias explicitly printed beside its own street in the same government's directory. */
function postalAddressAliases(address:MeetingPinAddress,body:MeetingPinBody|undefined):MeetingPinAddress[]{
  const comma=address.address.indexOf(",");
  if(comma<0)return[];
  const street=addressWords(address.address.slice(0,comma)),locality=addressWords(address.address.slice(comma+1));
  const house=/^\d+\b/.exec(street)?.[0];
  if(!house)return[];
  return(body?.postalAliases??[]).flatMap(source=>{
    const first=streetKeyOf(source.address);
    if(!first||first.index!==0||!(first.key===street||first.key.startsWith(street+" "))||!addressWords(source.address).endsWith(" "+locality))return[];
    const rest=source.address.slice(first.length).split(",",1)[0].trim().replace(/^\(|\)$/g,"");
    const alias=`${house} ${rest}`,parsed=streetKeyOf(alias);
    if(!parsed||parsed.index!==0||parsed.length!==alias.length)return[];
    return[{...address,geocodingAddress:`${alias}, ${address.address.slice(comma+1).trim()}`,
      addressAlias:{sourceAddress:source.address,provenance:source.provenance}}];
  });
}

function publishedAddressQuery(address:MeetingPinAddress,meeting:Meeting):string {
  const published=censusAddressQuery(address.geocodingAddress??address.address),street=streetKeyOf(published);
  const city=/^(?:city|town|village|borough|municipality)(?:\s+(?:and|&)\s+county)?\s+of\s+(.+)$/i.exec(meeting.jurisdiction)?.[1];
  const state=meetingStateOf(meeting.bodyId)||meetingStateOf(meeting.ocdId);
  return state&&street?.index===0&&street.length===published.length?`${published}, ${city?`${city}, `:""}${state}`:published;
}

/** Geocode at publication, then keep the point with the meeting. A fresh visit only reads saved points. */
export async function placePublishedMeetingPins(input: {
  readonly meetings: readonly Meeting[];
  readonly previous?: readonly Meeting[];
  readonly query?: Query;
  readonly offices?: ReadonlyMap<string, MeetingPinBody>;
  readonly retainedAddresses?: ReadonlyMap<string, MeetingPinAddress>;
  readonly geocodeAttempts?: ReadonlyMap<string, readonly PinGeocodeAttempt[]>;
  readonly fetchImpl?: typeof fetch;
  readonly clock?: () => string;
}): Promise<PublishedPinResult> {
  const clock = input.clock ?? (() => new Date().toISOString()),
    fetchImpl = input.fetchImpl ?? fetch;
  const responses: RetainedSourceResponse[] = [],
    held: string[] = [];
  let offices = input.offices;
  let officesUnavailable = !input.query && !input.offices;
  if (!offices) {
    try {
      offices = await publishedPinOffices(
        input.query,
        input.meetings
          .filter((m) => !m.location)
          .flatMap((m) => m.bodyId ?? []),
        detail=>{officesUnavailable=true;held.push(detail);},
      );
    } catch (error) {
      officesUnavailable = true;
      held.push(
        `Office addresses could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
      offices = new Map();
    }
  }
  const previous = new Map(
    (input.previous ?? []).map((meeting) => [meeting.id, meeting]),
  );
  const priorAttempts = new Map(input.geocodeAttempts);
  const unpinned = input.meetings.filter(meeting => {
    const pin=meeting.mapPin??previous.get(meeting.id)?.mapPin;
    return !meeting.location&&(!pin||Boolean(pin.pendingReplacement));
  });
  if (input.query && unpinned.length && !input.geocodeAttempts) try {
    const rows = await input.query("SELECT entity_id,detail FROM blank WHERE field='map_pin' AND entity_id=ANY($1::text[])",
      [unpinned.map(meeting => meetingEntityId(meeting.id))]);
    for (const row of rows) {
      if (typeof row.detail !== "string") continue;
      try {
        const detail = JSON.parse(row.detail) as { geocodeAttempts?: PinGeocodeAttempt[] };
        if (Array.isArray(detail.geocodeAttempts)) priorAttempts.set(String(row.entity_id).slice("meeting:".length),
          detail.geocodeAttempts.filter(attempt => typeof attempt.query === "string" && typeof attempt.checkedAt === "string" &&
            attempt.benchmark === CENSUS_BENCHMARK && ["NO_MATCH", "REJECTED", "TRANSIENT"].includes(attempt.outcome)));
      } catch { /* Older blanks carry their published venue as plain text. */ }
    }
  } catch (error) { held.push(`Earlier geocoding failures could not be read: ${error instanceof Error ? error.message : String(error)}`); }
  const attempts = new Map<string, PinGeocodeAttempt[]>([...priorAttempts].map(([id,rows])=>[id,[...rows]]));
  const failedQueries = new Map<string, PinGeocodeAttempt>();
  const queryKey = (query: string) => addressWords(query);
  for (const saved of priorAttempts.values()) for (const attempt of saved) {
    if (attempt.benchmark !== CENSUS_BENCHMARK) continue;
    const prior = failedQueries.get(queryKey(attempt.query));
    if (!prior || Date.parse(attempt.checkedAt) > Date.parse(prior.checkedAt)) failedQueries.set(queryKey(attempt.query), attempt);
  }
  const remember = (meetingId: string, attempt: PinGeocodeAttempt) => {
    const rows = attempts.get(meetingId) ?? [];
    const index=rows.findIndex(row => queryKey(row.query) === queryKey(attempt.query));
    if(index<0)rows.push(attempt);else rows[index]=attempt;
    attempts.set(meetingId, rows);
  };
  const saved = new Map<string, MeetingPinLocation>();
  const unresolved=input.meetings.filter(meeting=>{
    if(meeting.location||meeting.mapPin)return false;
    const prior=previous.get(meeting.id);
    return !prior?.mapPin||prior.bodyId!==meeting.bodyId||prior.mapPin.publishedLocation!==(meeting.venueGap?.publishedText??null)
      ||Boolean(prior.online)!==Boolean(meeting.online);
  });
  if(input.query&&unresolved.length)try {
    const owners=new Map(unresolved.flatMap(meeting=>[meeting.id,...meeting.mergedMeetingIds??[]].map(id=>[id,meeting] as const)));
    const rows=await input.query("SELECT entity_id,value FROM checked_fact WHERE field='map_pin' AND status='live' AND entity_id=ANY($1::text[])",
      [[...owners.keys()].map(meetingEntityId)]);
    for(const row of rows) {
      const pin=row.value as MeetingPinLocation|null;
      if(!pin||!Number.isFinite(pin.lat)||!Number.isFinite(pin.lng)||!pin.bodyId||!pin.address||!pin.matchedAddress||
        !["MEETING","BODY_OFFICE","GOVERNMENT_OFFICE"].includes(pin.basis))continue;
      saved.set(`${pin.basis}:${pin.bodyId}:${pin.address}`,pin);
      const owner=owners.get(String(row.entity_id).slice("meeting:".length));
      if(owner&&!previous.get(owner.id)?.mapPin)previous.set(owner.id,{...owner,mapPin:{...pin,meetingId:owner.id}});
    }
  } catch(error){held.push(`Saved meeting points could not be read: ${error instanceof Error?error.message:String(error)}`);}
  for (const meeting of [...(input.previous ?? []), ...input.meetings])
    if (meeting.mapPin)
      saved.set(
        `${meeting.mapPin.basis}:${meeting.bodyId}:${meeting.mapPin.address}`,
        meeting.mapPin,
      );
  offices = await withMunicipalHallOffices(input.query, input.meetings, offices,
    detail => { officesUnavailable = true; held.push(detail); }, previous);
  const lookups = new Map<
    string,
    Promise<{
      lat: number;
      lng: number;
      matchedAddress: string;
      url: string;
      at: string;
    } | null | undefined>
  >();
  const locate = (
    address: MeetingPinAddress,
    meeting: Meeting,
  ): Promise<{
    lat: number;
    lng: number;
    matchedAddress: string;
    url: string;
    at: string;
  } | null | undefined> => {
    const query = publishedAddressQuery(address,meeting), key = queryKey(query);
    const attempted = failedQueries.get(key);
    if (attempted && (attempted.outcome !== "TRANSIENT" || attempted.retryAt && Date.parse(attempted.retryAt) > Date.parse(clock()))) {
      remember(meeting.id, attempted);
      return Promise.resolve(attempted.outcome === "TRANSIENT" ? undefined : null);
    }
    const reject = (outcome: PinGeocodeAttempt["outcome"], retryAt?: string, httpStatus?: number) => {
      const attempt: PinGeocodeAttempt = {query, benchmark:CENSUS_BENCHMARK, outcome, checkedAt:clock(), ...(retryAt ? {retryAt} : {}), ...(httpStatus ? {httpStatus} : {})};
      failedQueries.set(key,attempt);
      return outcome === "TRANSIENT" ? undefined : null;
    };
    if (!isOfficeStreetAddress(query) || query.length < 3 || query.length > 200 || !/[0-9]/.test(query)) {
      reject("REJECTED");
      remember(meeting.id,failedQueries.get(key)!);
      return Promise.resolve(null);
    }
    let pending = lookups.get(key);
    if (!pending) {
      pending = (async () => {
        const url = new URL(CENSUS_GEOCODER_URL);
        url.searchParams.set("address", query);
        url.searchParams.set("benchmark", CENSUS_BENCHMARK);
        url.searchParams.set("format", "json");
        let response: Response | undefined, bytes: Uint8Array | undefined, retryAt: string | undefined;
        try {
          const read = await politeGetText(url.href, {
            signal: AbortSignal.timeout(8000), accept:"application/json",
            // The census geocoder shares the production host clock, so a 429 cools every lookup, not only this one.
            fetchImpl: trackSourceTransport(async (request, options) => {
              response = await fetchImpl(request,options);
              bytes = new Uint8Array(await response.clone().arrayBuffer());
              const retry = response.headers.get("retry-after");
              if (retry && (response.status === 429 || response.status >= 500)) {
                const seconds = Number(retry), at = Number.isFinite(seconds) ? Date.parse(clock()) + seconds*1000 : Date.parse(retry);
                if (Number.isFinite(at)) {
                  retryAt = new Date(at).toISOString();
                  // The shared reader accepts seconds; preserve an HTTP-date's full delay there too.
                  if (!Number.isFinite(seconds)) {
                    const headers = new Headers(response.headers);
                    headers.set("retry-after",String(Math.max(0,(at-Date.parse(clock()))/1000)));
                    return new Response(new Uint8Array(bytes),{status:response.status,headers});
                  }
                }
              }
              return response;
            }, fetchImpl),
          });
          const finalUrl = response?.url || url.href;
          if (new URL(finalUrl).hostname !== "geocoding.geo.census.gov") return reject("TRANSIENT",retryAt);
          const payload = JSON.parse(read.text) as {result?: {addressMatches?: unknown}};
          if (!Array.isArray(payload.result?.addressMatches)) throw new Error("Census returned no address-matching result");
          const point = verifiedCensusVenuePoint(query,payload);
          const at = clock();
          responses.push({source:"census-geocoder", requestedUrl:url.href, finalUrl, httpStatus:response!.status,
            rawHash:createHash("sha256").update(bytes!).digest("hex"), byteCount:bytes!.length, bytes:bytes!,
            retrievedAt:at, contentType:response!.headers.get("content-type") ?? "application/json"});
          if (!point) return reject("NO_MATCH",undefined,response?.status);
          failedQueries.delete(key);
          return {lat:point.lat, lng:point.lng, matchedAddress:point.address, url:finalUrl, at};
        } catch (error) {
          // A shared-host cooldown is honored as this query's retry time; the lookup is never re-sent sooner.
          if (error instanceof SourceReadDeferred && error.reason === "THROTTLED" && !(Date.parse(retryAt ?? "") >= error.until)) retryAt = new Date(error.until).toISOString();
          const rejected = error instanceof SourceHttpError && error.status === 400;
          if (!rejected) held.push(`${address.address}: ${error instanceof Error ? error.message : String(error)}`);
          return reject(rejected ? "REJECTED" : "TRANSIENT",retryAt,error instanceof SourceHttpError ? error.status : response?.status);
        }
      })();
      lookups.set(key,pending);
    }
    return pending.then(point => {
      const attempt = failedQueries.get(key);
      if (attempt) remember(meeting.id,attempt);
      return point;
    });
  };
  let placedCount = 0;
  const retainedMeetings = retainPreviouslyVerifiedVenuePoints(
    input.meetings,
    input.previous ?? [],
  );
  const placed = await runBoundedWorkPool(
    input.meetings,
    8,
    async (meeting, index) => {
      const agenda=offices.get(meeting.bodyId??"")?.meetingAddresses?.find(address=>address.meetingId===meeting.id);
      const existing=meeting.location??retainedMeetings[index].location;
      const sourceAt=meeting.fieldSources?.location?.collectedAt??previous.get(meeting.id)?.fieldSources?.location?.collectedAt??meeting.provenance.collectedAt;
      const agendaMoved=Boolean(agenda&&existing&&!streetKeyOf(censusAddressQuery(meeting.venueGap?.publishedText??""))&&
        Date.parse(agenda.provenance.collectedAt)>Date.parse(sourceAt)&&!repeatsPublishedVenue(agenda.address,existing.name,existing.address));
      if(agendaMoved)meeting={...meeting,location:null,mapPin:undefined,
        venueGap:{kind:"STATED_NOT_PLACED",publishedText:meeting.venueGap?.publishedText??meeting.mapPin?.publishedLocation??existing!.name,publisher:agenda!.provenance.sourceOrg},
        fieldSources:{...meeting.fieldSources,location:agenda!.provenance,venueGap:agenda!.provenance}};
      if (meeting.location) return meeting;
      const retained = retainedMeetings[index];
      if (retained.location&&!agendaMoved) return retained;
      const candidates = meetingPinAddresses(
        meeting,
        offices.get(meeting.bodyId ?? ""),
      );
      const retainedAddress = input.retainedAddresses?.get(meeting.id);
      if (retainedAddress?.basis === "MEETING" && retainedAddress.bodyId === meeting.bodyId && !meeting.online &&
        (!agenda||Date.parse(agenda.provenance.collectedAt)<=Date.parse(retainedAddress.provenance.collectedAt)||repeatsPublishedVenue(agenda.address,retainedAddress.name,retainedAddress.address))&&
        repeatsPublishedVenue(meeting.venueGap?.publishedText ?? "",retainedAddress.name,retainedAddress.address))
        candidates.splice(candidates.findIndex(address=>address.basis!=="MEETING")<0?candidates.length:candidates.findIndex(address=>address.basis!=="MEETING"),0,retainedAddress);
      const prior = previous.get(meeting.id);
      const publishedLocation = meeting.venueGap?.publishedText ?? null;
      const repeated = prior?.mapPin ?? meeting.mapPin;
      const bodyAddress=candidates.find(address=>address.basis==="BODY_OFFICE");
      const bodyQuery=bodyAddress?[bodyAddress,...postalAddressAliases(bodyAddress,offices.get(meeting.bodyId??""))]
        .map(address=>addressWords(publishedAddressQuery(address,meeting))).join(" | "):null;
      let bodyTried=false,bodyTransient=false;
      const referenceContext=(known:MeetingPinLocation|undefined)=>({boardAddressQuery:bodyAddress
        ? bodyTried&&!bodyTransient?bodyQuery:known?.boardAddressQuery??null
        : officesUnavailable?known?.boardAddressQuery??null:null});
      const agendaReplacesPoint=Boolean(agenda&&repeated&&
        (repeated.basis!=="MEETING"||Date.parse(agenda.provenance.collectedAt)>Date.parse(repeated.provenance.collectedAt)&&
        !repeatsPublishedVenue(agenda.address,repeated.name,repeated.address)));
      if (repeated?.basis === "MEETING" && repeated.bodyId === meeting.bodyId &&
        repeated.publishedLocation === publishedLocation && !meeting.online && !agendaReplacesPoint&&
        repeatsPublishedVenue(publishedLocation ?? "",repeated.name,repeated.address))
        candidates.splice(candidates[0]?.basis === "MEETING" ? 1 : 0,0,repeated);
      // An unavailable office read cannot erase a point already published for this unchanged sitting.
      if (
        officesUnavailable &&
        repeated &&
        repeated.basis !== "MEETING" &&
        repeated.bodyId === meeting.bodyId
      )
        candidates.push(repeated);
      if (
        repeated && !agendaReplacesPoint&&
        (repeated.basis!=="GOVERNMENT_OFFICE"||(repeated.boardAddressQuery??null)===bodyQuery||officesUnavailable&&!bodyAddress)&&
        repeated.publishedLocation === publishedLocation &&
        Boolean(meeting.online) === Boolean(prior?.online ?? meeting.online) &&
        candidates.some(
          (address) =>
            address.basis === repeated.basis &&
            address.address === repeated.address,
        )
      ) {
        placedCount++;
        const {pendingReplacement:_pending,...checked}=repeated;
        return withPublishedPin(meeting, {...checked,meetingId:meeting.id});
      }
      // A calendar omitting an earlier hall citation does not retract its saved office point.
      // Try current addresses first; an explicit government office still supersedes it.
      const governmentOffice=offices.get(meeting.bodyId??"")?.governmentOffice?.address;
      if (repeated?.basis === "GOVERNMENT_OFFICE" && repeated.bodyId === meeting.bodyId &&
        (!governmentOffice || !isOfficeStreetAddress(governmentOffice)) &&
        !candidates.some(address => address.basis === repeated.basis && address.address === repeated.address))
        candidates.push(repeated);
      for (const address of candidates.flatMap(address=>[address,...postalAddressAliases(address,offices.get(meeting.bodyId??""))])) {
        if(address.basis==="BODY_OFFICE"&&repeated?.basis==="GOVERNMENT_OFFICE"&&
          (repeated.boardAddressQuery??null)===bodyQuery){bodyTried=true;continue;}
        const {geocodingAddress:_query,verifiedPoint,...publishedAddress}=address;
        const cached = saved.get(
          `${address.basis}:${meeting.bodyId}:${address.address}`,
        );
        if (cached) {
          const pin = {
            ...cached,
            ...publishedAddress,
            ...(address.basis==="GOVERNMENT_OFFICE"?referenceContext(cached):{}),
            meetingId: meeting.id,
            publishedLocation,
          };
          placedCount++;
          const {pendingReplacement:_pending,...checked}=pin;
          return withPublishedPin(meeting,checked);
        }
        const coordinateUrl=verifiedPoint&&URL.canParse(verifiedPoint.coordinateSourceUrl)?new URL(verifiedPoint.coordinateSourceUrl):null;
        const knownPoint=verifiedPoint&&coordinateUrl?.protocol==="https:"&&coordinateUrl.hostname==="geocoding.geo.census.gov"
          &&Number.isFinite(verifiedPoint.lat)&&Math.abs(verifiedPoint.lat)<=90&&Number.isFinite(verifiedPoint.lng)&&Math.abs(verifiedPoint.lng)<=180
          &&Boolean(verifiedPoint.matchedAddress)&&Number.isFinite(Date.parse(verifiedPoint.coordinateCheckedAt))
          &&addressWords(censusAddressQuery(coordinateUrl.searchParams.get("address")??""))===addressWords(publishedAddressQuery(address,meeting))
          ?{lat:verifiedPoint.lat,lng:verifiedPoint.lng,matchedAddress:verifiedPoint.matchedAddress,
            url:verifiedPoint.coordinateSourceUrl,at:verifiedPoint.coordinateCheckedAt}:null;
        const point = knownPoint??await locate(address,meeting);
        if(address.basis==="BODY_OFFICE"){bodyTried=true;if(point===undefined)bodyTransient=true;}
        if (!point) continue;
        const pin: MeetingPinLocation = {
          ...publishedAddress,
          ...(address.basis==="GOVERNMENT_OFFICE"?referenceContext(repeated):{}),
          meetingId: meeting.id,
          lat: point.lat,
          lng: point.lng,
          coordinateSourceUrl: point.url,
          coordinateCheckedAt: point.at,
          matchedAddress: point.matchedAddress,
          publishedLocation,
        };
        saved.set(`${address.basis}:${meeting.bodyId}:${address.address}`, pin);
        placedCount++;
        return withPublishedPin(meeting, pin);
      }
      // A failed refresh keeps the last checked point while acquisition continues for the new address.
      if (repeated?.bodyId === meeting.bodyId) return {...meeting,mapPin:{...repeated,meetingId:meeting.id,
        pendingReplacement:{publishedLocation,onlineOnly:isOnlineOnly(meeting)}}};
      const { mapPin: _old, ...rest } = meeting;
      return rest;
    },
  );
  const meetings = placed.map((row) => {
    if (row.ok) return row.value;
    held.push(`${input.meetings[row.index].id}: ${row.error}`);
    return input.meetings[row.index];
  });
  return { meetings, placedCount, held, responses, attempts };
}

/** Resolve a relative event citation against the exact promoted publisher route. */
export function absolutePublisherMeetingUrl(
  citation: string | null,
  route: string,
): string {
  try {
    const base = new URL(route);
    const resolved = new URL(citation ?? "", base);
    return base.protocol === "https:" && resolved.protocol === "https:"
      ? resolved.toString()
      : route;
  } catch {
    return route;
  }
}

export function normalizeFamilyMeetingCitations(
  meetings: readonly Meeting[],
  routes: ReadonlyMap<string, string>,
): readonly Meeting[] {
  return meetings.map((meeting): Meeting => {
    const sourceId = meeting.id.split(":", 1)[0] ?? "";
    const route = routes.get(`${sourceId}:${meeting.bodyId}`);
    if (!route) return meeting;
    const sourceUrl = absolutePublisherMeetingUrl(
      meeting.provenance.sourceUrl,
      route,
    );
    return sourceUrl === meeting.provenance.sourceUrl
      ? meeting
      : { ...meeting, provenance: { ...meeting.provenance, sourceUrl } };
  });
}

/** Keep an already promoted point only while a fresh read repeats that exact sitting and address. */
export function retainPreviouslyVerifiedVenuePoints(
  meetings: readonly Meeting[],
  previous: readonly Meeting[],
): readonly Meeting[] {
  const byId = new Map(previous.map((meeting) => [meeting.id, meeting]));
  return meetings.map((meeting): Meeting => {
    const prior = byId.get(meeting.id);
    if (
      meeting.location ||
      meeting.venueGap?.kind !== "STATED_NOT_PLACED" ||
      !prior?.location ||
      meeting.bodyId !== prior.bodyId ||
      meeting.ocdId !== prior.ocdId ||
      meeting.provenance.sourceUrl !== prior.provenance.sourceUrl ||
      !repeatsPublishedVenue(
        meeting.venueGap.publishedText ?? "",
        prior.location.name,
        prior.location.address,
      )
    )
      return meeting;
    const { venueGap: _gap, ...rest } = meeting;
    const text=meeting.venueGap.publishedText!;
    // Keep the complete saved venue unless the source explicitly changes its room or suite.
    const previousText=`${prior.location.name} ${prior.location.address ?? ""}`;
    const changedUnit=[/\b(?:room|rm\.?)\s*#?\s*([a-z\d-]+)\b/i,/\b(?:suite|ste\.?)\s*#?\s*([a-z\d-]+)\b/i].some(pattern=>{
      const current=pattern.exec(text)?.[1],previous=pattern.exec(previousText)?.[1];
      return current && previous && current.toLowerCase()!==previous.toLowerCase();
    });
    const retained:Meeting = {
      ...rest,
      location: changedUnit?{...prior.location,...publishedVenueDescription(text,prior.location.address)}:prior.location,
      ...(prior.mapPin
        ? { mapPin: { ...prior.mapPin, meetingId: meeting.id,publishedLocation:text } }
        : {}),
      fieldSources: {
        ...meeting.fieldSources,
        location: prior.fieldSources?.location ?? prior.provenance,
        // Attendance was read again; the point itself was not checked again.
        venueGap: meeting.fieldSources?.venueGap ?? meeting.fieldSources?.location ?? meeting.provenance,
      },
    };
    return retained.mapPin?withPublishedPin(retained,retained.mapPin):retained;
  });
}
