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
import { memberOfficeContractId, memberOfficeScope } from "../officials/member-office-scope.ts";
import { readMemberOfficeProjection } from "../officials/member-office-projection.ts";
import { readVenueResolutionRecords, type VenueResolutionReadOptions } from "../meetings/venue-projection.ts";

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
const venueRecords = new WeakMap<object, CuratedReaderProjection["records"]>();
let processVenueRecords: CuratedReaderProjection["records"] = [];
function installVenueRecords(records: CuratedReaderProjection["records"]): void {
  const selection = currentReaderSelection();
  if (selection) venueRecords.set(selection, records); else processVenueRecords = records;
}
function readerStates() {
  const selection = currentReaderSelection();
  if (!selection) return states;
  let held = selectedStates.get(selection);
  if (!held) { held = new Map(); selectedStates.set(selection, held); }
  return held;
}


function initial(id: CuratedReaderContractId): CivicDataReadResult<CuratedReaderProjection> {
  if (id === "member-offices") return civicDataReadNotInitialized("CURATED_READER_RECORD", "member-offices:state", "Select a state before reading member offices.");
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
  options: VenueResolutionReadOptions = {},
): Promise<CivicDataReadResult<CuratedReaderProjection>> {
  if (id === "venue-resolutions") {
    const state = options.state ?? currentReaderSelection()?.states?.[0];
    if (!state) throw new Error("VENUE_RESOLUTION_STATE_REQUIRED");
    const selected = await readVenueResolutionRecords(state, options);
    installVenueRecords(selected.records);
    readerStates().set(id, selected.read);
    return selected.read;
  }
  if (id === "member-offices") {
    const selected = options.state ?? currentReaderSelection()?.states?.[0];
    if (!selected) return initial(id);
    const result = await readMemberOfficeProjection(selected, options);
    if (result.kind === "PROMOTED") validate(id, result.value, result.metadata.versionId ?? "unknown");
    readerStates().set(id, result);
    return result;
  }
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
  options: VenueResolutionReadOptions = {},
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
  if (id === "venue-resolutions") installVenueRecords(value.records);
  const officeState = currentReaderSelection()?.states?.[0] ?? (value.records[0]?.office as { state?: string } | undefined)?.state;
  if (id === "member-offices" && !officeState) throw new Error("MEMBER_OFFICE_STATE_REQUIRED");
  const contract = requiredManualProductionContract(id === "member-offices" ? memberOfficeContractId(officeState!) : id);
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
export const refreshMemberOfficesFromPromoted = (options: PromotedCivicDataReadOptions & { readonly state?: string } = {}) =>
  refreshCuratedReaderProjection("member-offices", options);
export const settleMemberOfficesRead = (): Promise<CivicDataReadResult<CuratedReaderProjection>> => {
  const state = currentReaderSelection()?.states?.[0];
  return state ? readPromotedEdgeFirst("CURATED_READER_RECORD", memberOfficeScope(state),
    options => readCuratedReaderProjection("member-offices", { ...options, state }), "The state legislators' offices") : Promise.resolve(initial("member-offices"));
};
export const refreshVenueResolutionsFromPromoted = (options: VenueResolutionReadOptions = {}) =>
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
  if (state.kind === "PROMOTED" || state.kind === "BOOTSTRAP") {
    if (id === "venue-resolutions") return (currentReaderSelection() ? venueRecords.get(currentReaderSelection()!) ?? [] : processVenueRecords) as readonly T[];
    return state.value.records as readonly T[];
  }
  if (mayUseTestFixture()) return testSeed;
  throw new Error(`${id} projection is ${state.kind}; initialize its canonical read before using the synchronous Reader projection.`);
}
