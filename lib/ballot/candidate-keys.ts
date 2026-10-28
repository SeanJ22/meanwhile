import type {BallotSet,Contest} from "./types.ts";
import {lineupForContest} from "./general-lineup.ts";
import {reconciledCandidacyIdForCard} from "../identity/az-2026.ts";
import {ballotCandidateAliases,ballotCandidatePeople} from "./tickets.ts";
/** Every card key and its held Arizona alias, including earlier filing candidacies. */
export function ballotCandidateKeys(set: BallotSet, contests: readonly Pick<Contest,"id">[]): string[] {
  const ids = new Set(contests.map(contest=>contest.id));
  const keys = new Set([...set.candidacies,...set.filingCandidacies ?? []].filter(candidate=>ids.has(candidate.contestId))
    .flatMap(candidate => [...ballotCandidateAliases(candidate), ...ballotCandidatePeople(candidate).flatMap(ballotCandidateAliases)]));
  for (const contest of contests) {
    const lineup = lineupForContest(set.election.state,contest.id) ?? set.generalLineup?.contests.find(row=>row.contestId===contest.id);
    for (const nominee of lineup?.nominees ?? []) {
      const key = `${contest.id}|${nominee.name}`;
      keys.add(key);
      if (set.election.state === "AZ") {
        const canonical = reconciledCandidacyIdForCard(key);
        if (canonical) keys.add(canonical);
      }
    }
  }
  return [...keys];
}

