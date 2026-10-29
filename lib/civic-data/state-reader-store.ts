import { REGISTRY_STATES, STATE_BALLOT_FAMILIES, stateFromBallotScope } from "./state-scopes.ts";
import { stateFromRegistryRuntimeScope } from "./state-scopes.ts";
import { ballotNavigationState } from "./ballot-navigation-scope.ts";
import { parseUnchangedConfirmation } from "./unchanged-confirmation.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import type { PublishedCandidateMetadata } from "./store.ts";
import type { PromotedProjection, RoutineRecordClass } from "./types.ts";
import type { PromotedEdgeEntry } from "./read-model.ts";
import { NH_COUNTY, nhMembersReadModel } from "../state-rollcalls/legislators.ts";
import type { NhMemberReadModel } from "./candidate-builders.ts";
import type { OfficeholderSet } from "../officials/types.ts";

type Query = (text: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
type StateReaderPromotion<T> = { readonly projection: PromotedProjection<T>; readonly candidate: PublishedCandidateMetadata };

/** NH publishes Members.txt rows and an identity crosswalk, rather than the
 * other states' roster shape. Keep that source contract while projecting only
 * the selected districts' checklist fields and its scalar publication proof. */
export async function readNhPlaceRosterRows(query: Query, ids: readonly string[]): Promise<{ readonly versionId: string; readonly payload: { readonly roster: OfficeholderSet } } | null> {
  const [row] = await query(`WITH pointer AS MATERIALIZED (
    SELECT p.current_version_id,reader_payload_node(p.payload) AS root,c.retrieved_at,
      reader_payload_value(reader_payload_node(c.candidate->'temporal')->'sourceThrough')#>>'{}' AS source_through,
      (p.source_id='nh-general-court' AND p.record_class='STATE_LEGISLATOR' AND p.scope='US-NH'
        AND c.id=p.current_version_id AND c.source_id=p.source_id AND c.record_class=p.record_class AND c.scope=p.scope
        AND c.state='PROMOTED' AND c.acquisition_succeeded AND p.current_version_id=p.last_known_good_version_id
        AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
        AND p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint
        AND (c.read_model_fingerprint IS NULL OR c.read_model_fingerprint=c.normalized_hash)
        AND c.normalized_hash ~ '^[a-f0-9]{64}$' AND c.candidate#>>'{normalization,normalizedHash}'=c.normalized_hash
        AND c.candidate#>'{normalization,succeeded}'='true'::jsonb
        AND c.validation_receipt=p.validation_receipt AND p.validation_receipt->>'decision'='GOOD'
        AND p.validation_receipt->>'candidateId'=c.id AND p.validation_receipt->>'sourceId'=p.source_id
        AND p.validation_receipt->>'recordClass'=p.record_class AND p.validation_receipt->>'scope'=p.scope
        AND c.retrieved_at<=(p.validation_receipt->>'validatedAt')::timestamptz
        AND (p.validation_receipt->>'validatedAt')::timestamptz<=p.promoted_at) IS TRUE AS published,
      (SELECT detail FROM civic_data_candidate_events e WHERE e.candidate_id=p.current_version_id
        AND left(e.detail,26)='UNCHANGED_CONFIRMATION_V1 ' ORDER BY sequence DESC LIMIT 1) AS confirmation
    FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
    WHERE p.key='STATE_LEGISLATOR:US-NH'
  ), members AS MATERIALIZED (
    SELECT m.ordinal_index,reader_payload_node(m.item) AS value FROM pointer p,LATERAL reader_payload_members(p.root->'members') m
  ), identities AS MATERIALIZED (
    SELECT i.ordinal_index,reader_payload_node(i.item) AS value FROM pointer p,LATERAL reader_payload_members(p.root->'identities') i
  ), linked AS MATERIALIZED (
    SELECT m.ordinal_index,m.value,i.value AS identity,CASE WHEN m.value->>'district' ~ '^[0-9]+$' THEN
      CASE WHEN m.value->>'chamber'='S' THEN 'ocd-division/country:us/state:nh/sldu:'||(m.value->>'district')::numeric::text
        WHEN (m.value->>'district')::numeric>0 AND array_position($2::text[],btrim(m.value->>'county')) IS NOT NULL
        THEN 'ocd-division/country:us/state:nh/sldl:'||((
          (array_position($2::text[],btrim(m.value->>'county'))-1)::text||lpad((m.value->>'district')::numeric::text,
            greatest(length((m.value->>'district')::numeric::text),2),'0'))::numeric)::text
      END END AS division FROM members m LEFT JOIN LATERAL (
        SELECT value FROM identities i WHERE i.value->>'chamber'=m.value->>'chamber' AND i.value->>'seatNo'=m.value->>'seatNo'
          AND i.value->>'district'=m.value->>'district' ORDER BY ordinal_index DESC LIMIT 1) i ON true
  ), selected AS MATERIALIZED (SELECT ordinal_index,value,identity FROM linked WHERE division=ANY($1::text[]) AND identity IS NOT NULL)
  SELECT p.current_version_id,p.retrieved_at,p.source_through,p.confirmation,
    (p.published AND p.root->>'formatVersion'='1' AND p.root->>'jurisdiction'='US-NH'
      AND jsonb_typeof(reader_payload_node(p.root->'members'))='array'
      AND jsonb_typeof(reader_payload_node(p.root->'identities'))='array'
      AND (SELECT count(*) FROM members)=(SELECT count(*) FROM identities)
      AND NOT EXISTS(SELECT 1 FROM identities WHERE NOT coalesce(starts_with(value->>'officeholderId','nh-general-court:'),false))
      AND (SELECT count(*)=count(DISTINCT identity->>'officeholderId') FROM linked WHERE identity IS NOT NULL)) IS TRUE AS valid,
    jsonb_build_object('formatVersion',1,'jurisdiction','US-NH','term',reader_payload_value(p.root->'term'),
      'members',coalesce((SELECT jsonb_agg(reader_payload_value(jsonb_build_object(
        'chamber',value->'chamber','seatNo',value->'seatNo','district',value->'district','county',value->'county',
        'givenName',value->'givenName','middleName',value->'middleName','familyName',value->'familyName',
        'party',value->'party','phone',value->'phone','email',value->'email')) ORDER BY ordinal_index) FROM selected),'[]'::jsonb),
      'identities',coalesce((SELECT jsonb_agg(reader_payload_value(identity) ORDER BY ordinal_index) FROM selected),'[]'::jsonb),
      'memberSourceDates',coalesce((SELECT jsonb_object_agg(identity->>'officeholderId',
        reader_payload_value(reader_payload_node(p.root->'memberSourceDates')->(identity->>'officeholderId'))) FROM selected),'{}'::jsonb)) AS payload
    FROM pointer p`,[[...new Set(ids)],Object.keys(NH_COUNTY)]);
  if (!row) return null;
  if (row.valid !== true) throw new Error("HELD_PLACE_READ_FAILED:STATE_LEGISLATOR:US-NH:STORE_UNREACHABLE");
  const confirmation = typeof row.confirmation === "string" ? parseUnchangedConfirmation(row.confirmation) : null;
  const retrievedAt = new Date(row.retrieved_at as string).toISOString();
  const confirmedAt = confirmation !== null && confirmation.versionId === row.current_version_id && Date.parse(confirmation.retrieval.retrievedAt)>Date.parse(retrievedAt)
    ? confirmation.retrieval.retrievedAt : retrievedAt;
  const model = nhMembersReadModel(row.payload as NhMemberReadModel,{ retrievedAt: confirmedAt, sourceThrough: row.source_through as string | null });
  return { versionId: row.current_version_id as string, payload: { roster: model.roster } };
}
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
      AND p.validation_receipt->>'scope'=c.scope AND (p.current_version_id=c.id AND p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint)) AS proof_valid,
    (SELECT detail FROM civic_data_candidate_events e WHERE e.candidate_id=p.current_version_id
      AND left(e.detail,26)='UNCHANGED_CONFIRMATION_V1 ' ORDER BY sequence DESC LIMIT 1) AS confirmation
  FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
  WHERE p.key=$1
), hashes(hash) AS (
  SELECT ref#>>'{}' FROM selected,LATERAL jsonb_path_query(roots,'strict $.**."$civicPayloadPart"','{}',true) ref WHERE proof_valid
  UNION
  SELECT ref#>>'{}' FROM hashes h JOIN LATERAL (SELECT hash,payload FROM civic_data_payload_parts WHERE hash=h.hash LIMIT 1) part ON true,
    LATERAL jsonb_path_query(part.payload,'strict $.**."$civicPayloadPart"','{}',true) ref
)
SELECT roots,proof_valid,confirmation,
  COALESCE((SELECT jsonb_object_agg(part.hash,part.payload) FROM hashes h JOIN LATERAL (SELECT hash,payload FROM civic_data_payload_parts WHERE hash=h.hash LIMIT 1) part ON true),'{}'::jsonb) AS parts
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
