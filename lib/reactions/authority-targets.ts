import { directFundingTargetPlan } from "../funding/target-authorities.ts";
import type { ReactionTargetType } from "../signal/reactions.ts";

export interface ReactionAuthorityReaders {
  readonly candidateTargets: (targetId: string) => Promise<Set<string>>;
  readonly provisionTargets: (targetId: string) => Set<string> | Promise<Set<string>>;
  readonly refreshFunding: () => Promise<unknown>;
  readonly fundingTargets: () => Set<string>;
  readonly stateMoneyTargets: (targetId: string) => Set<string> | Promise<Set<string>>;
  readonly contributorTargets: () => Set<string>;
  readonly refreshVotes: () => Promise<unknown>;
  readonly voteTargets: () => Set<string>;
}

export async function validReactionTargetsFor(
  targetType: ReactionTargetType,
  targetId: string,
  readers: ReactionAuthorityReaders,
): Promise<Set<string>> {
  switch (targetType) {
    case "CANDIDATE":
      return readers.candidateTargets(targetId);
    case "MEASURE_PROVISION":
      return readers.provisionTargets(targetId);
    case "FUNDING_TOTAL_REACTION": {
      if (!directFundingTargetPlan(targetId).federal) {
        return readers.stateMoneyTargets(targetId);
      }
      await readers.refreshFunding();
      return readers.fundingTargets();
    }
    case "CONTRIBUTOR_REACTION":
      await readers.refreshFunding();
      return readers.contributorTargets();
    case "FEDERAL_VOTE":
      await readers.refreshVotes();
      return readers.voteTargets();
  }
}
