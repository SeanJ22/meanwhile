import { refreshDerivedCampaignSites } from "./derived-campaign-sites-read.ts";
import { requireBallotState, stateBallotScope } from "./state-scopes.ts";
import type { CandidateCorpus } from "../candidates/corpus.ts";
import { promotedVersionOrThrow, readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "./read-model.ts";
import { readStateAuthorityProjection } from "./state-reader.ts";
import type { CandidateProfilesProjection } from "./manual-projections.ts";

export async function readCandidateProfilesProjection(state: string, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<CandidateProfilesProjection>> {
  const key = requireBallotState(state);
  return Object.keys(options).length
    ? readPromotedCivicData<CandidateProfilesProjection>("CANDIDATE_PROFILE", stateBallotScope("candidate-profiles", key), options)
    : (await readStateAuthorityProjection<CandidateProfilesProjection>("candidate-profiles", key)).result;
}

async function readCandidateCorpusProjection(state: string, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<CandidateCorpus>> {
  const key = requireBallotState(state);
  return Object.keys(options).length
    ? readPromotedCivicData<CandidateCorpus>("CANDIDATE_PUBLICATION", stateBallotScope("candidate-corpus", key), options)
    : (await readStateAuthorityProjection<CandidateCorpus>("candidate-publications", key)).result;
}

async function refreshCandidateProfilesFromPromoted(state: string, options: PromotedCivicDataReadOptions = {}): Promise<string | null> {
  const [profiles] = await Promise.all([readCandidateProfilesProjection(state, options), refreshDerivedCampaignSites(state, options)]);
  return promotedVersionOrThrow(profiles);
}

export const settleCandidateCorpusRead = (state: string): Promise<string | null> => refreshCandidateCorpusFromPromoted(state);

export const settleCandidateProfilesRead = (state: string): Promise<string | null> => refreshCandidateProfilesFromPromoted(state);

export async function refreshCandidateCorpusFromPromoted(state: string, options: PromotedCivicDataReadOptions = {}): Promise<string | null> {
  const [corpus] = await Promise.all([readCandidateCorpusProjection(state, options), refreshDerivedCampaignSites(state, options)]);
  return promotedVersionOrThrow(corpus);
}
