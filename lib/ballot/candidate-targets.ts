import { readerBallotSourceForTargetId } from "./reader-sources.ts";
import {
  BALLOT_SOURCES,
  type RegisteredBallotSource,
} from "./registry.ts";
import { getGeneralLineup } from "./general-lineup.ts";

/**
 * The set of candidate ids a CANDIDATE reaction may target (3d) — every
 * candidacy id in the canonical promoted ballot projections plus every certified-lineup
 * nominee key (`<contestId>|<name>`). The write path checks against this
 * set the way vote reactions check the votes snapshot: the surface only
 * renders the control on real candidates, so anything else is a client bug
 * or a probe, and it fails closed.
 */

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

/**
 * Candidate targets from either every authority (bounded engineering census)
 * or the one authority named by an exact submitted target. Runtime write paths
 * always pass the target, so an unrelated state's pointer is never opened.
 */
export async function getCandidateTargetIds(targetId?: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const exact = targetId === undefined ? null : await readerBallotSourceForTargetId(targetId);
  const sources = targetId === undefined ? BALLOT_SOURCES : exact ? [exact] : [];
  for (const source of sources) await addCandidateTargets(ids, source);
  if (targetId !== undefined) return ids;
  if (ids.size === 0) {
    throw new Error("candidate target set is empty — refusing to validate against nothing");
  }
  return ids;
}
