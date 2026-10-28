import {keyedReaderPointers} from "../../civic-data/keyed-reader.ts";
import type {Query} from "../../facts/publish.ts";
import type {PromotedEdgeEntry} from "../../civic-data/read-model.ts";
import {selectedMetadataSql,selectedStateEntry} from "../../reader/selected-entry.ts";
import {LEGISCAN_BULK_SCOPE,legiscanStateId} from "./bills.ts";

/** A named view of the national source, retaining its original pointer and metadata. */
export interface BillCatalogSelection {
  readonly entry:PromotedEdgeEntry;
  readonly sourceNonempty:boolean;
}

/** Only the state's rows, or just the original header, leave the database. */
export async function readStateCatalog(query:Query,state:string,headerOnly=false):Promise<BillCatalogSelection>{
  const [row]=await query(`WITH pointer AS MATERIALIZED (${keyedReaderPointers})
    SELECT ${selectedMetadataSql},EXISTS(SELECT 1 FROM civic_data_rows r WHERE r.promotion_key=pointer.key
      AND r.collection='rp01.datasets' AND r.version_id=pointer.current_version_id) AS source_nonempty,
      pointer.payload||jsonb_build_object('datasets',CASE WHEN $3::boolean THEN '[]'::jsonb ELSE coalesce((
        SELECT jsonb_agg(r.value ORDER BY r.ordinal) FROM civic_data_rows r WHERE r.promotion_key=pointer.key
          AND r.version_id=pointer.current_version_id AND r.collection='rp01.datasets' AND (r.value->>'state_id')::integer=$2),'[]'::jsonb) END) AS payload
    FROM pointer`,[[`STATE_BILL:${LEGISCAN_BULK_SCOPE}`],legiscanStateId(state),headerOnly]);
  return {entry:selectedStateEntry("STATE_BILL",LEGISCAN_BULK_SCOPE,row),sourceNonempty:row?.source_nonempty===true};
}
