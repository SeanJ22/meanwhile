import { currentPromotedEdge, ReaderEdgeOnlyRefusal } from "../registry/runtime-edge.ts";
import { FEDERAL_KEY_VOTE_SCOPE } from "./data-plane.ts";
import { chamberForOfficeholder } from "../registry/server.ts";
import { keyVoteRowsFor, type KeyVoteRowData } from "./key-votes-rows.ts";
import { keyVotePositionKey } from "./key-vote-positions.ts";
import { readFederalKeyVoteMemberProjection, readLegacyFederalKeyVoteMember } from "./key-votes-projection.ts";

export interface MemberKeyVotes {
  member: string;
  chamber: "house" | "senate" | null;
  rows: KeyVoteRowData[];
  positionsReadAt: string | null;
}

/** Current member/chamber and exact held position — shared by visuals and Ask. */
export async function keyVotesForMember(member: string): Promise<MemberKeyVotes> {
  if (!/^congress:[A-Z]\d{6}$/.test(member)) return { member, chamber: null, rows: [], positionsReadAt: null };
  const read = await readFederalKeyVoteMemberProjection(member).catch(error=>{
    if(error instanceof ReaderEdgeOnlyRefusal && currentPromotedEdge("FEDERAL_KEY_VOTE",FEDERAL_KEY_VOTE_SCOPE)) return null;
    throw error;
  });
  if(read?.kind==="STORE_UNREACHABLE") throw new Error(read.detail);
  const value=read?.kind==="PROMOTED"||read?.kind==="BOOTSTRAP" ? read.value : await readLegacyFederalKeyVoteMember(member);
  if(!value) throw new Error(read?.kind==="NOT_RECORDED" ? read.detail : "Federal key-vote positions unavailable");
  const chamber = await chamberForOfficeholder(member);
  if (!chamber) return { member, chamber, rows: [], positionsReadAt: null };
  const rows = keyVoteRowsFor(chamber, ref => {
    const key = keyVotePositionKey(ref.entryId, chamber, ref.congress, ref.session, ref.rollNumber);
    return { position: value.positions.positions[key]?.[member] ?? null, held: value.positions.positions[key] !== undefined, breakdown: null };
  },value.snapshot);
  return { member, chamber, rows, positionsReadAt: value.positions.fetchedAt };
}
