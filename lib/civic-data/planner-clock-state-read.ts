import type { ReadOnlyQuery, Row } from "../control-plane/admin-view/promoted-slices.ts";
import type { RoutineSourceTask } from "./runner.ts";
import { proofConsistentObservedSuccess, proofConsistentSuccess, trustedLkgImportClock,
  type RoutineClockRecord, type RoutineStoreClock } from "./store.ts";
import { isTrustedLkgImportCandidate } from "./trusted-lkg-import.ts";
import { parseUnchangedConfirmation } from "./unchanged-confirmation.ts";
import { sourceCheckedAt } from "./source-check.ts";
import type { RoutineRecordClass, ValidationReceipt } from "./types.ts";

const POINTER_SQL = `SELECT p.source_id,p.record_class,p.scope,p.current_version_id,p.last_known_good_version_id,p.promoted_at,
  p.validation_receipt AS pointer_receipt,c.state,c.acquisition_succeeded,c.promoted_version_id,
  c.last_known_good_version_id AS candidate_lkg,c.validation_receipt AS candidate_receipt,c.failure_code,c.failure_detail,
  jsonb_strip_nulls(jsonb_build_object('id',c.candidate->'id','sourceId',c.candidate->'sourceId',
    'recordClass',c.candidate->'recordClass','scope',c.candidate->'scope','bootstrapImport',c.candidate->'bootstrapImport',
    'retrieval',jsonb_build_object('retrievedAt',c.candidate#>'{retrieval,retrievedAt}','sourceCheck',c.candidate#>'{retrieval,sourceCheck}'),
    'normalization',jsonb_build_object('parserVersion',c.candidate#>'{normalization,parserVersion}'))) AS candidate,
  (SELECT e.at FROM civic_data_candidate_events e WHERE e.candidate_id=p.current_version_id AND e.sequence=1) AS observed_at,
  (SELECT e.detail FROM civic_data_candidate_events e WHERE e.candidate_id=p.current_version_id
    AND left(e.detail,26)='UNCHANGED_CONFIRMATION_V1 ' ORDER BY e.sequence DESC LIMIT 1) AS confirmation
  FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.key=$1`;

/** Only scalar columns participate in the history sort. A candidate's real
 * provider-check time cannot be later than its first local event. */
const ATTEMPTS_SQL = `SELECT c.id,c.state,c.acquisition_succeeded,e.at::text AS at
  FROM civic_data_candidates c JOIN civic_data_candidate_events e ON e.candidate_id=c.id AND e.sequence=1
  WHERE c.source_id=$1 AND c.record_class=$2 AND c.scope=$3 AND ($4::text IS NULL OR c.parser_version=$4)
    AND ($5::timestamptz IS NULL OR (e.at,c.id)<($5::timestamptz,$6::text))
  ORDER BY e.at DESC,c.id DESC LIMIT 32`;

const ATTEMPT_METADATA_SQL = `SELECT c.candidate#>>'{bootstrapImport,kind}' AS import_kind,
  CASE WHEN c.state='PROMOTED' AND c.acquisition_succeeded
    THEN c.candidate#>>'{retrieval,sourceCheck,checkedAt}' END AS checked_at
  FROM civic_data_candidates c WHERE c.id=$1 AND c.source_id=$2 AND c.record_class=$3 AND c.scope=$4`;

const STARTS_SQL = `SELECT COALESCE(jsonb_agg(h.value->'startsAt' ORDER BY m.ordinal_index)
    FILTER (WHERE jsonb_typeof(h.value->'startsAt')='string'),'[]'::jsonb) AS starts
  FROM civic_data_promotions p,LATERAL reader_payload_members(reader_payload_node(p.payload)->'meetings') m,
    LATERAL (SELECT reader_payload_node(m.item) AS value) h WHERE p.key=$1`;

function instant(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const at = new Date(value as string | Date);
  if (!Number.isFinite(at.getTime())) throw new Error("PLANNER_CLOCK_TIMESTAMP_INVALID");
  return at.toISOString();
}
const later = (left: string | undefined, right: string | undefined): string | undefined =>
  left === undefined ? right : right !== undefined && Date.parse(right) > Date.parse(left) ? right : left;

/** The exact source clock for one state's held-meeting planning. Existing proof
 * helpers still decide success. History is read only until its event-time upper
 * bound proves that no older candidate can change the answer. */
export async function readPlannerRoutineClock(task: Pick<RoutineSourceTask, "sourceId" | "recordClass" | "scope">,
  state: string, query: ReadOnlyQuery, parserVersion?: string): Promise<RoutineStoreClock> {
  const { sourceId, recordClass, scope } = task;
  if (!/^[a-z]{2}$/i.test(state) || !scope.startsWith(`US-${state.toUpperCase()}:`) ||
    !["MEETING", "MEETING_OUTCOME"].includes(recordClass)) throw new Error(`PLANNER_CLOCK_STATE_BOUNDARY:${state}:${scope}`);
  const [[pointers],[initialAttempts]] = await Promise.all([
    query([{ text: POINTER_SQL, params: [`${recordClass}:${scope}`] }]),
    query([{ text: ATTEMPTS_SQL, params: [sourceId,recordClass,scope,parserVersion ?? null,null,null] }]),
  ]);
  const row = pointers[0];
  const candidate = row?.candidate as RoutineClockRecord["candidate"] | undefined;
  const record: RoutineClockRecord | null = row && candidate?.id ? {
    candidate,state: row.state as RoutineClockRecord["state"],acquisitionSucceeded: row.acquisition_succeeded === true,
    receipt: row.candidate_receipt as ValidationReceipt | null,promotedVersion: row.promoted_version_id as string | null,
    lastKnownGoodVersion: row.candidate_lkg as string | null,failureCode: row.failure_code as string | null,failureDetail: row.failure_detail as string | null,
  } : null;
  let lastAttemptedAt: string | undefined;
  let before: string | null = null, beforeId: string | null = null;
  outer: for (;;) {
    const attempts: readonly Row[] = before === null ? initialAttempts :
      (await query([{ text: ATTEMPTS_SQL, params: [sourceId,recordClass,scope,parserVersion ?? null,before,beforeId] }]))[0];
    for (const attempt of attempts) {
      const observed = instant(attempt.at)!;
      if (lastAttemptedAt !== undefined && Date.parse(observed) <= Date.parse(lastAttemptedAt)) break outer;
      let imported: boolean, checked: string | undefined;
      if (record && record.candidate.id === attempt.id) {
        imported = isTrustedLkgImportCandidate(record.candidate);
        checked = attempt.state === "PROMOTED" && attempt.acquisition_succeeded === true
          ? instant(record.candidate.retrieval.sourceCheck?.checkedAt) : undefined;
      } else {
        const [metadata] = await query([{ text: ATTEMPT_METADATA_SQL, params: [attempt.id,sourceId,recordClass,scope] }]);
        if (!metadata[0]) throw new Error(`PLANNER_CLOCK_ATTEMPT_MISSING:${String(attempt.id)}`);
        imported = ["TRUSTED_LKG_IMPORT", "TRUSTED_LKG_REATTESTATION"].includes(String(metadata[0].import_kind));
        checked = instant(metadata[0].checked_at);
      }
      if (!imported) lastAttemptedAt = later(lastAttemptedAt,
        checked !== undefined && Date.parse(checked) < Date.parse(observed) ? checked : observed);
    }
    if (attempts.length < 32) break;
    // Keep Postgres microseconds for the cursor even though the public clock
    // intentionally canonicalizes timestamps to JavaScript milliseconds.
    const last = attempts.at(-1)!; before = String(last.at); beforeId = String(last.id);
  }
  const sittings = recordClass === "MEETING" && row ? {
    sittingStarts: (await query([{ text: STARTS_SQL, params: [`${recordClass}:${scope}`] }]))[0][0]?.starts as readonly string[] ?? [],
  } : {};
  if (row && record && row.source_id === sourceId && isTrustedLkgImportCandidate(record.candidate)) {
    return { ...trustedLkgImportClock(lastAttemptedAt,instant(row.promoted_at)!),...sittings };
  }
  const pointer = row ? { sourceId: String(row.source_id),recordClass: row.record_class as RoutineRecordClass,scope: String(row.scope),
    versionId: String(row.current_version_id),lastKnownGoodVersionId: String(row.last_known_good_version_id),receipt: row.pointer_receipt as ValidationReceipt } : null;
  const own = row?.source_id === sourceId ? record : null;
  const success = proofConsistentSuccess(own,pointer);
  const succeededAt = instant(success);
  const succeededObserved = proofConsistentObservedSuccess(own,pointer,instant(row?.observed_at));
  const succeededParser = parserVersion !== undefined && success !== undefined ? own!.candidate.normalization.parserVersion : undefined;
  const parsed = typeof row?.confirmation === "string" ? parseUnchangedConfirmation(row.confirmation) : null;
  const confirmation = parsed?.versionId === row?.current_version_id ? parsed : null;
  const confirmedAt = confirmation ? sourceCheckedAt(confirmation.retrieval,confirmation.observedAt) : undefined;
  lastAttemptedAt = later(lastAttemptedAt,parserVersion === undefined || succeededParser === parserVersion ? confirmedAt : undefined);
  const lastSucceededAt = succeededAt === undefined ? undefined : later(succeededAt,confirmation?.retrieval.retrievedAt);
  const lastSucceededObservedAt = succeededObserved === undefined ? undefined : later(succeededObserved,confirmedAt);
  return { ...(lastAttemptedAt ? { lastAttemptedAt } : {}),...(lastSucceededAt ? { lastSucceededAt } : {}),
    ...(lastSucceededObservedAt ? { lastSucceededObservedAt } : {}),...(succeededParser ? { lastSucceededParserVersion: succeededParser } : {}),...sittings };
}
