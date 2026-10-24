import { runBoundedWorkPool } from "../ops/bounded-work-pool.ts";
import { createHash } from "node:crypto";
import type { Query } from "../facts/publish.ts";
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
import { OUTBOUND_USER_AGENT } from "../geo/outbound-agent.ts";
import { isOfficeStreetAddress } from "../map/office-locator.ts";
import type { Meeting } from "../sources/types.ts";
import type { RegistryProvenance } from "../registry/types.ts";
import {
  meetingPinAddresses,
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
    SELECT g FROM inventory WHERE g->>'state'=b.state AND (g->>'jurisdictionId'=b.parent_id OR g->>'id'=b.parent_id
      OR g->'aliases' ? b.id OR g->'bodyIds' ? b.id) ORDER BY (g->>'jurisdictionId'=b.parent_id) DESC,g->>'id' LIMIT 1
  ) owned ON true
)
SELECT b.id,b.name,office.value#>>'{}' AS board_address,office.checked_at AS board_checked,office_source.url AS board_source,
  coalesce(government.name,o.g->>'name') AS government_name,
  coalesce(government.value#>>'{}',o.g->>'officeAddress') AS government_address,
  coalesce(CASE WHEN government.value IS NOT NULL THEN jsonb_build_object('sourceUrl',government.url,
    'sourceOrg',government.name,'collectedAt',government.checked_at,'verifiedAt',government.checked_at) END,
    o.g#>'{contactProvenance,officeAddress}',o.g->'provenance') AS government_source
FROM selected b JOIN owners o ON o.id=b.id
LEFT JOIN LATERAL (SELECT value,checked_at,source_copy_id FROM fact WHERE entity_id=b.id AND field='office_address' AND status='live' ORDER BY checked_at DESC LIMIT 1) office ON true
LEFT JOIN source_copy office_source ON office_source.id=office.source_copy_id
LEFT JOIN LATERAL (
  SELECT e.name,f.value,f.checked_at,s.url FROM entity e JOIN fact f ON f.entity_id=e.id AND f.status='live' AND f.field='office_address'
    JOIN source_copy s ON s.id=f.source_copy_id WHERE e.kind='government' AND e.state=b.state
      AND e.id IN (b.parent_id,o.g->>'jurisdictionId',o.g->>'id') ORDER BY f.checked_at DESC,e.id LIMIT 1
) government ON true`;

export async function publishedPinOffices(
  query: Query | undefined,
  bodyIds: readonly string[],
): Promise<ReadonlyMap<string, MeetingPinBody>> {
  if (!query || !bodyIds.length) return new Map();
  const rows = await query(PIN_OFFICES_SQL, [[...new Set(bodyIds)]]);
  return new Map(
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
}

export interface PublishedPinResult {
  readonly meetings: readonly Meeting[];
  readonly placedCount: number;
  readonly held: readonly string[];
  readonly responses: readonly RetainedSourceResponse[];
}

/** Geocode at publication, then keep the point with the meeting. A fresh visit only reads saved points. */
export async function placePublishedMeetingPins(input: {
  readonly meetings: readonly Meeting[];
  readonly previous?: readonly Meeting[];
  readonly query?: Query;
  readonly offices?: ReadonlyMap<string, MeetingPinBody>;
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
  const saved = new Map<string, MeetingPinLocation>();
  for (const meeting of [...(input.previous ?? []), ...input.meetings])
    if (meeting.mapPin)
      saved.set(
        `${meeting.mapPin.basis}:${meeting.bodyId}:${meeting.mapPin.address}`,
        meeting.mapPin,
      );
  const lookups = new Map<
    string,
    Promise<{
      lat: number;
      lng: number;
      matchedAddress: string;
      url: string;
      at: string;
    } | null>
  >();
  const locate = (
    address: MeetingPinAddress,
  ): Promise<{
    lat: number;
    lng: number;
    matchedAddress: string;
    url: string;
    at: string;
  } | null> => {
    const query = censusAddressQuery(address.address);
    if (
      !isOfficeStreetAddress(query) ||
      query.length < 3 ||
      query.length > 200 ||
      !/[0-9]/.test(query)
    )
      return Promise.resolve(null);
    const prior = lookups.get(query);
    if (prior) return prior;
    const pending = (async () => {
      const url = new URL(CENSUS_GEOCODER_URL);
      url.searchParams.set("address", query);
      url.searchParams.set("benchmark", CENSUS_BENCHMARK);
      url.searchParams.set("format", "json");
      try {
        const response = await fetchImpl(url, {
          signal: AbortSignal.timeout(8000),
          headers: { "user-agent": OUTBOUND_USER_AGENT },
        });
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!response.ok) {
          held.push(`${address.address}: Census HTTP ${response.status}`);
          return null;
        }
        const finalUrl = response.url || url.href;
        if (new URL(finalUrl).hostname !== "geocoding.geo.census.gov")
          return null;
        const point = verifiedCensusVenuePoint(
          address.address,
          JSON.parse(new TextDecoder().decode(bytes)),
        );
        if (!point) return null;
        const at = clock();
        responses.push({
          source: "census-geocoder",
          requestedUrl: url.href,
          finalUrl,
          httpStatus: response.status,
          rawHash: createHash("sha256").update(bytes).digest("hex"),
          byteCount: bytes.length,
          bytes,
          retrievedAt: at,
          contentType: "application/json",
        });
        return {
          lat: point.lat,
          lng: point.lng,
          matchedAddress: point.address,
          url: finalUrl,
          at,
        };
      } catch (error) {
        held.push(
          `${address.address}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }
    })();
    lookups.set(query, pending);
    return pending;
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
      if (meeting.location) return meeting;
      const retained = retainedMeetings[index];
      if (retained.location) return retained;
      const candidates = meetingPinAddresses(
        meeting,
        offices.get(meeting.bodyId ?? ""),
      );
      const prior = previous.get(meeting.id);
      const publishedLocation = meeting.venueGap?.publishedText ?? null;
      const repeated = prior?.mapPin ?? meeting.mapPin;
      // An unavailable office read cannot erase a point already published for this unchanged sitting.
      if (
        officesUnavailable &&
        repeated &&
        repeated.basis !== "MEETING" &&
        repeated.bodyId === meeting.bodyId &&
        repeated.publishedLocation === publishedLocation &&
        Boolean(meeting.online) === Boolean(prior?.online ?? meeting.online)
      )
        candidates.push(repeated);
      if (
        repeated &&
        repeated.publishedLocation === publishedLocation &&
        Boolean(meeting.online) === Boolean(prior?.online ?? meeting.online) &&
        candidates.some(
          (address) =>
            address.basis === repeated.basis &&
            address.address === repeated.address,
        )
      ) {
        placedCount++;
        return withPublishedPin(meeting, {
          ...repeated,
          meetingId: meeting.id,
        });
      }
      for (const address of candidates) {
        const cached = saved.get(
          `${address.basis}:${meeting.bodyId}:${address.address}`,
        );
        if (cached) {
          const pin = {
            ...cached,
            ...address,
            meetingId: meeting.id,
            publishedLocation,
          };
          placedCount++;
          return withPublishedPin(meeting, pin);
        }
        const point = await locate(address);
        if (!point) continue;
        const pin: MeetingPinLocation = {
          ...address,
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
      const { mapPin: _old, ...rest } = meeting;
      return rest;
    },
  );
  const meetings = placed.map((row) => {
    if (row.ok) return row.value;
    held.push(`${input.meetings[row.index].id}: ${row.error}`);
    return input.meetings[row.index];
  });
  return { meetings, placedCount, held, responses };
}

function withPublishedPin(meeting: Meeting, pin: MeetingPinLocation): Meeting {
  return pin.basis === "MEETING" && !meeting.online
    ? {
        ...meeting,
        mapPin: pin,
        location: {
          name: pin.name,
          address: pin.address,
          lat: pin.lat,
          lng: pin.lng,
        },
        venueGap: undefined,
      }
    : { ...meeting, mapPin: pin };
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
    return {
      ...rest,
      location: prior.location,
      ...(prior.mapPin
        ? { mapPin: { ...prior.mapPin, meetingId: meeting.id } }
        : {}),
      fieldSources: {
        ...meeting.fieldSources,
        location: prior.fieldSources?.location ?? prior.provenance,
      },
    };
  });
}
