import { ballotStatesForDivisions, readerBallotSourceForTargetId, readerBallotSourcesForDivisions, type RegisteredBallotSource } from "./reader-sources.ts";
import { factReader } from "../facts/db.ts";
import { resolveId } from "../core/resolve.ts";

async function addCandidateTargets(
  ids: Set<string>,
  { source }: RegisteredBallotSource,
): Promise<void> {
  const data = source.normalize(await source.fetch());
  for (const candidate of [...data.candidacies, ...data.filingCandidacies ?? []]) ids.add(candidate.id);
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
  if (targetId !== undefined) {
    // A later ballot can rename a ticket. Its previously accepted reader key still names the same person.
    if (!ids.has(targetId)) {
      const query = factReader();
      if (query) {
        const entityId = await resolveId(targetId, query);
        if (entityId) {
          const [held] = await query(`SELECT 1 FROM entity WHERE id=$1 AND kind IN ('person','candidacy')
            AND (state=ANY($3::text[]) OR state='US' OR state IS NULL) AND (
            EXISTS(SELECT 1 FROM reactions WHERE target_type='CANDIDATE' AND target_id=$2)
            OR EXISTS(SELECT 1 FROM demand_signals WHERE subject_type='CANDIDATE' AND subject_id=$2)
            OR EXISTS(SELECT 1 FROM speak_your_mind WHERE subject_type='CANDIDATE' AND subject_id=$2)
          )`, [entityId, targetId, ballotStatesForDivisions(divisions)]);
          if (held) ids.add(targetId);
        }
      }
    }
    return ids;
  }
  if (ids.size === 0) {
    throw new Error("candidate target set is empty — refusing to validate against nothing");
  }
  return ids;
}
