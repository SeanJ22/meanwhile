import type { PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import { readVotePages, votePageVault } from "../../state-rollcalls/vote-pages.ts";
import type { PluralVoteFact } from "../plural/votes.ts";
import { nativePersonId } from "./dataset.ts";
import { readLegiscanVotesProjection } from "./votes.ts";

export async function readLegiscanVotesForPerson(state: string, personId: string, options: PromotedCivicDataReadOptions = {}): Promise<(PluralVoteFact & { position: string })[]> {
  if (!nativePersonId(personId)) return [];
  const read = await readLegiscanVotesProjection(state, options);
  if (read.kind === "NOT_RECORDED") return [];
  if (read.kind !== "PROMOTED") throw new Error("LEGISCAN_VOTES_UNAVAILABLE");
  const votes = read.value.formatVersion === 2 ? await readVotePages(votePageVault(options.store), read.value, personId) : read.value.rollCalls;
  return votes.flatMap(vote => {
    const position = vote.positions.find(position => position.personId === personId);
    return position ? [{ ...vote, position: position.option, retrievedAt: position.retrievedAt }] : [];
  }).sort((a, b) => b.date.localeCompare(a.date));
}
