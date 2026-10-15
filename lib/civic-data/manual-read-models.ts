import { requireBallotState, stateBallotContractId, stateBallotScope, type BallotState } from "../ballot/state-scopes.ts";
import { readerCandidateProfiles } from "../ballot/candidate-reader-privacy.ts";

import type { CandidateCorpus } from "../candidates/corpus.ts";
import {
  civicDataReadNotInitialized,
  promotedVersionOrThrow,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "./read-model.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import {
  DERIVED_CAMPAIGN_SITES_RECORD_CLASS,
  refreshDerivedCampaignSites,
  currentDerivedCandidateDocuments,
} from "./derived-campaign-sites.ts";
import { currentReaderAuthorityEdge, readPromotedEdgeFirst } from "../registry/runtime-edge.ts";
import type {
  CandidateProfilesProjection,
} from "./manual-projections.ts";

const fallbackProfiles = new Map<BallotState, CivicDataReadResult<CandidateProfilesProjection>>();
const fallbackCorpora = new Map<BallotState, CivicDataReadResult<CandidateCorpus>>();
const requests = new WeakMap<object, { profiles: typeof fallbackProfiles; corpora: typeof fallbackCorpora }>();
function caches() {
  const edge = currentReaderAuthorityEdge();
  if (!edge) return { profiles: fallbackProfiles, corpora: fallbackCorpora };
  let held = requests.get(edge);
  if (!held) { held = { profiles: new Map(), corpora: new Map() }; requests.set(edge, held); }
  return held;
}

function install<T>(cache: Map<BallotState, T>, state: BallotState, value: T): void {
  cache.delete(state);
  cache.set(state, value);
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
}

async function readManual<T>(contract: ReturnType<typeof requiredManualProductionContract>, options: PromotedCivicDataReadOptions): Promise<CivicDataReadResult<T>> {
  return readPromotedCivicData<T>(contract.recordClass, contract.scope, options);
}

export async function readCandidateProfilesProjection(state: string, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<CandidateProfilesProjection>> {
  const key = requireBallotState(state);
  const result = await readManual<CandidateProfilesProjection>(requiredManualProductionContract(stateBallotContractId("candidate-profiles", key)), options);
  install(caches().profiles, key, result);
  return result;
}

export async function readCandidateCorpusProjection(state: string, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<CandidateCorpus>> {
  const key = requireBallotState(state);
  const result = await readManual<CandidateCorpus>(requiredManualProductionContract(stateBallotContractId("candidate-corpus", key)), options);
  install(caches().corpora, key, result);
  return result;
}

export async function refreshCandidateProfilesFromPromoted(state: string, options: PromotedCivicDataReadOptions = {}): Promise<string | null> {
  const [profiles] = await Promise.all([readCandidateProfilesProjection(state, options), refreshDerivedCampaignSites(state, options)]);
  return promotedVersionOrThrow(profiles);
}

export async function settleCandidateCorpusRead(state: string): Promise<string | null> {
  const contract = requiredManualProductionContract(stateBallotContractId("candidate-corpus", state));
  const [corpus] = await Promise.all([
    readPromotedEdgeFirst(contract.recordClass, contract.scope, options => readCandidateCorpusProjection(state, options), "The candidate publications"),
    readPromotedEdgeFirst(DERIVED_CAMPAIGN_SITES_RECORD_CLASS, stateBallotScope("candidate-campaign-sites-derived", state),
      options => refreshDerivedCampaignSites(state, options), "The verified candidate publications").catch(() => undefined),
  ]);
  return promotedVersionOrThrow(corpus);
}

export async function settleCandidateProfilesRead(state: string): Promise<string | null> {
  const contract = requiredManualProductionContract(stateBallotContractId("candidate-profiles", state));
  const [profiles] = await Promise.all([
    readPromotedEdgeFirst(contract.recordClass, contract.scope, options => readCandidateProfilesProjection(state, options), "The candidate profiles"),
    readPromotedEdgeFirst(DERIVED_CAMPAIGN_SITES_RECORD_CLASS, stateBallotScope("candidate-campaign-sites-derived", state),
      options => refreshDerivedCampaignSites(state, options), "The derived campaign sites").catch(() => undefined),
  ]);
  return promotedVersionOrThrow(profiles);
}

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
  caches().profiles.get(requireBallotState(state)) ?? civicDataReadNotInitialized("CANDIDATE_PROFILE", stateBallotScope("candidate-profiles", state), "The state's candidate profiles have not been read.");
export const candidateCorpusReadState = (state: string): CivicDataReadResult<CandidateCorpus> =>
  caches().corpora.get(requireBallotState(state)) ?? civicDataReadNotInitialized("CANDIDATE_PUBLICATION", stateBallotScope("candidate-corpus", state), "The state's candidate publications have not been read.");
