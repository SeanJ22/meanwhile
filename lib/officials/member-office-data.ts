import { parseUnchangedConfirmation, UNCHANGED_CONFIRMATION_PREFIX } from "../civic-data/unchanged-confirmation.ts";
import { parseValidationReceipt } from "../civic-data/receipt.ts";
import type { Query } from "../facts/publish.ts";
import type { ManualSourceReview, ValidationReceipt, NormalizationEvidence, PromotedPointerIdentity } from "../civic-data/types.ts";
import type { MemberOfficeRecord } from "./member-offices.ts";
import { memberOfficeStateScope, memberOfficeScopeState } from "./member-office-scope.ts";

export const MEMBER_OFFICE_NATIONAL_SCOPE = "US:state-legislator-member-offices";
export const MEMBER_OFFICE_CURSOR = "member-offices:states";
export { memberOfficeStateScope, memberOfficeScopeState } from "./member-office-scope.ts";
/** Matches the keyed row's state: native id, office state, owned state scope, then saved source path. */
export function memberOfficeRecordState(record: MemberOfficeRecord, scope: string): string | null {
  const state = /^(?:plural|statewide|legiscan|official-legislature|wikidata|congress-api|govinfo):([a-z]{2}):/.exec(record.officeholderId)?.[1]
    ?? /^([a-z]{2})-(?:legislature|general-court):/.exec(record.officeholderId)?.[1]
    ?? record.office.state ?? memberOfficeScopeState(scope)
    ?? /\/data\/([a-z]{2})\//.exec(record.sourceUrl)?.[1] ?? /\/current\/([a-z]{2})\.csv/.exec(record.sourceUrl)?.[1];
  return state?.toUpperCase() ?? null;
}
export interface MemberOfficeProgress {
  readonly rosterDigests: Readonly<Record<string, string>>;
  readonly pending: readonly string[];
  readonly checkedAt?: string;
  readonly attemptedAt?: string;
  readonly partitioned?: boolean;
}
export interface MemberOfficeSlice {
  readonly scope: string;
  readonly versionId: string;
  readonly sourceId: string;
  readonly promotedAt: string;
  readonly retrievedAt: string;
  readonly sourceThrough: string | null;
  readonly version: string | null;
  readonly staleAtRetrieval?: boolean;
  readonly receipt: ValidationReceipt;
  readonly latestConfirmation?: PromotedPointerIdentity["latestConfirmation"];
  readonly records: readonly MemberOfficeRecord[];
  readonly sources: readonly ManualSourceReview[];
  readonly header: Readonly<Record<string, unknown>>;
  readonly normalization: Pick<NormalizationEvidence, "normalizedHash" | "stateRecordHashes">;
}

/** One pointed state edition, or that state's exact rows in the earlier national edition. */
export async function readMemberOfficeRows(query: Query, state: string, members: readonly string[] = []): Promise<MemberOfficeSlice | null> {
  const scope = memberOfficeStateScope(state), postal = memberOfficeScopeState(scope)!;
  const [row] = await query(`WITH pointer AS MATERIALIZED (
    SELECT p.key,p.scope,p.current_version_id,p.source_id,p.promoted_at,p.validation_receipt,c.retrieved_at,c.candidate->'temporal' AS temporal,
      (reader_payload_node(p.payload)-'records') AS header,
      jsonb_build_object('normalizedHash',c.normalized_hash,'stateRecordHashes',CASE WHEN cardinality($4::text[])=0 THEN reader_payload_value(c.candidate#>'{normalization,stateRecordHashes}') END) AS normalization,
      (p.current_version_id=p.last_known_good_version_id AND c.state='PROMOTED' AND c.acquisition_succeeded
       AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id AND c.source_id=p.source_id
       AND c.record_class=p.record_class AND c.scope=p.scope AND (p.current_version_id=c.id AND p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint)
       AND c.validation_receipt=p.validation_receipt AND p.validation_receipt->>'decision'='GOOD') AS valid
    FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
    WHERE p.record_class='CURATED_READER_RECORD' AND p.scope=ANY($1::text[])
    ORDER BY (p.scope=$2) DESC LIMIT 1
  ), offices AS MATERIALIZED (
    SELECT r.ordinal,r.value,r.aliases FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id
    WHERE p.valid AND r.collection='memberOffices' AND r.state=$3
      AND (cardinality($4::text[])=0 OR r.body_id=ANY($4::text[]))
  ) SELECT p.valid,p.scope,p.current_version_id AS version_id,p.source_id,p.promoted_at,p.retrieved_at,p.temporal,p.header,p.normalization,
    (SELECT e.detail FROM civic_data_candidate_events e WHERE e.candidate_id=p.current_version_id
      AND left(e.detail,$5)=$6 ORDER BY e.sequence DESC LIMIT 1) AS latest_confirmation,
    jsonb_set(p.validation_receipt,'{excludedFacts}','[]'::jsonb) AS receipt,
    coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal) FROM offices),'[]'::jsonb) AS records,
    coalesce((SELECT jsonb_agg(reader_payload_value(s.value) ORDER BY s.ordinal) FROM civic_data_rows s
      WHERE s.promotion_key=p.key AND s.version_id=p.current_version_id AND s.collection='memberOfficeSources' AND s.state=$3
       AND EXISTS(SELECT 1 FROM offices o WHERE o.aliases && s.aliases)),'[]'::jsonb) AS sources
    FROM pointer p`, [[scope, MEMBER_OFFICE_NATIONAL_SCOPE], scope, postal, [...members], UNCHANGED_CONFIRMATION_PREFIX.length, UNCHANGED_CONFIRMATION_PREFIX]);
  if (!row) return null;
  const receipt=parseValidationReceipt(row.receipt);
  if (row.valid !== true || !receipt || receipt.candidateId!==row.version_id || receipt.scope!==row.scope || receipt.sourceId!==row.source_id || receipt.recordClass!=="CURATED_READER_RECORD")
    throw new Error(`MEMBER_OFFICE_POINTER_INVALID:${row.scope}`);
  const latest=typeof row.latest_confirmation==="string" ? parseUnchangedConfirmation(row.latest_confirmation) : null;
  const temporal = row.temporal as { version?: string; sourceThrough?: string | null; staleAtRetrieval?: boolean };
  return { scope: String(row.scope), versionId: String(row.version_id), sourceId: String(row.source_id),
    promotedAt: new Date(row.promoted_at as string).toISOString(), retrievedAt: new Date(row.retrieved_at as string).toISOString(),
    sourceThrough: temporal.sourceThrough ?? null, version: temporal.version ?? null, staleAtRetrieval: temporal.staleAtRetrieval === true, receipt, ...(latest && latest.versionId===row.version_id ? {latestConfirmation:latest}: {}),
    records: row.records as MemberOfficeRecord[], sources: row.sources as ManualSourceReview[],
    header: row.header as Record<string,unknown>, normalization: row.normalization as MemberOfficeSlice["normalization"] };
}

/** A source-native global person id needs no guessed state and never loads other members. */
export async function readMemberOfficeMembers(query: Query, members: readonly string[]): Promise<readonly MemberOfficeRecord[]> {
  if (!members.length) return [];
  const rows=await query(`WITH pointers AS MATERIALIZED (
    SELECT p.key,p.scope,p.current_version_id,
      (p.current_version_id=p.last_known_good_version_id AND c.state='PROMOTED' AND c.acquisition_succeeded
       AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id AND c.source_id=p.source_id
       AND c.record_class=p.record_class AND c.scope=p.scope AND (p.current_version_id=c.id AND p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint)
       AND c.validation_receipt=p.validation_receipt AND p.validation_receipt->>'decision'='GOOD') AS valid
    FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
    WHERE p.record_class='CURATED_READER_RECORD'
      AND (p.scope=$2 OR p.scope ~ '^US-[A-Z]{2}:state-legislator-member-offices$')
  ) SELECT p.valid,reader_payload_value(r.value) AS record FROM civic_data_rows r JOIN pointers p
      ON p.key=r.promotion_key AND p.current_version_id=r.version_id
    WHERE r.collection='memberOffices' AND r.body_id=ANY($1::text[])
      AND (p.scope<>$2 OR NOT EXISTS(SELECT 1 FROM pointers s WHERE s.scope='US-'||r.state||':state-legislator-member-offices'))
    ORDER BY r.state,r.ordinal`,[[...members],MEMBER_OFFICE_NATIONAL_SCOPE]);
  if(rows.some(row=>row.valid!==true))throw new Error("MEMBER_OFFICE_POINTER_INVALID:member");
  return rows.map(row=>row.record as MemberOfficeRecord);
}
