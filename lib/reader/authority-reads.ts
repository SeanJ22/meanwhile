import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { readRegistryRuntimeProjection as readRegistry } from "../registry/runtime-read-model.ts";
import { readFederalDirectoryProjection as readFederal, refreshFederalDirectoryFromPromoted as refreshFederal } from "../officials/federal-directory-read-model.ts";
import { readStateDelegation } from "./state.ts";
import { readCanonicalShelf } from "./canonical.ts";
import { primeReaderCanonicalStore, readerCanonicalEntry } from "./canonical-context.ts";
import { stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";

export { readRegistryRuntimeProjection, refreshRegistryRuntimeFromPromoted } from "../registry/runtime-read-model.ts";

const readsDatabase = (options: PromotedCivicDataReadOptions) => !options.store && !currentReaderAuthorityEdge();

export function readFederalDirectoryProjection(states: readonly string[], options: PromotedCivicDataReadOptions = {}) {
  return readFederal(states, options, readsDatabase(options) ? readStateDelegation : undefined);
}

export function refreshFederalDirectoryFromPromoted(states: readonly string[], options: PromotedCivicDataReadOptions = {}) {
  return refreshFederal(states, options, readsDatabase(options) ? readStateDelegation : undefined);
}

/** Statewide offices use the same canonical shelf and shared read-only socket,
 * without the district, delegation and member-office families they never read. */
export async function readStateRegistryAuthority(states: readonly string[]) {
  if (currentReaderAuthorityEdge()) return readRegistry(states);
  const entries = states.map(state => ({ recordClass: "REGISTRY_RUNTIME_BINDING" as const, scope: stateRegistryRuntimeScope(state) }));
  if (entries.some(entry => !readerCanonicalEntry(entry.recordClass, entry.scope))) {
    await primeReaderCanonicalStore(entries, readCanonicalShelf(entries));
  }
  return readRegistry(states);
}
