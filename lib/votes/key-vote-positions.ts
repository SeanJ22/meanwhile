import type { VotePosition } from "./types.ts";
import { getFederalKeyVotesReadModel } from "./key-votes-projection.ts";

/**
 * How each sitting member voted on each key-vote roll call (item 6b,
 * 2026-08-15). `pnpm key-votes:positions` writes these facts to
 * the canonical data plane; this module reads the initialized projection.
 *
 * **A member absent from a roll call's map means WE HOLD NO POSITION for
 * them — never that they did not vote.** The distinction is the whole point
 * of this file existing: the card component was already written to render a
 * position and, with nothing to render, fell through to "Did not vote", which
 * is a false and checkable claim about a named person. Two very common
 * reasons a sitting member is absent from a 2021 roll call are that they were
 * not in Congress yet and that they were not in that chamber — neither of
 * which is "did not vote", and both of which a card must be able to say.
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
 * Whether a roll call was fetched at all.
 *
 * Distinguishes "we have this roll call and this member is not in it" from
 * "we have not fetched this roll call". Both render as our gap, but they are
 * different gaps and a report should be able to tell them apart.
 */
export function keyVoteRollCallHeld(key: string): boolean {
  return load().positions[key] !== undefined;
}
