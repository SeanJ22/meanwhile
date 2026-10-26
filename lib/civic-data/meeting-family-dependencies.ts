import type { Query } from "../facts/publish.ts";
import type { Registry } from "../registry/types.ts";
import type { VenueEntry } from "../meetings/venue-cache.ts";
import type { DerivedWiringRecord } from "./derived-meeting-wiring.ts";
import { DERIVED_WIRING_SOURCE_NAMES } from "./derived-meeting-wiring.ts";
import { readKeyedRegistry } from "./keyed-rows.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { stateRegistryRuntimeScope } from "./state-scopes.ts";
import { meetingVenueChoices } from "./meeting-venue-inputs.ts";

/** Attribution needs the named governments' other bodies and served divisions, never the state's inventory. */
export async function readMeetingFamilyDependencies(query: Query, state: string, members: readonly DerivedWiringRecord[], now: string): Promise<{
  readonly registry: Registry; readonly venues: readonly VenueEntry[];
}> {
  const bodies = [...new Set(members.map(member => member.row.bodyId))], governments = [...new Set(members.map(member => member.row.ocdId))];
  const expanded = await query(`SELECT r.row_id FROM civic_data_promotions p JOIN civic_data_rows r
    ON r.promotion_key=p.key AND r.version_id=p.current_version_id WHERE p.key=$1 AND r.collection='registry.bodies'
      AND (r.row_id=ANY($2::text[]) OR split_part(r.body_id,'#',1)=ANY($3::text[]))`, [
    `REGISTRY_RUNTIME_BINDING:${stateRegistryRuntimeScope(state.replace(/^US-/, ""))}`, bodies, governments,
  ]);
  const registry = await readKeyedRegistry(query, state.replace(/^US-/, ""), [...new Set([...bodies, ...expanded.map(row => String(row.row_id))])], governments);
  if (!registry) throw new Error(`MEETING_FAMILY_REGISTRY_NOT_HELD:${state}`);
  const wanted = members.flatMap(member => [...new Set([DERIVED_WIRING_SOURCE_NAMES[member.row.kind], member.row.config.venueSourceId].filter((source): source is string => Boolean(source)))].map(sourceId => ({
    sourceId, bodyOcdId: member.row.ocdId, tenant: member.row.config.venueTenant ?? member.row.config.slug ?? null })));
  const contract = requiredManualProductionContract("venue-resolutions");
  const rows = await query(`WITH pointer AS MATERIALIZED (
    SELECT p.key,p.current_version_id,p.source_id,p.record_class,p.scope,reader_payload_node(p.payload) AS value,
      (p.current_version_id=p.last_known_good_version_id AND c.state='PROMOTED' AND c.source_id=p.source_id
        AND c.record_class=p.record_class AND c.scope=p.scope AND c.candidate->'readModel'=p.payload
        AND p.validation_receipt=c.validation_receipt AND p.validation_receipt->>'decision'='GOOD') AS valid
      FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.key=$1
  ), wanted AS (SELECT * FROM jsonb_to_recordset($2::jsonb) AS w("sourceId" text,"bodyOcdId" text,tenant text))
  SELECT p.source_id,p.record_class,p.scope,p.valid,p.value->>'kind' AS kind,
    coalesce((SELECT jsonb_agg(reader_payload_value(r.value) ORDER BY r.ordinal) FROM civic_data_rows r
      WHERE r.promotion_key=p.key AND r.version_id=p.current_version_id AND r.collection='venues'
        AND EXISTS (SELECT 1 FROM wanted w WHERE r.value->>'sourceId'=w."sourceId" AND r.body_id IS NOT DISTINCT FROM w."bodyOcdId"
          AND (w."bodyOcdId" IS NOT NULL OR r.value->>'tenant' IS NOT DISTINCT FROM w.tenant))),'[]'::jsonb) AS venues
    FROM pointer p`, [`${contract.recordClass}:${contract.scope}`, JSON.stringify(wanted)]);
  const venue = rows[0];
  const venuesHeld = venue?.valid === true && venue.source_id === contract.sourceId && venue.record_class === contract.recordClass && venue.scope === contract.scope && venue.kind === "venue-resolutions";
  if (!venuesHeld) console.warn("MEETING_FAMILY_VENUES_NOT_HELD: verified calendars remain independently readable; prior verified points remain held.");
  return { registry: { generatedAt: now, bodies: registry.payload.registry.bodies, divisions: registry.payload.registry.divisions },
    venues: venuesHeld ? await meetingVenueChoices(query, venue.venues as VenueEntry[]) : [] };
}
