import type { VoteSubjectSeat } from "../ask/votes.ts";
import { getVotesSnapshot } from "./snapshot.ts";
import type { VotesSnapshot } from "./types.ts";

/**
 * The vote seat of a federal member no longer on the current roster, derived
 * from their recorded roll-call positions (the chamber is the one that
 * published them). Null when the store holds nothing for the id.
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
