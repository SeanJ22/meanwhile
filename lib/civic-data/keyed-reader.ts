import type { Query } from "../facts/publish.ts";
import { selectedStateEntry } from "../reader/selected-entry.ts";
import { AUTHORITY_FIELDS } from "../reader/page-authorities.ts";
import type { RoutineRecordClass } from "./types.ts";

/** Publication proof and clocks are written with the normalized facts. */
export const keyedReaderPointers = `SELECT p.key,p.record_class,p.scope,p.source_id,p.current_version_id,p.last_known_good_version_id,
  p.promoted_at,p.validation_receipt,p.payload,p.normalized_hash,p.retrieved_at,p.confirmation,
  (p.published AND r.content_hash=encode(sha256(convert_to(r.value::text,'UTF8')),'hex')) AS published,r.value->'temporal' AS temporal,r.value->'sittingShape' AS sitting_shape
  FROM civic_data_rows r CROSS JOIN LATERAL jsonb_to_record(r.value) p(${AUTHORITY_FIELDS})
  WHERE r.collection='rp01.header' AND r.promotion_key=ANY($1::text[])`;

export async function readKeyedEntry(query:Query,recordClass:RoutineRecordClass,scope:string) {
  const [row]=await query(`WITH pointer AS (${keyedReaderPointers}) SELECT pointer.*,
    pointer.payload || coalesce((SELECT jsonb_object_agg(collection,items) FROM (
      SELECT substring(r.collection FROM 6) AS collection,jsonb_agg(r.value ORDER BY r.ordinal) AS items
      FROM civic_data_rows r WHERE r.promotion_key=pointer.key AND r.version_id=pointer.current_version_id
        AND r.collection=ANY(ARRAY['rp01.bills','rp01.sponsors','rp01.datasets','rp01.sittings']) GROUP BY r.collection
    ) lists),'{}'::jsonb) AS payload FROM pointer`,[[`${recordClass}:${scope}`]]);
  return selectedStateEntry(recordClass,scope,row);
}
