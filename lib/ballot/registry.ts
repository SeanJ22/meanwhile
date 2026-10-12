import { ballotNjMorrisSource } from "../sources/ballot-nj-morris/index.ts";
import { curatedBallotSource } from "../sources/ballot-curated/index.ts";
import type { BallotSource } from "./types.ts";

export interface RegisteredBallotSource {
  readonly state: string;
  readonly source: BallotSource;
}

/** Readers narrow this by division or exact target id before opening a source, so one state's failure cannot take down another's ballot. */
export const BALLOT_SOURCES: readonly RegisteredBallotSource[] =
  [
    { state: "nj", source: ballotNjMorrisSource },
    { state: "az", source: curatedBallotSource("ballot-az-pima") },
    { state: "nh", source: curatedBallotSource("ballot-nh-merrimack") },
  ];

export function ballotSourcesForDivisions(
  ocdIds: readonly string[],
): readonly RegisteredBallotSource[] {
  const states = new Set(
    ocdIds.flatMap((id) => /\/state:([a-z]{2})(?:\/|$)/.exec(id)?.[1] ?? []),
  );
  return BALLOT_SOURCES.filter(({ state }) => states.has(state));
}

export function ballotSourceForTargetId(
  targetId: string,
): RegisteredBallotSource | null {
  return BALLOT_SOURCES.find(({ source }) => targetId.startsWith(`${source.name}:`)) ?? null;
}
