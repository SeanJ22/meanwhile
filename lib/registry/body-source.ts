import { readPromotedCivicData } from "../civic-data/read-model.ts";
import { stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../civic-data/store.ts";
import { currentReaderAuthorityEdge, ensurePromotedEdge, refuseDatabaseInEdgeOnlyContext } from "./runtime-edge.ts";
import { withStateRegistryFacts } from "./state-composition.ts";
import type { RegistryRuntimeReadModel } from "./runtime-data-plane.ts";
import type { Body } from "./types.ts";

/** A worker binds one governing body; the database returns that row and no state inventory. */
export async function readRegistryRuntimeBody(state: string, bodyId: string,
  store?: Pick<RoutineDataStore, "readRegistrySlice">): Promise<Body | null> {
  const scope = stateRegistryRuntimeScope(state);
  const edge = !store ? await ensurePromotedEdge("REGISTRY_RUNTIME_BINDING", scope) : null;
  if (edge) {
    const read = await readPromotedCivicData<RegistryRuntimeReadModel>("REGISTRY_RUNTIME_BINDING", scope, { edge: edge.value });
    if (read.kind !== "PROMOTED") throw new Error(`AUDIT_REGISTRY_UNAVAILABLE:${state}:${read.kind}`);
    // A reader may already hold its state package and field overlays in memory.
    const facts = await currentReaderAuthorityEdge()?.stateRegistryFacts?.load(state);
    const value = facts ? withStateRegistryFacts(read.value, facts.bodies.filter(body => body.id === bodyId)) : read.value;
    return value.registry.bodies.find(body => body.id === bodyId) ?? null;
  }
  refuseDatabaseInEdgeOnlyContext(`The ${state} governing body`);
  const selected = await (store ?? new PostgresRoutineDataStore()).readRegistrySlice(state, [bodyId], []);
  return selected?.payload.registry.bodies.find(body => body.id === bodyId) ?? null;
}
