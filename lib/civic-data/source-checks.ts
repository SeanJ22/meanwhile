import type { RoutineRecordClass } from "./types.ts";

/** A source check is keyed to its exact published bytes/configuration, independently of its containing package. */
export interface PublishedSourceCheck {
  readonly sourceKey: string;
  readonly rawHash: string;
  readonly parserVersion: string;
  readonly checkedAt: string;
  readonly sourceUrls: readonly string[];
  readonly jurisdictionIds: readonly string[];
  /** For an independently published source, binds this page's hash to its complete source-head hash. */
  readonly sourceHash?: string;
}

export interface RecordPublishedSourceCheck extends PublishedSourceCheck {
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly pointerVersionId: string;
}

export type SourceChecksQuery = (text: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;

export function validPublishedSourceCheck(check: RecordPublishedSourceCheck): boolean {
  return [check.sourceId, check.sourceKey, check.parserVersion, check.scope, check.pointerVersionId].every(value => typeof value === "string" && value.trim().length > 0) &&
    /^[a-f0-9]{64}$/.test(check.rawHash) && Number.isFinite(Date.parse(check.checkedAt)) &&
    (check.sourceHash === undefined || /^[a-f0-9]{64}$/.test(check.sourceHash)) &&
    check.sourceUrls.length > 0 && check.jurisdictionIds.length > 0 &&
    check.sourceUrls.every(value => { try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password; } catch { return false; } }) &&
    check.jurisdictionIds.every(value => typeof value === "string" && value.trim().length > 0);
}

/** The live pointer, its source hash and parser must still match in the same statement that saves the check. */
export async function recordPublishedSourceCheck(query: SourceChecksQuery, input: RecordPublishedSourceCheck): Promise<boolean> {
  if (!validPublishedSourceCheck(input)) throw new Error("SOURCE_CHECK_INVALID");
  const rows = await query(`INSERT INTO civic_data_source_checks
    (record_class,scope,source_key,source_id,pointer_version_id,raw_hash,parser_version,checked_at,source_urls,jurisdiction_ids,source_raw_hash)
    SELECT p.record_class,p.scope,$3,p.source_id,p.current_version_id,$6,$7,$8::timestamptz,$9::text[],$10::text[],$11::text
    FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id
    WHERE p.record_class=$1 AND p.scope=$2 AND p.source_id=$4 AND p.current_version_id=$5
      AND p.last_known_good_version_id=p.current_version_id AND c.state='PROMOTED' AND c.acquisition_succeeded
      AND c.source_id=p.source_id AND c.record_class=p.record_class AND c.scope=p.scope AND c.parser_version=$7
      AND c.candidate#>>'{retrieval,rawHashBasis}'='SOURCE_CONTENT_V1'
      AND (($11::text IS NULL AND reader_payload_node(p.payload)->>'sourceManifestVersion'='1' AND reader_payload_node(reader_payload_node(p.payload)->'sourceHashes')->>$3=$6)
        OR ($11::text IS NOT NULL AND c.raw_hash=$11))
      AND NOT (c.candidate ? 'bootstrapImport')
      AND coalesce(c.candidate#>>'{stateRetirement,kind}','')<>'STATE_AUTHORITY_RETIREMENT'
    ON CONFLICT(record_class,scope,source_key) DO UPDATE SET
      source_id=excluded.source_id,pointer_version_id=excluded.pointer_version_id,raw_hash=excluded.raw_hash,
      parser_version=excluded.parser_version,source_urls=excluded.source_urls,jurisdiction_ids=excluded.jurisdiction_ids,source_raw_hash=excluded.source_raw_hash,
      checked_at=CASE WHEN civic_data_source_checks.raw_hash=excluded.raw_hash AND civic_data_source_checks.parser_version=excluded.parser_version
        THEN greatest(civic_data_source_checks.checked_at,excluded.checked_at) ELSE excluded.checked_at END
    RETURNING source_key`, [input.recordClass, input.scope, input.sourceKey, input.sourceId, input.pointerVersionId,
    input.rawHash, input.parserVersion, input.checkedAt, [...input.sourceUrls], [...input.jurisdictionIds], input.sourceHash ?? null]);
  return rows.length === 1;
}

/** Exact keyed checks; consumers bind their hashes to the admitted page's source facts. */
export async function readPublishedSourceChecks(query: SourceChecksQuery, recordClass: RoutineRecordClass, scope: string,
  sourceKeys: readonly string[]): Promise<readonly PublishedSourceCheck[]> {
  if (!sourceKeys.length) return [];
  const rows = await query(`SELECT s.source_key,s.raw_hash,s.parser_version,s.checked_at,s.source_urls,s.jurisdiction_ids,s.source_raw_hash
    FROM civic_data_source_checks s
    WHERE s.record_class=$1 AND s.scope=$2 AND s.source_key=ANY($3::text[])
    ORDER BY s.source_key`, [recordClass, scope, [...new Set(sourceKeys)]]);
  return rows.map(row => ({ sourceKey: String(row.source_key), rawHash: String(row.raw_hash), parserVersion: String(row.parser_version),
    checkedAt: new Date(String(row.checked_at)).toISOString(), sourceUrls: row.source_urls as string[], jurisdictionIds: row.jurisdiction_ids as string[],
    ...(typeof row.source_raw_hash === "string" ? { sourceHash: row.source_raw_hash } : {}) }));
}
