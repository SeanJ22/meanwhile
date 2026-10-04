import type { VoteSubjectSeat } from "../ask/votes.ts";
import { getVotesSnapshot } from "./snapshot.ts";
import type { VotesSnapshot } from "./types.ts";

/**
 * CA-42 · A person's votes stay with them after they leave.
 *
 * A member who is no longer on the current roster still has recorded roll-call
 * positions in the vote store, keyed by their officeholder id. This derives the
 * seat from that record itself (the chamber is the one that published their
 * roll calls), so a departed federal member resolves the way a sitting one
 * does. It returns null when the store holds nothing for the id; the caller
 * keeps its own honest gap.
 *
 * State legislators already resolve this way in `officialStateVoteSeat`.
 */
export function departedFederalVoteSeat(
  officeholderId: string,
  personName: string,
  snapshot: VotesSnapshot = getVotesSnapshot(),
): VoteSubjectSeat | null {
  const mine = snapshot.positions.filter((row) => row.officeholderId === officeholderId);
  if (mine.length === 0) return null;
  const byId = new Map(snapshot.votes.map((vote) => [vote.id, vote]));
  const rolls = mine.flatMap((row) => {
    const vote = byId.get(row.voteId);
    return vote ? [vote] : [];
  });
  if (rolls.length === 0) return null;
  const chambers = new Set(rolls.map((vote) => vote.chamber));
  const chamber = chambers.size === 1 ? rolls[0].chamber : null;
  const latest = rolls.reduce((a, b) => (a.date >= b.date ? a : b));
  return {
    officeholderId,
    name: personName,
    officeTitle: chamber === "senate" ? "U.S. Senator" : chamber === "house" ? "U.S. Representative" : "Member of Congress",
    rosterScope: "us",
    state: null,
    chamber,
    ocdIds: [],
    sourceUrl: latest.rollCallUrl,
    sourceOrg: chamber === "senate" ? "U.S. Senate" : "U.S. House of Representatives",
    retrievedAt: latest.retrievedAt,
  };
}
