import { chamberForOfficeholder } from "../registry/server.ts";
import { keyVoteRowsFor, type KeyVoteRowData } from "./key-votes-rows.ts";
import { keyVotePositionFor, keyVotePositionKey, keyVotePositionsReadAt, keyVoteRollCallHeld } from "./key-vote-positions.ts";
import { readFederalKeyVotesProjection } from "./key-votes-projection.ts";

export interface MemberKeyVotes {
  member: string;
  chamber: "house" | "senate" | null;
  rows: KeyVoteRowData[];
  positionsReadAt: string | null;
}

/** Current member/chamber and exact held position — shared by visuals and Ask. */
export async function keyVotesForMember(member: string): Promise<MemberKeyVotes> {
  if (!/^congress:[A-Z]\d{6}$/.test(member)) return { member, chamber: null, rows: [], positionsReadAt: null };
  const read = await readFederalKeyVotesProjection();
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") throw new Error(read.detail);
  const chamber = await chamberForOfficeholder(member);
  if (!chamber) return { member, chamber, rows: [], positionsReadAt: null };
  const rows = keyVoteRowsFor(chamber, ref => {
    const key = keyVotePositionKey(ref.entryId, chamber, ref.congress, ref.session, ref.rollNumber);
    return { position: keyVotePositionFor(key, member), held: keyVoteRollCallHeld(key), breakdown: null };
  });
  return { member, chamber, rows, positionsReadAt: keyVotePositionsReadAt() };
}
