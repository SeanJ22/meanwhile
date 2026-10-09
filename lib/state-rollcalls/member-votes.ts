import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import type { StateLegislatorVotes, StateVotesSnapshot } from "../sources/legiscan/types.ts";

/** One member's complete acquired vote facts can be read before the session fan-out finishes. */
export async function readStateMemberVoteSnapshot(member: string, options: PromotedCivicDataReadOptions = {}): Promise<{
  snapshot: StateVotesSnapshot; versionId: string | null;
} | null> {
  if (!/^nh-general-court:\d+$/.test(member)) return null;
  const read = await readPromotedCivicData<StateLegislatorVotes>("STATE_LEGISLATOR_VOTES", member, options);
  if (read.kind === "NOT_RECORDED") return null;
  if (read.kind !== "PROMOTED") throw new Error("STATE_MEMBER_VOTES_UNAVAILABLE");
  const value = read.value;
  if (read.metadata.sourceId !== "nh-general-court" || value.sourceId !== "nh-general-court" || value.jurisdiction !== "US-NH" ||
      value.officeholderId !== member || !Array.isArray(value.positions) || !Array.isArray(value.rollCalls) || !value.term || !value.session ||
      !value.officialIdentityAuthority || value.officialIdentityAuthority.sessionParticipantSet.term !== value.term ||
      value.officialIdentityAuthority.sessionParticipantSet.session !== value.session) throw new Error("STATE_MEMBER_VOTES_IDENTITY_UNRESOLVED");
  const rolls = new Map(value.rollCalls.map(roll => [roll.id, roll]));
  if (rolls.size !== value.rollCalls.length || new Set(value.positions.map(row => row.rollCallId)).size !== value.positions.length ||
      value.positions.some(position => {
        const roll = rolls.get(position.rollCallId);
        return !roll || roll.sourceId !== value.sourceId || roll.state !== "NH" || roll.term !== value.term || roll.session !== value.session ||
          roll.date !== position.date || !roll.officialRollCallId || position.publisherPosition === undefined;
      })) throw new Error("STATE_MEMBER_VOTES_ROLL_METADATA_UNRESOLVED");
  const snapshot: StateVotesSnapshot = {
    generatedAt: value.generatedAt, officialIdentityAuthority: value.officialIdentityAuthority,
    datasets: [{ state: "NH", sessionId: 0, sessionName: `${value.term} ${value.session}`,
      datasetHash: value.officialIdentityAuthority.sessionParticipantSet.sourceVersion, datasetDate: value.generatedAt,
      downloadedAt: value.generatedAt }],
    identifierMatch: { peopleSeen: 1, peopleMatched: 1, distinctOfficeholders: 1,
      byState: { NH: { peopleSeen: 1, peopleMatched: 1, rollCalls: value.rollCalls.length } } },
    rollCalls: [...value.rollCalls], positions: value.positions.map(row => ({ ...row, officeholderId: member,
      officialPersonId: member.slice("nh-general-court:".length), legiscanPeopleId: 0 })),
  };
  return { snapshot, versionId: read.metadata.versionId };
}
