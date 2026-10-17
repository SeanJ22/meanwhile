import { readerBallotSourceForTargetId, readerBallotSourcesForDivisions, type RegisteredBallotSource } from "./reader-sources.ts";

interface Candidacy {
  id: string;
  contestId: string;
}

async function addSingleCandidateTargets(
  ids: Set<string>,
  { source }: RegisteredBallotSource,
): Promise<void> {
  const data = source.normalize(await source.fetch());
  const byContest = new Map<string, Candidacy[]>();
  for (const candidate of data.candidacies ?? []) {
    const list = byContest.get(candidate.contestId) ?? [];
    list.push(candidate);
    byContest.set(candidate.contestId, list);
  }
  const complete = new Set(data.contests.filter(contest => contest.candidateListComplete).map(contest => contest.id));
  for (const [contestId, list] of byContest) {
    if (complete.has(contestId) && list.length === 1) ids.add(list[0]!.id);
  }

  for (const contest of data.generalLineup?.contests ?? []) {
    if (contest.nominees.length === 1) {
      ids.add(`${contest.contestId}|${contest.nominees[0]!.name}`);
    }
  }
}

export async function getSingleCandidateTargetIds(divisions: readonly string[], targetId?: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const exact = targetId === undefined ? null : await readerBallotSourceForTargetId(targetId, divisions);
  const sources = targetId === undefined ? await readerBallotSourcesForDivisions(divisions) : exact ? [exact] : [];
  for (const source of sources) await addSingleCandidateTargets(ids, source);

  return ids;
}
