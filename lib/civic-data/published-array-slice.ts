import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { readerDatabaseQuery } from "../reader/database.ts";
import { CivicPayloadParts } from "./payload-parts.ts";
import type { DerivedInputRef } from "./derived-authority.ts";
import { VALIDATION_CHECKS, type RoutineRecordClass } from "./types.ts";
import type { ValidationReceipt } from "./types.ts";

/** A legacy publication stays authoritative while its readers move to area pointers.
 * Only matching records and their immutable payload parts cross the connection. */
export interface PublishedArraySlice<T> {
  readonly records: readonly T[];
  readonly input: Extract<DerivedInputRef, { kind: "PROMOTED_VERSION" }>;
  readonly sourceId: string;
  readonly retrievedAt: string;
  readonly sourceVersion: string | null;
  readonly sourceThrough: string | null;
  readonly finalUrl: string | null;
  readonly receipt: ValidationReceipt;
}

// Couple the pointer to the stored validated candidate before selecting native facts.
// The immutable payload-part store supplies the encoding; this does not rehash unselected country records.
function publishedArraySliceSql(multipleScopes = false, stateKeysOnly = false, normalizedPayload = false): string { return `WITH RECURSIVE publication AS MATERIALIZED (
 SELECT p.*,c.normalized_hash,c.retrieved_at,c.candidate#>>'{temporal,version}' AS source_version,c.candidate#>>'{temporal,sourceThrough}' AS source_through,
  c.candidate#>>'{retrieval,finalUrl}' AS final_url,${normalizedPayload ? "c.candidate->'normalizedPayload' AS source_payload," : ""}
  (p.key=p.record_class||':'||p.scope
   AND p.current_version_id=p.last_known_good_version_id AND c.id=p.current_version_id AND c.state='PROMOTED'
   AND c.acquisition_succeeded AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
   AND c.record_class=p.record_class AND c.scope=p.scope AND c.source_id=p.source_id
   AND c.candidate->>'id'=c.id AND c.candidate->>'sourceId'=c.source_id
   AND c.candidate->>'recordClass'=c.record_class AND c.candidate->>'scope'=c.scope
   AND p.payload=c.candidate->'readModel' AND p.validation_receipt=c.validation_receipt
   AND c.candidate#>'{retrieval,succeeded}'='true'::jsonb
   AND c.candidate#>'{normalization,succeeded}'='true'::jsonb
   AND c.normalized_hash ~ '^[a-f0-9]{64}$'
   AND c.candidate#>>'{normalization,normalizedHash}'=c.normalized_hash
   AND c.candidate#>>'{normalization,normalizedPayloadHash}' ~ '^[a-f0-9]{64}$'
   AND jsonb_typeof(c.candidate#>'{temporal,version}')='string'
   AND jsonb_typeof(c.candidate#>'{temporal,sourceThrough}')='string'
   AND (c.candidate#>>'{retrieval,retrievedAt}')::timestamptz=c.retrieved_at
   AND c.retrieved_at<=(p.validation_receipt->>'validatedAt')::timestamptz
   AND (p.validation_receipt->>'validatedAt')::timestamptz<=p.promoted_at
   AND p.validation_receipt->'contractVersion'='2'::jsonb
   AND p.validation_receipt->>'decision'='GOOD' AND p.validation_receipt->>'candidateId'=c.id
   AND p.validation_receipt->>'sourceId'=c.source_id AND p.validation_receipt->>'recordClass'=p.record_class
   AND p.validation_receipt->>'scope'=p.scope
   AND jsonb_typeof(p.validation_receipt->'checks')='array'
   AND jsonb_array_length(CASE WHEN jsonb_typeof(p.validation_receipt->'checks')='array' THEN p.validation_receipt->'checks' ELSE '[]'::jsonb END)=${VALIDATION_CHECKS.length}
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.validation_receipt->'checks')='array'
     THEN p.validation_receipt->'checks' ELSE '[]'::jsonb END) WITH ORDINALITY checked(value,position)
     WHERE value->>'check' IS DISTINCT FROM (ARRAY[${VALIDATION_CHECKS.map(check => `'${check}'`).join(",")} ]::text[])[position]
       OR value->>'verdict' IS DISTINCT FROM 'PASS' OR jsonb_typeof(value->'code') IS DISTINCT FROM 'string'
       OR btrim(value->>'code')='' OR jsonb_typeof(value->'detail') IS DISTINCT FROM 'string' OR btrim(value->>'detail')='')
   AND jsonb_typeof(p.validation_receipt->'excludedFacts')='array'
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.validation_receipt->'excludedFacts')='array'
     THEN p.validation_receipt->'excludedFacts' ELSE '[]'::jsonb END) excluded(value)
     WHERE jsonb_typeof(value->'code') IS DISTINCT FROM 'string' OR btrim(value->>'code')=''
       OR jsonb_typeof(value->'detail') IS DISTINCT FROM 'string' OR btrim(value->>'detail')=''
       OR value ? 'key' AND value->'key'<>'null'::jsonb AND jsonb_typeof(value->'key')<>'string')) AS published
 FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
 WHERE p.record_class=$1 AND ${multipleScopes ? "p.scope=ANY($2::text[])" : "p.scope=$2"}
), navigation(value,remaining,ordinal,is_record) AS (
 SELECT ${normalizedPayload ? "source_payload" : "payload"},$3::text[],${multipleScopes ? "ARRAY[row_number() OVER(ORDER BY scope)]::bigint[]" : "ARRAY[]::bigint[]"},false FROM publication WHERE published
 UNION ALL
 SELECT next.value,next.remaining,next.ordinal,next.is_record FROM navigation n
 CROSS JOIN LATERAL (
  SELECT CASE WHEN part.payload->>'kind'='object' THEN part.payload->'value' ELSE part.payload END,
    n.remaining,n.ordinal,false
  FROM civic_data_payload_parts part WHERE NOT n.is_record AND part.hash=n.value->>'$civicPayloadPart'
  UNION ALL
  SELECT held.payload->(ordered.group_position::int-1),
    CASE WHEN cardinality(n.remaining)=0 THEN n.remaining ELSE n.remaining[2:] END,
    n.ordinal || ordered.position,cardinality(n.remaining)=0
  FROM LATERAL (
    WITH RECURSIVE pieces(value,position) AS (
      SELECT n.value->'order',ARRAY[]::bigint[] WHERE NOT n.is_record AND n.value->>'kind'='array'
        AND (cardinality(n.remaining)=0 OR n.remaining[1]='*')
      UNION ALL
      SELECT next.value,next.position FROM pieces p CROSS JOIN LATERAL (
        SELECT part.payload,p.position FROM civic_data_payload_parts part WHERE part.hash=p.value->>'$civicPayloadPart'
        UNION ALL
        SELECT chunk.value,p.position || chunk.position FROM jsonb_array_elements(CASE WHEN p.value->>'kind'='string' THEN p.value->'chunks' ELSE '[]'::jsonb END)
          WITH ORDINALITY chunk(value,position)
      ) next(value,position)
    ) SELECT string_agg(value#>>'{}','' ORDER BY position)::jsonb AS sequence FROM pieces WHERE jsonb_typeof(value)='string'
  ) source_order
  CROSS JOIN LATERAL (
    SELECT member.value#>>'{}' AS group_index,member.position,
      row_number() OVER (PARTITION BY member.value#>>'{}' ORDER BY member.position) AS group_position
    FROM jsonb_array_elements(COALESCE(source_order.sequence,'[]'::jsonb)) WITH ORDINALITY member(value,position)
  ) ordered
  JOIN civic_data_payload_parts held ON held.hash=n.value->'groups'->(ordered.group_index::int)->>'$civicPayloadPart'
  UNION ALL
  SELECT member.value,CASE WHEN cardinality(n.remaining)=0 THEN n.remaining ELSE n.remaining[2:] END,
    n.ordinal || member.position,cardinality(n.remaining)=0
  FROM jsonb_array_elements(CASE WHEN NOT n.is_record AND jsonb_typeof(n.value)='array'
      AND (cardinality(n.remaining)=0 OR n.remaining[1]='*') THEN n.value ELSE '[]'::jsonb END)
    WITH ORDINALITY member(value,position)
  UNION ALL
  SELECT n.value->n.remaining[1],n.remaining[2:],n.ordinal,false
  WHERE NOT n.is_record AND cardinality(n.remaining)>0 AND n.remaining[1]<>'*'
    AND jsonb_typeof(n.value)='object' AND NOT n.value ? '$civicPayloadPart'
    AND n.value ? n.remaining[1]
  UNION ALL
  SELECT n.value,n.remaining,n.ordinal,true
  WHERE ($6::boolean OR $9::boolean) AND NOT n.is_record AND cardinality(n.remaining)=0
    AND ($9::boolean OR jsonb_typeof(n.value)='object') AND NOT (jsonb_typeof(n.value)='object' AND n.value ? '$civicPayloadPart')
 ) next(value,remaining,ordinal,is_record)
), record_parts(ordinal,value) AS (
 SELECT ordinal,value FROM navigation WHERE is_record
 UNION ALL
 SELECT r.ordinal,CASE WHEN part.payload->>'kind'='object' THEN part.payload->'value' ELSE part.payload END
 FROM record_parts r JOIN civic_data_payload_parts part ON part.hash=r.value->>'$civicPayloadPart'
), native_records AS (
 SELECT ordinal,value FROM record_parts WHERE NOT (jsonb_typeof(value)='object' AND value ? '$civicPayloadPart')
), identities(ordinal,value,remaining,pattern,requirement) AS (
 SELECT n.ordinal,n.value,s.path,s.pattern,s.requirement FROM native_records n CROSS JOIN LATERAL (
  SELECT $4::text[] AS path,$5::text AS pattern,0::bigint AS requirement WHERE $8::jsonb IS NULL
  UNION ALL
  SELECT ARRAY(SELECT jsonb_array_elements_text(selector.value->'path')),selector.value->>'pattern',
    CASE WHEN selector.value->>'required'='true' THEN selector.position ELSE 0 END
   FROM jsonb_array_elements(COALESCE($8::jsonb,'[]'::jsonb)) WITH ORDINALITY selector(value,position)
 ) s
 UNION ALL
 SELECT i.ordinal,next.value,next.remaining,i.pattern,i.requirement FROM identities i CROSS JOIN LATERAL (
  SELECT CASE WHEN part.payload->>'kind'='object' THEN part.payload->'value' ELSE part.payload END,i.remaining
   FROM civic_data_payload_parts part WHERE part.hash=i.value->>'$civicPayloadPart'
  UNION ALL
  SELECT i.value->i.remaining[1],i.remaining[2:]
   WHERE cardinality(i.remaining)>0 AND jsonb_typeof(i.value)='object' AND NOT i.value ? '$civicPayloadPart'
    AND i.value ? i.remaining[1] AND i.remaining[1]<>'*'
  UNION ALL
  SELECT member.value,i.remaining[2:] FROM jsonb_array_elements(CASE WHEN cardinality(i.remaining)>0
    AND i.remaining[1]='*' AND jsonb_typeof(i.value)='array' THEN i.value ELSE '[]'::jsonb END) member(value)
  UNION ALL
  SELECT member.value,i.remaining[2:] FROM jsonb_array_elements(CASE WHEN cardinality(i.remaining)>0
    AND i.remaining[1]='*' AND i.value->>'kind'='array' THEN i.value->'groups' ELSE '[]'::jsonb END) grouped(value)
  JOIN civic_data_payload_parts part ON part.hash=grouped.value->>'$civicPayloadPart'
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(part.payload)='array' THEN part.payload ELSE '[]'::jsonb END) member(value)
 ) next(value,remaining)
), selected AS (
 SELECT CASE WHEN $10::boolean THEN to_jsonb(ARRAY(SELECT jsonb_object_keys(n.value)))
  WHEN $11::text[] IS NOT NULL AND jsonb_typeof(n.value)='object' THEN coalesce((SELECT jsonb_object_agg(e.key,e.value) FROM jsonb_each(n.value - $7::text[]) e WHERE e.key=ANY($11::text[])),'{}'::jsonb) WHEN jsonb_typeof(n.value)='object' THEN n.value - $7::text[] ELSE n.value END AS value,n.ordinal FROM native_records n WHERE EXISTS (
  SELECT 1 FROM identities i WHERE i.ordinal=n.ordinal AND i.requirement=0 AND cardinality(i.remaining)=0 AND i.value#>>'{}' ~ i.pattern
 ) AND NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(COALESCE($8::jsonb,'[]'::jsonb)) WITH ORDINALITY required(value,position)
  WHERE required.value->>'required'='true' AND NOT EXISTS (
   SELECT 1 FROM identities i WHERE i.ordinal=n.ordinal AND i.requirement=required.position AND cardinality(i.remaining)=0 AND i.value#>>'{}' ~ i.pattern)
 )
)
${stateKeysOnly ? `, state_records(value) AS (
 SELECT value FROM selected
 UNION ALL SELECT CASE WHEN p.payload->>'kind'='object' THEN p.payload->'value' ELSE p.payload END
 FROM state_records r JOIN civic_data_payload_parts p ON p.hash=r.value->>'$civicPayloadPart'
)
SELECT DISTINCT value->>'state' AS state FROM state_records WHERE jsonb_typeof(value->'state')='string'` : `SELECT 'publication' AS row_kind,(to_jsonb(p)-'payload'-'validation_receipt'${normalizedPayload ? "-'source_payload'" : ""}) ||
 jsonb_build_object('validation_receipt',p.validation_receipt-'excludedFacts') AS value,NULL::bigint[] AS ordinal FROM publication p
UNION ALL SELECT 'record',value,ordinal FROM selected ORDER BY ordinal NULLS FIRST`}`; }
export const PUBLISHED_ARRAY_SLICE_SQL = publishedArraySliceSql();
/** Capture references from the same validated candidate; never transfer its enclosing source payload. */
export const PUBLISHED_NORMALIZED_ARRAY_SLICE_SQL = publishedArraySliceSql(false, false, true);
/** Exact native person routing returns only its state key; source records stay in SQL. */
export const PUBLISHED_NATIVE_STATE_LOOKUP_SQL = publishedArraySliceSql(true, true);

export async function readPublishedArraySlice<T>(input: {
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly payload?: "readModel" | "normalizedPayload";
  /** Object keys; `*` visits each member of a containing array. */
  readonly path: readonly string[];
  readonly statePath: readonly string[];
  readonly statePattern: string;
  /** A record is selected when any of these native fields matches; replaces statePath/statePattern. */
  readonly selectors?: readonly { readonly path: readonly string[]; readonly pattern: string }[];
  /** Every required native selector must also match before its record transfers. */
  readonly requiredSelectors?: readonly { readonly path: readonly string[]; readonly pattern: string }[];
  /** Select the object at path itself, instead of each member of a final array. */
  readonly objectRecord?: boolean;
  /** Return only an exact object's key names, resolved in SQL before its country-sized values transfer. */
  readonly objectKeys?: boolean;
  /** Keep only these exact object keys before resolving any nested parts. */
  readonly keepKeys?: readonly string[];
  /** Select the exact value at path, including a scalar, instead of a final array member. */
  readonly valueRecord?: boolean;
  /** Remove unneeded fields before their payload-part references cross the connection. */
  readonly omitKeys?: readonly string[];
  readonly query?: ReadOnlyQuery | null;
}): Promise<PublishedArraySlice<T> | null> {
  const query = input.query === undefined ? readerDatabaseQuery() : input.query;
  if (!query) throw new Error("PUBLISHED_ARRAY_SLICE_STORE_NOT_CONFIGURED");
  const selectors = input.requiredSelectors?.length ? [
    ...(input.selectors ?? [{ path: input.statePath, pattern: input.statePattern }]),
    ...input.requiredSelectors.map(selector => ({ ...selector, required: true })),
  ] : input.selectors;
  const [rows] = await query([{ text: input.payload === "normalizedPayload" ? PUBLISHED_NORMALIZED_ARRAY_SLICE_SQL : PUBLISHED_ARRAY_SLICE_SQL,
    params: [input.recordClass, input.scope, input.path, input.statePath, input.statePattern, input.objectRecord ?? false, input.omitKeys ?? [], selectors ? JSON.stringify(selectors) : null, input.valueRecord ?? false, input.objectKeys ?? false, input.keepKeys ?? null] }]);
  const publication = rows.find(row => row.row_kind === "publication")?.value as Record<string, unknown> | undefined;
  if (!publication) return null;
  if (publication.published !== true || !/^[a-f0-9]{64}$/.test(String(publication.normalized_hash)))
    throw new Error("PUBLISHED_ARRAY_SLICE_POINTER_INVALID");
  const parts = new CivicPayloadParts({
    async existing() { throw new Error("PUBLISHED_ARRAY_SLICE_IS_READ_ONLY"); },
    async write() { throw new Error("PUBLISHED_ARRAY_SLICE_IS_READ_ONLY"); },
    async read(hashes) {
      const [parts] = await query([{ text: "SELECT hash,payload FROM civic_data_payload_parts WHERE hash=ANY($1::text[])", params: [hashes] }]);
      return parts.map(part => ({ hash: String(part.hash), payload: part.payload }));
    },
  });
  const records = await parts.load(rows.filter(row => row.row_kind === "record").map(row => row.value)) as readonly T[];
  return { records, sourceId: String(publication.source_id), retrievedAt: String(publication.retrieved_at),
    sourceVersion: publication.source_version === null ? null : String(publication.source_version), sourceThrough: publication.source_through == null ? null : String(publication.source_through), finalUrl: publication.final_url === null ? null : String(publication.final_url), receipt: publication.validation_receipt as ValidationReceipt,
    input: { kind: "PROMOTED_VERSION", recordClass: input.recordClass, scope: input.scope,
      versionId: String(publication.current_version_id), readModelSha256: String(publication.normalized_hash),
      promotedAt: String(publication.promoted_at) } };
}
