import { promotedPayloadSha256 } from "../civic-data/attested-promotion.ts";
import { readPromotedCivicData, type PromotedEdgeEntry } from "../civic-data/read-model.ts";
import { requireRegistryState } from "../civic-data/state-scopes.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { meetingPartitionId } from "../meetings/body-scope.ts";
import { outcomePartitionScope } from "../outcomes/door-outcome-pointers.ts";
import type { OutcomeSnapshot } from "../outcomes/types.ts";
import { readerDatabaseQuery } from "./database.ts";

const stateScope = `(p.scope LIKE ANY($1::text[]) OR p.scope LIKE ANY($6::text[]))`;
const bodySelected = (header: string) => `(${header}->>'bodyId'=ANY($2::text[]) OR ${header}->>'meetingId'=ANY($2::text[])
  OR EXISTS(SELECT 1 FROM entity e WHERE e.id=${header}->>'bodyId' AND e.state=ANY($5::text[])))`;

// Select sitting headers before expanding immutable parts: a body's other meetings stay in the database.
const SELECTED_OUTCOMES = `WITH selected AS MATERIALIZED (
  SELECT p.key,p.record_class,p.scope,p.source_id,p.current_version_id,p.last_known_good_version_id,p.promoted_at,
    CASE WHEN jsonb_typeof(p.validation_receipt->'excludedFacts')='array' THEN
      jsonb_set(p.validation_receipt,'{excludedFacts}',coalesce((SELECT jsonb_agg(f.value-'record') FROM jsonb_array_elements(p.validation_receipt->'excludedFacts') f(value)),'[]'::jsonb))
      ELSE p.validation_receipt END AS validation_receipt,
    reader_payload_node(p.payload) AS root,c.retrieved_at,reader_payload_node(c.candidate)->'temporal' AS temporal,
    ${stateScope} AS state_scoped,
    ($3::text[] IS NULL AND EXISTS(SELECT 1 FROM reader_payload_members(reader_payload_node(p.payload)->'sittings') s
      WHERE ${bodySelected("reader_payload_node(s.item)")})) AS selected_by_body,
    (p.current_version_id=p.last_known_good_version_id AND c.id=p.current_version_id AND c.state='PROMOTED' AND c.acquisition_succeeded
      AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id AND c.record_class=p.record_class AND c.scope=p.scope AND c.source_id=p.source_id
      AND p.validation_receipt->>'decision'='GOOD' AND p.validation_receipt->>'candidateId'=c.id AND p.validation_receipt->>'sourceId'=c.source_id
      AND p.validation_receipt->>'recordClass'=p.record_class AND p.validation_receipt->>'scope'=p.scope) AS published
    FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
    WHERE p.record_class='MEETING_OUTCOME' AND (${stateScope} OR p.key=ANY($4::text[])
      OR $3::text[] IS NULL AND p.scope LIKE 'door:%:outcomes' AND EXISTS(
        SELECT 1 FROM reader_payload_members(reader_payload_node(p.payload)->'sittings') s WHERE ${bodySelected("reader_payload_node(s.item)")}))
)
SELECT key,record_class,scope,source_id,current_version_id,last_known_good_version_id,promoted_at,validation_receipt,retrieved_at,temporal,published,selected_by_body,
  (jsonb_typeof(selected.root)='object' AND selected.root ? 'sittings' AND selected.root ? 'tenants') AS snapshot_shape_valid,
  CASE WHEN $3::text[] IS NULL THEN reader_payload_value(matching.root) ELSE reader_place_payload(matching.root,$2::text[],NULL) END AS payload
  FROM selected CROSS JOIN LATERAL (SELECT root||jsonb_build_object('sittings',coalesce((
    SELECT jsonb_agg(s.item ORDER BY s.ordinal_index) FROM reader_payload_members(root->'sittings') s
    WHERE CASE WHEN $3::text[] IS NOT NULL THEN reader_payload_node(s.item)->>'meetingId'=ANY($3::text[])
      ELSE state_scoped OR ${bodySelected("reader_payload_node(s.item)")} END
  ),'[]'::jsonb)) AS root) matching ORDER BY scope,key`;

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function assertSnapshot(value: unknown, ids: ReadonlySet<string> | null): asserts value is OutcomeSnapshot {
  if (!object(value) || typeof value.generatedOn !== "string" || typeof value.generatedAt !== "string" ||
      !Array.isArray(value.tenants) || value.tenants.some(tenant => typeof tenant !== "string") || !Array.isArray(value.sittings)) {
    throw new Error("READER_OUTCOME_SNAPSHOT_INVALID");
  }
  for (const sitting of value.sittings) {
    if (!object(sitting) || typeof sitting.meetingId !== "string" || (ids !== null && !ids.has(sitting.meetingId)) ||
        (sitting.bodyId !== null && typeof sitting.bodyId !== "string") || typeof sitting.slug !== "string" ||
        !value.tenants.includes(sitting.slug) || (sitting.startsAt !== null && typeof sitting.startsAt !== "string") ||
        typeof sitting.sourceOrg !== "string" || (sitting.sourceUrl !== null && typeof sitting.sourceUrl !== "string") ||
        !["RETRIEVED", "ZERO_ROWS_FAILED", "REQUEST_FAILED", "NOT_YET_PUBLISHED"].includes(String(sitting.extraction)) ||
        !Array.isArray(sitting.failedRollCallExtractions) || !Array.isArray(sitting.voteRequestFailures)) {
      throw new Error("READER_OUTCOME_SITTING_INVALID");
    }
    for (const [field, recordClass] of [["agenda", "AGENDA"], ["outcomes", "ACTION_SUMMARY"], ["rollCalls", "ROLL_CALL"]] as const) {
      const records = sitting[field];
      if (!Array.isArray(records) || records.some(record => !object(record) || record.recordClass !== recordClass ||
          typeof record.eventItemId !== "number" || !object(record.provenance) ||
          (field === "agenda" && typeof record.title !== "string") || (field === "rollCalls" && !Array.isArray(record.votes)))) {
        throw new Error(`READER_OUTCOME_RECORDS_INVALID:${field}`);
      }
    }
  }
}

/** The selected sitting and all verified aliases, from current source promotions in one read-only socket statement. */
export async function readSelectedMeetingOutcomes(states: readonly string[], bodyId: string | null | undefined, meetingIds: readonly string[],
  query: ReadOnlyQuery | null = readerDatabaseQuery()): Promise<OutcomeSnapshot> {
  return readMeetingOutcomes(states, bodyId ? [bodyId] : [], new Set(meetingIds.filter(Boolean)), query);
}

/** Ask keeps every held year in the named states, including door sources absent from a runner's catalogue. */
export function readStateMeetingOutcomes(states: readonly string[], selectors: readonly string[] = [],
  query: ReadOnlyQuery | null = readerDatabaseQuery()): Promise<OutcomeSnapshot> {
  return readMeetingOutcomes(states, selectors, null, query);
}

async function readMeetingOutcomes(states: readonly string[], selectors: readonly string[], ids: ReadonlySet<string> | null,
  query: ReadOnlyQuery | null): Promise<OutcomeSnapshot> {
  if (!query) throw new Error("READER_STORE_NOT_CONFIGURED");
  const selectedStates = [...new Set(states.map(state => requireRegistryState(state.replace(/^US-/i, ""))))];
  if (!selectedStates.length) throw new Error("READER_OUTCOME_STATE_REQUIRED");
  const keys = [...new Set([...(ids ?? []), ...selectors])];
  const doorKeys = selectors.flatMap(bodyId => ["legistar", "legistar-insite"].map(kind =>
    `MEETING_OUTCOME:${outcomePartitionScope(meetingPartitionId(kind, bodyId))}`));
  const doorPrefixes = ids === null ? selectedStates.flatMap(state => ["state", "district", "territory"].flatMap(type =>
    ["legistar", "legistar-insite"].map(kind => outcomePartitionScope(meetingPartitionId(kind,
      `ocd-division/country:us/${type}:${state.toLowerCase()}/`)).slice(0, -":outcomes".length)))) : [];
  const [rows] = await query([{ text: SELECTED_OUTCOMES, params: [selectedStates.map(state => `US-${state}:%`), keys, ids === null ? null : [...ids], doorKeys,
    selectedStates, doorPrefixes.map(prefix => prefix.replace(/[\\%_]/g, "\\$&") + "%")] }]);
  const snapshots: OutcomeSnapshot[] = [];
  for (const row of rows) {
    if (row.published !== true) throw new Error("READER_OUTCOME_PUBLICATION_INVALID");
    if (row.snapshot_shape_valid !== true) throw new Error("READER_OUTCOME_SNAPSHOT_INVALID");
    const scope = String(row.scope);
    if (row.record_class !== "MEETING_OUTCOME" || !(selectedStates.some(state => scope.startsWith(`US-${state}:`)) || doorKeys.includes(String(row.key))
        || doorPrefixes.some(prefix => scope.startsWith(prefix)) || ids === null && row.selected_by_body === true)) {
      throw new Error("READER_OUTCOME_SOURCE_SCOPE_INVALID");
    }
    const temporal = object(row.temporal) ? row.temporal : {};
    const entry: Extract<PromotedEdgeEntry, { kind: "PROMOTED" }> = {
      kind: "PROMOTED", projection: {
        key: String(row.key), recordClass: "MEETING_OUTCOME", scope, sourceId: String(row.source_id),
        versionId: String(row.current_version_id), lastKnownGoodVersionId: String(row.last_known_good_version_id),
        promotedAt: new Date(row.promoted_at as string).toISOString(), payload: row.payload,
        receipt: row.validation_receipt as Extract<PromotedEdgeEntry, { kind: "PROMOTED" }>["projection"]["receipt"],
      }, attested: { recordClass: "MEETING_OUTCOME", scope, versionId: String(row.current_version_id),
        payloadSha256: promotedPayloadSha256(row.payload), retrievedAt: new Date(row.retrieved_at as string).toISOString(),
        staleAtRetrieval: temporal.staleAtRetrieval === true, version: typeof temporal.version === "string" ? temporal.version : null,
        sourceThrough: typeof temporal.sourceThrough === "string" ? temporal.sourceThrough : null },
    };
    const read = await readPromotedCivicData<OutcomeSnapshot>("MEETING_OUTCOME", scope, { edge: entry });
    if (read.kind !== "PROMOTED") throw new Error(`READER_OUTCOME_PROOF_INVALID:${read.kind}`);
    assertSnapshot(read.value, ids);
    snapshots.push(read.value);
  }
  const stamp = (field: "generatedOn" | "generatedAt") => snapshots.map(snapshot => snapshot[field]).filter(value => value !== "UNKNOWN").sort().at(-1) ?? "UNKNOWN";
  return { generatedOn: stamp("generatedOn"), generatedAt: stamp("generatedAt"),
    tenants: [...new Set(snapshots.flatMap(snapshot => snapshot.tenants))].sort(),
    sittings: snapshots.flatMap(snapshot => snapshot.sittings),
    ...(ids === null ? { pointers: rows.flatMap((row, index) => snapshots[index].tenants.map(tenant => ({
      contractId: String(row.key), tenant, versionId: String(row.current_version_id),
    }))) } : {}) };
}
