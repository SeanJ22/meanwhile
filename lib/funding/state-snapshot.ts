import { campaignFinanceForTarget, settleCampaignFinanceReads } from "./campaign-finance-reader.ts";

import {
  civicDataReadNotInitialized,
  readPromotedCivicData,
  type CivicDataReadMetadata,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import {
  STATE_CAMPAIGN_FINANCE_SOURCES,
  type StateCampaignFinanceJurisdiction,
} from "./data-plane.ts";
import { isRenderable, publicStateMoneyRecord } from "./state-money-reader.ts";
import { readPromotedEdgeFirst } from "../registry/runtime-edge.ts";
import type { StateMoneyRecord, StateMoneySnapshot } from "./state-money.ts";
import { currentReaderSelection, type ReaderSelection } from "../db/reader-route.ts";

/**
 * State campaign money is canonical only after a GOOD promotion. The bundled
 * JSON files are deterministic first-seed/test fixtures; production never
 * opens them and a store error can never select them as an implicit LKG.
 */
export type StateCampaignFinanceRead = CivicDataReadResult<StateMoneySnapshot> | {
  readonly kind: "PROJECTION_INVALID";
  readonly value: null;
  readonly metadata: CivicDataReadMetadata;
  readonly code: "SOURCE_ID_MISMATCH" | "PROJECTION_CONTRACT_INVALID";
  readonly detail: string;
};

type StateRead = StateCampaignFinanceRead;

let cache = new Map<StateCampaignFinanceJurisdiction, StateMoneySnapshot>();
let readStates = new Map<StateCampaignFinanceJurisdiction, StateRead>(
  (Object.keys(STATE_CAMPAIGN_FINANCE_SOURCES) as StateCampaignFinanceJurisdiction[]).map((state) => [
    state,
    civicDataReadNotInitialized(
      "STATE_CAMPAIGN_FINANCE",
      STATE_CAMPAIGN_FINANCE_SOURCES[state].scope,
      `The ${state} campaign-finance canonical pointer has not been read for this process.`,
    ),
  ]),
);
const requestStates = new WeakMap<ReaderSelection, { cache: typeof cache; reads: typeof readStates }>();
function selectedState() {
  const selection = currentReaderSelection();
  if (!selection) return { cache, reads: readStates };
  let held = requestStates.get(selection);
  if (!held) { held = { cache: new Map(), reads: new Map() }; requestStates.set(selection, held); }
  return held;
}

function validateSnapshot(value: StateMoneySnapshot, state: StateCampaignFinanceJurisdiction, version: string): void {
  if (value.formatVersion !== 1 || !Number.isSafeInteger(value.cycle) || value.cycle < 1900 || !Array.isArray(value.records)) {
    throw new Error(`${state} campaign-finance projection ${version} does not satisfy StateMoneySnapshot.`);
  }
  if (value.records.some((record) => record.jurisdiction !== state)) {
    throw new Error(`${state} campaign-finance projection ${version} crosses its jurisdiction scope.`);
  }
}

/**
 * Read and validate exactly one state authority. A corrupt payload is an
 * explicit failure of that state projection; it is never allowed to reject a
 * grouped Promise and suppress the other independent state Readers.
 */
export async function readStateMoneyProjection(
  state: StateCampaignFinanceJurisdiction,
  options: PromotedCivicDataReadOptions = {},
): Promise<StateRead> {
  const contract = STATE_CAMPAIGN_FINANCE_SOURCES[state];
  const result = await readPromotedCivicData<StateMoneySnapshot>("STATE_CAMPAIGN_FINANCE", contract.scope, options);
  if (result.kind !== "PROMOTED") return result;
  if (result.metadata.sourceId !== contract.sourceId) {
    return {
      kind: "PROJECTION_INVALID",
      value: null,
      metadata: result.metadata,
      code: "SOURCE_ID_MISMATCH",
      detail: `${state} campaign-finance pointer names ${result.metadata.sourceId}, not ${contract.sourceId}.`,
    };
  }
  try {
    validateSnapshot(result.value, state, result.metadata.versionId ?? "unknown");
    return result;
  } catch (error) {
    return {
      kind: "PROJECTION_INVALID",
      value: null,
      metadata: result.metadata,
      code: "PROJECTION_CONTRACT_INVALID",
      detail: error instanceof Error ? error.message : `${state} campaign-finance projection validation failed.`,
    };
  }
}

/**
 * Refresh one exact state Reader without opening or replacing any sibling
 * state's authority. A failed requested state is removed from the serving
 * cache and retained as its own explicit read state; every unrelated state
 * keeps the exact projection it already held.
 */
export async function refreshStateMoneyProjectionFromPromoted(
  state: StateCampaignFinanceJurisdiction,
  options: PromotedCivicDataReadOptions = {},
): Promise<StateRead> {
  const result = await readStateMoneyProjection(state, options);
  const held = selectedState();
  const nextCache = new Map(held.cache);
  const nextStates = new Map(held.reads);
  nextStates.set(state, result);
  nextCache.delete(state);
  if (result.kind === "PROMOTED") nextCache.set(state, result.value);
  const selection = currentReaderSelection();
  if (selection) requestStates.set(selection, { cache: nextCache, reads: nextStates });
  else { cache = nextCache; readStates = nextStates; }
  return result;
}

/**
 * One state's money, edge first: the reader edge's proven copy of that
 * state's pointer through this same Reader and validator, else the database
 * as `refreshStateMoneyProjectionFromPromoted`.
 */
export function settleStateMoneyRead(state: StateCampaignFinanceJurisdiction): Promise<StateRead> {
  return readPromotedEdgeFirst(
    "STATE_CAMPAIGN_FINANCE",
    STATE_CAMPAIGN_FINANCE_SOURCES[state].scope,
    (options) => refreshStateMoneyProjectionFromPromoted(state, options),
    `The ${state} campaign money`,
  );
}

/**
 * Every state's money, edge first, each state its own read and failure domain
 * (Ask's preload). Settles like `refreshStateMoneyFromPromoted`: the promoted
 * versions, joined, or null.
 */
export async function settleStateMoneyReads(): Promise<string | null> {
  const states = Object.keys(STATE_CAMPAIGN_FINANCE_SOURCES) as StateCampaignFinanceJurisdiction[];
  const [reads, general] = await Promise.all([
    Promise.allSettled(states.map((state) => settleStateMoneyRead(state))), settleCampaignFinanceReads(),
  ]);
  const versions = reads
    .flatMap((read) => read.status === "fulfilled" && read.value.kind === "PROMOTED" ? [read.value.metadata.versionId] : [])
    .filter((version): version is string => version !== null);
  return [...versions, ...general].length ? [...versions, ...general].join(",") : null;
}

/** Read all independent state pointers; one unavailable state cannot erase another. */
export async function readStateMoneyProjections(
  options: PromotedCivicDataReadOptions = {},
): Promise<ReadonlyMap<StateCampaignFinanceJurisdiction, StateRead>> {
  const entries = await Promise.all(
    (Object.keys(STATE_CAMPAIGN_FINANCE_SOURCES) as StateCampaignFinanceJurisdiction[]).map(async (state) => [
      state,
      await readStateMoneyProjection(state, options),
    ] as const),
  );

  const nextCache = new Map<StateCampaignFinanceJurisdiction, StateMoneySnapshot>();
  const nextStates = new Map<StateCampaignFinanceJurisdiction, StateRead>();
  for (const [state, result] of entries) {
    nextStates.set(state, result);
    if (result.kind === "PROMOTED") nextCache.set(state, result.value);
  }
  const selection = currentReaderSelection();
  if (selection) requestStates.set(selection, { cache: nextCache, reads: nextStates });
  else { cache = nextCache; readStates = nextStates; }
  return new Map(nextStates);
}

/**
 * Request preload for the independent state projections. Failures stay in
 * that state's read state, so one state's defect cannot take another's
 * Reader down; the affected state's selector still fails closed.
 */
export async function refreshStateMoneyFromPromoted(
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  const states = await readStateMoneyProjections(options);
  const versions = [...states.values()]
    .filter((state): state is Extract<StateRead, { kind: "PROMOTED" }> => state.kind === "PROMOTED")
    .map((state) => state.metadata.versionId)
    .filter((version): version is string => version !== null);
  return versions.length ? versions.join(",") : null;
}

export function stateMoneyReadState(state: StateCampaignFinanceJurisdiction): StateRead {
  return selectedState().reads.get(state) ?? civicDataReadNotInitialized("STATE_CAMPAIGN_FINANCE", STATE_CAMPAIGN_FINANCE_SOURCES[state].scope, "This request's campaign records have not been read.");
}

/** The canonical scope of every state read so far. */
export function stateMoneySources(): string[] {
  return [...selectedState().cache.keys()].sort().map((state) => STATE_CAMPAIGN_FINANCE_SOURCES[state].scope);
}

export function stateMoneySourceRecords(states: readonly StateCampaignFinanceJurisdiction[]): StateMoneyRecord[] {
  return states.flatMap(state => selectedState().cache.get(state)?.records ?? []);
}

export interface StateMoneyProofInventory {
  readonly targetKeys: readonly string[];
  readonly readbacks: readonly {
    readonly state: StateCampaignFinanceJurisdiction;
    readonly kind: "PROMOTED";
    readonly recordClass: "STATE_CAMPAIGN_FINANCE";
    readonly scope: string;
    readonly sourceId: string;
    readonly versionId: string;
  }[];
}

/**
 * Documentary proof inventory from the exact promoted state authorities.
 * Unlike `stateMoneySources`, this never exposes or seeds tracked fixtures.
 */
export function stateMoneyProofInventory(): StateMoneyProofInventory {
  const held = selectedState();
  const targetKeys: string[] = [];
  const readbacks: StateMoneyProofInventory["readbacks"][number][] = [];
  const states = (Object.keys(STATE_CAMPAIGN_FINANCE_SOURCES) as StateCampaignFinanceJurisdiction[]).sort();
  for (const state of states) {
    const contract = STATE_CAMPAIGN_FINANCE_SOURCES[state];
    const result = held.reads.get(state);
    if (result?.kind !== "PROMOTED") {
      throw new Error(
        `${state} state campaign-finance Reader proof authority is ${result?.kind ?? "READ_NOT_INITIALIZED"}; ` +
        "call refreshStateMoneyFromPromoted before building proof inventory.",
      );
    }
    if (
      result.metadata.recordClass !== "STATE_CAMPAIGN_FINANCE" ||
      result.metadata.scope !== contract.scope ||
      result.metadata.sourceId !== contract.sourceId
    ) {
      throw new Error(`${state} state campaign-finance Reader proof authority identity does not match its registered contract.`);
    }
    const versionId = result.metadata.versionId;
    if (!versionId) throw new Error(`${state} state campaign-finance Reader proof authority has no promoted version.`);
    const snapshot = held.cache.get(state);
    if (!snapshot) throw new Error(`${state} state campaign-finance promoted Reader proof cache is unavailable.`);
    validateSnapshot(snapshot, state, versionId);
    targetKeys.push(...snapshot.records.flatMap((record) => record.targetKeys));
    readbacks.push({
      state,
      kind: "PROMOTED",
      recordClass: "STATE_CAMPAIGN_FINANCE",
      scope: contract.scope,
      sourceId: contract.sourceId,
      versionId,
    });
  }
  return { targetKeys: [...new Set(targetKeys)].sort(), readbacks };
}

function snapshotForTarget(targetKey: string, hasScopedFiling = false): StateMoneySnapshot | null {
  const state = (/^ballot-([a-z]{2})-/.exec(targetKey)?.[1]?.toUpperCase() ?? /^state-finance:([A-Z]{2}):/.exec(targetKey)?.[1]) as StateCampaignFinanceJurisdiction | undefined;
  if (!state || !Object.hasOwn(STATE_CAMPAIGN_FINANCE_SOURCES, state)) return null;
  const snapshot = selectedState().cache.get(state);
  if (snapshot) return snapshot;
  if (hasScopedFiling) return null;
  const read = selectedState().reads.get(state);
  throw new Error(
    `Canonical state-money holding unavailable for ${state} (${read?.kind ?? "READ_NOT_INITIALIZED"}); ` +
    "call refreshStateMoneyFromPromoted before reading the projection.",
  );
}

export function stateMoneyForTarget(targetKey: string): StateMoneyRecord[] {
  const general = campaignFinanceForTarget(targetKey);
  const snapshot = snapshotForTarget(targetKey, general.length > 0);
  if (!snapshot) return general.map(publicStateMoneyRecord);
  const held = snapshot.records.filter((record) => record.targetKeys.includes(targetKey) && isRenderable(record));
  return [...general, ...held.filter(record => !general.some(current =>
    [current.totals.receipts, current.totals.expenditures, current.totals.cashOnHand].some(amount => amount !== null) &&
    current.committeeId === record.committeeId && current.electionYear === record.electionYear && current.totals.coveringPeriod === record.totals.coveringPeriod))].map(publicStateMoneyRecord);
}

export function stateMoneyWasAsked(targetKey: string): boolean {
  return stateMoneyForTarget(targetKey).length > 0;
}

export function stateMoneySplit(): {
  candidaciesWithFilings: number;
  candidaciesWithRegisteredNoActivity: number;
  candidaciesWithSourcedAbsence: number;
  renderableRecords: number;
  leadsWithheld: number;
  routesUnread: number;
} {
  const all = [...cache.values()].flatMap((snapshot) => snapshot.records);
  const filed = new Set<string>();
  const registered = new Set<string>();
  const absent = new Set<string>();
  for (const record of all) {
    if (record.filingState === "FILED") for (const key of record.targetKeys) filed.add(key);
    else if (record.filingState === "REGISTERED_NO_ACTIVITY_REPORTED") for (const key of record.targetKeys) registered.add(key);
    else if (record.filingState === "NO_REPORTS_ON_FILE") for (const key of record.targetKeys) absent.add(key);
  }
  for (const key of filed) { registered.delete(key); absent.delete(key); }
  for (const key of registered) absent.delete(key);
  return {
    candidaciesWithFilings: filed.size,
    candidaciesWithRegisteredNoActivity: registered.size,
    candidaciesWithSourcedAbsence: absent.size,
    renderableRecords: all.filter(isRenderable).length,
    leadsWithheld: all.filter((record) => record.filingState === "LEAD").length,
    routesUnread: all.filter((record) => record.filingState === "ROUTE_UNREAD").length,
  };
}

/** Test seam. Never called by a render path. */
export function resetStateMoneyCache(): void {
  cache = new Map();
  readStates = new Map(
    (Object.keys(STATE_CAMPAIGN_FINANCE_SOURCES) as StateCampaignFinanceJurisdiction[]).map((state) => [
      state,
      civicDataReadNotInitialized(
        "STATE_CAMPAIGN_FINANCE",
        STATE_CAMPAIGN_FINANCE_SOURCES[state].scope,
        `The ${state} campaign-finance canonical pointer has not been read for this process.`,
      ),
    ]),
  );
}
