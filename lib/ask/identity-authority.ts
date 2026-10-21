import { readCanonicalShelf } from "../reader/canonical.ts";
import { primeReaderCanonicalStore } from "../reader/canonical-context.ts";
import { stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import { federalDirectoryScope } from "../officials/federal-directory-data-plane.ts";
import { readFederalDirectoryProjection } from "../officials/federal-directory-read-model.ts";
import { readRegistryRuntimeProjection } from "../registry/runtime-read-model.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";

/** Office and ballot identity joins use the registry and current delegation, in one shelf read. */
export async function readAskIdentityAuthority(states: readonly string[]) {
  if (currentReaderAuthorityEdge()) {
    const [registry] = await Promise.all([readRegistryRuntimeProjection(states), readFederalDirectoryProjection(states)]);
    return registry;
  }
  const entries = states.flatMap(state => [
    { recordClass: "REGISTRY_RUNTIME_BINDING" as const, scope: stateRegistryRuntimeScope(state) },
    { recordClass: "FEDERAL_DIRECTORY" as const, scope: federalDirectoryScope(state) },
  ]);
  const store = await readCanonicalShelf(entries);
  await primeReaderCanonicalStore(entries, store);
  const [registry] = await Promise.all([
    readRegistryRuntimeProjection(states, { store }),
    readFederalDirectoryProjection(states, { store }),
  ]);
  return registry;
}
