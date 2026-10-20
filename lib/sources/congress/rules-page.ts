import type { ReadOnlyQuery } from "../../control-plane/admin-view/promoted-slices.ts";
import type { FederalFact } from "./types.ts";
import { FEDERAL_RECORD_CLASS } from "./targets.ts";

const field = (key: string) => `(reader_payload_value(header->'${key}')#>>'{}')`;
const instant = (key: string, end = false) => `CASE WHEN ${field(key)} ~ '^\\d{4}-\\d{2}-\\d{2}$'
 THEN (${field(key)}::date + time '${end ? "23:59:59" : "00:00:00"}') AT TIME ZONE 'America/New_York'
 ELSE ${field(key)}::timestamptz END`;

/** Filter and page immutable native publications before reading their full facts.
 * The legacy array remains usable without transferring its other documents. */
export const FEDERAL_RULES_PAGE_SQL = `WITH publications AS MATERIALIZED (
 SELECT p.scope,p.source_id,p.payload,
  (p.current_version_id=p.last_known_good_version_id AND c.id=p.current_version_id AND c.state='PROMOTED'
   AND c.acquisition_succeeded AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
   AND c.record_class=p.record_class AND c.scope=p.scope AND c.source_id=p.source_id
   AND c.normalized_hash ~ '^[a-f0-9]{64}$'
   AND p.validation_receipt->>'decision'='GOOD' AND p.validation_receipt->>'candidateId'=c.id
   AND p.validation_receipt->>'sourceId'=c.source_id AND p.validation_receipt->>'recordClass'=p.record_class
   AND p.validation_receipt->>'scope'=p.scope) AS published
 FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
 WHERE p.record_class=$1 AND p.source_id=ANY($2::text[])
  AND (p.scope=p.source_id||':rules' OR p.scope LIKE p.source_id||':rule:%' OR p.scope=p.source_id||':national')
), headers AS MATERIALIZED (
 SELECT p.scope,p.source_id,r.item,r.ordinal_index,reader_payload_node(r.item) AS header
 FROM publications p CROSS JOIN LATERAL reader_payload_members(reader_payload_node(p.payload)->'records') r
 WHERE p.published AND p.scope<>p.source_id||':national'
), native_records AS MATERIALIZED (
 SELECT DISTINCT ON (source_id,${field("nativeId")}) *,${field("nativeId")} AS native_id,
  COALESCE(NULLIF(${field("documentNumber")},''),source_id||':'||${field("nativeId")}) AS group_key
 FROM headers WHERE ${field("source")}=source_id AND ${field("kind")}='RULE'
  AND (scope=source_id||':rules' OR scope=source_id||':rule:'||${field("nativeId")})
 ORDER BY source_id,${field("nativeId")},(scope<>source_id||':rules') DESC,ordinal_index
), candidates AS MATERIALIZED (
 SELECT *,row_number() OVER (PARTITION BY group_key ORDER BY (source_id='regulations-gov') DESC,native_id) AS preference
 FROM native_records WHERE COALESCE(${field("withdrawn")},'false')<>'true' AND COALESCE(${field("acceptsComments")},'true')<>'false'
  AND NULLIF(${field("commentUrl")},'') IS NOT NULL AND NULLIF(${field("closesAt")},'') IS NOT NULL
  AND ${instant("closesAt", true)}>=$3::timestamptz
  AND (NULLIF(${field("opensAt")},'') IS NULL OR ${instant("opensAt")}<=$3::timestamptz)
  AND (NULLIF(${field("publishedAt")},'') IS NULL OR ${instant("publishedAt")}<=$3::timestamptz)
  AND NOT EXISTS(SELECT 1 FROM native_records other WHERE other.group_key=native_records.group_key
   AND other.source_id='regulations-gov' AND reader_payload_value(other.header->'withdrawn')='true'::jsonb)
), chosen AS MATERIALIZED (SELECT * FROM candidates WHERE preference=1),
 page AS MATERIALIZED (SELECT * FROM chosen ORDER BY ${field("closesAt")},group_key OFFSET $4 LIMIT $5)
SELECT 'coverage' AS row_kind,jsonb_build_object('source',source,
 'kind',CASE WHEN NOT EXISTS(SELECT 1 FROM publications p WHERE p.source_id=source) THEN 'NOT_RECORDED'
  WHEN EXISTS(SELECT 1 FROM publications p WHERE p.source_id=source AND p.published IS NOT TRUE) THEN 'STORE_UNREACHABLE' ELSE 'PROMOTED' END) AS value
 FROM unnest($2::text[]) source
UNION ALL SELECT 'summary',jsonb_build_object('totalRules',(SELECT count(*) FROM chosen))
UNION ALL SELECT 'rule',jsonb_build_object('rule',reader_payload_value(page.item),'sources',
 (SELECT jsonb_agg(reader_payload_value(other.item) ORDER BY (other.source_id='regulations-gov') DESC,other.native_id)
 FROM native_records other WHERE other.group_key=page.group_key)) FROM page`;

export async function readFederalRulesPage(query: ReadOnlyQuery, now: string, offset: number, limit: number) {
  const [rows] = await query([{ text: FEDERAL_RULES_PAGE_SQL,
    params: [FEDERAL_RECORD_CLASS, ["regulations-gov", "federal-register"], now, offset, limit] }]);
  const coverage: Record<string, string> = {};
  const rules: { rule: FederalFact; sources: FederalFact[] }[] = [];
  let totalRules = 0;
  for (const row of rows) {
    if (row.row_kind === "coverage") {
      const value = row.value as { source: string; kind: string }; coverage[value.source] = value.kind;
    } else if (row.row_kind === "summary") totalRules = Number((row.value as { totalRules: number }).totalRules);
    else if (row.row_kind === "rule") rules.push(row.value as { rule: FederalFact; sources: FederalFact[] });
  }
  rules.sort((a, b) => a.rule.closesAt!.localeCompare(b.rule.closesAt!) || (a.rule.documentNumber || `${a.rule.source}:${a.rule.nativeId}`).localeCompare(b.rule.documentNumber || `${b.rule.source}:${b.rule.nativeId}`));
  return { coverage, totalRules, rules };
}
