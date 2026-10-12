import type { VotePosition } from "./types.ts";
import { getFederalKeyVotesReadModel } from "./key-votes-projection.ts";

/**
 * How each sitting member voted on each key-vote roll call, read from the
 * initialized projection (`pnpm key-votes:positions` writes it).
 *
 * A member absent from a roll call's map means WE HOLD NO POSITION for them —
 * never that they did not vote (they may not have been in that chamber yet).
 */

export interface PositionsFile {
  formatVersion: 1;
  fetchedAt: string;
  positions: Record<string, Record<string, VotePosition>>;
}

function load(): PositionsFile {
  return getFederalKeyVotesReadModel().positions;
}

/** The actual acquisition timestamp of the committed position map. */
export function keyVotePositionsReadAt(): string {
  return load().fetchedAt;
}

export function keyVotePositionKey(
  entryId: string,
  chamber: "house" | "senate",
  congress: number,
  session: number,
  rollNumber: number,
): string {
  return `${entryId}|${chamber}|${congress}-${session}:${rollNumber}`;
}

/**
 * One member's position on one key-vote roll call, or null when we hold none.
 *
 * `null` is a real answer with its own sentence on the card. It is never
 * collapsed into `DID_NOT_VOTE`.
 */
export function keyVotePositionFor(
  key: string,
  officeholderId: string,
): VotePosition | null {
  const file = load();
  return file.positions[key]?.[officeholderId] ?? null;
}

/**
 * Whether a roll call was fetched at all: "this member is not in this roll
 * call" and "we have not fetched this roll call" are different gaps.
 */
export function keyVoteRollCallHeld(key: string): boolean {
  return load().positions[key] !== undefined;
}
