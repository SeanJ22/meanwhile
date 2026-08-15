import { readFileSync } from "node:fs";
import { join } from "node:path";

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
 * The set is derived from the committed ballot data, never from a flag on a
 * contest — a contest becomes uncontested by having one candidate, and it
 * stops being uncontested the moment a second files. Counting the data keeps
 * that automatic.
 *
 * Used by the write path to enforce the value's context: SOMEONE_ELSE is
 * refused for a target in a contested race, because there the answer would
 * be meaningless and the aggregate would be polluted by it.
 */

const BALLOT_FILES = [
  "nj-morris-2026.json",
  "az-pima-2026.json",
  "nh-merrimack-2026.json",
];

interface Candidacy {
  id: string;
  contestId: string;
}

let cache: Set<string> | null = null;

/**
 * Every CANDIDATE target id whose contest carries exactly one candidate.
 *
 * Both id shapes are covered, the same two the target set itself uses: a
 * candidacy id from a ballot file, and a `<contestId>|<name>` nominee key
 * from the certified general lineup.
 */
export function getSingleCandidateTargetIds(): Set<string> {
  if (cache) return cache;

  const ids = new Set<string>();

  for (const file of BALLOT_FILES) {
    const data = JSON.parse(
      readFileSync(join(process.cwd(), "data", "ballot", file), "utf8"),
    ) as { candidacies?: Candidacy[] };
    const byContest = new Map<string, Candidacy[]>();
    for (const c of data.candidacies ?? []) {
      const list = byContest.get(c.contestId) ?? [];
      list.push(c);
      byContest.set(c.contestId, list);
    }
    for (const [, list] of byContest) {
      if (list.length === 1) ids.add(list[0].id);
    }
  }

  const lineup = getGeneralLineup();
  for (const contest of lineup?.contests ?? []) {
    if (contest.nominees.length === 1) {
      ids.add(`${contest.contestId}|${contest.nominees[0].name}`);
    }
  }

  // Deliberately NOT throwing on an empty set, unlike the candidate target
  // set: "no uncontested races on any committed ballot" is a possible and
  // perfectly valid state of the world, and refusing to start over it would
  // be treating a fact as a failure. An empty set simply refuses every
  // SOMEONE_ELSE write, which is the correct behaviour when no race
  // qualifies.
  cache = ids;
  return ids;
}

/** Test seam: the sets are read once per process and cached. */
export function resetUncontestedCache(): void {
  cache = null;
}
