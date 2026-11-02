import { REGISTRY_STATES, stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import { readCanonicalShelf } from "../reader/canonical.ts";
import { nationalCongress, nationalFederalState } from "../reader/national.ts";
import { refreshFederalDirectoryFromPromoted, refreshRegistryRuntimeFromPromoted } from "../reader/authority-reads.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { readStatePeopleProjection } from "../state-rollcalls/legislators.ts";
import { federalDirectoryScope, type FederalDirectoryReadModel } from "./federal-directory-data-plane.ts";
import { placePortraitsScope } from "./federal-directory-read-model.ts";
import { federalOfficeRecordsForMember } from "./member-offices.ts";
import { statePeopleSourcePointers } from "./people-identity.ts";

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

function memberDirectory(value: FederalDirectoryReadModel, member: string) {
  const state = value.roster.officeholders.find(holder => holder.id === member)?.state;
  const entry = value.directory.byMember[member.slice(9)];
  return entry ? {source: value.directory.source, entry, state,
    offices: federalOfficeRecordsForMember(value, member), committeeJurisdictions: value.directory.committees} : null;
}

/** A federal member's offices and committees. A place hint reads that state's members, held in this server's memory; a missing or wrong hint reads all of Congress, held the same way. */
export async function readCardFederalDirectory(member: string, state?: string) {
  const place = REGISTRY_STATES.find(place => place === state?.replace(/^US-/i, "").toUpperCase());
  if (place) {
    const held = await nationalFederalState(place);
    if (held?.roster.officeholders.some(holder => holder.id === member)) {
      const found = memberDirectory(held, member);
      if (found) return found;
    }
  }
  const { congress, federalByState } = await nationalCongress();
  const heldState = congress.roster.officeholders.find(holder => holder.id === member)?.state;
  const model = heldState ? federalByState.get(heldState.replace(/^US-/i, "").toUpperCase()) ?? congress : congress;
  return memberDirectory(model, member);
}
