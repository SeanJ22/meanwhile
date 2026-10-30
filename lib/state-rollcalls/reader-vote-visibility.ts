import { officialStateVoteScopeForOfficeholderId } from "./authority.ts";
import { openStatesPerson } from "../core/ids.ts";
import { PLURAL_STATES } from "../sources/plural/targets.ts";

/** Establish the state boundary before reading a vote holding. */
export function stateVoteStateForMember(member: string, stateHint?: string): string | null {
  const official = officialStateVoteScopeForOfficeholderId(member);
  if (official) return official.slice(3);
  const person = openStatesPerson(member);
  const state = person?.state ?? (person ? stateHint?.replace(/^US-/i, "") : null);
  return state && PLURAL_STATES.includes(state.toLowerCase()) ? state.toUpperCase() : null;
}

/** Whether this officeholder id is an official state legislator whose votes render to a reader today. */
export function officialStateVotesRenderToReader(officeholderId: string, stateHint?: string): boolean {
  return stateVoteStateForMember(officeholderId, stateHint) !== null;
}
