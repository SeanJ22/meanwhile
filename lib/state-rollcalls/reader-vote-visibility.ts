import {
  officialStateVoteScopeForOfficeholderId,
  type OfficialStateVoteScope,
} from "./authority.ts";

/**
 * Which official state scopes render a legislator's roll-call votes to a reader
 * TODAY, through `/api/votes` → the promoted `STATE_ROLL_CALL` projection. This
 * is the client-safe gate the official popup uses to decide whether to ask for
 * a member's votes at all. It is intentionally dependency-free (no civic-data
 * import) so the reader bundle never pulls the contract registry.
 *
 * A scope belongs here IFF its registered contract is a plain `STATE_ROLL_CALL`
 * contract with no live-acceptance gap and no per-legislator fan-out — i.e. its
 * votes actually reach `stateVotes()` in `app/api/votes/route.ts`.
 *
 * Two official scopes are DELIBERATELY absent, and must NOT be swept into a
 * generic silence — silence would render their absence identically to a
 * legislator who simply has no votes, asserting an absence the product is
 * required to argue (RULING 250/254):
 *
 *   - `US-AZ` — a KNOWN, named source gap. azleg.gov is behind a WAF and no
 *     alternate route has been walked yet; the contract carries the fail-closed
 *     horizon refusal. Its reader-facing argued named gap is a filed follow-up,
 *     NOT silence. Excluding it here keeps AZ recognized-but-unhandled rather
 *     than coding silence as its answer.
 *   - `US-NH` — mid-flight per-legislator fan-out (`STATE_LEGISLATOR_VOTES`).
 *     Its reader join (roll-metadata index + per-member read) is a filed
 *     follow-up; honest silence is correct while that ships.
 *
 * `tests/state-rollcalls-reader-visibility.test.ts` re-derives this exact set
 * from `ROUTINE_SOURCE_CONTRACTS`, so it cannot drift as states are added or
 * migrated: a newly renderable state fails that test until it is listed here —
 * the forcing function that a promoted state is also wired to be asked for.
 */
export const READER_VOTE_RENDERABLE_STATE_SCOPES: readonly OfficialStateVoteScope[] = [
  "US-NJ",
];

/**
 * Whether this officeholder id is an official state legislator whose roll-call
 * votes render to a reader today. `false` for federal/other ids and for the
 * deliberately-excluded scopes above.
 */
export function officialStateVotesRenderToReader(officeholderId: string): boolean {
  const scope = officialStateVoteScopeForOfficeholderId(officeholderId);
  return scope !== null && READER_VOTE_RENDERABLE_STATE_SCOPES.includes(scope);
}
