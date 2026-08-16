import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { KeyVoteEntry } from "./key-votes.ts";
import type { VotePosition } from "./types.ts";

/**
 * The chamber rule, in code (B15).
 *
 * **An entry is a QUESTION; each chamber answered it with its own roll
 * calls; a member's card shows only their own chamber's votes.** This is the
 * one place that rule lives, so a card cannot get it wrong by rendering the
 * wrong array — the component is handed rows that are already chamber-
 * correct and has no access to the other chamber's.
 *
 * The snapshot is committed (`data/votes/key-votes-snapshot.json`, written
 * by `pnpm key-votes:fetch`); nothing fetches per page load.
 */

export interface KeyVoteRowData {
  entry: KeyVoteEntry;
  refs: KeyVoteEntry["house"];
  positions: (VotePosition | "DID_NOT_VOTE" | null)[];
  breakdowns: (string | null)[];
  note: string | null;
}

interface KeyVotesSnapshot {
  formatVersion: 1;
  fetchedAt: string;
  criteria: string;
  entries: KeyVoteEntry[];
  misses: { id: string; chamber: string; reason: string }[];
}

let cache: KeyVotesSnapshot | null = null;

export function getKeyVotesSnapshot(): KeyVotesSnapshot {
  if (!cache) {
    cache = JSON.parse(
      readFileSync(
        join(process.cwd(), "data", "votes", "key-votes-snapshot.json"),
        "utf8",
      ),
    ) as KeyVotesSnapshot;
  }
  return cache;
}

/**
 * The rows for one member. `positionFor` is the caller's lookup into the
 * member-vote data; it returns null when we hold no position for that roll
 * call, which renders as our gap rather than as a claim about the member.
 */
export function keyVoteRowsFor(
  chamber: "house" | "senate",
  positionFor: (
    ref: KeyVoteEntry["house"][number],
  ) => { position: VotePosition | "DID_NOT_VOTE" | null; breakdown: string | null },
): KeyVoteRowData[] {
  const snapshot = getKeyVotesSnapshot();
  return snapshot.entries.map((entry) => {
    // The member's OWN chamber. The other array is never read here, which
    // is what makes "a House card never shows a Senate-only entry as a
    // vote" a structural property rather than a discipline.
    const refs = chamber === "house" ? entry.house : entry.senate;
    const note = chamber === "house" ? entry.houseNote : entry.senateNote;
    const answers = refs.map((ref) => positionFor(ref));
    return {
      entry,
      refs,
      positions: answers.map((a) => a.position),
      breakdowns: answers.map((a) => a.breakdown),
      note: note ?? null,
    };
  });
}
