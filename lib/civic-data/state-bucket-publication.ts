import { withStateRecordHashes } from "./state-publication.ts";
import { createHash } from "node:crypto";
import { requireBallotState, stateBallotContractId, stateBallotScope, type StateBallotFamily } from "./state-scopes.ts";
import { requireRegistryState, stateRegistryRuntimeContractId, stateRegistryRuntimeScope } from "./state-scopes.ts";
import { assertWriteAllowed } from "../db/write-guard.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { candidateChangeSet, canonicalCivicDataJson, civicRecordsFor, rowKeyedCivicRecordsFor, ROW_KEYED_CIVIC_CHANGE_CONTRACT } from "./changes.ts";
import { CivicPayloadParts } from "./payload-parts.ts";
import { CIVIC_DATA_PROMOTION_OPERATION } from "./production-write.ts";
import { assertRegisteredRuntimeContract } from "./runtime-authority.ts";
import { encodeStateCandidate, immutableStateCandidate } from "./state-publication.ts";
import { trustedLkgCandidateEnvelopeSha256, trustedLkgValidatorIds, trustedLkgCandidateId } from "./trusted-lkg-import.ts";
import type { CandidateEvent, RoutineCandidate, RoutineRecordClass, ValidationReceipt } from "./types.ts";

type StateBucketFamily = StateBallotFamily | "registry-runtime";
export interface StateBucketSource {
  readonly family: StateBucketFamily;
  readonly state: string;
  readonly inputHash: string;
  readonly originId: string;
  readonly originScope: string;
  readonly originReadModelHash: string;
  readonly promotedAt: string;
  readonly candidate: RoutineCandidate;
  readonly receipt: ValidationReceipt;
  readonly payload: unknown;
  readonly normalizedMetadata: Record<string, unknown>;
  readonly events: readonly CandidateEvent[];
}
type Query = (text: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
const TRACE = "STATE_BUCKET_RESTORE_V1 ";
const classes: Record<StateBucketFamily, RoutineRecordClass> = {
  "ballot-contests": "BALLOT_CANDIDACY", "candidate-profiles": "CANDIDATE_PROFILE", "candidate-corpus": "CANDIDATE_PUBLICATION",
  "voting-sites": "VOTING_SITE", "candidate-campaign-sites-derived": "CURATED_READER_RECORD", "registry-runtime": "REGISTRY_RUNTIME_BINDING",
};
const bucketScope = (family: StateBucketFamily, state: string) => family === "registry-runtime"
  ? stateRegistryRuntimeScope(state) : stateBallotScope(family, state);
const bucketContract = (family: StateBucketFamily, state: string) => family === "registry-runtime"
  ? stateRegistryRuntimeContractId(state) : stateBallotContractId(family, state);

function rekey(source: StateBucketSource, family: StateBucketFamily, state: string): { candidate: RoutineCandidate; receipt: ValidationReceipt } {
  const scope = bucketScope(family, state), prior = { ...source.candidate, readModel: source.payload,
    normalizedPayload: family === "voting-sites" ? { ...source.normalizedMetadata, projection: source.payload }
      : family === "candidate-campaign-sites-derived" ? { ...source.normalizedMetadata, readModel: source.payload } : source.payload };
  let candidate: RoutineCandidate = { ...prior, scope, sourceProjectionEvidence: { ...prior.sourceProjectionEvidence, scope } };
  if (family === "candidate-campaign-sites-derived") candidate = { ...candidate,
    retrieval: { ...candidate.retrieval, requestedUrl: `derived:${candidate.sourceId}:${scope}` },
    temporal: { ...candidate.temporal, version: scope, expectedVersion: scope } };
  if (family === "ballot-contests") {
    const receipt = candidate.retrieval.manualSourceReceipt;
    if (!receipt?.sources.length) throw new Error("STATE_AUTHORITY_BALLOT_SOURCES_MISSING");
    const sources = [...receipt.sources].sort((a, b) => `${a.finalUrl}\n${a.rawHash}`.localeCompare(`${b.finalUrl}\n${b.rawHash}`));
    const rawHash = createHash("sha256").update(sources.map(s =>
      `${s.requestedUrl}\n${s.finalUrl}\n${s.httpStatus}\n${s.rawHash}\n${s.reviewOutcome ?? "SUPPORTED"}\n${s.failureDetail ?? ""}${s.extractedMembers?.length ? `\n${canonicalCivicDataJson(s.extractedMembers)}` : ""}`,
    ).join("\n")).digest("hex");
    const first = receipt.sources[0];
    candidate = { ...candidate, retrieval: { ...candidate.retrieval, rawHash,
      requestedUrl: first.requestedUrl, finalUrl: first.finalUrl, httpStatus: first.httpStatus } };
  }
  const civicRecords = candidate.bootstrapImport ? rowKeyedCivicRecordsFor(candidate.recordClass, candidate.readModel) : civicRecordsFor(candidate.recordClass, candidate.readModel);
  const count = civicRecords.length, dropped = candidate.excludedFacts?.length ?? 0;
  const normalizedHash = canonicalCivicDataHash(candidate.readModel);
  candidate = { ...candidate, civicRecords, normalization: { ...candidate.normalization, inputRecords: count + dropped, outputRecords: count, droppedRecords: dropped,
    normalizedHash, normalizedPayloadHash: candidate.normalizedPayload === candidate.readModel ? normalizedHash : canonicalCivicDataHash(candidate.normalizedPayload) },
  horizon: { ...candidate.horizon, returnedRecords: count } };
  candidate = { ...candidate, changeSet: candidateChangeSet(candidate, null, candidate.bootstrapImport ? ROW_KEYED_CIVIC_CHANGE_CONTRACT : undefined) };
  candidate = withStateRecordHashes(immutableStateCandidate(candidate));
  if (candidate.bootstrapImport) {
    candidate = { ...candidate, bootstrapImport: { ...candidate.bootstrapImport, scope,
      readModelSha256: candidate.normalization.normalizedHash!, normalizedPayloadSha256: candidate.normalization.normalizedPayloadHash! } };
    candidate = { ...candidate, bootstrapImport: { ...candidate.bootstrapImport!, validatorIds: trustedLkgValidatorIds(candidate), candidateEnvelopeSha256: trustedLkgCandidateEnvelopeSha256(candidate) } };
    candidate = { ...candidate, id: trustedLkgCandidateId(candidate.bootstrapImport!) };
  } else candidate = { ...candidate, id: `cv-${canonicalCivicDataHash({ operation: "state-authority-partition", originId: source.originId, inputHash: source.inputHash, scope, payloadHash: candidate.normalization.normalizedHash }).slice(0, 32)}` };
  const receipt: ValidationReceipt = { ...source.receipt, candidateId: candidate.id, scope, excludedFacts: candidate.excludedFacts ?? [],
    checks: source.receipt.checks.map(check => ({ ...check,
      ...(check.check === "SCHEMA_PARSE_VALIDITY" ? { detail: `${count} preserved state records; ${dropped} explicitly held facts.` }
        : check.check === "IDENTITY_JURISDICTION_VALIDITY" ? { detail: `${candidate.identities.length} exact state identity bindings preserved.` } : {}),
    })) };
  return { candidate, receipt };
}


const originScopes: Record<StateBucketFamily, string> = {
  "ballot-contests": "US:state-election-ballots",
  "candidate-profiles": "US-AZ+US-NH+US-NJ:2026-supported-candidates",
  "candidate-corpus": "US-AZ+US-NH+US-NJ:2026-supported-candidates",
  "voting-sites": "US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions",
  "candidate-campaign-sites-derived": "US:candidate-campaign-sites-derived",
  "registry-runtime": "US:reader-registry-runtime-bindings",
};

const ORIGIN_GUARD = `SELECT c.id FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id
  WHERE p.record_class=$1 AND p.scope=$2 AND p.current_version_id=$3 AND p.last_known_good_version_id=$3
    AND c.source_id=$4 AND p.source_id=c.source_id AND c.record_class=p.record_class AND c.scope=p.scope
    AND c.state='PROMOTED' AND c.acquisition_succeeded AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
    AND c.normalized_hash=$5
    AND c.validation_receipt->>'decision'='GOOD' AND c.validation_receipt-'excludedFacts'=$6::jsonb
    AND p.validation_receipt=c.validation_receipt`;

async function currentBucket(query: Query, recordClass: string, scope: string): Promise<{ versionId: string; inputHash: string | null } | null> {
  const rows = await query(`SELECT p.current_version_id AS version_id,e.detail
    FROM civic_data_promotions p LEFT JOIN civic_data_candidate_events e ON e.candidate_id=p.current_version_id AND e.sequence=1
    WHERE p.record_class=$1 AND p.scope=$2 /* STATE_BUCKET_CURRENT: Checking ownership must not hydrate the prior payload. */`, [recordClass, scope]);
  if (!rows[0]) return null;
  let inputHash: string | null = null;
  const detail = rows[0].detail;
  if (typeof detail === "string" && detail.startsWith(TRACE)) {
    try { const trace = JSON.parse(detail.slice(TRACE.length));
      if (trace.scope === scope && trace.recordClass === recordClass && /^[a-f0-9]{64}$/.test(trace.inputHash)) inputHash = trace.inputHash;
    } catch { /* An unrecognized first event never authorizes replacing the current pointer. */ }
  }
  return { versionId: String(rows[0].version_id), inputHash };
}

function partitionEvents(source: StateBucketSource, candidate: RoutineCandidate): readonly CandidateEvent[] {
  if (source.events.slice(0, 4).map(event => event.state).join(",") !== "FETCHED,NORMALIZED,VALIDATED,PROMOTED" ||
      source.events[2]?.at !== source.receipt.validatedAt || source.events[3]?.at !== source.promotedAt)
    throw new Error("STATE_BUCKET_ORIGIN_EVENTS_INVALID");
  return source.events.map((event, index) => {
    let detail = event.detail;
    if (index === 0) detail = TRACE + JSON.stringify({ inputHash: source.inputHash, originId: source.originId,
      originScope: source.originScope, originReadModelHash: source.originReadModelHash,
      scope: candidate.scope, recordClass: candidate.recordClass, sourceDetail: event.detail });
    else for (const prefix of ["UNCHANGED_CONFIRMATION_V1 ", "UNCHANGED_CONFIRMATION_SOURCES_V1 "]) {
      if (!detail.startsWith(prefix)) continue;
      const evidence = JSON.parse(detail.slice(prefix.length));
      evidence.versionId = candidate.id;
      if (prefix === "UNCHANGED_CONFIRMATION_V1 ") {
        evidence.scope = candidate.scope; evidence.pointerKey = `${candidate.recordClass}:${candidate.scope}`;
        evidence.readModelHash = candidate.normalization.normalizedHash;
        if (source.family === "candidate-campaign-sites-derived") evidence.retrieval = { ...evidence.retrieval,
          requestedUrl: candidate.retrieval.requestedUrl, finalUrl: candidate.retrieval.finalUrl };
      }
      detail = prefix + JSON.stringify(evidence);
    }
    return { ...event, candidateId: candidate.id, sequence: index + 1, detail };
  });
}

export async function publishStateBucket(source: StateBucketSource, query: Query): Promise<{
  status: "PUBLISHED" | "UNCHANGED" | "CURRENT"; state: string; family: StateBucketFamily; versionId: string;
}> {
  const { family } = source;
  if (!Object.hasOwn(classes, family)) throw new Error("STATE_BUCKET_FAMILY_INVALID");
  const state = family === "registry-runtime" ? requireRegistryState(source.state) : requireBallotState(source.state);
  const recordClass = classes[family], scope = bucketScope(family, state);
  assertRegisteredRuntimeContract(bucketContract(family, state), family === "candidate-campaign-sites-derived" ? "routine" : "manual");
  assertWriteAllowed(CIVIC_DATA_PROMOTION_OPERATION);
  if (!/^[a-f0-9]{64}$/.test(source.inputHash) || !/^[a-f0-9]{64}$/.test(source.originReadModelHash) ||
      source.originScope !== originScopes[family] || source.candidate.id !== source.originId ||
      source.candidate.scope !== source.originScope || source.candidate.recordClass !== recordClass ||
      source.receipt.candidateId !== source.originId || source.receipt.scope !== source.originScope ||
      source.receipt.sourceId !== source.candidate.sourceId || source.receipt.recordClass !== recordClass ||
      source.receipt.decision !== "GOOD" || source.receipt.checks.some(check => check.verdict !== "PASS"))
    throw new Error("STATE_BUCKET_ORIGIN_INVALID");
  const originalReceipt = { ...source.receipt, excludedFacts: undefined };
  const guard = [recordClass, source.originScope, source.originId, source.candidate.sourceId,
    source.originReadModelHash, JSON.stringify(originalReceipt)];
  if (!(await query(`${ORIGIN_GUARD} /* STATE_BUCKET_ORIGIN_GUARD: Refuse a moved origin before storing any state parts. */`, guard)).length)
    throw new Error("STATE_BUCKET_ORIGIN_NOT_CURRENT_GOOD");
  const held = await currentBucket(query, recordClass, scope);
  const result = (status: "PUBLISHED" | "UNCHANGED" | "CURRENT", versionId: string) => ({ status, state, family, versionId });
  if (held?.inputHash === source.inputHash) return result("UNCHANGED", held.versionId);
  if (held && held.inputHash === null) return result("CURRENT", held.versionId);

  const prepared = rekey(source, family, state), candidate = immutableStateCandidate(prepared.candidate);
  const events = partitionEvents(source, candidate);
  const parts = new CivicPayloadParts({
    existing: async hashes => (await query("SELECT hash FROM civic_data_payload_parts WHERE hash=ANY($1::text[])", [hashes])).map(row => String(row.hash)),
    write: async values => { await query(`INSERT INTO civic_data_payload_parts(hash,payload)
      SELECT hash,payload FROM jsonb_to_recordset($1::jsonb) AS part(hash text,payload jsonb) ON CONFLICT(hash) DO NOTHING`, [JSON.stringify(values)]); },
    read: async () => { throw new Error("STATE_BUCKET_PRIOR_PAYLOAD_READ_FORBIDDEN"); },
  });
  const encoded = await parts.store({ ...encodeStateCandidate(candidate), retrieval: await parts.store(candidate.retrieval,
    ["succeeded", "requestedUrl", "finalUrl", "httpStatus", "retrievedAt", "rawHash", "sourceCheck", "failureDetail"]) },
  ["id", "sourceId", "recordClass", "scope", "retrieval", "normalization", "temporal", "bootstrapImport"], ["readModel"]);
  const rows = await query(`WITH origin AS MATERIALIZED (${ORIGIN_GUARD} FOR SHARE OF p,c), eligible AS MATERIALIZED (
      SELECT 1 FROM origin WHERE NOT EXISTS (SELECT 1 FROM civic_data_promotions WHERE key=$7 AND current_version_id IS DISTINCT FROM $8::text)
        AND ($8::text IS NULL OR EXISTS (SELECT 1 FROM civic_data_promotions WHERE key=$7 AND current_version_id=$8))
    ), saved AS (
      INSERT INTO civic_data_candidates(id,source_id,record_class,scope,state,acquisition_succeeded,raw_hash,normalized_hash,
        retrieved_at,source_through,parser_version,identity,candidate,validation_receipt,promoted_version_id,last_known_good_version_id)
      SELECT $9,$4,$1,$10,'PROMOTED',true,$11,$12,$13::timestamptz,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$9,$9 FROM eligible
      ON CONFLICT(id) DO NOTHING RETURNING id
    ), pointed AS (
      INSERT INTO civic_data_promotions(key,source_id,record_class,scope,current_version_id,last_known_good_version_id,promoted_at,payload,validation_receipt)
      SELECT $7,$4,$1,$10,id,id,$19::timestamptz,$17::jsonb->'readModel',$18::jsonb FROM saved
      ON CONFLICT(key) DO UPDATE SET current_version_id=excluded.current_version_id,last_known_good_version_id=excluded.last_known_good_version_id,
        promoted_at=excluded.promoted_at,payload=excluded.payload,validation_receipt=excluded.validation_receipt
      WHERE civic_data_promotions.current_version_id=$8 AND civic_data_promotions.source_id=$4 RETURNING current_version_id
    ), history AS (
      INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail)
      SELECT pointed.current_version_id,e.sequence,e.state,e.at::timestamptz,e.detail FROM pointed,
        jsonb_to_recordset($20::jsonb) AS e(sequence integer,state text,at text,detail text) ORDER BY e.sequence RETURNING candidate_id
    ) SELECT current_version_id AS version_id FROM pointed WHERE EXISTS(SELECT 1 FROM history) /* STATE_BUCKET_PUBLISH: The pointer and original history must commit together. */`,
  [...guard, `${recordClass}:${scope}`, held?.versionId ?? null, candidate.id, scope, candidate.retrieval.rawHash,
    candidate.normalization.normalizedHash, candidate.retrieval.retrievedAt, candidate.temporal.sourceThrough,
    candidate.normalization.parserVersion, JSON.stringify((encoded as Record<string, unknown>).identities), JSON.stringify(encoded),
    JSON.stringify(prepared.receipt), source.promotedAt, JSON.stringify(events)]);
  if (rows[0]) return result("PUBLISHED", String(rows[0].version_id));
  if (!(await query(`${ORIGIN_GUARD} /* STATE_BUCKET_ORIGIN_GUARD: Refuse a moved origin before storing any state parts. */`, guard)).length)
    throw new Error("STATE_BUCKET_ORIGIN_NOT_CURRENT_GOOD");
  const latest = await currentBucket(query, recordClass, scope);
  if (latest) return result(latest.inputHash === source.inputHash ? "UNCHANGED" : "CURRENT", latest.versionId);
  throw new Error("STATE_BUCKET_POINTER_NOT_PUBLISHED");
}
