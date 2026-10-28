import { stateBallotScope } from "../civic-data/state-scopes.ts";
import type { VotingReaderPlace } from "../ballot/voting-answer.ts";
import { selectedPointerSql, selectedMetadataSql } from "./selected-entry.ts";
import { CivicPayloadParts } from "../civic-data/payload-parts.ts";

/** County-scoped holdings outside the resolved place cannot contribute a voting answer.
 * Unscoped and subdivision holdings remain available to the existing exact matcher. */
export function selectedVotingStatement(state: string, place: VotingReaderPlace) {
  return {params:[`VOTING_SITE:${stateBallotScope("voting-sites",state)}`,place.countyFips],text:`WITH RECURSIVE pointer AS MATERIALIZED (
    ${selectedPointerSql()}
  ), root AS MATERIALIZED (SELECT reader_payload_node(payload) AS value FROM pointer WHERE published),
  jurisdictions AS MATERIALIZED (
    SELECT j.ordinal_index,reader_payload_node(j.item) AS value FROM root,LATERAL reader_payload_members(root.value->'jurisdictions') j
    WHERE cardinality($2::text[])=0 OR reader_payload_node(j.item)->>'countySubdivisionGeoid' IS NOT NULL
      OR reader_payload_node(j.item)->>'countyFips' IS NULL OR reader_payload_node(j.item)->>'countyFips'=ANY($2::text[])
  ), selected AS MATERIALIZED (
    SELECT ${selectedMetadataSql},CASE WHEN published THEN (root.value-'jurisdictions')||jsonb_build_object('jurisdictions',
      coalesce((SELECT jsonb_agg((value-'sites')||jsonb_build_object('sites',
        coalesce((SELECT jsonb_agg(reader_payload_node(s.item) ORDER BY s.ordinal_index)
          FROM reader_payload_members(value->'sites') s WHERE cardinality($2::text[])=0
            OR reader_payload_node(s.item)->>'countyFips' IS NULL OR reader_payload_node(s.item)->>'countyFips'=ANY($2::text[])), '[]'::jsonb))
        ORDER BY ordinal_index) FROM jurisdictions),'[]'::jsonb)) END AS payload
    FROM pointer LEFT JOIN root ON true
  ), hashes(hash) AS (
    SELECT ref#>>'{}' FROM selected,LATERAL jsonb_path_query(payload,'strict $.**."$civicPayloadPart"','{}',true) ref
    UNION SELECT ref#>>'{}' FROM hashes
      CROSS JOIN LATERAL (SELECT payload FROM civic_data_payload_parts WHERE hash=hashes.hash LIMIT 1) part,
      LATERAL jsonb_path_query(part.payload,'strict $.**."$civicPayloadPart"','{}',true) ref
  ) SELECT selected.*,coalesce((SELECT jsonb_object_agg(part.hash,part.payload) FROM hashes
      CROSS JOIN LATERAL (SELECT hash,payload FROM civic_data_payload_parts WHERE hash=hashes.hash LIMIT 1) part),'{}'::jsonb) AS parts
    FROM selected`};
}

/** Decode only the selected source members in Node; expanding every scalar in SQL can miss the voting deadline. */
export async function decodeSelectedVoting(row: Record<string, unknown> | undefined): Promise<Record<string, unknown> | undefined> {
  if (!row) return row;
  const {parts,...selected}=row;
  const payloads=new CivicPayloadParts({existing:async()=>[],write:async()=>{throw new Error("READER_IS_READ_ONLY");},
    read:async()=>{throw new Error("READER_PARTS_MISSING");}});
  return await payloads.loadOwned(selected,parts as Record<string,unknown>) as Record<string,unknown>;
}
