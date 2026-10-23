import { meetingPartitionId, meetingPartitionScope, type MeetingPartitionContract } from "../../../civic-data/meeting-partitions.ts";
import { requiredManualProductionContract } from "../../../civic-data/manual-contracts.ts";
import type { Query } from "../../../facts/publish.ts";
import type { MeetingsSnapshot } from "../../../meetings/snapshot.ts";
import type { VenueEntry } from "../../../meetings/venue-cache.ts";
import { meetingSourceNamesForWiring } from "../../../registry/source-wiring.ts";
import type { Body, Registry } from "../../../registry/types.ts";

const VENUE_CONTRACT = requiredManualProductionContract("venue-resolutions");

/** Resolve immutable array membership before materializing only the selected body's values. */
export const HELD_MEETING_INPUT_SQL = `WITH registry_pointer AS MATERIALIZED (
  SELECT current_version_id,reader_payload_node(payload) AS root FROM civic_data_promotions
    WHERE key='REGISTRY_RUNTIME_BINDING:US-'||$1||':reader-registry-runtime'
      AND record_class='REGISTRY_RUNTIME_BINDING'
), registry AS MATERIALIZED (
  SELECT current_version_id,reader_payload_node(root->'registry') AS value FROM registry_pointer
), bodies AS MATERIALIZED (
  SELECT b.item FROM registry r,LATERAL reader_payload_members(r.value->'bodies') b,
    LATERAL (SELECT reader_payload_node(b.item) AS value) header WHERE header.value->>'id'=$2
), previous_pointer AS MATERIALIZED (
  SELECT source_id,record_class,scope,current_version_id,reader_payload_node(payload) AS value
    FROM civic_data_promotions WHERE key='MEETING:'||$3 AND record_class='MEETING'
), previous_meetings AS MATERIALIZED (
  SELECT m.ordinal_index,m.item,header.value->>'id' AS id,header.value->>'bodyId' AS body_id
    FROM previous_pointer p,LATERAL reader_payload_members(p.value->'meetings') m,
      LATERAL (SELECT reader_payload_node(m.item) AS value) header
), previous_documents AS MATERIALIZED (
  SELECT d.ordinal_index,d.item,header.value->>'meetingId' AS meeting_id
    FROM previous_pointer p,LATERAL reader_payload_members(p.value->'agendaDocuments') d,
      LATERAL (SELECT reader_payload_node(d.item) AS value) header
)
SELECT (SELECT current_version_id FROM registry) AS registry_version_id,
  (SELECT reader_payload_value(value->'generatedAt') FROM registry) AS registry_generated_at,
  coalesce((SELECT jsonb_agg(reader_payload_value(item)) FROM bodies),'[]'::jsonb) AS bodies,
  (SELECT jsonb_build_object('sourceId',source_id,'recordClass',record_class,'scope',scope,'versionId',current_version_id)
    FROM previous_pointer) AS previous_pointer,
  (SELECT reader_payload_value(value-'meetings'-'agendaDocuments') || jsonb_build_object(
    'meetings',coalesce((SELECT jsonb_agg(reader_payload_value(item) ORDER BY ordinal_index)
      FROM previous_meetings WHERE body_id=$2),'[]'::jsonb),
    'agendaDocuments',coalesce((SELECT jsonb_agg(reader_payload_value(item) ORDER BY ordinal_index)
      FROM previous_documents WHERE meeting_id IN (SELECT id FROM previous_meetings WHERE body_id=$2)),'[]'::jsonb))
    FROM previous_pointer) AS previous,
  (SELECT count(*)::int FROM previous_meetings WHERE body_id IS DISTINCT FROM $2) AS foreign_meetings,
  (SELECT count(*)::int FROM previous_documents d WHERE NOT EXISTS
    (SELECT 1 FROM previous_meetings m WHERE m.body_id=$2 AND m.id=d.meeting_id)) AS foreign_documents`;

/** Optional placement is read separately: unreadable venues never suppress a verified calendar. */
export const HELD_MEETING_VENUES_SQL = `WITH venue_pointer AS MATERIALIZED (
  SELECT source_id,record_class,scope,current_version_id,reader_payload_node(payload) AS value
    FROM civic_data_promotions WHERE key='CURATED_READER_RECORD:'||$1 AND record_class='CURATED_READER_RECORD'
), venues AS MATERIALIZED (
  SELECT v.ordinal_index,v.item FROM venue_pointer p,LATERAL reader_payload_members(p.value->'records') v,
    LATERAL (SELECT reader_payload_node(v.item) AS value) header
    WHERE header.value->>'sourceId'=ANY($2::text[])
      AND (header.value->>'bodyOcdId') IS NOT DISTINCT FROM $3::text
      AND ($3::text IS NOT NULL OR (header.value->>'tenant') IS NOT DISTINCT FROM $4::text)
)
SELECT (SELECT jsonb_build_object('sourceId',source_id,'recordClass',record_class,'scope',scope,
    'versionId',current_version_id,'kind',value->>'kind') FROM venue_pointer) AS venue_pointer,
  coalesce((SELECT jsonb_agg(reader_payload_value(item) ORDER BY ordinal_index) FROM venues),'[]'::jsonb) AS venues`;

export interface HeldMeetingInput {
  readonly partition: MeetingPartitionContract;
  readonly registry: Registry;
  readonly previous: MeetingsSnapshot | null;
  readonly venues: readonly VenueEntry[];
  /** A reason keeps unavailable placement distinct from a successfully read, empty venue scope. */
  readonly venuesUnavailable?: string;
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const stateOf = (id: string): string | null =>
  /^(?:ocd-division\/country:us\/(?:state|district|territory):|curated:)([a-z]{2})(?:[/#]|$)/i.exec(id)?.[1]?.toUpperCase() ?? null;
const instant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

function scopeOf(partition: MeetingPartitionContract): string {
  const wiring = partition.wiring, state = stateOf(partition.bodyId);
  if (!state || partition.derivedFamily !== null || !wiring || partition.recordClass !== "MEETING" ||
    partition.id !== meetingPartitionId(partition.meetingSource, partition.bodyId, wiring.config.partitionRoute) ||
    partition.scope !== meetingPartitionScope(partition.meetingSource, partition.bodyId, wiring.config.partitionRoute) ||
    wiring.bodyId !== partition.bodyId || wiring.ocdId !== partition.ocdId ||
    (partition.ocdId !== null && stateOf(partition.ocdId) !== state) ||
    !meetingSourceNamesForWiring(wiring).includes(partition.meetingSource)) {
    throw new Error("HELD_MEETING_INPUT_PARTITION_NOT_ONE_BODY");
  }
  return state;
}

function savedVenues(value: unknown, partition: MeetingPartitionContract): VenueEntry[] {
  if (!Array.isArray(value)) throw new Error("HELD_MEETING_INPUT_VENUES_UNREADABLE");
  const config = partition.wiring!.config, sources = [partition.meetingSource, config.venueSourceId];
  const tenant = config.venueTenant ?? config.slug ?? null;
  return value.map(raw => {
    const entry = object(raw);
    if (!entry || !sources.includes(String(entry.sourceId)) || entry.bodyOcdId !== partition.ocdId ||
      (partition.ocdId === null && (entry.tenant ?? null) !== tenant) ||
      typeof entry.match !== "string" || typeof entry.name !== "string" ||
      (entry.address !== null && typeof entry.address !== "string") ||
      typeof entry.lat !== "number" || !Number.isFinite(entry.lat) || Math.abs(entry.lat) > 90 ||
      typeof entry.lng !== "number" || !Number.isFinite(entry.lng) || Math.abs(entry.lng) > 180 ||
      ![entry.addressSourceUrl, entry.coordinateSourceUrl].every(url => {
        try { const parsed = new URL(String(url)); return parsed.protocol === "https:" && !parsed.username && !parsed.password; }
        catch { return false; }
      }) || (entry.verifiedAt !== null && !instant(entry.verifiedAt))) {
      throw new Error("HELD_MEETING_INPUT_VENUE_NOT_ONE_BODY");
    }
    const { id: _id, ...venue } = entry;
    return venue as unknown as VenueEntry;
  });
}

/** The caller supplies one installed partition; a missing projection is never mistaken for a verified empty slice. */
export async function readHeldMeetingInput(query: Query, partition: MeetingPartitionContract): Promise<HeldMeetingInput> {
  const state = scopeOf(partition), config = partition.wiring!.config;
  const rows = await query(HELD_MEETING_INPUT_SQL, [state, partition.bodyId, partition.scope]);
  if (rows.length !== 1) throw new Error("HELD_MEETING_INPUT_READ_FAILED");
  const row = rows[0]!, bodies = row.bodies;
  if (typeof row.registry_version_id !== "string" || !instant(row.registry_generated_at) || !Array.isArray(bodies) || bodies.length !== 1) {
    throw new Error(`HELD_MEETING_INPUT_BODY_NOT_HELD:${partition.bodyId}`);
  }
  const body = object(bodies[0]);
  if (!body || body.id !== partition.bodyId || body.ocdId !== partition.ocdId || stateOf(String(body.id)) !== state) {
    throw new Error("HELD_MEETING_INPUT_REGISTRY_NOT_ONE_BODY");
  }
  const pointer = object(row.previous_pointer), previous = row.previous;
  if (pointer !== null) {
    if (pointer.sourceId !== partition.sourceId || pointer.recordClass !== "MEETING" || pointer.scope !== partition.scope ||
      typeof pointer.versionId !== "string" || Number(row.foreign_meetings) !== 0 || Number(row.foreign_documents) !== 0) {
      throw new Error("HELD_MEETING_INPUT_PREVIOUS_NOT_ONE_BODY");
    }
    const snapshot = object(previous);
    if (!snapshot || snapshot.formatVersion !== 1 || !instant(snapshot.generatedAt) || !Array.isArray(snapshot.meetings) ||
      !Array.isArray(snapshot.agendaDocuments) || !Array.isArray(snapshot.sources) ||
      snapshot.sources.some(source => object(source)?.source !== partition.meetingSource) ||
      snapshot.meetings.some(meeting => object(meeting)?.bodyId !== partition.bodyId || object(meeting)?.ocdId !== partition.ocdId)) {
      throw new Error("HELD_MEETING_INPUT_PREVIOUS_NOT_ONE_BODY");
    }
    const meetingIds = new Set(snapshot.meetings.map(meeting => object(meeting)?.id));
    if (snapshot.agendaDocuments.some(document => !meetingIds.has(object(document)?.meetingId) || object(document)?.ocdId !== partition.ocdId)) {
      throw new Error("HELD_MEETING_INPUT_PREVIOUS_NOT_ONE_BODY");
    }
  } else if (previous !== null) throw new Error("HELD_MEETING_INPUT_PREVIOUS_UNREADABLE");
  let venues: VenueEntry[] = [], venuesUnavailable: string | null = null;
  try {
    const venueRows = await query(HELD_MEETING_VENUES_SQL, [VENUE_CONTRACT.scope,
      [...new Set([partition.meetingSource, config.venueSourceId].filter((source): source is string => Boolean(source)))],
      partition.ocdId, config.venueTenant ?? config.slug ?? null]);
    const venueRow = venueRows.length === 1 ? venueRows[0] : null, venuePointer = object(venueRow?.venue_pointer);
    if (!venuePointer || venuePointer.sourceId !== VENUE_CONTRACT.sourceId || venuePointer.recordClass !== VENUE_CONTRACT.recordClass ||
      venuePointer.scope !== VENUE_CONTRACT.scope || typeof venuePointer.versionId !== "string" || venuePointer.kind !== "venue-resolutions") {
      throw new Error("HELD_MEETING_INPUT_VENUES_NOT_HELD");
    }
    venues = savedVenues(venueRow?.venues, partition);
  } catch (error) {
    venuesUnavailable = error instanceof Error ? error.message : "HELD_MEETING_INPUT_VENUES_UNREADABLE";
  }
  return { partition, registry: { generatedAt: row.registry_generated_at, divisions: [], bodies: [body as unknown as Body] },
    previous: previous as MeetingsSnapshot | null, venues, ...(venuesUnavailable ? { venuesUnavailable } : {}) };
}
