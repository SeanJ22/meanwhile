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
import { electionFieldState, type PublishedElectionField } from "./election-fields.ts";

import { ballotNavigationScope } from "./ballot-navigation-scope.ts";
import { ballotNavigationFor } from "../ballot/navigation.ts";

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
type GlobalCuratedReaderId = Exclude<CuratedReaderContractId, "ballot-navigation">;

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

const states = new Map<GlobalCuratedReaderId, CivicDataReadResult<CuratedReaderProjection>>();

function initial(id: GlobalCuratedReaderId): CivicDataReadResult<CuratedReaderProjection> {
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
  state?: string,
): Promise<CivicDataReadResult<CuratedReaderProjection>> {
  const contract = requiredManualProductionContract(id);
  const scope = id === "ballot-navigation" ? ballotNavigationScope(state ?? "") : contract.scope;
  const result = await readPromotedCivicData<CuratedReaderProjection>(contract.recordClass, scope, id === "ballot-navigation" && !options.edge ? { ...options, bypassCache: true } : options);
  if (result.kind === "PROMOTED") {
    if (id === "ballot-navigation") ballotNavigationFor(state!, result.value, result.metadata.versionId!, []);
    else validate(id, result.value, result.metadata.versionId ?? "unknown");
  }
  if (id !== "ballot-navigation") states.set(id, result);
  return result;
}

export async function readElectionFieldsForDivisions(divisions: readonly string[], options: PromotedCivicDataReadOptions = {}) {
  const states = [...new Set(divisions.map(electionFieldState).filter((state): state is string => state !== null))];
  const reads = await Promise.all(states.map(state => readCuratedReaderProjection("ballot-navigation", options, state)));
  const fields = reads.flatMap(read => read.kind === "PROMOTED" ? read.value.records.filter(row =>
    row.kind === "ELECTION_FIELD" && divisions.includes((row as unknown as PublishedElectionField).value.divisionId)) as unknown as PublishedElectionField[] : []);
  return { reads, fields };
}

export async function refreshCuratedReaderProjection(
  id: GlobalCuratedReaderId,
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
  id: GlobalCuratedReaderId,
  value: CuratedReaderProjection,
  versionId: string,
): void {
  validateOnce(id, value, versionId, () => validate(id, value, versionId));
  const contract = requiredManualProductionContract(id);
  states.set(id, {
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
export const readOfficialFilingsForReader = (): Promise<CivicDataReadResult<CuratedReaderProjection>> => {
  const contract = requiredManualProductionContract("official-filings");
  return readPromotedEdgeFirst(contract.recordClass, contract.scope,
    options => readCuratedReaderProjection("official-filings", options), "Official filing records");
};
const BALLOT_NAVIGATION = requiredManualProductionContract("ballot-navigation");
export const settleBallotNavigationRead = (state: string): Promise<CivicDataReadResult<CuratedReaderProjection>> =>
  readPromotedEdgeFirst(BALLOT_NAVIGATION.recordClass, ballotNavigationScope(state),
    options => readCuratedReaderProjection("ballot-navigation", options, state), "The ballot navigation links");
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

export function curatedReaderReadState(id: GlobalCuratedReaderId): CivicDataReadResult<CuratedReaderProjection> {
  return states.get(id) ?? initial(id);
}

/** Only after the canonical pointer was read. A BOOTSTRAP state is a validated edge copy of a promoted version and is served; the seed is test evidence, never a production fallback. */
export function currentCuratedReaderRecords<T>(
  id: GlobalCuratedReaderId,
  testSeed: readonly T[],
): readonly T[] {
  const state = states.get(id) ?? initial(id);
  if (state.kind === "PROMOTED" || state.kind === "BOOTSTRAP") return state.value.records as readonly T[];
  if (mayUseTestFixture()) return testSeed;
  throw new Error(`${id} projection is ${state.kind}; initialize its canonical read before using the synchronous Reader projection.`);
}
