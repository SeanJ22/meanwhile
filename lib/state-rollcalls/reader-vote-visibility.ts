import { officialStateVoteScopeForOfficeholderId } from "./authority.ts";
import { PLURAL_STATES } from "../sources/plural/targets.ts";

/**
 * Which state scopes can render a legislator's roll-call votes to a reader
 * through `/api/votes` → the promoted `STATE_ROLL_CALL` projection. The
 * client-safe gate the official popup uses to decide whether to ask for a
 * member's votes; dependency-free so the reader bundle never pulls the
 * contract registry.
 *
 * Each state reads its national source holdings and any linked official source.
 */
export const READER_VOTE_RENDERABLE_STATE_SCOPES: readonly string[] = PLURAL_STATES.map(state => `US-${state.toUpperCase()}`);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Establish the state boundary before reading a vote holding. */
export function stateVoteStateForMember(member: string, stateHint?: string): string | null {
  const official = officialStateVoteScopeForOfficeholderId(member);
  if (official) return official.slice(3);
  const nativeState = new RegExp(`^plural:([a-z]{2}):${UUID}$`, "i").exec(member)?.[1];
  const globalPerson = new RegExp(`^(?:ocd-person/|plural:)${UUID}$`, "i").test(member);
  const state = nativeState ?? (globalPerson ? stateHint?.replace(/^US-/i, "") : null);
  return state && PLURAL_STATES.includes(state.toLowerCase()) ? state.toUpperCase() : null;
}

/** Whether this officeholder id is an official state legislator whose votes render to a reader today. */
export function officialStateVotesRenderToReader(officeholderId: string, stateHint?: string): boolean {
  return stateVoteStateForMember(officeholderId, stateHint) !== null;
}
