import { ballotCandidateAliases, ballotCandidatePeople } from "../ballot/tickets.ts";
import type { BallotSet } from "../ballot/types.ts";
import { directFundingTargetPlan } from "../funding/target-authorities.ts";
import { VOTE_CAST_NONE, voteCastContestPrefix, voteCastTargetId, type ReactionTargetType } from "../signal/reactions.ts";

export interface ReactionAuthorityReaders {
  readonly candidateTargets: (targetId: string) => Promise<Set<string>>;
  readonly voteCastTargets: (targetId: string) => Set<string> | Promise<Set<string>>;
  readonly provisionTargets: (targetId: string) => Set<string> | Promise<Set<string>>;
  readonly refreshFunding: () => Promise<unknown>;
  readonly fundingTargets: () => Set<string>;
  readonly stateMoneyTargets: (targetId: string) => Set<string> | Promise<Set<string>>;
  readonly contributorTargets: () => Set<string>;
  readonly refreshVotes: () => Promise<unknown>;
  readonly voteTargets: () => Set<string>;
}

/**
 * Every answer a reader can give for the contest a vote-cast target names: each of its candidates (under
 * every id the ballot knows them by), Yes and No on a measure or retention question, and "Didn't vote on
 * this". The contest part is taken as the reader's page spelled it, so an earlier contest id still works.
 */
export function voteCastTargetIds(ballot: BallotSet, targetId: string): Set<string> {
  const contestId = voteCastContestPrefix(targetId)?.slice(0, -1);
  const contest = contestId ? ballot.contests.find(row => row.id === contestId || row.aliases?.includes(contestId)) : undefined;
  if (!contestId || !contest) return new Set();
  const contestIds = new Set([contest.id, ...contest.aliases ?? []]);
  const options = new Set<string>([VOTE_CAST_NONE]);
  if (contest.type !== "CANDIDACY") options.add("YES").add("NO");
  for (const candidate of [...ballot.candidacies, ...ballot.filingCandidacies ?? []]) {
    if (!contestIds.has(candidate.contestId)) continue;
    for (const person of ballotCandidatePeople(candidate)) ballotCandidateAliases(person).forEach(id => options.add(id));
    ballotCandidateAliases(candidate).forEach(id => options.add(id));
  }
  for (const nominee of ballot.generalLineup?.contests.find(row => contestIds.has(row.contestId))?.nominees ?? []) {
    options.add(`${contest.id}|${nominee.name}`);
  }
  return new Set([...options].map(option => voteCastTargetId(contestId, option)));
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
    case "VOTE_CAST":
      return readers.voteCastTargets(targetId);
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
