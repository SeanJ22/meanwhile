import { measureRecordsForBallot } from "@/lib/ballot/measure-records";
import { readerBallotSourceForTargetId } from "@/lib/ballot/reader-sources";
import { getCandidateTargetIds } from "@/lib/ballot/candidate-targets";
import { getProvisionTargetIds } from "@/lib/ballot/measure-provisions";
import {
  getContributorReactionTargetIds,
  getFundingTargetIds,
  refreshFundingFromPromoted,
} from "@/lib/funding/snapshot";
import { getVoteIds, refreshFederalVotesFromPromoted } from "@/lib/votes/snapshot";
import type { StateCampaignFinanceJurisdiction } from "@/lib/funding/data-plane";
import { settleStateMoneyRead, stateMoneyForTarget } from "@/lib/funding/state-snapshot";
import { FEDERAL_CONTEST, directFundingTargetPlan } from "@/lib/funding/target-authorities";
import type { ReactionTargetType } from "@/lib/signal/reactions";

interface ReactionAuthorityReaders {
  readonly candidateTargets: (targetId: string) => Promise<Set<string>>;
  readonly provisionTargets: (targetId: string) => Set<string> | Promise<Set<string>>;
  readonly refreshFunding: () => Promise<unknown>;
  readonly fundingTargets: () => Set<string>;
  readonly refreshStateMoney: (state: StateCampaignFinanceJurisdiction) => Promise<unknown>;
  readonly stateMoneyTargets: (targetId: string) => Set<string>;
  readonly contributorTargets: () => Set<string>;
  readonly refreshVotes: () => Promise<unknown>;
  readonly voteTargets: () => Set<string>;
}

const reactionAuthorityReaders: ReactionAuthorityReaders = {
  candidateTargets: getCandidateTargetIds,
  provisionTargets: async (targetId) => {
    const authority = await readerBallotSourceForTargetId(targetId);
    if (!authority) return new Set();
    const ballot = authority.source.normalize(await authority.source.fetch());
    return getProvisionTargetIds(measureRecordsForBallot(ballot));
  },
  refreshFunding: refreshFundingFromPromoted,
  fundingTargets: getFundingTargetIds,
  refreshStateMoney: (state) => settleStateMoneyRead(state),
  stateMoneyTargets: (targetId) =>
    stateMoneyForTarget(targetId).some(
      (r) => r.filingState === "FILED" || r.filingState === "REGISTERED_NO_ACTIVITY_REPORTED",
    )
      ? new Set([targetId])
      : new Set(),
  contributorTargets: getContributorReactionTargetIds,
  refreshVotes: refreshFederalVotesFromPromoted,
  voteTargets: getVoteIds,
};

/**
 * Open only the authority named by the validated target class. Intake for a
 * candidate must not depend on FEC or roll-call availability, and the two
 * latter authorities must not become one all-or-nothing preload domain.
 */
export async function validReactionTargetsFor(
  targetType: ReactionTargetType,
  targetId: string,
  readers: ReactionAuthorityReaders = reactionAuthorityReaders,
): Promise<Set<string>> {
  switch (targetType) {
    case "CANDIDATE":
      return readers.candidateTargets(targetId);
    case "MEASURE_PROVISION":
      return readers.provisionTargets(targetId);
    case "FUNDING_TOTAL_REACTION": {
      // A state or local candidacy key (`ballot-xx-...`) is valid when that
      // state's promoted money holds a committee for it; anything else is an
      // FEC candidate id, as before.
      const state = directFundingTargetPlan(targetId).state;
      if (state !== null && !FEDERAL_CONTEST.test(targetId)) {
        await readers.refreshStateMoney(state);
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
