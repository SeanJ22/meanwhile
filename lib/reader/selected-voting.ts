import { stateBallotScope } from "../civic-data/state-scopes.ts";
import type { VotingReaderPlace } from "../ballot/voting-answer.ts";
import { keyedReaderPointers } from "../civic-data/keyed-reader.ts";
import { selectedMetadataSql } from "./selected-entry.ts";

/** Only the county's keyed jurisdiction and site facts leave the database. */
export function selectedVotingStatement(state:string,place:VotingReaderPlace) {
  return {params:[[ `VOTING_SITE:${stateBallotScope('voting-sites',state)}` ],place.countyFips],text:`WITH
    pointer AS MATERIALIZED (${keyedReaderPointers}), jurisdictions AS MATERIALIZED (
      SELECT r.* FROM pointer JOIN civic_data_rows r ON r.promotion_key=pointer.key AND r.version_id=pointer.current_version_id
      WHERE pointer.published AND r.collection='rp01.jurisdictions' AND
        (cardinality($2::text[])=0 OR r.value->>'countySubdivisionGeoid' IS NOT NULL
          OR r.value->>'countyFips' IS NULL OR r.value->>'countyFips'=ANY($2::text[]))
    ) SELECT ${selectedMetadataSql},CASE WHEN pointer.published THEN pointer.payload||jsonb_build_object('jurisdictions',
      coalesce((SELECT jsonb_agg(j.value||jsonb_build_object('sites',coalesce((SELECT jsonb_agg(s.value ORDER BY s.ordinal)
        FROM civic_data_rows s WHERE s.promotion_key=j.promotion_key AND s.version_id=j.version_id
          AND s.collection='rp01.sites' AND s.body_id=j.body_id AND (cardinality($2::text[])=0
            OR s.value->>'countyFips' IS NULL OR s.value->>'countyFips'=ANY($2::text[]))),'[]'::jsonb)) ORDER BY j.ordinal)
        FROM jurisdictions j),'[]'::jsonb)) END AS payload FROM pointer`};
}

export async function decodeSelectedVoting(row:Record<string,unknown>|undefined) {return row;}
