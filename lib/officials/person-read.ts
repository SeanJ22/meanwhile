import { CivicDataStoreUnavailableError, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { statesForRegistryDivisions } from "../civic-data/state-scopes.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { readCanonicalShelf } from "../reader/canonical.ts";
import { readStateRegistryAuthority } from "../reader/authority-reads.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { selectedRegistryStates } from "../registry/runtime-read-model.ts";
import { seatHolderById } from "../registry/server.ts";
import { heldOfficialStateLegislatorsFromRead, readStatePeopleProjection } from "../state-rollcalls/legislators.ts";
import { readStateFederalDirectory } from "./federal-directory-read-model.ts";
import { federalDirectoryScope } from "./federal-directory-data-plane.ts";
import { indexByOfficeholderId, type SeatHolder } from "./lookup.ts";
import { personIdentityKeys, statePeopleScopeForId, statePeopleSourcePointers } from "./people-identity.ts";

const requests = new WeakMap<object, Map<string, Promise<readonly SeatHolder[]>>>();

export type HeldPersonIdentity = Pick<SeatHolder, "id" | "personId" | "nativeIds" | "provenance" | "fieldSources">;

/** Resolve archive identity through held people and their existing source verification. */
export async function readHeldPersonIdentity(id: string, options: PromotedCivicDataReadOptions = {}): Promise<HeldPersonIdentity | null> {
  // Existing edge adapters retain their source and edge-only refusal contracts.
  if (!options.store && currentReaderAuthorityEdge()) return seatHolderById(id);
  const scope = statePeopleScopeForId(id);
  const states = selectedRegistryStates();
  const key = scope ?? (id.startsWith("congress:") ? `congress:${states.join("|")}` : null);
  if (key) {
    const selection = currentReaderSelection();
    const reads = selection && !options.store ? requests.get(selection) ?? new Map<string, Promise<readonly SeatHolder[]>>() : null;
    if (selection && reads) requests.set(selection, reads);
    let pending = reads?.get(key);
    if (!pending) {
      pending = (async (): Promise<readonly SeatHolder[]> => {
        if (scope) {
          const store = options.store ?? await readCanonicalShelf(statePeopleSourcePointers(scope));
          const read = await readStatePeopleProjection(scope, { ...options, store });
          if (read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
          return read.kind === "PROMOTED" || read.kind === "BOOTSTRAP" ? heldOfficialStateLegislatorsFromRead(scope, read).seats : [];
        }
        if (!states.length) return [];
        const store = options.store ?? await readCanonicalShelf(states.map(state => ({ recordClass: "FEDERAL_DIRECTORY" as const, scope: federalDirectoryScope(state) })));
        const reads = await Promise.all(states.map(state => readStateFederalDirectory(state, { ...options, store })));
        const sets = reads.flatMap(read => {
          if (read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
          return read.kind === "PROMOTED" || read.kind === "BOOTSTRAP" ? [read.value.roster] : [];
        });
        return [...new Set(indexByOfficeholderId(sets).values())];
      })();
      reads?.set(key, pending);
    }
    const matches = (await pending).filter(holder => personIdentityKeys(holder).has(id));
    return matches.length === 1 ? matches[0] : null;
  }
  // Registry-only people still use the established resolver, with just their held
  // registry authority supplied rather than a district/delegation/state package.
  const named = statesForRegistryDivisions([id]);
  const statewide = /^statewide:([a-z]{2})\//.exec(id)?.[1]?.toUpperCase();
  const places = named.length ? named : statewide ? [statewide] : states;
  if (!options.store && places.length) {
    await readStateRegistryAuthority(places);
  }
  return seatHolderById(id);
}
