import { CivicDataStoreUnavailableError, readStateRegistryRuntimeProjection, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { readStateAuthorityProjection } from "../civic-data/state-reader.ts";
import type { RegistryRuntimeReadModel } from "./runtime-data-plane.ts";
import { currentReaderAuthorityEdge, reportReaderStateFailure } from "./runtime-edge.ts";
import { combineStateRegistries, withStateRegistryFacts } from "./state-composition.ts";
import { requireRegistryState, stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import { currentRegistryRuntimeContext, enterRegistryRuntimeContext, type RegistryRuntimeContext } from "./runtime-read-model.ts";

/** Publication uses canonical reads; the site can supply its already loaded state answer. */
export async function readRegistryRuntimeProjection(states: readonly string[], options: PromotedCivicDataReadOptions = {}, loadState?: (state: string) => Promise<CivicDataReadResult<RegistryRuntimeReadModel>>): Promise<CivicDataReadResult<RegistryRuntimeReadModel>> {
  const selected = [...new Set(states.map(requireRegistryState))].sort();
  if (!selected.length) throw new Error("REGISTRY_STATES_NOT_SELECTED");
  const existing = currentRegistryRuntimeContext();
  const sameStates = existing && selected.join() === existing.states.join();
  if (!options.store && sameStates && existing.bound) {
    if (existing.read) return existing.read;
    if (existing.pending) return existing.pending;
  }
  const context: RegistryRuntimeContext = sameStates ? existing : { states: selected };
  enterRegistryRuntimeContext(context, existing);
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
