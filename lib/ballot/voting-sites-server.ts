import { civicDataReadNotInitialized, readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { currentStateAuthorityProjection, readStateAuthorityProjection } from "../civic-data/state-reader.ts";
import { requireBallotState, stateBallotScope } from "../civic-data/state-scopes.ts";
import type { VotingSitesFile } from "./voting-sites.ts";

export async function readVotingSitesProjection(state: string, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<VotingSitesFile>> {
  const key = requireBallotState(state);
  return Object.keys(options).length
    ? readPromotedCivicData<VotingSitesFile>("VOTING_SITE", stateBallotScope("voting-sites", key), options)
    : (await readStateAuthorityProjection<VotingSitesFile>("voting-sites", key)).result;
}

function votingSitesReadState(state: string): CivicDataReadResult<VotingSitesFile> {
  return currentStateAuthorityProjection<VotingSitesFile>("voting-sites", state)?.result ?? civicDataReadNotInitialized(
    "VOTING_SITE", stateBallotScope("voting-sites", state), "The state's voting sites have not been read.");
}

export function loadVotingSites(state: string): VotingSitesFile {
  const read = votingSitesReadState(state);
  if (read.kind === "PROMOTED") return read.value;
  throw new Error(`Voting sites for ${state} are ${read.kind}; read the state's authority before using the projection.`);
}
