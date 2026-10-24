import { requireBallotState, stateBallotScope } from "./state-scopes.ts";
import { readerCandidateProfiles } from "../ballot/candidate-reader-privacy.ts";

import type { CandidateCorpus } from "../candidates/corpus.ts";
import {
  civicDataReadNotInitialized,
  promotedVersionOrThrow,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "./read-model.ts";
import { currentStateAuthorityProjection, readStateAuthorityProjection } from "./state-reader.ts";
import {
  refreshDerivedCampaignSites,
  currentDerivedCandidateDocuments,
} from "./derived-campaign-sites.ts";
import type {
  CandidateProfilesProjection,
} from "./manual-projections.ts";

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

const emptyProfiles: CandidateProfilesProjection = { cards: { curatedAt: "", note: "", cards: {}, hunts: [] }, links: { curatedAt: "", note: "", links: {}, hunts: [] } };
const safeProfiles = new WeakMap<CandidateProfilesProjection, CandidateProfilesProjection>();
export const currentCandidateProfilesProjection = (state: string): CandidateProfilesProjection => {
  const result = candidateProfilesReadState(state);
  if (result.kind !== "PROMOTED" && result.kind !== "BOOTSTRAP") return emptyProfiles;
  let safe = safeProfiles.get(result.value);
  if (!safe) { safe = readerCandidateProfiles(result.value); safeProfiles.set(result.value, safe); }
  return safe;
};
const emptyCorpus: CandidateCorpus = { formatVersion: 1, fetchedAt: "", attempted: 0, documents: [], failures: [] };
const composedCorpora = new WeakMap<CandidateCorpus, WeakMap<object, CandidateCorpus>>();
export const currentCandidateCorpusProjection = (state: string): CandidateCorpus => {
  const result = candidateCorpusReadState(state);
  const prior = result.kind === "PROMOTED" || result.kind === "BOOTSTRAP" ? result.value : emptyCorpus;
  const derived = currentDerivedCandidateDocuments(state);
  if (!derived.length) return prior;
  const held = composedCorpora.get(prior) ?? new WeakMap<object, CandidateCorpus>();
  const cached = held.get(derived);
  if (cached) return cached;
  const documents = new Map(prior.documents.map(row => [row.id, row]));
  for (const row of derived) if (!documents.has(row.id)) documents.set(row.id, row);
  const composed = { ...prior, documents: [...documents.values()], attempted: Math.max(prior.attempted,
    new Set([...documents.values()].map(row => row.candidateKey).concat(prior.failures.map(row => row.candidateKey))).size) };
  held.set(derived, composed); composedCorpora.set(prior, held);
  return composed;
};

export const candidateProfilesReadState = (state: string): CivicDataReadResult<CandidateProfilesProjection> =>
  currentStateAuthorityProjection<CandidateProfilesProjection>("candidate-profiles", state)?.result ?? civicDataReadNotInitialized("CANDIDATE_PROFILE", stateBallotScope("candidate-profiles", state), "The state's candidate profiles have not been read.");
const candidateCorpusReadState = (state: string): CivicDataReadResult<CandidateCorpus> =>
  currentStateAuthorityProjection<CandidateCorpus>("candidate-publications", state)?.result ?? civicDataReadNotInitialized("CANDIDATE_PUBLICATION", stateBallotScope("candidate-corpus", state), "The state's candidate publications have not been read.");
