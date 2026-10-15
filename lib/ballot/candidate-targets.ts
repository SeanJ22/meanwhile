import { readerBallotSourceForTargetId, readerBallotSources, type RegisteredBallotSource } from "./reader-sources.ts";
import { getGeneralLineup } from "./general-lineup.ts";

async function addCandidateTargets(
  ids: Set<string>,
  { state, source }: RegisteredBallotSource,
): Promise<void> {
  const data = source.normalize(await source.fetch());
  for (const candidate of data.candidacies ?? []) ids.add(candidate.id);
  if (state !== "az") return;
  for (const contest of getGeneralLineup()?.contests ?? []) {
    for (const nominee of contest.nominees) {
      ids.add(`${contest.contestId}|${nominee.name}`);
    }
  }
}

export async function getCandidateTargetIds(targetId?: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const exact = targetId === undefined ? null : await readerBallotSourceForTargetId(targetId);
  const sources = targetId === undefined ? await readerBallotSources() : exact ? [exact] : [];
  for (const source of sources) await addCandidateTargets(ids, source);
  if (targetId !== undefined) return ids;
  if (ids.size === 0) {
    throw new Error("candidate target set is empty — refusing to validate against nothing");
  }
  return ids;
}
