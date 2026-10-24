import { readerBallotSourceForTargetId, readerBallotSourcesForDivisions, type RegisteredBallotSource } from "./reader-sources.ts";
import { ballotCandidateAliases, ballotCandidatePeople } from "./tickets.ts";

async function addCandidateTargets(
  ids: Set<string>,
  { source }: RegisteredBallotSource,
): Promise<void> {
  const data = source.normalize(await source.fetch());
  for (const candidate of [...data.candidacies, ...data.filingCandidacies ?? []])
    for (const person of ballotCandidatePeople(candidate)) for (const id of ballotCandidateAliases(person)) ids.add(id);
  for (const candidate of data.candidacies) for (const id of ballotCandidateAliases(candidate)) ids.add(id);
  for (const contest of data.generalLineup?.contests ?? []) {
    for (const nominee of contest.nominees) {
      ids.add(`${contest.contestId}|${nominee.name}`);
    }
  }
}

export async function getCandidateTargetIds(divisions: readonly string[], targetId?: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const exact = targetId === undefined ? null : await readerBallotSourceForTargetId(targetId, divisions);
  const sources = targetId === undefined ? await readerBallotSourcesForDivisions(divisions) : exact ? [exact] : [];
  for (const source of sources) await addCandidateTargets(ids, source);
  if (targetId !== undefined) return ids;
  if (ids.size === 0) {
    throw new Error("candidate target set is empty — refusing to validate against nothing");
  }
  return ids;
}
