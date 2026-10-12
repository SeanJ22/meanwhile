import {
  officialStateVoteScopeForOfficeholderId,
  type OfficialStateVoteScope,
} from "./authority.ts";

/**
 * Which official state scopes render a legislator's roll-call votes to a reader
 * today, through `/api/votes` → the promoted `STATE_ROLL_CALL` projection. The
 * client-safe gate the official popup uses to decide whether to ask for a
 * member's votes; dependency-free so the reader bundle never pulls the
 * contract registry.
 *
 * New Jersey uses its state projection; New Hampshire reads one native member's
 * positions with the matching roll metadata from the same acquisition. Arizona's
 * official landing-page probe cannot supply a native member vote.
 */
export const READER_VOTE_RENDERABLE_STATE_SCOPES: readonly OfficialStateVoteScope[] = [
  "US-NJ", "US-NH",
];

/** Whether this officeholder id is an official state legislator whose votes render to a reader today. */
export function officialStateVotesRenderToReader(officeholderId: string): boolean {
  if (/^(?:plural:(?:az|nh):[0-9a-f-]{36}|az-legislature:\d+)$/.test(officeholderId)) return true;
  const scope = officialStateVoteScopeForOfficeholderId(officeholderId);
  return scope !== null && READER_VOTE_RENDERABLE_STATE_SCOPES.includes(scope);
}
