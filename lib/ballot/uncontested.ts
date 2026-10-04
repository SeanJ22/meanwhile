import { readerBallotSourceForTargetId } from "./reader-sources.ts";
import {
  BALLOT_SOURCES,
  type RegisteredBallotSource,
} from "./registry.ts";
import { getGeneralLineup } from "./general-lineup.ts";

/**
 * Contests with exactly one candidate, and the target ids belonging to them
 * (M63, 2026-08-15).
 *
 * Why this exists: in a race with one name on the ballot, "would you vote
 * for them?" collects almost nothing. Yes is what the ballot forces, No is
 * ambiguous between disliking the candidate and wanting a choice at all, and
 * the reader who wants somebody else has no way to say so. The author's
 * call: an uncontested race gets a fourth answer, **"Someone else"**, and it
 * is the only honest sentiment measure such a race has.
 *
 * The set is derived from the canonical promoted ballot data, never from a flag on a
 * contest — a contest becomes uncontested by having one candidate, and it
 * stops being uncontested the moment a second files. Counting the data keeps
 * that automatic.
 *
 * Used by the write path to enforce the value's context: SOMEONE_ELSE is
 * refused for a target in a contested race, because there the answer would
 * be meaningless and the aggregate would be polluted by it.
 */

interface Candidacy {
  id: string;
  contestId: string;
}

/**
 * Every CANDIDATE target id whose contest carries exactly one candidate.
 *
 * Both id shapes are covered, the same two the target set itself uses: a
 * candidacy id from a ballot file, and a `<contestId>|<name>` nominee key
 * from the certified general lineup.
 */
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

/**
 * Single-candidate targets from either the bounded all-source census or the
 * one authority named by an exact submitted target. Runtime validation uses
 * the latter and therefore keeps authority failures state-scoped.
 */
export async function getSingleCandidateTargetIds(targetId?: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const exact = targetId === undefined ? null : await readerBallotSourceForTargetId(targetId);
  const sources = targetId === undefined ? BALLOT_SOURCES : exact ? [exact] : [];
  for (const source of sources) await addSingleCandidateTargets(ids, source);

  // Deliberately NOT throwing on an empty set, unlike the candidate target
  // set: "no uncontested races on any committed ballot" is a possible and
  // perfectly valid state of the world, and refusing to start over it would
  // be treating a fact as a failure. An empty set simply refuses every
  // SOMEONE_ELSE write, which is the correct behaviour when no race
  // qualifies.
  return ids;
}
