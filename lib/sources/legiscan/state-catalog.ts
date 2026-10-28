import type {Query} from "../../facts/publish.ts";
import type {PromotedEdgeEntry} from "../../civic-data/read-model.ts";
import {selectedMetadataSql,selectedPointerSql,selectedStateEntry} from "../../reader/selected-entry.ts";
import {LEGISCAN_BULK_SCOPE,legiscanStateId} from "./bills.ts";

/** A named view of the national source, retaining its original pointer and metadata. */
export interface BillCatalogSelection {
  readonly entry:PromotedEdgeEntry;
  readonly sourceNonempty:boolean;
}

/** Only the state's rows, or just the original header, leave the database. */
export async function readStateCatalog(query:Query,state:string,headerOnly=false):Promise<BillCatalogSelection>{
  const metadata=selectedMetadataSql.replace("pointer.published",`(pointer.published AND (pointer.current_version_id=c.id AND pointer.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint)
    AND pointer.validation_receipt=c.validation_receipt AND c.normalized_hash=c.candidate#>>'{normalization,normalizedHash}') AS published`);
  const [row]=await query(`WITH pointer AS MATERIALIZED (${selectedPointerSql().replace("WHERE p.key=$1","WHERE p.key=ANY($1::text[])")})
    SELECT ${metadata},
      EXISTS(SELECT 1 FROM reader_payload_members(reader_payload_node(pointer.payload)->'datasets')) AS source_nonempty,
      reader_payload_value(reader_payload_node(pointer.payload)-'datasets') || jsonb_build_object('datasets',
        CASE WHEN $3::boolean THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(reader_payload_value(d.item) ORDER BY d.ordinal_index)
          FROM reader_payload_members(reader_payload_node(pointer.payload)->'datasets') d
          WHERE (reader_payload_node(d.item)->>'state_id')::integer=$2),'[]'::jsonb) END) AS payload
      FROM pointer LEFT JOIN civic_data_candidates c ON c.id=pointer.current_version_id`,
    [[`STATE_BILL:${LEGISCAN_BULK_SCOPE}`],legiscanStateId(state),headerOnly]);
  return {entry:selectedStateEntry("STATE_BILL",LEGISCAN_BULK_SCOPE,row),sourceNonempty:row?.source_nonempty===true};
}
