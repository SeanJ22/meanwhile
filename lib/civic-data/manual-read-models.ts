import { readerCandidateProfiles } from "../ballot/candidate-reader-privacy.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { CandidateCorpus } from "../candidates/corpus.ts";
import {
  civicDataReadNotInitialized,
  mayUseTestFixture,
  promotedVersionOrThrow,
  readPromotedOrBootstrap,
  type CivicDataBootstrap,
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

function instant(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
}

function arrays(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return keys.every((key) => Array.isArray(record[key]));
}

function validateAz(value: AzBallotProjection, version: string): void {
  if (!arrays(value.ballot, ["contests", "candidacies"]) || value.ballot.contests.length === 0 || value.ballot.candidacies.length === 0) {
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
  if (!arrays(value.ballot, ["contests", "candidacies"]) || value.ballot.contests.length === 0 || value.ballot.candidacies.length === 0) {
    throw new Error(`New Hampshire ballot projection ${version} has no ballot rows.`);
  }
}

function validateProfiles(value: CandidateProfilesProjection, version: string): void {
  const cards = value.cards?.cards;
  const links = value.links?.links;
  if (
    !cards || typeof cards !== "object" || Array.isArray(cards) ||
    !links || typeof links !== "object" || Array.isArray(links) ||
    Object.keys(cards).length + Object.keys(links).length === 0
  ) {
    throw new Error(`Candidate profile projection ${version} has no card or link records.`);
  }
}

function validateCorpus(value: CandidateCorpus, version: string): void {
  if (!Array.isArray(value.documents) || !Array.isArray(value.failures) || value.documents.length === 0) {
    throw new Error(`Candidate publication projection ${version} has no document versions.`);
  }
}

function azBootstrap(): CivicDataBootstrap<AzBallotProjection> {
  const value: AzBallotProjection = {
    ballot: JSON.parse(readFileSync(join(process.cwd(), "data", "states", "az", "ballot", "az-pima-2026.json"), "utf8")),
    generalLineup: JSON.parse(readFileSync(join(process.cwd(), "data", "states", "az", "ballot", "az-general-lineup-2026.json"), "utf8")),
    measureAnalyses: JSON.parse(readFileSync(join(process.cwd(), "data", "states", "az", "ballot", "az-analyses-2026.json"), "utf8")),
    candidateFilings: JSON.parse(readFileSync(join(process.cwd(), "data", "states", "az", "candidates", "az-2026-sos-candidate-filings.json"), "utf8")),
    identityRegistry: JSON.parse(readFileSync(join(process.cwd(), "data", "states", "az", "identity", "az-2026-candidate-registry.json"), "utf8")),
    lineupReconciliation: JSON.parse(readFileSync(join(process.cwd(), "data", "states", "az", "identity", "az-2026-certified-lineup-reconciliation.json"), "utf8")),
  };
  validateAz(value, "bundled bootstrap");
  const sourceThrough = value.identityRegistry.generatedAt;
  return {
    value,
    sourceId: AZ.sourceId,
    version: value.ballot.election.date,
    versionId: `bootstrap:az-ballot:${sourceThrough}`,
    sourceThrough,
    retrievedAt: instant(sourceThrough),
    detail: "Bundled Arizona ballot/identity seed selected only because the canonical store answered with no promoted pointer.",
  };
}

function nhBootstrap(): CivicDataBootstrap<NhBallotProjection> {
  const value: NhBallotProjection = {
    ballot: JSON.parse(readFileSync(join(process.cwd(), "data", "states", "nh", "ballot", "nh-merrimack-2026.json"), "utf8")),
  };
  validateNh(value, "bundled bootstrap");
  const sourceThrough = value.ballot.curatedAt ?? value.ballot.election.date;
  return {
    value,
    sourceId: NH.sourceId,
    version: value.ballot.election.date,
    versionId: `bootstrap:nh-ballot:${sourceThrough}`,
    sourceThrough,
    retrievedAt: instant(sourceThrough),
    detail: "Bundled New Hampshire ballot seed selected only because the canonical store answered with no promoted pointer.",
  };
}

function profilesBootstrap(): CivicDataBootstrap<CandidateProfilesProjection> {
  const value: CandidateProfilesProjection = {
    cards: JSON.parse(readFileSync(join(process.cwd(), "data", "ballot", "candidate-cards-2026.json"), "utf8")),
    links: JSON.parse(readFileSync(join(process.cwd(), "data", "ballot", "candidate-links-2026.json"), "utf8")),
  };
  validateProfiles(value, "bundled bootstrap");
  const sourceThrough = [value.cards.curatedAt, value.links.curatedAt].sort().at(-1)!;
  return {
    value,
    sourceId: PROFILES.sourceId,
    version: sourceThrough,
    versionId: `bootstrap:candidate-profiles:${sourceThrough}`,
    sourceThrough,
    retrievedAt: instant(sourceThrough),
    detail: "Bundled candidate profile seed selected only because the canonical store answered with no promoted pointer.",
  };
}

function corpusBootstrap(): CivicDataBootstrap<CandidateCorpus> {
  const value = JSON.parse(readFileSync(join(process.cwd(), "data", "candidates", "corpus-2026.json"), "utf8")) as CandidateCorpus;
  validateCorpus(value, "bundled bootstrap");
  return {
    value,
    sourceId: CORPUS.sourceId,
    version: value.fetchedAt,
    versionId: `bootstrap:candidate-corpus:${value.fetchedAt}`,
    sourceThrough: value.fetchedAt,
    retrievedAt: value.fetchedAt,
    detail: "Bundled candidate publication seed selected only because the canonical store answered with no promoted pointer.",
  };
}

let azState: CivicDataReadResult<AzBallotProjection> = civicDataReadNotInitialized("BALLOT_CANDIDACY", AZ.scope, "The Arizona ballot pointer has not been read for this process.");
let nhState: CivicDataReadResult<NhBallotProjection> = civicDataReadNotInitialized("BALLOT_CANDIDACY", NH.scope, "The New Hampshire ballot pointer has not been read for this process.");
let profilesState: CivicDataReadResult<CandidateProfilesProjection> = civicDataReadNotInitialized("CANDIDATE_PROFILE", PROFILES.scope, "The candidate profile pointer has not been read for this process.");
let corpusState: CivicDataReadResult<CandidateCorpus> = civicDataReadNotInitialized("CANDIDATE_PUBLICATION", CORPUS.scope, "The candidate publication pointer has not been read for this process.");

/**
 * Which (class:scope:versionId) triples have already passed `validate` in this
 * process. A promoted version is immutable, so validating it once is sufficient
 * — the ballot page reads the AZ projection several times per request and
 * re-scanned the whole ballot each time. Skipped for an injected store (tests),
 * which re-validate every time so a planted malformed fixture is never waved
 * through by a version another test already cleared.
 */
const validatedVersions = new Set<string>();

async function readManual<T>(
  contract: typeof AZ | typeof NH | typeof PROFILES | typeof CORPUS,
  bootstrap: () => CivicDataBootstrap<T>,
  validate: (value: T, version: string) => void,
  options: PromotedCivicDataReadOptions,
): Promise<CivicDataReadResult<T>> {
  const result = await readPromotedOrBootstrap({
    ...options,
    recordClass: contract.recordClass,
    scope: contract.scope,
    bootstrap,
    allowUnconfiguredBootstrap: process.env.NODE_ENV === "development" || mayUseTestFixture(),
  });
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    const injected = options.store !== undefined;
    const version = result.metadata.versionId ?? result.kind;
    const key = `${contract.recordClass}:${contract.scope}:${version}`;
    if (injected || !validatedVersions.has(key)) {
      validate(result.value, version);
      if (!injected) validatedVersions.add(key);
    }
  }
  return result;
}

export async function readAzBallotProjection(options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<AzBallotProjection>> {
  azState = await readManual(AZ, azBootstrap, validateAz, options);
  return azState;
}

export async function readNhBallotProjection(options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<NhBallotProjection>> {
  nhState = await readManual(NH, nhBootstrap, validateNh, options);
  return nhState;
}

export async function readCandidateProfilesProjection(options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<CandidateProfilesProjection>> {
  profilesState = await readManual(PROFILES, profilesBootstrap, validateProfiles, options);
  return profilesState;
}

export async function readCandidateCorpusProjection(options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<CandidateCorpus>> {
  corpusState = await readManual(CORPUS, corpusBootstrap, validateCorpus, options);
  return corpusState;
}

/**
 * The profile Reader's preload. It also reads the verified campaign sites the
 * standing runner publishes (`derived-campaign-sites.ts`), in their own failure
 * domain: that read never fails or delays the profiles it accompanies, and the
 * Reader composes the two (`lib/ballot/candidate-sites.ts`).
 */
export async function refreshCandidateProfilesFromPromoted(options: PromotedCivicDataReadOptions = {}): Promise<string | null> {
  const [profiles] = await Promise.all([readCandidateProfilesProjection(options), refreshDerivedCampaignSites(options)]);
  return promotedVersionOrThrow(profiles);
}

/*
 * **EDGE FIRST, DATABASE SECOND** (2026-09-25): each pointer from the reader
 * edge's proven copy when the request entered one, through the same Reader and
 * validator (`readPromotedEdgeFirst`, lib/registry/runtime-edge.ts); from the
 * database otherwise, exactly as before, and never in an edge-only context.
 */
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
/** The profile preload, edge first: the profiles and, in their own failure domain, the derived campaign sites. */
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

function currentOrTestSeed<T>(result: CivicDataReadResult<T>, name: string, seed: () => CivicDataBootstrap<T>): T {
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") return result.value;
  if (mayUseTestFixture()) return seed().value;
  throw new Error(`${name} is ${result.kind}; initialize its canonical read before using the synchronous projection.`);
}

export const currentAzBallotProjection = (): AzBallotProjection => currentOrTestSeed(azState, "Arizona ballot projection", azBootstrap);
export const currentNhBallotProjection = (): NhBallotProjection => currentOrTestSeed(nhState, "New Hampshire ballot projection", nhBootstrap);
export const currentCandidateProfilesProjection = (): CandidateProfilesProjection => readerCandidateProfiles(currentOrTestSeed(profilesState, "Candidate profile projection", profilesBootstrap));
export const currentCandidateCorpusProjection = (): CandidateCorpus => {
  const prior = currentOrTestSeed(corpusState, "Candidate publication projection", corpusBootstrap);
  const documents = new Map(prior.documents.map(row => [row.id, row]));
  for (const row of currentDerivedCandidateDocuments()) if (!documents.has(row.id)) documents.set(row.id, row);
  return { ...prior, documents: [...documents.values()], attempted: Math.max(prior.attempted,
    new Set([...documents.values()].map(row => row.candidateKey).concat(prior.failures.map(row => row.candidateKey))).size) };
};

export const azBallotReadState = (): CivicDataReadResult<AzBallotProjection> => azState;
export const nhBallotReadState = (): CivicDataReadResult<NhBallotProjection> => nhState;
export const candidateProfilesReadState = (): CivicDataReadResult<CandidateProfilesProjection> => profilesState;
export const candidateCorpusReadState = (): CivicDataReadResult<CandidateCorpus> => corpusState;
