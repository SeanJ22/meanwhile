import type { KeyVoteEntry } from "./key-votes.ts";
import type { VotePosition } from "./types.ts";
import { getFederalKeyVotesReadModel } from "./key-votes-projection.ts";

/**
 * The chamber rule: an entry is a QUESTION, each chamber answered it with its
 * own roll calls, and a member's card shows only their own chamber's votes.
 * The component is handed rows that are already chamber-correct. Rows come
 * only from the initialized canonical key-vote projection.
 */

export interface KeyVoteRowData {
  entry: KeyVoteEntry;
  refs: KeyVoteEntry["house"];
  positions: (VotePosition | "DID_NOT_VOTE" | null)[];
  /**
   * Whether the roll call itself is in hand, per ref, so a null position can
   * say either "this member is not in this roll call" or "we have not recorded
   * this roll call yet" — never `DID_NOT_VOTE`.
   */
  held: boolean[];
  breakdowns: (string | null)[];
  note: string | null;
}

export interface KeyVotesSnapshot {
  formatVersion: 1;
  fetchedAt: string;
  criteria: string;
  entries: KeyVoteEntry[];
  misses: readonly { readonly id: string; readonly chamber: string; readonly reason: string }[];
}

export function getKeyVotesSnapshot(): KeyVotesSnapshot {
  return getFederalKeyVotesReadModel().snapshot;
}

/**
 * The rows for one member. `positionFor` is the caller's lookup into the
 * member-vote data; it returns null when we hold no position for that roll
 * call, which renders as our gap rather than as a claim about the member.
 */
export function keyVoteRowsFor(
  chamber: "house" | "senate",
  positionFor: (ref: {
    /** The entry the ref belongs to — the positions store is keyed on it. */
    entryId: string;
    congress: number;
    session: number;
    rollNumber: number;
  }) => {
    position: VotePosition | "DID_NOT_VOTE" | null;
    held: boolean;
    breakdown: string | null;
  },
  snapshot: KeyVotesSnapshot = getKeyVotesSnapshot(),
): KeyVoteRowData[] {
  return snapshot.entries.map((entry) => {
    // The member's OWN chamber only; the other array is never read here.
    const refs = chamber === "house" ? entry.house : entry.senate;
    const note = chamber === "house" ? entry.houseNote : entry.senateNote;
    const answers = refs.map((ref) =>
      positionFor({
        entryId: entry.id,
        congress: ref.congress,
        session: ref.session,
        rollNumber: ref.rollNumber,
      }),
    );
    return {
      entry,
      refs,
      positions: answers.map((a) => a.position),
      held: answers.map((a) => a.held),
      breakdowns: answers.map((a) => a.breakdown),
      note: note ?? null,
    };
  });
}
