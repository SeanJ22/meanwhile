import { stateBallotScope } from "../civic-data/state-scopes.ts";
import type { VotingReaderPlace } from "../ballot/voting-answer.ts";
import { AUTHORITY_COLUMNS, authorityPageId, savedSelectedPointerSql } from "./page-authorities.ts";
import { votingPageFingerprintSql } from "./voting-page.ts";
import { buildVotingPage } from "./place-builder.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { selectedMetadataSql } from "./selected-entry.ts";

/** Only the county's keyed jurisdiction and site facts leave the database. */
export function selectedVotingStatement(state:string,place:Pick<VotingReaderPlace,"countyFips">) {
  const key=`VOTING_SITE:${stateBallotScope('voting-sites',state)}`;
  return {params:[key,place.countyFips,authorityPageId(key)],text:`WITH
    head AS (${votingPageFingerprintSql.replace('$1::text[]','ARRAY[$1::text]')}),
    saved AS (${savedSelectedPointerSql()}), pointer AS MATERIALIZED (
      SELECT ${AUTHORITY_COLUMNS.split(',').map(column=>`saved.${column}`).join(',')} FROM saved,head,place_page page WHERE page.place_id=$3 AND page.context->'authorities'->$1->>'page_fingerprint'=head.fingerprint
    ), jurisdictions AS MATERIALIZED (
      SELECT r.promotion_key,r.version_id,r.ordinal,r.body_id,r.value FROM pointer JOIN civic_data_rows r ON r.promotion_key=pointer.key AND r.version_id=pointer.current_version_id
      WHERE pointer.published AND r.collection='rp01.jurisdictions' AND
        (cardinality($2::text[])=0 OR r.value->>'countySubdivisionGeoid' IS NOT NULL
          OR r.value->>'countyFips' IS NULL OR r.value->>'countyFips'=ANY($2::text[]))
    ) SELECT ${selectedMetadataSql},CASE WHEN pointer.published THEN pointer.payload||jsonb_build_object('jurisdictions',
      coalesce((SELECT jsonb_agg(j.value||jsonb_build_object('sites',coalesce((SELECT jsonb_agg(s.value ORDER BY s.ordinal)
        FROM civic_data_rows s WHERE s.promotion_key=j.promotion_key AND s.version_id=j.version_id
          AND s.collection='rp01.sites' AND s.body_id=j.body_id AND (cardinality($2::text[])=0
            OR s.value->>'countyFips' IS NULL OR s.value->>'countyFips'=ANY($2::text[]))),'[]'::jsonb)) ORDER BY j.ordinal)
        FROM jurisdictions j),'[]'::jsonb)) END AS payload,false AS needs_voting_page FROM pointer
    UNION ALL SELECT $1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,true FROM head
      WHERE NOT EXISTS(SELECT 1 FROM pointer)`};
}

export async function decodeSelectedVoting(row:Record<string,unknown>|undefined) {return row;}

/** Metadata and Checked clocks come from the saved page; locations remain keyed county facts. */
export async function readSelectedVoting(query:ReadOnlyQuery,state:string,place:Pick<VotingReaderPlace,'countyFips'>) {
  const statement=selectedVotingStatement(state,place);
  for(let attempt=0;attempt<3;attempt++){
    const row=(await query([statement]))[0]?.[0];
    if(row?.needs_voting_page!==true)return row;
    await buildVotingPage(state,String(statement.params[2]));
  }
  throw new Error('PLACE_VOTING_BUILD_NOT_SAVED');
}
