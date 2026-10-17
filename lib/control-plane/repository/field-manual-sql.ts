import { BOOKKEEPING_KINDS, OUTCOME_RANK, TRANSFERABLE_METHOD_KINDS } from "../field-manual.ts";

export const MANUAL_METHOD_SQL = `((value->>'kind' IN (${[...TRANSFERABLE_METHOD_KINDS].map(kind=>`'${kind}'`).join(",")})
  AND (value->>'url' IS NULL OR jsonb_array_length(coalesce(value->'platforms','[]'::jsonb))>0))
  OR coalesce((value->'reach'->>'method')::boolean,false))`;
export const MANUAL_BROAD_SQL = `(coalesce((value->'reach'->>'everywhere')::boolean,false)
  OR jsonb_array_length(coalesce(value->'reach'->'platforms','[]'::jsonb))>0)`;
export const MANUAL_OUTCOME_SQL = `(CASE value->>'outcome' ${Object.entries(OUTCOME_RANK).map(([outcome,rank])=>`WHEN '${outcome}' THEN ${rank}`).join(" ")} ELSE 5 END)`;
export const MANUAL_PLAIN_SQL = `NOT ${MANUAL_METHOD_SQL}
  AND value->>'kind' NOT IN (${[...BOOKKEEPING_KINDS,"EXHAUSTED_RUNGS"].map(kind=>`'${kind}'`).join(",")})`;
export const MANUAL_EMPTY_CLASS_SQL = `(jsonb_array_length(coalesce(value->'recordClasses','[]'::jsonb))=0)`;
const sourceUrl = `translate(btrim(value->>'url'),chr(9)||chr(10)||chr(13),'')`;
export const MANUAL_SOURCE_ORIGIN_SQL = `lower(split_part(${sourceUrl},':',1)||'://' ||
  regexp_replace(substring(regexp_replace(${sourceUrl},'^[a-zA-Z][a-zA-Z0-9+.-]*:/*','') from '^[^/?#]*'),'^.*@',''))`;

export const MANUAL_ORDER_INDEXES = [
  `CREATE INDEX IF NOT EXISTS cp_field_manual_plain_order ON cp_field_manual_entries
    ((value->>'role'),${MANUAL_BROAD_SQL},${MANUAL_EMPTY_CLASS_SQL},${MANUAL_OUTCOME_SQL},
      (coalesce(value->>'observedAt','')) COLLATE "C" DESC,id COLLATE "C") WHERE ${MANUAL_PLAIN_SQL};`,
  `CREATE INDEX IF NOT EXISTS cp_field_manual_broad_classes ON cp_field_manual_entries USING gin
    ((value->'role'),(coalesce(value->'recordClasses','[]'::jsonb))) WHERE ${MANUAL_PLAIN_SQL} AND ${MANUAL_BROAD_SQL};`,
  `CREATE INDEX IF NOT EXISTS cp_field_manual_exhausted_subject ON cp_field_manual_entries
    ((value #>> '{payload,subjectId}')) WHERE value->>'kind'='EXHAUSTED_RUNGS';`,
  `CREATE INDEX IF NOT EXISTS cp_field_manual_source_order ON cp_field_manual_entries
    (${MANUAL_SOURCE_ORIGIN_SQL},(value->>'url'),(coalesce(value->>'observedAt','')) COLLATE "C" DESC,id COLLATE "C")
    WHERE value->>'url' IS NOT NULL;`,
] as const;

export const MANUAL_SOURCE_HINTS_SQL = `WITH source_rows AS MATERIALIZED (
  SELECT id,value->>'url' AS url,value->>'outcome' AS outcome,value->>'observedAt' AS observed_at,
    coalesce(value->'recordClasses','[]'::jsonb) AS classes
  FROM cp_field_manual_entries WHERE value->>'url' IS NOT NULL AND ${MANUAL_SOURCE_ORIGIN_SQL}=ANY($3::text[])
    AND (coalesce(value->'reach'->'places','[]'::jsonb) ?| $1::text[]
      OR ($2::text IS NOT NULL AND coalesce(value->'reach'->'states','[]'::jsonb) ? $2)
      OR coalesce((value->'reach'->>'everywhere')::boolean,false)
      OR jsonb_array_length(coalesce(value->'reach'->'platforms','[]'::jsonb))>0 OR ${MANUAL_METHOD_SQL})
), latest AS (
  SELECT DISTINCT ON(url) url,outcome,observed_at FROM source_rows
  ORDER BY url,coalesce(observed_at,'') COLLATE "C" DESC,id COLLATE "C"
), worked AS (
  SELECT url,min(id COLLATE "C") AS first_worked,
    array_agg(DISTINCT kind COLLATE "C" ORDER BY kind COLLATE "C") FILTER(WHERE kind IS NOT NULL) AS classes
  FROM source_rows LEFT JOIN LATERAL jsonb_array_elements_text(classes) kinds(kind) ON true
  WHERE outcome='YIELDED' GROUP BY url
)
SELECT jsonb_build_object('url',l.url,'outcome',outcome,'observedAt',observed_at,
  'worked',w.url IS NOT NULL,'workedFor',coalesce(w.classes,'{}'::text[])) AS hint
FROM latest l LEFT JOIN worked w ON w.url=l.url
ORDER BY w.first_worked COLLATE "C" NULLS LAST,l.url COLLATE "C"`;
