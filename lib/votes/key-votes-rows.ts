import type { KeyVoteEntry } from "./key-votes.ts";
import type { VotePosition } from "./types.ts";
import { getFederalKeyVotesReadModel } from "./key-votes-projection.ts";

/**
 * The chamber rule, in code (B15).
 *
 * **An entry is a QUESTION; each chamber answered it with its own roll
 * calls; a member's card shows only their own chamber's votes.** This is the
 * one place that rule lives, so a card cannot get it wrong by rendering the
 * wrong array — the component is handed rows that are already chamber-
 * correct and has no access to the other chamber's.
 *
 * Rows come only from the initialized canonical key-vote projection. The
 * bundled JSON is an explicit first seed, never a store-error fallback.
 */

export interface KeyVoteRowData {
  entry: KeyVoteEntry;
  refs: KeyVoteEntry["house"];
  positions: (VotePosition | "DID_NOT_VOTE" | null)[];
  /**
   * Whether the roll call itself is in hand, per ref (item 6b, 2026-08-15).
   *
   * With this, a null position has TWO honest sentences instead of one wrong
   * one: "we hold this roll call and this member is not in it" (they were not
   * in the chamber then) and "we have not recorded this roll call yet". The
   * card used to default a null to `DID_NOT_VOTE`, which asserted a fact
   * about a named member that nothing behind it supported.
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
): KeyVoteRowData[] {
  const snapshot = getKeyVotesSnapshot();
  return snapshot.entries.map((entry) => {
    // The member's OWN chamber. The other array is never read here, which
    // is what makes "a House card never shows a Senate-only entry as a
    // vote" a structural property rather than a discipline.
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
