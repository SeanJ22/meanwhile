import {
  civicDataReadNotInitialized,
  mayUseTestFixture,
  promotedVersionOrThrow,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "./read-model.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { validateOnce } from "./validated-once.ts";
import { readPromotedEdgeFirst } from "../registry/runtime-edge.ts";
import type { CuratedReaderProjection } from "./manual-projections.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { electionFieldIssue, type PublishedElectionField } from "./election-fields.ts";

export const CURATED_READER_CONTRACT_IDS = [
  "official-filings",
  "ballot-navigation",
  "stances",
  "campaign-sites",
  "member-offices",
  "venue-resolutions",
  "meeting-body-crosswalk",
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
const selectedStates = new WeakMap<object, Map<CuratedReaderContractId, CivicDataReadResult<CuratedReaderProjection>>>();
function readerStates() {
  const selection = currentReaderSelection();
  if (!selection) return states;
  let held = selectedStates.get(selection);
  if (!held) { held = new Map(); selectedStates.set(selection, held); }
  return held;
}


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
  readerStates().set(id, result);
  return result;
}

export async function readElectionFieldsForDivisions(divisions: readonly string[], options: PromotedCivicDataReadOptions = {}) {
  const read = await readCuratedReaderProjection("ballot-navigation", options);
  const fields = read.kind === "PROMOTED" ? read.value.records.filter(row => row.kind === "ELECTION_FIELD" && electionFieldIssue(row) === null)
    .map(row => row as unknown as PublishedElectionField).filter(row => divisions.includes(row.value.divisionId)) : [];
  return { read, fields };
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

/** Primes from a validated edge serving copy, with no database read; its state is BOOTSTRAP. */
export function primeCuratedReaderProjection(
  id: CuratedReaderContractId,
  value: CuratedReaderProjection,
  versionId: string,
): void {
  validateOnce(id, value, versionId, () => validate(id, value, versionId));
  const contract = requiredManualProductionContract(id);
  readerStates().set(id, {
    kind: "BOOTSTRAP",
    value,
    metadata: {
      recordClass: contract.recordClass,
      scope: contract.scope,
      sourceId: contract.sourceId ?? null,
      version: null,
      versionId,
      lastKnownGoodVersionId: versionId,
      sourceThrough: null,
      retrievedAt: null,
      promotedAt: null,
      stale: "CURRENT",
      staleAt: null,
    },
    detail: `Served from the ${id} edge artifact (version ${versionId}); the promotion receipt stays on the authoritative database path.`,
  });
}

export const refreshBallotNavigationFromPromoted = (options: PromotedCivicDataReadOptions = {}) =>
  refreshCuratedReaderProjection("ballot-navigation", options);
export const readOfficialFilingsForReader = (): Promise<CivicDataReadResult<CuratedReaderProjection>> => {
  const contract = requiredManualProductionContract("official-filings");
  return readPromotedEdgeFirst(contract.recordClass, contract.scope,
    options => readCuratedReaderProjection("official-filings", options), "Official filing records");
};
const BALLOT_NAVIGATION = requiredManualProductionContract("ballot-navigation");
export const settleBallotNavigationRead = (): Promise<string> =>
  readPromotedEdgeFirst(BALLOT_NAVIGATION.recordClass, BALLOT_NAVIGATION.scope, refreshBallotNavigationFromPromoted, "The ballot navigation links");
export const refreshCampaignSitesFromPromoted = (options: PromotedCivicDataReadOptions = {}) =>
  refreshCuratedReaderProjection("campaign-sites", options);
export const refreshMemberOfficesFromPromoted = (options: PromotedCivicDataReadOptions = {}) =>
  refreshCuratedReaderProjection("member-offices", options);
const MEMBER_OFFICES = requiredManualProductionContract("member-offices");
export const settleMemberOfficesRead = (): Promise<CivicDataReadResult<CuratedReaderProjection>> =>
  readPromotedEdgeFirst(MEMBER_OFFICES.recordClass, MEMBER_OFFICES.scope,
    options => readCuratedReaderProjection("member-offices", options), "The state legislators' offices");
export const refreshVenueResolutionsFromPromoted = (options: PromotedCivicDataReadOptions = {}) =>
  refreshCuratedReaderProjection("venue-resolutions", options);

export function curatedReaderReadState(id: CuratedReaderContractId): CivicDataReadResult<CuratedReaderProjection> {
  return readerStates().get(id) ?? initial(id);
}

/** Only after the canonical pointer was read. A BOOTSTRAP state is a validated edge copy of a promoted version and is served; the seed is test evidence, never a production fallback. */
export function currentCuratedReaderRecords<T>(
  id: CuratedReaderContractId,
  testSeed: readonly T[],
): readonly T[] {
  const state = readerStates().get(id) ?? initial(id);
  if (state.kind === "PROMOTED" || state.kind === "BOOTSTRAP") return state.value.records as readonly T[];
  if (mayUseTestFixture()) return testSeed;
  throw new Error(`${id} projection is ${state.kind}; initialize its canonical read before using the synchronous Reader projection.`);
}
