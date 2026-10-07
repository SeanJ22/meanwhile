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
 * A scope belongs here only if its contract is a plain `STATE_ROLL_CALL`
 * contract with no live-acceptance gap and no per-legislator fan-out. US-AZ
 * (a named source gap with a fail-closed horizon refusal) and US-NH (a
 * per-legislator fan-out without a reader join yet) are deliberately absent.
 */
export const READER_VOTE_RENDERABLE_STATE_SCOPES: readonly OfficialStateVoteScope[] = [
  "US-NJ",
];

/** Whether this officeholder id is an official state legislator whose votes render to a reader today. */
export function officialStateVotesRenderToReader(officeholderId: string): boolean {
  const scope = officialStateVoteScopeForOfficeholderId(officeholderId);
  return scope !== null && READER_VOTE_RENDERABLE_STATE_SCOPES.includes(scope);
}
