import { currentReaderRoute } from "../db/reader-route.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
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
  DERIVED_CAMPAIGN_SITES_SCOPE,
  refreshDerivedCampaignSites,
  currentDerivedCandidateDocuments,
} from "./derived-campaign-sites.ts";
import { validateOnce } from "./validated-once.ts";
import { readPromotedEdgeFirst } from "../registry/runtime-edge.ts";
import type {
  AzBallotProjection,
  CandidateProfilesProjection,
  NhBallotProjection,
} from "./manual-projections.ts";

const AZ = requiredManualProductionContract("az-sos-ballot");
const NH = requiredManualProductionContract("nh-curated-ballot");
const PROFILES = requiredManualProductionContract("candidate-profiles");
const CORPUS = requiredManualProductionContract("candidate-corpus");

function arrays(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return keys.every((key) => Array.isArray(record[key]));
}

function validateAz(value: AzBallotProjection, version: string): void {
  if (!arrays(value.ballot, ["contests", "candidacies"])) {
    throw new Error(`Arizona ballot projection ${version} has no ballot rows.`);
  }
  if (!arrays(value.generalLineup, ["contests"]) || !arrays(value.measureAnalyses, ["analyses"])) {
    throw new Error(`Arizona ballot projection ${version} lacks its lineup or analysis projection.`);
  }
  if (!arrays(value.identityRegistry, ["contests", "candidates"]) || !arrays(value.lineupReconciliation, ["rows"])) {
    throw new Error(`Arizona ballot projection ${version} lacks its exact identity projection.`);
  }
  if (!value.candidateFilings || typeof value.candidateFilings !== "object") {
    throw new Error(`Arizona ballot projection ${version} lacks its filing corpus.`);
  }
}

function validateNh(value: NhBallotProjection, version: string): void {
  if (!arrays(value.ballot, ["contests", "candidacies"])) {
    throw new Error(`New Hampshire ballot projection ${version} has no ballot rows.`);
  }
}

function validateProfiles(value: CandidateProfilesProjection, version: string): void {
  const cards = value.cards?.cards;
  const links = value.links?.links;
  if (
    !cards || typeof cards !== "object" || Array.isArray(cards) ||
    !links || typeof links !== "object" || Array.isArray(links)
  ) {
    throw new Error(`Candidate profile projection ${version} has no card or link records.`);
  }
}

function validateCorpus(value: CandidateCorpus, version: string): void {
  if (!Array.isArray(value.documents) || !Array.isArray(value.failures)) {
    throw new Error(`Candidate publication projection ${version} has no document versions.`);
  }
}

interface ReaderStates {
  az: CivicDataReadResult<AzBallotProjection>;
  nh: CivicDataReadResult<NhBallotProjection>;
  profiles: CivicDataReadResult<CandidateProfilesProjection>;
  corpus: CivicDataReadResult<CandidateCorpus>;
}
function initialStates(): ReaderStates {
  return {
    az: civicDataReadNotInitialized("BALLOT_CANDIDACY", AZ.scope, "The Arizona ballot has not been read."),
    nh: civicDataReadNotInitialized("BALLOT_CANDIDACY", NH.scope, "The New Hampshire ballot has not been read."),
    profiles: civicDataReadNotInitialized("CANDIDATE_PROFILE", PROFILES.scope, "The candidate profiles have not been read."),
    corpus: civicDataReadNotInitialized("CANDIDATE_PUBLICATION", CORPUS.scope, "The candidate publications have not been read."),
  };
}
const states = initialStates();
const observedStates = { ...states };
const selectedStates = new WeakMap<object, ReturnType<typeof initialStates>>();
function readerStates() {
  const selection = currentReaderSelection();
  if (!selection) return states;
  let held = selectedStates.get(selection);
  if (!held) { held = { ...states }; selectedStates.set(selection, held); }
  return held;
}

async function readManual<T extends object>(
  contract: typeof AZ | typeof NH | typeof PROFILES | typeof CORPUS,
  validate: (value: T, version: string) => void,
  options: PromotedCivicDataReadOptions,
): Promise<CivicDataReadResult<T>> {
  const result = await readPromotedCivicData<T>(contract.recordClass, contract.scope, options);
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    const injected = options.store !== undefined;
    const version = result.metadata.versionId ?? result.kind;
    if (injected) validate(result.value, version);
    else validateOnce(`${contract.recordClass}:${contract.scope}`, result.value, version, () => validate(result.value, version));
  }
  return result;
}

export async function readAzBallotProjection(options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<AzBallotProjection>> {
  const result = await readManual(AZ, validateAz, options);
  readerStates().az = result;
  observedStates.az = result;
  return result;
}

export async function readNhBallotProjection(options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<NhBallotProjection>> {
  const result = await readManual(NH, validateNh, options);
  readerStates().nh = result;
  observedStates.nh = result;
  return result;
}

export async function readCandidateProfilesProjection(options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<CandidateProfilesProjection>> {
  const result = await readManual(PROFILES, validateProfiles, options);
  readerStates().profiles = result;
  observedStates.profiles = result;
  return result;
}

export async function readCandidateCorpusProjection(options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<CandidateCorpus>> {
  const result = await readManual(CORPUS, validateCorpus, options);
  readerStates().corpus = result;
  observedStates.corpus = result;
  return result;
}


export async function refreshCandidateProfilesFromPromoted(options: PromotedCivicDataReadOptions = {}): Promise<string | null> {
  const [profiles] = await Promise.all([readCandidateProfilesProjection(options), refreshDerivedCampaignSites(options)]);
  return promotedVersionOrThrow(profiles);
}

/** Edge first: the reader edge's proven copy when the request entered one, else the database. */
export const settleAzBallotRead = (): Promise<CivicDataReadResult<AzBallotProjection>> =>
  readPromotedEdgeFirst(AZ.recordClass, AZ.scope, readAzBallotProjection, "The Arizona ballot");
export const settleNhBallotRead = (): Promise<CivicDataReadResult<NhBallotProjection>> =>
  readPromotedEdgeFirst(NH.recordClass, NH.scope, readNhBallotProjection, "The New Hampshire ballot");
export const settleCandidateCorpusRead = async (): Promise<string | null> => {
  const [corpus] = await Promise.all([
    readPromotedEdgeFirst(CORPUS.recordClass, CORPUS.scope, readCandidateCorpusProjection, "The candidate publications"),
    readPromotedEdgeFirst(DERIVED_CAMPAIGN_SITES_RECORD_CLASS, DERIVED_CAMPAIGN_SITES_SCOPE, refreshDerivedCampaignSites, "The verified candidate publications").catch(() => undefined),
  ]);
  return promotedVersionOrThrow(corpus);
};
export async function settleCandidateProfilesRead(): Promise<string | null> {
  const [profiles] = await Promise.all([
    readPromotedEdgeFirst(PROFILES.recordClass, PROFILES.scope, readCandidateProfilesProjection, "The candidate profiles"),
    // Their own failure domain, as in `refreshCandidateProfilesFromPromoted`: a refusal withholds only them.
    readPromotedEdgeFirst(DERIVED_CAMPAIGN_SITES_RECORD_CLASS, DERIVED_CAMPAIGN_SITES_SCOPE, refreshDerivedCampaignSites, "The derived campaign sites")
      .catch(() => undefined),
  ]);
  return promotedVersionOrThrow(profiles);
}

export async function refreshCandidateCorpusFromPromoted(options: PromotedCivicDataReadOptions = {}): Promise<string | null> {
  const [corpus] = await Promise.all([readCandidateCorpusProjection(options), refreshDerivedCampaignSites(options)]);
  return promotedVersionOrThrow(corpus);
}

export async function refreshAzBallotFromPromoted(options: PromotedCivicDataReadOptions = {}): Promise<string | null> {
  return promotedVersionOrThrow(await readAzBallotProjection(options));
}

export async function refreshNhBallotFromPromoted(options: PromotedCivicDataReadOptions = {}): Promise<string | null> {
  return promotedVersionOrThrow(await readNhBallotProjection(options));
}

function current<T>(result: CivicDataReadResult<T>, name: string): T {
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") return result.value;
  throw new Error(`${name} is ${result.kind}; initialize its canonical read before using the synchronous projection.`);
}

export const currentAzBallotProjection = (): AzBallotProjection => current(readerStates().az, "Arizona ballot projection");
export const currentNhBallotProjection = (): NhBallotProjection => current(readerStates().nh, "New Hampshire ballot projection");
export const currentCandidateProfilesProjection = (): CandidateProfilesProjection => readerCandidateProfiles(current(readerStates().profiles, "Candidate profile projection"));
export const currentCandidateCorpusProjection = (): CandidateCorpus => {
  const prior = current(readerStates().corpus, "Candidate publication projection");
  const documents = new Map(prior.documents.map(row => [row.id, row]));
  for (const row of currentDerivedCandidateDocuments()) if (!documents.has(row.id)) documents.set(row.id, row);
  return { ...prior, documents: [...documents.values()], attempted: Math.max(prior.attempted,
    new Set([...documents.values()].map(row => row.candidateKey).concat(prior.failures.map(row => row.candidateKey))).size) };
};

function observedReaderStates() {
  return currentReaderSelection() || currentReaderRoute() !== "unattributed" ? readerStates() : observedStates;
}

export const azBallotReadState = (): CivicDataReadResult<AzBallotProjection> => observedReaderStates().az;
export const nhBallotReadState = (): CivicDataReadResult<NhBallotProjection> => observedReaderStates().nh;
export const candidateProfilesReadState = (): CivicDataReadResult<CandidateProfilesProjection> => observedReaderStates().profiles;
export const candidateCorpusReadState = (): CivicDataReadResult<CandidateCorpus> => observedReaderStates().corpus;
