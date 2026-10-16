import { readerBallotSourceForTargetId } from "./reader-sources.ts";
import {
  BALLOT_SOURCES,
  type RegisteredBallotSource,
} from "./registry.ts";
import { getGeneralLineup } from "./general-lineup.ts";

interface Candidacy {
  id: string;
  contestId: string;
}

async function addSingleCandidateTargets(
  ids: Set<string>,
  { state, source }: RegisteredBallotSource,
): Promise<void> {
  const data = source.normalize(await source.fetch());
  const byContest = new Map<string, Candidacy[]>();
  for (const candidate of data.candidacies ?? []) {
    const list = byContest.get(candidate.contestId) ?? [];
    list.push(candidate);
    byContest.set(candidate.contestId, list);
  }
  for (const list of byContest.values()) {
    if (list.length === 1) ids.add(list[0]!.id);
  }

  if (state !== "az") return;
  for (const contest of getGeneralLineup()?.contests ?? []) {
    if (contest.nominees.length === 1) {
      ids.add(`${contest.contestId}|${contest.nominees[0]!.name}`);
    }
  }
}

export async function getSingleCandidateTargetIds(targetId?: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const exact = targetId === undefined ? null : await readerBallotSourceForTargetId(targetId);
  const sources = targetId === undefined ? BALLOT_SOURCES : exact ? [exact] : [];
  for (const source of sources) await addSingleCandidateTargets(ids, source);

  return ids;
}
