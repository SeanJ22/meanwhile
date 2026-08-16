import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { VotePosition } from "./types.ts";

/**
 * How each sitting member voted on each key-vote roll call (item 6b,
 * 2026-08-15). Written by `pnpm key-votes:positions`, committed, read here.
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

interface PositionsFile {
  formatVersion: 1;
  fetchedAt: string;
  positions: Record<string, Record<string, VotePosition>>;
}

let cache: PositionsFile | null = null;

function load(): PositionsFile {
  if (!cache) {
    cache = JSON.parse(
      readFileSync(
        join(process.cwd(), "data", "votes", "key-vote-positions.json"),
        "utf8",
      ),
    ) as PositionsFile;
  }
  return cache;
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
  let file: PositionsFile;
  try {
    file = load();
  } catch {
    // No file is an honest empty state everywhere — the card says the gap is
    // ours, which is exactly what a missing file means.
    return null;
  }
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
  try {
    return load().positions[key] !== undefined;
  } catch {
    return false;
  }
}
