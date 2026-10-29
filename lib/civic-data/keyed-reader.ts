import type { Query } from "../facts/publish.ts";
import { selectedStateEntry } from "../reader/selected-entry.ts";
import { AUTHORITY_FIELDS,AUTHORITY_COLUMNS } from "../reader/page-authorities.ts";
import type { RoutineRecordClass } from "./types.ts";

/** Publication proof and clocks are written with the normalized facts. */
export const keyedReaderPointers = `SELECT p.key,p.record_class,p.scope,p.source_id,p.current_version_id,p.last_known_good_version_id,
  p.promoted_at,p.validation_receipt,p.payload,p.normalized_hash,p.retrieved_at,p.confirmation,
  (p.published AND r.content_hash=encode(sha256(convert_to(r.value::text,'UTF8')),'hex')) AS published,r.value->'temporal' AS temporal,r.value->'sittingShape' AS sitting_shape
  FROM civic_data_rows r CROSS JOIN LATERAL jsonb_to_record(r.value) p(${AUTHORITY_FIELDS})
  WHERE r.collection='rp01.header' AND r.promotion_key=ANY($1::text[])`;

export async function readKeyedEntry(query:Query,recordClass:RoutineRecordClass,scope:string) {
  const [row]=await query(`WITH pointer AS (${keyedReaderPointers}) SELECT ${AUTHORITY_COLUMNS.split(",").map(column=>`pointer.${column}`).join(",")},pointer.temporal,
    pointer.payload||coalesce((SELECT jsonb_object_agg(field,coalesce((SELECT jsonb_agg(r.value ORDER BY r.ordinal)
      FROM civic_data_rows r WHERE r.promotion_key=pointer.key AND r.version_id=pointer.current_version_id AND r.collection='rp01.'||field),'[]'::jsonb))
      FROM civic_data_rows h,LATERAL jsonb_array_elements_text(h.value->'collections') field
      WHERE h.promotion_key=pointer.key AND h.collection='rp01.header'),'{}'::jsonb) AS payload FROM pointer`,[[`${recordClass}:${scope}`]]);
  return selectedStateEntry(recordClass,scope,row);
}

/** Funding and roll-call views select native facts before transfer, including one-hop committee books. */
export async function readKeyedSelection(query:Query,recordClass:RoutineRecordClass,scope:string,keys:readonly string[]) {
  const [row]=await query(`WITH pointer AS MATERIALIZED (${keyedReaderPointers}),
    chosen AS MATERIALIZED (SELECT r.promotion_key,r.version_id,r.collection,r.ordinal,r.value FROM pointer JOIN civic_data_rows r ON r.promotion_key=pointer.key
      AND r.version_id=pointer.current_version_id WHERE r.collection=ANY(ARRAY['rp01.candidates','rp01.records','rp01.absences','rp01.partitions'])
      AND (r.aliases && $2::text[] OR r.aliases && ARRAY(SELECT substring(key FROM 21) FROM unnest($2::text[]) key WHERE starts_with(key,'open-data-partition:'))
        OR r.collection='rp01.records' AND EXISTS(SELECT 1 FROM unnest($2::text[]) wanted(name) WHERE name LIKE 'ask-money-name:%'
          AND regexp_split_to_array(trim(regexp_replace(lower(r.value->>'candidateNameAsFiled'),'[^a-z0-9]+',' ','g')),' +') @> string_to_array(substring(name FROM 16),' ')))),
    committees AS (SELECT DISTINCT item->>'contributorCommitteeId' AS id FROM chosen,
      LATERAL jsonb_array_elements(coalesce(value->'topContributions','[]'::jsonb)) item WHERE collection='rp01.candidates'),
    facts AS (SELECT promotion_key,version_id,collection,ordinal,value FROM chosen UNION ALL SELECT r.promotion_key,r.version_id,r.collection,r.ordinal,r.value FROM pointer JOIN civic_data_rows r ON r.promotion_key=pointer.key
      AND r.version_id=pointer.current_version_id WHERE r.collection='rp01.secondHop' AND r.value->>'committeeId' IN (SELECT id FROM committees)),
    arrays AS (SELECT jsonb_object_agg(field,coalesce((SELECT jsonb_agg(f.value ORDER BY f.ordinal) FROM facts f
      WHERE f.collection='rp01.'||field),'[]'::jsonb)) AS value FROM civic_data_rows h,
      LATERAL jsonb_array_elements_text(h.value->'collections') field WHERE h.collection='rp01.header' AND h.promotion_key=($1::text[])[1])
    SELECT ${AUTHORITY_COLUMNS.split(",").map(column=>`pointer.${column}`).join(",")},pointer.temporal,pointer.payload||coalesce(arrays.value,'{}'::jsonb)||CASE WHEN pointer.record_class='FEDERAL_KEY_VOTE'
      THEN jsonb_build_object('positions',pointer.payload->'positions'||jsonb_build_object('positions',coalesce((
        SELECT jsonb_object_agg(roll,coalesce((SELECT jsonb_object_agg(r.row_id,r.value->'position') FROM civic_data_rows r
          WHERE r.promotion_key=pointer.key AND r.version_id=pointer.current_version_id AND r.collection='rp01.positions'
            AND r.body_id=ANY($2::text[]) AND r.value->>'roll'=roll),'{}'::jsonb))
        FROM (SELECT DISTINCT r.value->>'roll' AS roll FROM civic_data_rows r WHERE r.promotion_key=pointer.key
          AND r.version_id=pointer.current_version_id AND r.collection='rp01.positions') rolls),'{}'::jsonb))) ELSE '{}'::jsonb END AS payload
    FROM pointer CROSS JOIN arrays`,[[`${recordClass}:${scope}`],[...keys]]);
  return selectedStateEntry(recordClass,scope,row);
}
