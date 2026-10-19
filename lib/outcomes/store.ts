import {
  evidenceRecordsFor,
  ruleOnQuestion,
} from "../answerability/record-class.ts";
import type {
  QuestionClass,
  RecordClass,
} from "../answerability/record-class.ts";

import type {
  LegistarAgendaRecord,
  LegistarOutcomeRecord,
  LegistarRollCallRecord,
} from "../sources/legistar/outcomes.ts";
import { reconcilePublicationObservations } from "./publication.ts";
import type { ReconciledPublication } from "./publication.ts";
import type {
  OutcomeSnapshot,
  PersistedSittingOutcomes,
} from "./types.ts";
import {
  CivicDataStoreUnavailableError,
  civicDataReadNotInitialized,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
  type PromotedEdgeEntry,
} from "../civic-data/read-model.ts";
import { MESA_OUTCOME_TENANT, PIMA_OUTCOME_TENANT } from "./data-plane.ts";
import { currentMeetingOutcomesEdge, settleEdgeFirst } from "../registry/runtime-edge.ts";
import { DOOR_OUTCOME_POINTERS, doorOutcomeScopeIssue, outcomePartitionScope, type DoorOutcomePointer } from "./door-outcome-pointers.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { requireRegistryState, statesForRegistryDivisions } from "../civic-data/state-scopes.ts";
import { promotedPayloadSha256 } from "../civic-data/attested-promotion.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { meetingPartitionId } from "../meetings/body-scope.ts";
import { readerDatabaseQuery } from "../reader/database.ts";

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

const EMPTY: OutcomeSnapshot = {
  generatedOn: "UNKNOWN",
  generatedAt: "UNKNOWN",
  tenants: [],
  sittings: [],
};

const STANDING_OUTCOME_POINTERS: readonly DoorOutcomePointer[] = [
  { contractId: PIMA_OUTCOME_TENANT.contractId, scope: PIMA_OUTCOME_TENANT.scope, recordClass: "MEETING_OUTCOME", slug: PIMA_OUTCOME_TENANT.slug, kind: "legistar" },
  { contractId: MESA_OUTCOME_TENANT.contractId, scope: MESA_OUTCOME_TENANT.scope, recordClass: "MEETING_OUTCOME", slug: MESA_OUTCOME_TENANT.slug, kind: "legistar-insite" },
];

export function outcomePointers(): readonly DoorOutcomePointer[] {
  const standing = new Set(STANDING_OUTCOME_POINTERS.map((pointer) => pointer.contractId));
  return [...STANDING_OUTCOME_POINTERS, ...DOOR_OUTCOME_POINTERS.filter((pointer) => !standing.has(pointer.contractId))];
}

/** One door's read; a failed read is recorded here and never costs a reader another door's answers. */
const readStates = new Map<string, { readonly pointer: DoorOutcomePointer; readonly state: CivicDataReadResult<OutcomeSnapshot> }>();
type RequestOutcomes = { pending: Promise<string | null>; value?: OutcomeSnapshot; detail?: string };
let readerOutcomes = new WeakMap<object, RequestOutcomes>();
const requestOutcomes = () => { const selection = currentReaderSelection(); return selection ? readerOutcomes.get(selection) : undefined; };
/** The edge artifact this process was primed from, or null when the doors were read from the database. */
let edgePart: { readonly value: OutcomeSnapshot; readonly versionId: string } | null = null;

export interface DoorOutcomePart { readonly value: OutcomeSnapshot; readonly pointers: readonly OutcomePointerRef[] }

export interface OutcomePointerRef { readonly contractId: string; readonly tenant: string; readonly versionId: string }

let injected: OutcomeSnapshot | null = null;

/** Install a snapshot for the duration of a test, or pass `null` to restore the store. Always restore. */
export function useOutcomeSnapshotForTests(snapshot: OutcomeSnapshot | null): void {
  injected = snapshot;
  readStates.clear();
  edgePart = null;
  combinedMemo = null;
}

function outcomeScopeIssue(pointer: DoorOutcomePointer, value: OutcomeSnapshot): string | null {
  return !Array.isArray(value.sittings) || !Array.isArray(value.tenants)
    ? `${pointer.contractId} is malformed.`
    : doorOutcomeScopeIssue(pointer, value);
}

async function readOneDoorOutcome(pointer: DoorOutcomePointer, options: PromotedCivicDataReadOptions): Promise<CivicDataReadResult<OutcomeSnapshot>> {
  const read = await readPromotedCivicData<OutcomeSnapshot>(pointer.recordClass, pointer.scope, options);
  if (read.kind === "PROMOTED" || read.kind === "BOOTSTRAP") {
    const issue = outcomeScopeIssue(pointer, read.value);
    if (issue !== null) throw new Error(`Door outcome projection ${read.metadata.versionId ?? "unknown"}: ${issue}`);
  }
  return read;
}

async function readAndRecord(pointer: DoorOutcomePointer, options: PromotedCivicDataReadOptions): Promise<CivicDataReadResult<OutcomeSnapshot>> {
  try {
    const state = await readOneDoorOutcome(pointer, options);
    readStates.set(pointer.contractId, { pointer, state });
    return state;
  } catch (error) {
    readStates.set(pointer.contractId, {
      pointer,
      state: civicDataReadNotInitialized(pointer.recordClass, pointer.scope, `The ${pointer.contractId} outcome read failed: ${error instanceof Error ? error.message : String(error)}`),
    });
    throw error;
  }
}

export async function readDoorOutcomeProjection(
  scope: string,
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<OutcomeSnapshot>> {
  const pointer = outcomePointers().find((candidate) => candidate.scope === scope);
  if (pointer === undefined) throw new Error(`DOOR_OUTCOME_POINTER_UNKNOWN:${scope}`);
  edgePart = null;
  return readAndRecord(pointer, options);
}

/** Every door's exact GOOD pointer, each into its own state; a failed read is recorded, never thrown. */
export async function readDoorOutcomeProjections(options: PromotedCivicDataReadOptions = {}): Promise<void> {
  const pointers = outcomePointers();
  for (const key of [...readStates.keys()]) if (!pointers.some((pointer) => pointer.contractId === key)) readStates.delete(key);
  edgePart = null;
  await Promise.all(pointers.map((pointer) => readAndRecord(pointer, options).catch(() => undefined)));
}

/** The combined version of every door read. Throws only when no door could be read and the store did not answer. */
export async function refreshOutcomeSnapshotFromPromoted(
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  const selection = currentReaderSelection();
  if (selection && !options.store && options.edge === undefined) {
    const prior = readerOutcomes.get(selection);
    if (prior) return prior.pending;
    const held: RequestOutcomes = { pending: Promise.resolve(null) };
    readerOutcomes.set(selection, held);
    held.pending = readStateMeetingOutcomes(selection.states?.length ? selection.states : statesForRegistryDivisions([...selection.keys]), [...selection.keys])
      .then(value => { held.value = value; return combinedOutcomeVersionId(value.pointers ?? []); })
      .catch(error => { held.detail = error instanceof Error ? error.message : String(error); throw error; });
    return held.pending;
  }
  await readDoorOutcomeProjections(options);
  const states = [...readStates.values()].map(({ state }) => state);
  const unreachable = states.find((state) => state.kind === "STORE_UNREACHABLE");
  if (unreachable?.kind === "STORE_UNREACHABLE" && !states.some((state) => state.kind !== "STORE_UNREACHABLE")) {
    throw new CivicDataStoreUnavailableError(unreachable);
  }
  return combinedOutcomeVersionId(doorOutcomeParts().map((part) => ({ contractId: part.pointer.contractId, versionId: part.versionId })));
}

/** The doors whose read failed (neither promoted nor honestly not recorded yet); a publisher leaves these out whole. */
export function doorOutcomesUnreadable(): readonly string[] {
  return [...readStates.values()]
    .filter(({ state }) => state.kind !== "PROMOTED" && state.kind !== "NOT_RECORDED" && state.kind !== "BOOTSTRAP")
    .map(({ pointer }) => pointer.contractId);
}

export function doorOutcomeParts(): readonly { readonly pointer: DoorOutcomePointer; readonly value: OutcomeSnapshot; readonly versionId: string }[] {
  return [...readStates.values()].flatMap(({ pointer, state }) =>
    (state.kind === "PROMOTED" || state.kind === "BOOTSTRAP") && state.metadata.versionId
      ? [{ pointer, value: state.value, versionId: state.metadata.versionId }]
      : []);
}

export function outcomeProjectionReadState(): { readonly kind: CivicDataReadResult<OutcomeSnapshot>["kind"]; readonly detail?: string } {
  const request = requestOutcomes();
  if (request) return request.value ? { kind: "PROMOTED" } : { kind: "STORE_UNREACHABLE", detail: request.detail ?? "The selected states' outcomes have not finished loading." };
  if (edgePart !== null) return { kind: "BOOTSTRAP", detail: `Served from the meeting-outcomes edge artifact (version ${edgePart.versionId}).` };
  const states = [...readStates.values()].map(({ state }) => state);
  if (states.length === 0) return { kind: "STORE_UNREACHABLE", detail: "The outcome pointers have not been read for this process." };
  for (const kind of ["PROMOTED", "BOOTSTRAP", "NOT_RECORDED"] as const) {
    if (states.some((state) => state.kind === kind)) return { kind };
  }
  return { kind: "STORE_UNREACHABLE", detail: states.map((state) => ("detail" in state ? state.detail : null) ?? state.kind).join("; ") };
}

/** The version of a combined view: each door's `contractId=versionId`, sorted. Null when no door has a version. */
export function combinedOutcomeVersionId(
  pointers: readonly { readonly contractId: string; readonly versionId: string }[],
): string | null {
  if (pointers.length === 0) return null;
  return [...pointers].sort((a, b) => a.contractId.localeCompare(b.contractId)).map((pointer) => `${pointer.contractId}=${pointer.versionId}`).join("|");
}

export function combineOutcomeProjections(
  parts: readonly DoorOutcomePart[],
): { readonly value: OutcomeSnapshot; readonly versionId: string } | null {
  const pointers = parts.flatMap((part) => part.pointers).sort((a, b) => a.contractId.localeCompare(b.contractId));
  const versionId = combinedOutcomeVersionId(pointers);
  if (versionId === null) return null;
  const stamp = (key: "generatedOn" | "generatedAt") =>
    parts.map(({ value }) => value[key]).filter((stamped) => stamped !== "UNKNOWN").sort().at(-1) ?? "UNKNOWN";
  return {
    versionId,
    value: {
      generatedOn: stamp("generatedOn"),
      generatedAt: stamp("generatedAt"),
      tenants: [...new Set(parts.flatMap(({ value }) => value.tenants))].sort(),
      sittings: parts.flatMap(({ value }) => value.sittings).sort((a, b) => a.meetingId.localeCompare(b.meetingId)),
      pointers,
    },
  };
}

export function primeOutcomeProjection(value: OutcomeSnapshot, versionId: string): void {
  const known = new Map(outcomePointers().map((pointer) => [pointer.contractId, pointer]));
  for (const ref of value.pointers ?? []) {
    const pointer = known.get(ref.contractId);
    if (pointer === undefined) continue;
    const sittings = value.sittings.filter((sitting) => sitting.slug === pointer.slug);
    const issue = outcomeScopeIssue(pointer, { ...value, tenants: [pointer.slug], sittings });
    if (issue !== null) throw new Error(`Outcome edge artifact ${versionId}: ${issue}`);
  }
  readStates.clear();
  edgePart = { value, versionId };
}

export const settleOutcomeRead = (): Promise<void> =>
  settleEdgeFirst(currentMeetingOutcomesEdge, primeOutcomeProjection, refreshOutcomeSnapshotFromPromoted, "The recorded outcomes");

let combinedMemo: { parts: readonly OutcomeSnapshot[]; value: OutcomeSnapshot } | null = null;

/** The snapshot every Reader consumer reads: every door read, else the edge artifact. One door alone is returned as read. */
export function getOutcomeSnapshot(): OutcomeSnapshot {
  if (injected !== null) return injected;
  const request = requestOutcomes();
  if (request) return request.value ?? EMPTY;
  const parts = doorOutcomeParts().filter((part) => part.value.sittings.length > 0);
  if (parts.length === 0) return readStates.size === 0 && edgePart !== null ? edgePart.value : EMPTY;
  if (parts.length === 1) return parts[0]!.value;
  if (combinedMemo?.parts.length === parts.length && combinedMemo.parts.every((value, at) => value === parts[at]!.value)) return combinedMemo.value;
  const combined = combineOutcomeProjections(parts.map((part) => ({
    value: part.value,
    pointers: [{ contractId: part.pointer.contractId, tenant: part.pointer.slug, versionId: part.versionId }],
  })))!.value;
  combinedMemo = { parts: parts.map((part) => part.value), value: combined };
  return combined;
}

export function resetOutcomeSnapshotCache(): void {
  readerOutcomes = new WeakMap();
  readStates.clear();
  edgePart = null;
  combinedMemo = null;
}

export function loadedFrom(): "DATA_PLANE" | "TEST_FIXTURE" | "EMPTY_STORE" {
  if (injected !== null) return injected.sittings.length === 0 && injected.generatedAt === "UNKNOWN" ? "EMPTY_STORE" : "TEST_FIXTURE";
  const request = requestOutcomes();
  if (request) return request.value ? "DATA_PLANE" : "EMPTY_STORE";
  if (edgePart !== null || [...readStates.values()].some(({ state }) => state.kind === "PROMOTED")) return "DATA_PLANE";
  if ([...readStates.values()].some(({ state }) => state.kind === "BOOTSTRAP")) return "TEST_FIXTURE";
  return "EMPTY_STORE";
}

export type OutcomeEvidenceState =
  | "HELD"
  | "NO_SITTING_HELD"
  | "NOT_YET_INGESTED"
  | "EXTRACTION_FAILED"
  | "NO_ACTION_RECORDED"
  | "ACTION_WITHOUT_ROLL_CALL"
  /** The sitting concluded and its minutes are not published yet: THEIRS, never "no decision". */
  | "MINUTES_NOT_YET_PUBLISHED";

/** The states that are facts about the government; every other state is a fact about us. */
export const OUTCOME_STATES_ABOUT_THEM: readonly OutcomeEvidenceState[] = [
  "NO_ACTION_RECORDED",
  "ACTION_WITHOUT_ROLL_CALL",
  // Read off the publisher's own minutes cell ("Not available"), with the instant it was read.
  "MINUTES_NOT_YET_PUBLISHED",
];

/** A sitting the InSite minutes route wrote: records come from minutes, and tabulations are text, never a per-person roll. */
export function isMinutesRouteSitting(sitting: Pick<PersistedSittingOutcomes, "meetingId">): boolean {
  return sitting.meetingId.startsWith("legistar-insite:");
}

/** Whose gap a state names. Derived from the list above, never restated. */
export function outcomeGapWhose(state: OutcomeEvidenceState): "OURS" | "THEIRS" {
  return OUTCOME_STATES_ABOUT_THEM.includes(state) ? "THEIRS" : "OURS";
}

export interface OutcomeQuery {
  /** `ocd-division/...#governing`. Exact string equality, never a name match. */
  readonly bodyId?: string | null;
  /** Narrows to one sitting when the caller has it. */
  readonly meetingId?: string | null;
  /** Which question is being asked. Drives the record-class filter. */
  readonly questionClass: QuestionClass;
  /** ISO instant. Only sittings at or before it — "the last meeting". */
  readonly onOrBefore?: string | null;
  /** How many sittings back to consider. Default 1: the most recent. */
  readonly sittings?: number;
}

export type OutcomeEvidenceRecord =
  | LegistarAgendaRecord
  | LegistarOutcomeRecord
  | LegistarRollCallRecord;

/** A record that was held and refused, with the sentence saying why. */
export interface RefusedRecord {
  readonly recordClass: RecordClass | string;
  readonly reason: string;
  readonly count: number;
}

export interface OutcomeEvidence {
  readonly state: OutcomeEvidenceState;
  /** True only for `HELD`. Derived, never asserted by a caller. */
  readonly answerable: boolean;
  /** The records that answer the question asked, already class-filtered; empty on every non-`HELD` state. */
  readonly records: readonly OutcomeEvidenceRecord[];
  /** The sittings consulted, newest first. Present on every state but the first. */
  readonly sittings: readonly PersistedSittingOutcomes[];
  /** Classes held and refused for this question, so a caller never quietly answers from them. */
  readonly refused: readonly RefusedRecord[];
  /** The named gap, saying whose gap it is; null when `state` is `HELD`. */
  readonly gap: string | null;
  /** Retrieval failures still open; never converted into an absence. */
  readonly openFailures: readonly string[];
}

/** Sittings for one body, newest first, honouring the query's window. */
function selectSittings(
  query: OutcomeQuery,
  snapshot: OutcomeSnapshot,
): PersistedSittingOutcomes[] {
  const wanted = snapshot.sittings.filter((sitting) => {
    if (query.meetingId && sitting.meetingId !== query.meetingId) return false;
    if (query.bodyId && sitting.bodyId !== query.bodyId) return false;
    if (query.onOrBefore && sitting.startsAt !== null) {
      if (sitting.startsAt > query.onOrBefore) return false;
    }
    return true;
  });

  wanted.sort((a, b) => String(b.startsAt ?? "").localeCompare(String(a.startsAt ?? "")));
  const limit = query.meetingId ? wanted.length : Math.max(1, query.sittings ?? 1);
  return wanted.slice(0, limit);
}

/** Outcome evidence for one question about one body. Pure over the held store: no network, clock or database. */
export function outcomeEvidenceFor(
  query: OutcomeQuery,
  snapshot: OutcomeSnapshot = getOutcomeSnapshot(),
): OutcomeEvidence {
  const sittings = selectSittings(query, snapshot);

  if (sittings.length === 0) {
    return {
      state: "NO_SITTING_HELD",
      answerable: false,
      records: [],
      sittings: [],
      refused: [],
      gap:
        "We hold no sitting of that body in the outcome store, so we have not " +
        "recorded what it decided. That is a gap in what we have collected and " +
        "not a statement about what the body has published.",
      openFailures: [],
    };
  }

  // Named before the failure checks so it cannot read as a failed extraction or an empty sitting.
  if (sittings.every((sitting) => sitting.extraction === "NOT_YET_PUBLISHED")) {
    return {
      state: "MINUTES_NOT_YET_PUBLISHED",
      answerable: false,
      records: [],
      sittings,
      refused: [],
      gap:
        sittings[0]!.extractionNote ??
        "The body has not published minutes for that sitting yet, so its decisions are not yet in " +
          "the public record we read. That is not a record that nothing was decided.",
      openFailures: [],
    };
  }

  const openFailures: string[] = [];
  for (const sitting of sittings) {
    if (sitting.extraction !== "RETRIEVED" && sitting.extraction !== "NOT_YET_PUBLISHED") {
      openFailures.push(
        `${sitting.meetingId}: ${sitting.extraction} — ${sitting.extractionNote ?? "no reason recorded"}`,
      );
    }
    for (const failure of sitting.voteRequestFailures) {
      openFailures.push(
        `${sitting.meetingId} item ${failure.eventItemId}: votes request failed — ${failure.reason}`,
      );
    }
    for (const itemId of sitting.failedRollCallExtractions) {
      openFailures.push(
        `${sitting.meetingId} item ${itemId}: the item's own record asserts a roll call ` +
          "and the votes route returned zero rows — a FAILED extraction, not an empty roll",
      );
    }
  }

  // A zero-row extraction is a failed extraction, checked before the record counts so it never reads as a body that
  // acted on nothing.
  const allFailed = sittings.every((s) => s.extraction !== "RETRIEVED" && s.extraction !== "NOT_YET_PUBLISHED");
  if (allFailed) {
    return {
      state: "EXTRACTION_FAILED",
      answerable: false,
      records: [],
      sittings,
      refused: [],
      gap: sittings.every((s) => isMinutesRouteSitting(s) && s.failedMinutesRead !== undefined)
        ? "We read that sitting's minutes and could not find in them what was decided. That is a " +
          "failed reading on our side, not a meeting where nothing was decided. We read the minutes " +
          "again when the document changes or our reading of it improves."
        : "Our retrieval of that sitting's agenda items returned nothing, which is a " +
          "failed retrieval on our side and not a meeting with nothing on it. It is " +
          "retryable and it has not been retried yet.",
      openFailures,
    };
  }

  const held: OutcomeEvidenceRecord[] = [];
  for (const sitting of sittings) {
    held.push(...sitting.agenda, ...sitting.outcomes, ...sitting.rollCalls);
  }

  // Minutes read that record no motion because no formal action was taken: a fact about the body. Any other empty
  // minutes read is held as a failed extraction, answered above.
  if (
    held.length === 0 &&
    sittings.some((s) => s.extraction === "RETRIEVED" && isMinutesRouteSitting(s)) &&
    sittings.every((s) => !isMinutesRouteSitting(s) || s.extraction !== "RETRIEVED" || s.outcomes.length === 0)
  ) {
    return {
      state: "NO_ACTION_RECORDED",
      answerable: false,
      records: [],
      sittings,
      refused: [],
      gap:
        "We read that sitting's minutes. They record no motion or vote, and say that no formal action " +
        "was taken. That is what the body's own record says, not a gap in our retrieval of it.",
      openFailures,
    };
  }

  if (held.length === 0) {
    return {
      state: "NOT_YET_INGESTED",
      answerable: false,
      records: [],
      sittings,
      refused: [],
      gap:
        "We hold that sitting but have not recorded any of its agenda, actions or " +
        "roll calls yet. That is a gap in our collection.",
      openFailures,
    };
  }

  const { admitted, refused } = evidenceRecordsFor(query.questionClass, held);

  const refusedSummary: RefusedRecord[] = [];
  const ruling = ruleOnQuestion(
    query.questionClass,
    [...new Set(refused.map((r) => r.record.recordClass))],
  );
  for (const substitution of ruling.refusedSubstitutions) {
    refusedSummary.push({
      recordClass: substitution.held,
      reason: substitution.reason,
      count: refused.filter((r) => r.record.recordClass === substitution.held).length,
    });
  }

  if (admitted.length > 0) {
    return {
      state: "HELD",
      answerable: true,
      records: admitted,
      sittings,
      refused: refusedSummary,
      gap: null,
      openFailures,
    };
  }

  // Nothing admitted and the extraction succeeded: a fact about the publisher. An action without a per-person roll is
  // a real decision, never an absence.
  const anyOutcome = sittings.some((s) => s.outcomes.length > 0);
  // Minutes that tabulate ayes and nays by surname are carried as text only: our gap, not a record without a roll call.
  if (
    anyOutcome &&
    query.questionClass === "HOW_DID_THEY_VOTE" &&
    sittings.every((s) => isMinutesRouteSitting(s)) &&
    sittings.some((s) => s.outcomes.some((record) => record.tallyText !== null))
  ) {
    return {
      state: "NOT_YET_INGESTED",
      answerable: false,
      records: [],
      sittings,
      refused: refusedSummary,
      gap:
        "The body's minutes for this sitting list how its members voted, by surname, and we carry " +
        "that tabulation only as the clerk's text. We have not turned it into per-member vote " +
        "records yet. That is a gap in our collection, not in the body's record.",
      openFailures,
    };
  }
  if (anyOutcome && query.questionClass === "HOW_DID_THEY_VOTE") {
    return {
      state: "ACTION_WITHOUT_ROLL_CALL",
      answerable: false,
      records: [],
      sittings,
      refused: refusedSummary,
      gap:
        "That body's own record of this sitting states the actions it took and does " +
        "not record how each member voted on them. The action is published; a " +
        "per-person roll call for it is not.",
      openFailures,
    };
  }

  return {
    state: "NO_ACTION_RECORDED",
    answerable: false,
    records: [],
    sittings,
    refused: refusedSummary,
    gap:
      "We read that sitting's agenda items and the body's own record shows no action " +
      "recorded against them. That is what the publisher's record says, not a gap in " +
      "our retrieval of it.",
    openFailures,
  };
}

/** Sittings held for one body, newest first, for coverage reporting; not filtered by record class. */
export function sittingsForBody(
  bodyId: string,
): readonly PersistedSittingOutcomes[] {
  return getOutcomeSnapshot()
    .sittings.filter((sitting) => sitting.bodyId === bodyId)
    .sort((a, b) => String(b.startsAt ?? "").localeCompare(String(a.startsAt ?? "")));
}

/** Every publisher reading held for one sitting's agenda, reconciled without picking a winner; `actionable` is null on a DISAGREE. */
export function publicationObservationsFor(
  meetingId: string,
): ReconciledPublication {
  const sitting = getOutcomeSnapshot().sittings.find(
    (row) => row.meetingId === meetingId,
  );
  return reconcilePublicationObservations(
    meetingId,
    sitting?.publicationObservations ?? [],
  );
}

/** Every meeting id the store holds outcome records for. */
export function answerableMeetingIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const sitting of getOutcomeSnapshot().sittings) {
    if (sitting.extraction === "RETRIEVED" && sitting.outcomes.length > 0) {
      ids.add(sitting.meetingId);
    }
  }
  return ids;
}
