import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { readStateAuthorityProjection } from "../civic-data/state-reader.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { requireBallotState, stateBallotScope } from "../civic-data/state-scopes.ts";
import type { VotingSitesFile } from "./voting-sites.ts";

export async function readVotingSitesProjection(state: string, options: PromotedCivicDataReadOptions = {}, deadlineMs?: number): Promise<CivicDataReadResult<VotingSitesFile>> {
  const key = requireBallotState(state);
  const query = deadlineMs === undefined ? null : readerQuery(deadlineMs);
  return Object.keys(options).length
    ? readPromotedCivicData<VotingSitesFile>("VOTING_SITE", stateBallotScope("voting-sites", key), options)
    : (await readStateAuthorityProjection<VotingSitesFile>("voting-sites", key,
      query ? async (text, params) => (await query([{ text, params }]))[0] : undefined)).result;
}
