import type { PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import { readVotePages, votePageVault } from "../../state-rollcalls/vote-pages.ts";
import { VOTE_PAGE_PERSON } from "../../state-rollcalls/vote-page-model.ts";
import { readPluralVotesProjection, type PluralVoteFact } from "./votes.ts";

export async function readPluralVotesForPerson(state: string, personId: string, options: PromotedCivicDataReadOptions = {}): Promise<(PluralVoteFact & { position: string })[]> {
  if (typeof personId !== "string" || !VOTE_PAGE_PERSON.test(personId)) return [];
  const read = await readPluralVotesProjection(state, options);
  if (read.kind === "NOT_RECORDED") return [];
  if (read.kind !== "PROMOTED") throw new Error("PLURAL_VOTES_UNAVAILABLE");
  const votes = read.value.formatVersion === 2 ? await readVotePages(votePageVault(options.store), read.value, personId) : read.value.rollCalls;
  return votes.flatMap(vote => {
    const position = vote.positions.find(position => position.personId === personId);
    return position ? [{ ...vote, position: position.option, retrievedAt: position.retrievedAt }] : [];
  }).sort((left, right) => right.date.localeCompare(left.date));
}
