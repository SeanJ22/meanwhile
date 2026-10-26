import type { Query } from "../facts/publish.ts";
import { censusAddressQuery } from "../geo/address-query.ts";
import type { RegistryProvenance } from "../registry/types.ts";
import type { Meeting } from "../sources/types.ts";
import { streetKeyOf } from "./agenda-address.ts";
import type { MeetingPinBody } from "./pin-location.ts";

const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function municipality(jurisdiction: string): string | null {
  return /^(?:city|town|village|borough|municipality) of (.+)$/i.exec(jurisdiction)?.[1]
    ?? /^(.+) (?:city|town|village|borough)$/i.exec(jurisdiction)?.[1] ?? null;
}

// Only published municipal-hall venue/address fields leave Postgres, in bounded pages.
const HALL_ADDRESSES_SQL = `WITH venues AS (
  SELECT body_id,value->>'ocdId' AS ocd_id,value->>'jurisdiction' AS jurisdiction,value->>'startsAt' AS starts_at,
    value->'location' AS location,value->'venueGap' AS venue_gap,value->'provenance' AS provenance
  FROM civic_data_rows WHERE record_class='MEETING' AND collection='meetings' AND split_part(body_id,'#',1)=$1 AND (
    left(split_part(scope,':',4),length($2))=$2 AND left(scope,7)='source:' AND split_part(scope,':',3)='body' AND right(scope,8)<>':history'
    OR promotion_key='MEETING:source:derived:family:US-'||$3
  )
), halls AS (
SELECT DISTINCT ON (coalesce(location->>'address',location->>'name',venue_gap->>'publishedText'),ocd_id,jurisdiction)
  body_id,ocd_id,jurisdiction,starts_at,location,venue_gap,provenance FROM venues
WHERE coalesce(location->>'name',venue_gap->>'publishedText','') ~* '^(city|town|village|borough) hall\\M'
  AND provenance->>'sourceUrl' IS NOT NULL
ORDER BY coalesce(location->>'address',location->>'name',venue_gap->>'publishedText'),ocd_id,jurisdiction,
  starts_at DESC,body_id,provenance
)
SELECT body_id,ocd_id,jurisdiction,starts_at,location,venue_gap,provenance FROM halls
ORDER BY starts_at DESC,body_id,location,venue_gap,provenance,ocd_id,jurisdiction
LIMIT 64 OFFSET $4`;

/** A hall explicitly named by the municipality is its office, not another board's meeting location. */
export async function withMunicipalHallOffices(
  query: Query | undefined,
  meetings: readonly Meeting[],
  offices: ReadonlyMap<string, MeetingPinBody>,
  onFailure: (detail: string) => void,
  previous: ReadonlyMap<string, Meeting> = new Map(),
): Promise<ReadonlyMap<string, MeetingPinBody>> {
  const groups = new Map<string, { name: string; state: string; bodies: Set<string> }>();
  for (const meeting of meetings) {
    if (meeting.location || !meeting.bodyId) continue;
    const pin = previous.get(meeting.id)?.mapPin ?? meeting.mapPin;
    const body = offices.get(meeting.bodyId);
    if (pin?.bodyId === meeting.bodyId && (
      pin.basis === "BODY_OFFICE" && pin.address === body?.officeContact?.address ||
      pin.basis === "GOVERNMENT_OFFICE" && pin.address === body?.governmentOffice?.address
    )) continue;
    const division = meeting.bodyId.split("#")[0];
    const scope = /^ocd-division\/country:us\/state:([a-z]{2})\/place:([^/#]+)$/.exec(division);
    const city = municipality(meeting.jurisdiction);
    if (!scope || !city || words(scope[2].replace(/_(?:city|town|village|borough)$/, "")) !== words(city)) continue;
    const group = groups.get(division) ?? { name: city, state: scope[1].toUpperCase(), bodies: new Set<string>() };
    group.bodies.add(meeting.bodyId);
    groups.set(division, group);
  }
  if (!groups.size) return offices;
  const result = new Map(offices);
  for (const [division, group] of groups) {
    const halls: NonNullable<MeetingPinBody["governmentOffice"]>[] = [];
    const seen = new Set<string>();
    const consider = (source: Pick<Meeting, "bodyId" | "ocdId" | "jurisdiction" | "location" | "venueGap" | "provenance">) => {
      if (source.bodyId?.split("#")[0] !== division || source.ocdId && source.ocdId !== division
        || words(municipality(source.jurisdiction) ?? "") !== words(group.name)) return;
      const venue = source.location?.name ?? source.venueGap?.publishedText ?? "";
      if (!/^(?:city|town|village|borough) hall\b/i.test(venue) || /\bhall\s+meeting\b/i.test(venue)) return;
      const address = source.location?.address ?? venue;
      const parsed = censusAddressQuery(address), street = streetKeyOf(parsed);
      if (!street || street.index !== 0) return;
      const locality = /^,\s*([^,]+),\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/i.exec(parsed.slice(street.length));
      if (!locality || words(locality[1]) !== words(group.name) || locality[2].toUpperCase() !== group.state) return;
      const provenance = source.provenance;
      if (!provenance?.sourceUrl || !Number.isFinite(Date.parse(provenance.collectedAt))) return;
      const key = words(parsed);
      if (seen.has(key)) return;
      seen.add(key);
      halls.push({ name: source.jurisdiction, address: parsed, provenance });
    };
    for (const meeting of meetings) consider(meeting);
    if (query) try {
      for (let offset = 0; ; offset += 64) {
        const rows = await query(HALL_ADDRESSES_SQL, [division, encodeURIComponent(`${division}#`), group.state, offset]);
        for (const row of rows) consider({ bodyId: String(row.body_id), ocdId: typeof row.ocd_id === "string" ? row.ocd_id : null,
          jurisdiction: String(row.jurisdiction), location: row.location as Meeting["location"],
          venueGap: row.venue_gap as Meeting["venueGap"], provenance: row.provenance as RegistryProvenance });
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
