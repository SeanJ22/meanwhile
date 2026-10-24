import { AsyncLocalStorage } from "node:async_hooks";
import { CivicDataStoreUnavailableError, civicDataReadNotInitialized, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { readStateAuthorityProjection } from "../civic-data/state-reader.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import type { RegistryRuntimeReadModel } from "./runtime-data-plane.ts";
import type { BodyRoster, RosterReaderDisposition } from "./body-rosters.ts";
import { currentReaderAuthorityEdge, reportReaderStateFailure } from "./runtime-edge.ts";
import { readStateRegistryRuntimeProjection } from "../civic-data/read-model.ts";
import { combineStateRegistries, withStateRegistryFacts } from "./state-composition.ts";
import { requireRegistryState, stateRegistryRuntimeScope, statesForRegistryDivisions } from "../civic-data/state-scopes.ts";

type Context = { states: readonly string[]; read?: CivicDataReadResult<RegistryRuntimeReadModel>; pending?: Promise<CivicDataReadResult<RegistryRuntimeReadModel>> };
const requests = new WeakMap<object, Context>(), jobs = new AsyncLocalStorage<Context>();
const contextKey = () => currentReaderSelection() ?? currentReaderAuthorityEdge();
const current = () => { const key = contextKey(); return key ? requests.get(key) : jobs.getStore(); };

export function selectedRegistryStates(): readonly string[] {
  const selection = currentReaderSelection();
  if (selection?.states) return selection.states.map(requireRegistryState);
  const named = selection ? statesForRegistryDivisions([...selection.keys, ...selection.divisions ?? []]) : [];
  return named.length ? named : current()?.states ?? [];
}

export function withRegistryRuntimeStates<T>(states: readonly string[], read: () => T): T {
  return jobs.run({ states: [...new Set(states.map(requireRegistryState))].sort() }, read);
}

/** Bind an already loaded state package while composing its reader answer. */
export function withRegistryRuntimeProjection<T>(value: RegistryRuntimeReadModel, states: readonly string[], read: () => T): T {
  const selected = [...new Set(states.map(requireRegistryState))].sort();
  const context: Context = { states: selected, read: { kind: "BOOTSTRAP", value,
    metadata: { recordClass: "REGISTRY_RUNTIME_BINDING", scope: selected.map(stateRegistryRuntimeScope).join("|"),
      sourceId: null, version: null, versionId: value.registry.generatedAt, lastKnownGoodVersionId: null,
      sourceThrough: null, retrievedAt: value.registry.generatedAt, promotedAt: null, stale: "UNKNOWN", staleAt: null },
    detail: "The state's current records, loaded together in memory." } };
  const key = contextKey();
  if (key) requests.set(key, context);
  return jobs.run(context, read);
}

/** Publication uses canonical reads; the site can supply its already loaded state answer. */
export async function readRegistryRuntimeProjection(states: readonly string[], options: PromotedCivicDataReadOptions = {}, loadState?: (state: string) => Promise<CivicDataReadResult<RegistryRuntimeReadModel>>): Promise<CivicDataReadResult<RegistryRuntimeReadModel>> {
  const selected = [...new Set(states.map(requireRegistryState))].sort();
  if (!selected.length) throw new Error("REGISTRY_STATES_NOT_SELECTED");
  const key = contextKey(), existing = current();
  const sameStates = existing && selected.join() === existing.states.join();
  if (!options.store && !options.bypassCache && sameStates) {
    if (existing.read) return existing.read;
    if (existing.pending) return existing.pending;
  }
  const context: Context = sameStates ? existing : { states: selected };
  if (key) requests.set(key, context); else if (context !== existing) jobs.enterWith(context);
  const load = async (): Promise<CivicDataReadResult<RegistryRuntimeReadModel>> => {
  const reads = await Promise.all(selected.map(async state => {
    if (loadState) return loadState(state);
    const read = options.store ? await readStateRegistryRuntimeProjection(state, options)
      : (await readStateAuthorityProjection<RegistryRuntimeReadModel>("registry-runtime", state)).result;
    if (read.kind === "PROMOTED" || read.kind === "BOOTSTRAP") {
      const overlay = currentReaderAuthorityEdge()?.stateRegistryFacts;
      const facts = await overlay?.load(state).catch(error => {
        reportReaderStateFailure("state-facts", state, overlay.key?.(state) ?? null, error); return null;
      });
      return { ...read, value: withStateRegistryFacts(read.value, facts?.bodies ?? []) };
    }
    return read;
  }));
  const served = reads.filter(read => read.kind === "PROMOTED" || read.kind === "BOOTSTRAP");
  if (!served.length) context.read = reads[0];
  else if (selected.length === 1) context.read = served[0];
  else context.read = { kind: "BOOTSTRAP", value: combineStateRegistries(served.map(read => read.value)),
    metadata: { ...served[0].metadata, scope: selected.map(stateRegistryRuntimeScope).join("|"),
      versionId: served.map(read => read.metadata.versionId).join("|"), lastKnownGoodVersionId: null },
    detail: `The named states' published registry records.${served.length < reads.length ? " Some requested state records are unavailable." : ""}` };
  return context.read;
  };
  context.pending = load();
  return context.pending;
}

export async function refreshRegistryRuntimeFromPromoted(states: readonly string[], options: PromotedCivicDataReadOptions = {}, loadState?: Parameters<typeof readRegistryRuntimeProjection>[2]): Promise<string | null> {
  const result = await readRegistryRuntimeProjection(states, options, loadState);
  if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
  if (result.kind === "NOT_RECORDED") throw new Error(result.detail);
  return result.metadata.versionId;
}

export function registryRuntimeReadState(): CivicDataReadResult<RegistryRuntimeReadModel> {
  return current()?.read ?? civicDataReadNotInitialized("REGISTRY_RUNTIME_BINDING", selectedRegistryStates().map(stateRegistryRuntimeScope).join("|"),
    "The named states' registry records have not been read in this context.",
  );
}

export function getRegistryRuntimeReadModel(): RegistryRuntimeReadModel {
  const state = registryRuntimeReadState();
  if (state.kind === "PROMOTED" || state.kind === "BOOTSTRAP") return state.value;
  throw new Error(`The requested registry records are ${state.kind}.`);
}

/** The published roster and its identity decisions, without loading card composition. */
export function currentBodyRosters(): readonly BodyRoster[] {
  return getRegistryRuntimeReadModel().bodyRosters;
}

export function currentRosterMemberReaderDisposition(id: string): RosterReaderDisposition | null {
  return getRegistryRuntimeReadModel().rosterReaderDispositions.find(row => row.sourceId === id) ?? null;
}
