import { scopedValue } from "../scoped-value.ts";
import type { CivicDataReadResult } from "../civic-data/read-model.ts";
import { civicDataReadNotInitialized } from "../civic-data/read-result.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import type { RegistryRuntimeReadModel } from "./runtime-data-plane.ts";
import type { BodyRoster, RosterReaderDisposition } from "./body-rosters.ts";
import type { StatewideExecutive } from "../officials/statewide-executives.ts";
import { selectStatewideExecutives } from "../officials/statewide-selection.ts";
import { currentReaderAuthorityEdge } from "./runtime-edge.ts";
import { requireRegistryState, stateRegistryRuntimeScope, statesForRegistryDivisions } from "../civic-data/state-scopes.ts";
import { withRosterPeople } from "./roster-people.ts";
import { personIdentityKeys } from "../officials/people-identity.ts";

export type RegistryRuntimeContext = { bound?: true; states: readonly string[]; read?: CivicDataReadResult<RegistryRuntimeReadModel>; pending?: Promise<CivicDataReadResult<RegistryRuntimeReadModel>> };
const requests = new WeakMap<object, RegistryRuntimeContext>(), jobs = scopedValue<RegistryRuntimeContext>();
const contextKey = () => currentReaderSelection() ?? currentReaderAuthorityEdge();
export const currentRegistryRuntimeContext = () => { const key = contextKey(); return key ? requests.get(key) : jobs.getStore(); };

/** A read in flight is remembered on the request, or on the running job when there is no request. */
export function enterRegistryRuntimeContext(context: RegistryRuntimeContext, existing: RegistryRuntimeContext | undefined): void {
  const key = contextKey();
  if (key) requests.set(key, context); else if (context !== existing) jobs.enterWith(context);
}

export function selectedRegistryStates(): readonly string[] {
  const selection = currentReaderSelection();
  if (selection?.states) return selection.states.map(requireRegistryState);
  const named = selection ? statesForRegistryDivisions([...selection.keys, ...selection.divisions ?? []]) : [];
  return named.length ? named : currentRegistryRuntimeContext()?.states ?? [];
}

export function withRegistryRuntimeStates<T>(states: readonly string[], read: () => T): T {
  return jobs.run({ states: [...new Set(states.map(requireRegistryState))].sort() }, read);
}

/** Bind an already loaded state package while composing its reader answer. */
export function withRegistryRuntimeProjection<T>(value: RegistryRuntimeReadModel, states: readonly string[], read: () => T): T {
  const selected = [...new Set(states.map(requireRegistryState))].sort();
  const context: RegistryRuntimeContext = { bound: true, states: selected, read: { kind: "BOOTSTRAP", value,
    metadata: { recordClass: "REGISTRY_RUNTIME_BINDING", scope: selected.map(stateRegistryRuntimeScope).join("|"),
      sourceId: null, version: null, versionId: value.registry.generatedAt, lastKnownGoodVersionId: null,
      sourceThrough: null, retrievedAt: value.registry.generatedAt, promotedAt: null, stale: "UNKNOWN", staleAt: null },
    detail: "The state's current records, loaded together in memory." } };
  const key = contextKey();
  if (key) requests.set(key, context);
  return jobs.run(context, read);
}

export function registryRuntimeReadState(): CivicDataReadResult<RegistryRuntimeReadModel> {
  return currentRegistryRuntimeContext()?.read ?? civicDataReadNotInitialized("REGISTRY_RUNTIME_BINDING", selectedRegistryStates().map(stateRegistryRuntimeScope).join("|"),
    "The named states' registry records have not been read in this context.",
  );
}

export function getRegistryRuntimeReadModel(): RegistryRuntimeReadModel {
  const state = registryRuntimeReadState();
  if (state.kind === "PROMOTED" || state.kind === "BOOTSTRAP") return withRosterPeople(state.value);
  throw new Error(`The requested registry records are ${state.kind}.`);
}

/** The published roster and its identity decisions, without loading card composition. */
export function currentBodyRosters(): readonly BodyRoster[] {
  return getRegistryRuntimeReadModel().bodyRosters;
}

const selectedExecutives = new WeakMap<readonly StatewideExecutive[], readonly StatewideExecutive[]>();
export function currentStatewideExecutives(): readonly StatewideExecutive[] {
  const rows = getRegistryRuntimeReadModel().statewideExecutives;
  let selected = selectedExecutives.get(rows);
  if (!selected) { selected = selectStatewideExecutives(rows); selectedExecutives.set(rows, selected); }
  return selected;
}

export function currentRosterMemberReaderDisposition(id: string): RosterReaderDisposition | null {
  return getRegistryRuntimeReadModel().rosterReaderDispositions.find(row => row.sourceId === id) ?? null;
}

const rosterIdentities = new WeakMap<RegistryRuntimeReadModel, ReadonlyMap<string, readonly string[]>>();
export function currentRosterPersonKeys(id: string): readonly string[] {
  const model = getRegistryRuntimeReadModel();
  let index = rosterIdentities.get(model);
  if (!index) {
    const built = new Map<string, readonly string[]>();
    for (const roster of model.bodyRosters) for (const member of [...roster.members, ...roster.membershipHistory ?? []]) {
      const keys = [...personIdentityKeys(member)];
      for (const key of keys) built.set(key, [...new Set([...built.get(key) ?? [], ...keys])]);
    }
    index = built; rosterIdentities.set(model, index);
  }
  return index.get(id) ?? [];
}
