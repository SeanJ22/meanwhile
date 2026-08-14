import { ballotNjMorrisSource } from "../sources/ballot-nj-morris/index.ts";
import { curatedBallotSource } from "../sources/ballot-curated/index.ts";
import type { BallotSource } from "./types.ts";

/**
 * Every ballot source, by state. The ballot page resolves a zip to its
 * divisions and asks each source; a source whose contests match none of the
 * point's divisions contributes nothing, so looping all of them is safe and
 * a reader near a state line gets whichever state actually contains them.
 *
 * `lib/ballot/covered-states.ts` mirrors this list for the client bundle;
 * `tests/ballot.test.ts` asserts the two agree so they cannot drift.
 */
export const BALLOT_SOURCES: readonly { state: string; source: BallotSource }[] =
  [
    { state: "nj", source: ballotNjMorrisSource },
    {
      state: "az",
      source: curatedBallotSource("ballot-az-pima", "data/ballot/az-pima-2026.json"),
    },
    {
      state: "nh",
      source: curatedBallotSource(
        "ballot-nh-merrimack",
        "data/ballot/nh-merrimack-2026.json",
      ),
    },
  ];
