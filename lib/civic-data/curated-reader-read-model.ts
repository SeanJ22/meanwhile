import {
  civicDataReadNotInitialized,
  mayUseTestFixture,
  promotedVersionOrThrow,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "./read-model.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import type { CuratedReaderProjection } from "./manual-projections.ts";

export const CURATED_READER_CONTRACT_IDS = [
  "comment-access",
  "ballot-navigation",
  "campaign-sites",
  "venue-resolutions",
] as const;
export type CuratedReaderContractId = (typeof CURATED_READER_CONTRACT_IDS)[number];

export interface BallotNavigationProjectionRecord {
  readonly id: string;
  readonly kind: "POLLING_PLACE_LINK" | "REGISTRATION_LINK";
  readonly value: Readonly<Record<string, unknown>>;
}

export interface CampaignSiteProjectionRecord {
  readonly id: string;
  readonly officeholderId: string;
  readonly site: Readonly<Record<string, unknown>>;
}

const states = new Map<CuratedReaderContractId, CivicDataReadResult<CuratedReaderProjection>>();

function initial(id: CuratedReaderContractId): CivicDataReadResult<CuratedReaderProjection> {
  const contract = requiredManualProductionContract(id);
  return civicDataReadNotInitialized(
    contract.recordClass,
    contract.scope,
    `The ${id} canonical pointer has not been read for this process.`,
  );
}

function validate(id: CuratedReaderContractId, value: CuratedReaderProjection, version: string): void {
  if (value?.kind !== id || !Array.isArray(value.records) || value.records.length === 0) {
    throw new Error(`${id} projection ${version} has the wrong family or no records.`);
  }
  const keys = value.records.map((record) => record?.id);
  if (keys.some((key) => typeof key !== "string" || key.length === 0) || new Set(keys).size !== keys.length) {
    throw new Error(`${id} projection ${version} has an empty or duplicate record id.`);
  }
}

export async function readCuratedReaderProjection(
  id: CuratedReaderContractId,
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<CuratedReaderProjection>> {
  const contract = requiredManualProductionContract(id);
  const result = await readPromotedCivicData<CuratedReaderProjection>(contract.recordClass, contract.scope, options);
  if (result.kind === "PROMOTED") validate(id, result.value, result.metadata.versionId ?? "unknown");
  states.set(id, result);
  return result;
}

export async function refreshCuratedReaderProjection(
  id: CuratedReaderContractId,
  options: PromotedCivicDataReadOptions = {},
): Promise<string> {
  const result = await readCuratedReaderProjection(id, options);
  if (result.kind === "NOT_RECORDED") throw new Error(`The ${id} store answered without a canonical promoted projection.`);
  const version = promotedVersionOrThrow(result);
  if (version === null) throw new Error(`The ${id} canonical projection was not promoted.`);
  return version;
}

export const refreshCommentAccessFromPromoted = (options: PromotedCivicDataReadOptions = {}) =>
  refreshCuratedReaderProjection("comment-access", options);
export const refreshBallotNavigationFromPromoted = (options: PromotedCivicDataReadOptions = {}) =>
  refreshCuratedReaderProjection("ballot-navigation", options);
export const refreshCampaignSitesFromPromoted = (options: PromotedCivicDataReadOptions = {}) =>
  refreshCuratedReaderProjection("campaign-sites", options);
export const refreshVenueResolutionsFromPromoted = (options: PromotedCivicDataReadOptions = {}) =>
  refreshCuratedReaderProjection("venue-resolutions", options);

export function curatedReaderReadState(id: CuratedReaderContractId): CivicDataReadResult<CuratedReaderProjection> {
  return states.get(id) ?? initial(id);
}

/**
 * Synchronous selectors are allowed only after the canonical pointer was read.
 * The tracked value is deterministic first-seed/test evidence, never a
 * production fallback after NOT_RECORDED or a store failure.
 */
export function currentCuratedReaderRecords<T>(
  id: CuratedReaderContractId,
  testSeed: readonly T[],
): readonly T[] {
  const state = states.get(id) ?? initial(id);
  if (state.kind === "PROMOTED") return state.value.records as readonly T[];
  if (mayUseTestFixture()) return testSeed;
  throw new Error(`${id} projection is ${state.kind}; initialize its canonical read before using the synchronous Reader projection.`);
}
