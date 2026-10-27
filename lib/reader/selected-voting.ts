import { stateBallotScope } from "../civic-data/state-scopes.ts";
import type { VotingReaderPlace } from "../ballot/voting-answer.ts";
import { selectedPointerSql, selectedMetadataSql } from "./selected-entry.ts";

/** County-scoped holdings outside the resolved place cannot contribute a voting answer.
 * Unscoped and subdivision holdings remain available to the existing exact matcher. */
export function selectedVotingStatement(state: string, place: VotingReaderPlace) {
  return {params:[`VOTING_SITE:${stateBallotScope("voting-sites",state)}`,place.countyFips],text:`WITH pointer AS MATERIALIZED (
    ${selectedPointerSql}
  ), root AS MATERIALIZED (SELECT reader_payload_node(payload) AS value FROM pointer WHERE published),
  jurisdictions AS MATERIALIZED (
    SELECT j.ordinal_index,reader_payload_node(j.item) AS value FROM root,LATERAL reader_payload_members(root.value->'jurisdictions') j
    WHERE cardinality($2::text[])=0 OR reader_payload_node(j.item)->>'countySubdivisionGeoid' IS NOT NULL
      OR reader_payload_node(j.item)->>'countyFips' IS NULL OR reader_payload_node(j.item)->>'countyFips'=ANY($2::text[])
  ) SELECT ${selectedMetadataSql},CASE WHEN published THEN reader_payload_value(root.value-'jurisdictions')||jsonb_build_object('jurisdictions',
    coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal_index) FROM jurisdictions),'[]'::jsonb)) END AS payload
    FROM pointer LEFT JOIN root ON true`};
}
