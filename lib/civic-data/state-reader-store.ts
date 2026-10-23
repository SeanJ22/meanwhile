import { REGISTRY_STATES, STATE_BALLOT_FAMILIES, stateFromBallotScope } from "./state-scopes.ts";
import { stateFromRegistryRuntimeScope } from "./state-scopes.ts";
import { ballotNavigationState } from "./ballot-navigation-scope.ts";
import { parseUnchangedConfirmation } from "./unchanged-confirmation.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import type { PublishedCandidateMetadata } from "./store.ts";
import type { PromotedProjection, RoutineRecordClass } from "./types.ts";
import type { PromotedEdgeEntry } from "./read-model.ts";

type Query = (text: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
type StateReaderPromotion<T> = { readonly projection: PromotedProjection<T>; readonly candidate: PublishedCandidateMetadata };
const classes = { "ballot-contests": "BALLOT_CANDIDACY", "candidate-profiles": "CANDIDATE_PROFILE", "candidate-corpus": "CANDIDATE_PUBLICATION",
  "voting-sites": "VOTING_SITE", "candidate-campaign-sites-derived": "CURATED_READER_RECORD" } as const;

const READ_STATE = `WITH RECURSIVE selected AS MATERIALIZED (
  SELECT jsonb_build_object(
    'projection',jsonb_build_object('key',p.key,'recordClass',p.record_class,'scope',p.scope,'sourceId',p.source_id,
      'versionId',p.current_version_id,'lastKnownGoodVersionId',p.last_known_good_version_id,
      'promotedAt',p.promoted_at,'payload',p.payload,'receipt',p.validation_receipt),
    'candidate',jsonb_build_object('candidate',jsonb_build_object('id',c.id,'sourceId',c.source_id,'recordClass',c.record_class,'scope',c.scope,
      'retrieval',jsonb_build_object('succeeded',c.acquisition_succeeded,'retrievedAt',c.retrieved_at,'sourceCheck',c.candidate#>'{retrieval,sourceCheck}'),
      'temporal',c.candidate->'temporal','normalization',jsonb_build_object('succeeded',true,'normalizedHash',c.normalized_hash)),
      'state',c.state,'acquisitionSucceeded',c.acquisition_succeeded,'promotedVersion',c.promoted_version_id,
      'lastKnownGoodVersion',c.last_known_good_version_id,'failureCode',c.failure_code,'failureDetail',c.failure_detail)) AS roots,
    (c.id=p.current_version_id AND c.source_id=p.source_id AND c.record_class=p.record_class AND c.scope=p.scope
      AND p.current_version_id=p.last_known_good_version_id AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
      AND c.state='PROMOTED' AND c.acquisition_succeeded AND c.candidate#>'{normalization,succeeded}'='true'::jsonb
      AND c.normalized_hash ~ '^[a-f0-9]{64}$' AND p.validation_receipt=c.validation_receipt
      AND p.validation_receipt->>'decision'='GOOD' AND p.validation_receipt->>'candidateId'=c.id
      AND p.validation_receipt->>'sourceId'=c.source_id AND p.validation_receipt->>'recordClass'=c.record_class
      AND p.validation_receipt->>'scope'=c.scope AND p.payload=c.candidate->'readModel') AS proof_valid,
    (SELECT detail FROM civic_data_candidate_events e WHERE e.candidate_id=p.current_version_id
      AND left(e.detail,26)='UNCHANGED_CONFIRMATION_V1 ' ORDER BY sequence DESC LIMIT 1) AS confirmation
  FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
  WHERE p.key=$1
), hashes(hash) AS (
  SELECT ref#>>'{}' FROM selected,LATERAL jsonb_path_query(roots,'strict $.**."$civicPayloadPart"','{}',true) ref WHERE proof_valid
  UNION
  SELECT ref#>>'{}' FROM hashes JOIN civic_data_payload_parts part USING(hash),
    LATERAL jsonb_path_query(part.payload,'strict $.**."$civicPayloadPart"','{}',true) ref
)
SELECT roots,proof_valid,confirmation,
  COALESCE((SELECT jsonb_object_agg(part.hash,part.payload) FROM hashes JOIN civic_data_payload_parts part USING(hash)),'{}'::jsonb) AS parts
FROM selected`;

function decodeStateParts(roots: unknown, parts: Record<string, unknown>): unknown {
  const completed = new Set<string>(), active = new Set<string>();
  const build = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) value[i] = build(value[i]); return value; }
    const object = value as Record<string, unknown>;
    if (Object.keys(object).length === 1 && typeof object.$civicPayloadPart === "string") {
      const hash = object.$civicPayloadPart;
      if (!Object.hasOwn(parts, hash)) throw new Error(`STATE_READER_PART_MISSING:${hash}`);
      if (completed.has(hash)) return parts[hash];
      if (active.has(hash)) throw new Error(`STATE_READER_PART_CYCLE:${hash}`);
      active.add(hash);
      const part = parts[hash] as { kind?: string; value?: unknown; chunks?: unknown[]; groups?: unknown[]; order?: unknown } | null;
      let decoded: unknown;
      if (part?.kind === "object") decoded = build(part.value);
      else if (part?.kind === "string") decoded = part.chunks!.map(build).join("");
      else if (part?.kind === "array") {
        const groups = part.groups!.map(group => build(group) as unknown[]), positions = groups.map(() => 0);
        const order = JSON.parse(build(part.order) as string) as number[], rows = new Array<unknown>(order.length);
        for (let i = 0; i < order.length; i++) {
          const group = order[i], position = positions[group]++;
          if (!Number.isInteger(group) || !groups[group] || position >= groups[group].length) throw new Error("STATE_READER_PART_ORDER_INVALID");
          rows[i] = groups[group][position];
        }
        if (groups.some((group, i) => positions[i] !== group.length)) throw new Error("STATE_READER_PART_ORDER_INVALID");
        decoded = rows;
      } else decoded = build(part);
      parts[hash] = decoded; active.delete(hash); completed.add(hash);
      return decoded;
    }
    for (const key of Object.keys(object)) object[key] = build(object[key]);
    return object;
  };
  const value = build(roots);
  for (const key of Object.keys(parts)) delete parts[key];
  return value;
}

export async function readStateReaderPromotion<T>(query: Query, recordClass: RoutineRecordClass, scope: string): Promise<StateReaderPromotion<T> | null> {
  const federalState = /^US-([A-Z]{2}):current-congress-directory$/.exec(scope)?.[1];
  const portraitState = /^US-([A-Z]{2}):people:portraits:v1$/.exec(scope)?.[1];
  const registrationState = /^US-([A-Z]{2}):registration:v1$/.exec(scope)?.[1];
  const state = recordClass === "REGISTRY_RUNTIME_BINDING" ? stateFromRegistryRuntimeScope(scope)
    : recordClass === "FEDERAL_DIRECTORY" && federalState ? REGISTRY_STATES.some(state => state === federalState)
    : recordClass === "STATE_LEGISLATOR" && portraitState ? REGISTRY_STATES.some(state => state === portraitState)
    : recordClass === "REGISTRATION" && registrationState ? REGISTRY_STATES.some(state => state === registrationState)
    : recordClass === "CURATED_READER_RECORD" && ballotNavigationState(scope) !== null ||
      STATE_BALLOT_FAMILIES.some(family => classes[family] === recordClass && stateFromBallotScope(scope, family));
  if (!state) throw new Error(`STATE_READER_SCOPE_INVALID:${recordClass}:${scope}`);
  const rows = await query(READ_STATE, [`${recordClass}:${scope}`]);
  if (!rows.length) return null;
  if (rows.length !== 1 || rows[0].proof_valid !== true) throw new Error("STATE_READER_PUBLISHED_PROOF_INVALID");
  const result = decodeStateParts(rows[0].roots, rows[0].parts as Record<string, unknown>) as StateReaderPromotion<T>;
  if (result.projection.key !== `${recordClass}:${scope}`) throw new Error("STATE_READER_POINTER_MISMATCH");
  if (canonicalCivicDataHash(result.projection.payload) !== result.candidate.candidate.normalization.normalizedHash)
    throw new Error("STATE_READER_PAYLOAD_HASH_MISMATCH");
  Object.assign(result.candidate, { receipt: result.projection.receipt });
  const confirmation = typeof rows[0].confirmation === "string" ? parseUnchangedConfirmation(rows[0].confirmation) : null;
  if (confirmation?.versionId === result.projection.versionId && confirmation.pointerKey === result.projection.key)
    Object.assign(result.projection, { latestConfirmation: confirmation });
  return result;
}

/** A verified canonical state record, even when its optional serving copy is absent. */
export async function readStateReaderEntry(query: Query, recordClass: RoutineRecordClass, scope: string): Promise<PromotedEdgeEntry> {
  const read = await readStateReaderPromotion(query, recordClass, scope);
  return read ? { kind: "PROMOTED", projection: read.projection, attested: {
    recordClass, scope, versionId: read.projection.versionId, payloadSha256: read.candidate.candidate.normalization.normalizedHash!,
    retrievedAt: read.candidate.candidate.retrieval.retrievedAt, staleAtRetrieval: read.candidate.candidate.temporal.staleAtRetrieval === true,
    version: read.candidate.candidate.temporal.version, sourceThrough: read.candidate.candidate.temporal.sourceThrough,
  } } : { kind: "NOT_RECORDED", recordClass, scope };
}
