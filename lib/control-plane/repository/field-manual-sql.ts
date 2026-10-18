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

export const MANUAL_ROUTE_ID_SQL = `(CASE WHEN jsonb_typeof(value #> '{payload,id}')='string' THEN value #>> '{payload,id}'
  WHEN jsonb_typeof(value #> '{payload,routeId}')='string' THEN value #>> '{payload,routeId}' END)`;
export const MANUAL_LEARNED_ROUTES_SQL = `SELECT jsonb_build_object(
  'present',EXISTS(SELECT 1 FROM cp_field_manual_entries WHERE value->>'kind'='ROUTE' AND ${MANUAL_ROUTE_ID_SQL} IS NOT NULL),
  'routeIds',ARRAY(SELECT DISTINCT ${MANUAL_ROUTE_ID_SQL} FROM cp_field_manual_entries
    WHERE value->>'kind'='ROUTE' AND ${MANUAL_ROUTE_ID_SQL}=ANY($1::text[]) ORDER BY 1)) AS summary`;

export const MANUAL_ORDER_INDEXES = [
  `CREATE INDEX IF NOT EXISTS cp_field_manual_route_id ON cp_field_manual_entries (${MANUAL_ROUTE_ID_SQL})
    WHERE value->>'kind'='ROUTE' AND ${MANUAL_ROUTE_ID_SQL} IS NOT NULL;`,
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
