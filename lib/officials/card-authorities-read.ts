import { requiredManualProductionContract } from "../civic-data/manual-contracts.ts";
import { CivicDataStoreUnavailableError, type CivicDataReadStore, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { REGISTRY_STATES, stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import { readCanonicalShelf } from "../reader/canonical.ts";
import { readNationalShelf } from "../reader/national.ts";
import { refreshFederalDirectoryFromPromoted, refreshRegistryRuntimeFromPromoted } from "../reader/authority-reads.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { readStatePeopleProjection } from "../state-rollcalls/legislators.ts";
import { federalDirectoryScope, type FederalDirectoryReadModel } from "./federal-directory-data-plane.ts";
import { placePortraitsScope, readFederalDirectoryProjection, readStateFederalDirectory } from "./federal-directory-read-model.ts";
import { federalOfficeRecordsForMember } from "./member-offices.ts";
import { readMemberOffices } from "./member-offices-read.ts";
import { statePeopleScopeForId, statePeopleSourcePointers } from "./people-identity.ts";

/** Action identity uses the same held rosters and bridge, without unrelated state services. */
export async function readOfficialActionIdentityAuthorities(subject: string, states: readonly string[]): Promise<void> {
  if (currentReaderAuthorityEdge() || !states.length) {
    await refreshRegistryRuntimeFromPromoted(states);
    if (subject.startsWith("congress:") && states.length) await refreshFederalDirectoryFromPromoted(states);
    return;
  }
  const federal = subject.startsWith("congress:") && states.length > 0;
  // This action family reaches Arizona. Other places' verified registry and
  // federal identities cannot acquire an Arizona action through a state roster.
  const peopleStates = states.filter(state => state === "AZ" && !federal && !subject.startsWith("statewide:az/"));
  const store = await readCanonicalShelf(states.flatMap(state => [
    {recordClass: "REGISTRY_RUNTIME_BINDING" as const, scope: stateRegistryRuntimeScope(state)},
    ...peopleStates.includes(state) ? statePeopleSourcePointers(`US-${state}`) : [],
    ...federal ? [{recordClass: "STATE_LEGISLATOR" as const, scope: placePortraitsScope(state)}] : [],
    ...federal ? [{recordClass: "FEDERAL_DIRECTORY" as const, scope: federalDirectoryScope(state)}] : [],
  ]));
  await Promise.all([
    refreshRegistryRuntimeFromPromoted(states, {store}),
    ...peopleStates.map(state => readStatePeopleProjection(`US-${state}`, {store})),
    ...federal ? [refreshFederalDirectoryFromPromoted(states, {store})] : [],
  ]);
}

/** Existing native office matching, source fallback and owner choices receive only their authorities. */
export async function readCardMemberOffices(member: string, state?: string) {
  const scope = statePeopleScopeForId(member, state);
  if (currentReaderAuthorityEdge() || !scope) return readMemberOffices(member, state);
  const people = await readCanonicalShelf(statePeopleSourcePointers(scope));
  const curated = requiredManualProductionContract("member-offices");
  const store: CivicDataReadStore = {...people, readPromotedEntry: async (recordClass, scope) => {
    // The existing reader requests this source only when the native person has
    // no offices. A native record never waits for the national fallback.
    if (recordClass === curated.recordClass && scope === curated.scope) {
      const fallback = await readCanonicalShelf([{recordClass, scope}]);
      return fallback.readPromotedEntry!(recordClass, scope);
    }
    return people.readPromotedEntry!(recordClass, scope);
  }};
  return readMemberOffices(member, state, {store});
}

function memberDirectory(value: FederalDirectoryReadModel, member: string) {
  const state = value.roster.officeholders.find(holder => holder.id === member)?.state;
  const entry = value.directory.byMember[member.slice(9)];
  return entry ? {source: value.directory.source, entry, state,
    offices: federalOfficeRecordsForMember(value, member), committeeJurisdictions: value.directory.committees} : null;
}

/** A place hint saves a national read only after its held directory confirms the exact member. */
export async function readCardFederalDirectory(member: string, state?: string, options: PromotedCivicDataReadOptions = {}) {
  const place = REGISTRY_STATES.find(place => place === state?.replace(/^US-/i, "").toUpperCase());
  if (place) {
    const read = !options.store && currentReaderAuthorityEdge() ? await readFederalDirectoryProjection([place], options)
      : await readStateFederalDirectory(place, {...options, store: options.store ?? await readCanonicalShelf([{recordClass: "FEDERAL_DIRECTORY", scope: federalDirectoryScope(place)}])});
    if (read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
    if ((read.kind === "PROMOTED" || read.kind === "BOOTSTRAP") && read.value.roster.officeholders.some(holder => holder.id === member)) {
      const found = memberDirectory(read.value, member);
      if (found) return found;
    }
  }
  // An absent, invalid or different-place hint cannot change a native member's
  // answer. The established national reader supplies that lookup.
  const shelf = await readNationalShelf();
  const heldState = shelf.congress.roster.officeholders.find(holder => holder.id === member)?.state;
  const model = heldState ? shelf.federalByState.get(heldState.replace(/^US-/i, "").toUpperCase()) ?? shelf.congress : shelf.congress;
  return memberDirectory(model, member);
}
