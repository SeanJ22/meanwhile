import { readStateAuthorityProjection } from "../civic-data/state-reader.ts";
import { requireBallotState, stateBallotScope } from "../civic-data/state-scopes.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { GenericBallotProjection } from "./generic-projection.ts";

export async function readGenericBallotProjection(state: string, options: PromotedCivicDataReadOptions = {}) {
  const key = requireBallotState(state);
  return Object.keys(options).length
    ? readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", key), options)
    : (await readStateAuthorityProjection<GenericBallotProjection>("ballot-contests", key)).result;
}
