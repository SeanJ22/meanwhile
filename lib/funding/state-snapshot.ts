import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  civicDataReadNotInitialized,
  mayUseTestFixture,
  readPromotedCivicData,
  type CivicDataReadMetadata,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import {
  STATE_CAMPAIGN_FINANCE_SOURCES,
  type StateCampaignFinanceJurisdiction,
} from "./data-plane.ts";
import { isRenderable } from "./state-money-reader.ts";
import { readPromotedEdgeFirst } from "../registry/runtime-edge.ts";
import type { StateMoneyRecord, StateMoneySnapshot } from "./state-money.ts";

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
let readStates = new Map<StateCampaignFinanceJurisdiction, StateRead>();

function validateSnapshot(value: StateMoneySnapshot, state: StateCampaignFinanceJurisdiction, version: string): void {
  if (value.formatVersion !== 1 || value.cycle !== STATE_CAMPAIGN_FINANCE_SOURCES[state].cycle || !Array.isArray(value.records)) {
    throw new Error(`${state} campaign-finance projection ${version} does not satisfy StateMoneySnapshot.`);
  }
  if (value.records.some((record) => record.jurisdiction !== state)) {
    throw new Error(`${state} campaign-finance projection ${version} crosses its jurisdiction scope.`);
  }
}

function testFixture(state: StateCampaignFinanceJurisdiction): StateMoneySnapshot {
  if (!mayUseTestFixture()) throw new Error("Bundled state-money fixtures are available only to deterministic tests.");
  const path = join(/* turbopackIgnore: true */ process.cwd(), "data", "states", state.toLowerCase(), "funding", `state-money-${state.toLowerCase()}-${STATE_CAMPAIGN_FINANCE_SOURCES[state].cycle}.json`);
  const value = JSON.parse(readFileSync(path, "utf8")) as StateMoneySnapshot;
  validateSnapshot(value, state, "bundled test fixture");
  return value;
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
  const nextCache = new Map(cache);
  const nextStates = new Map(readStates);
  nextStates.set(state, result);
  nextCache.delete(state);
  if (result.kind === "PROMOTED") nextCache.set(state, result.value);
  else if (mayUseTestFixture() && (
    result.kind === "NOT_RECORDED" ||
    (result.kind === "STORE_UNREACHABLE" && result.code === "STORE_NOT_CONFIGURED")
  )) {
    try { nextCache.set(state, testFixture(state)); } catch { /* an absent test fixture supplies no holding */ }
  }
  cache = nextCache;
  readStates = nextStates;
  return result;
}

/**
 * One state's money, edge first (2026-09-25): the reader edge's proven copy of
 * that state's pointer through this same Reader and validator, else the
 * database exactly as `refreshStateMoneyProjectionFromPromoted`.
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
 * Requested states' money, edge first, each state its own read and failure
 * domain. Returns their promoted versions, joined, or null.
 */
export async function settleStateMoneyReads(states: readonly StateCampaignFinanceJurisdiction[] = []): Promise<string | null> {
  const reads = await Promise.allSettled(states.map((state) => settleStateMoneyRead(state)));
  const versions = reads
    .flatMap((read) => read.status === "fulfilled" && read.value.kind === "PROMOTED" ? [read.value.metadata.versionId] : [])
    .filter((version): version is string => version !== null);
  return versions.length ? versions.join(",") : null;
}

/** Read only selected state pointers; no country refresh or unrelated cache replacement. */
export async function readStateMoneyProjections(
  states: readonly StateCampaignFinanceJurisdiction[],
  options: PromotedCivicDataReadOptions = {},
): Promise<ReadonlyMap<StateCampaignFinanceJurisdiction, StateRead>> {
  const entries = await Promise.all(
    [...new Set(states)].map(async (state) => [
      state,
      await readStateMoneyProjection(state, options),
    ] as const),
  );

  const nextCache = new Map(cache);
  const nextStates = new Map(readStates);
  for (const [state, result] of entries) {
    nextStates.set(state, result);
    nextCache.delete(state);
    if (result.kind === "PROMOTED") nextCache.set(state, result.value);
    else if (mayUseTestFixture() && (
      result.kind === "NOT_RECORDED" ||
      (result.kind === "STORE_UNREACHABLE" && result.code === "STORE_NOT_CONFIGURED")
    )) {
      try { nextCache.set(state, testFixture(state)); } catch { /* an absent test fixture supplies no holding */ }
    }
  }
  cache = nextCache;
  readStates = nextStates;
  return new Map(entries);
}

/**
 * Request preload for the independent state projections. Failures stay in the
 * exact state's read state, so one publisher or projection defect cannot
 * take another state's Reader down. The affected state's synchronous
 * selector still fails closed instead of manufacturing an empty answer.
 */
export async function refreshStateMoneyFromPromoted(
  selected: readonly StateCampaignFinanceJurisdiction[],
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  const states = await readStateMoneyProjections(selected, options);
  const versions = [...states.values()]
    .filter((state): state is Extract<StateRead, { kind: "PROMOTED" }> => state.kind === "PROMOTED")
    .map((state) => state.metadata.versionId)
    .filter((version): version is string => version !== null);
  return versions.length ? versions.join(",") : null;
}

function ensureTestFixtures(state: StateCampaignFinanceJurisdiction): void {
  if (!mayUseTestFixture() || cache.has(state)) return;
  const outcome = stateMoneyReadState(state);
  const maySeed = outcome.kind === "NOT_RECORDED" || (
    outcome.kind === "STORE_UNREACHABLE" &&
    (outcome.code === "STORE_NOT_CONFIGURED" || outcome.code === "READ_NOT_INITIALIZED")
  );
  if (!maySeed) return;
  try { cache.set(state, testFixture(state)); } catch { /* an absent fixture stays unavailable */ }
}

export function stateMoneyReadState(state: StateCampaignFinanceJurisdiction): StateRead {
  return readStates.get(state) ?? civicDataReadNotInitialized("STATE_CAMPAIGN_FINANCE", STATE_CAMPAIGN_FINANCE_SOURCES[state].scope,
    `The ${state} campaign-finance canonical pointer has not been read for this process.`);
}

/** Compatibility inventory: canonical scopes in production, fixture names in tests. */
export function stateMoneySources(): string[] {
  return [...cache.keys()].sort().map((state) =>
    mayUseTestFixture() ? `state-money-${state.toLowerCase()}-${STATE_CAMPAIGN_FINANCE_SOURCES[state].cycle}.json` : STATE_CAMPAIGN_FINANCE_SOURCES[state].scope,
  );
}

function snapshotForTarget(targetKey: string): StateMoneySnapshot | null {
  const state = /^ballot-([a-z]{2})-/.exec(targetKey)?.[1]?.toUpperCase() as StateCampaignFinanceJurisdiction | undefined;
  if (!state || !Object.hasOwn(STATE_CAMPAIGN_FINANCE_SOURCES, state)) return null;
  ensureTestFixtures(state);
  const snapshot = cache.get(state);
  if (snapshot) return snapshot;
  const read = readStates.get(state);
  throw new Error(
    `Canonical state-money holding unavailable for ${state} (${read?.kind ?? "READ_NOT_INITIALIZED"}); ` +
    "call refreshStateMoneyFromPromoted before reading the projection.",
  );
}

export function stateMoneyForTarget(targetKey: string): StateMoneyRecord[] {
  const snapshot = snapshotForTarget(targetKey);
  if (!snapshot) return [];
  return snapshot.records.filter((record) => record.targetKeys.includes(targetKey) && isRenderable(record));
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
  readStates = new Map();
}
