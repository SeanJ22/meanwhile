import { ballotNjMorrisSource } from "../sources/ballot-nj-morris/index.ts";
import { curatedBallotSource } from "../sources/ballot-curated/index.ts";
import type { BallotSource } from "./types.ts";

export interface RegisteredBallotSource {
  readonly state: string;
  readonly source: BallotSource;
}

/**
 * Every ballot source, by state. `lib/ballot/covered-states.ts` mirrors this
 * list for the client bundle; `tests/ballot.test.ts` asserts the two agree so
 * they cannot drift.
 *
 * A Reader must narrow this registry from the requested OCD divisions or
 * exact target id before it opens a source. Iterating the whole registry makes
 * an unavailable authority in one state capable of taking down a different
 * state's ballot, questionnaire, or intake validation.
 */
export const BALLOT_SOURCES: readonly RegisteredBallotSource[] =
  [
    { state: "nj", source: ballotNjMorrisSource },
    // The file each name reads is an explicit named read in
    // `lib/sources/ballot-curated/index.ts` — R23. A path passed through here
    // was a path Turbopack could not trace, and it traced the whole project.
    { state: "az", source: curatedBallotSource("ballot-az-pima") },
    { state: "nh", source: curatedBallotSource("ballot-nh-merrimack") },
  ];

/** Exact state authorities applicable to the Reader's resolved divisions. */
export function ballotSourcesForDivisions(
  ocdIds: readonly string[],
): readonly RegisteredBallotSource[] {
  const states = new Set(
    ocdIds.flatMap((id) => /\/state:([a-z]{2})(?:\/|$)/.exec(id)?.[1] ?? []),
  );
  return BALLOT_SOURCES.filter(({ state }) => states.has(state));
}

/**
 * The one authority that can own an exact ballot target. Unknown prefixes do
 * not open any source; the write path can reject them as unknown without
 * making an unrelated production-store read.
 */
export function ballotSourceForTargetId(
  targetId: string,
): RegisteredBallotSource | null {
  return BALLOT_SOURCES.find(({ source }) => targetId.startsWith(`${source.name}:`)) ?? null;
}
