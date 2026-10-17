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

export const MANUAL_ORDER_INDEXES = [
  `CREATE INDEX IF NOT EXISTS cp_field_manual_plain_order ON cp_field_manual_entries
    ((value->>'role'),${MANUAL_BROAD_SQL},${MANUAL_EMPTY_CLASS_SQL},${MANUAL_OUTCOME_SQL},
      (coalesce(value->>'observedAt','')) COLLATE "C" DESC,id COLLATE "C") WHERE ${MANUAL_PLAIN_SQL};`,
  `CREATE INDEX IF NOT EXISTS cp_field_manual_broad_classes ON cp_field_manual_entries USING gin
    ((value->'role'),(coalesce(value->'recordClasses','[]'::jsonb))) WHERE ${MANUAL_PLAIN_SQL} AND ${MANUAL_BROAD_SQL};`,
  `CREATE INDEX IF NOT EXISTS cp_field_manual_exhausted_subject ON cp_field_manual_entries
    ((value #>> '{payload,subjectId}')) WHERE value->>'kind'='EXHAUSTED_RUNGS';`,
] as const;
