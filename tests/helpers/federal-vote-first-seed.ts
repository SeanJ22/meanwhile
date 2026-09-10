import { MemoryRoutineDataStore } from "../../lib/civic-data/store.ts";
import { readFederalKeyVotesProjection } from "../../lib/votes/key-votes-projection.ts";
import { readFederalRollCallsProjection } from "../../lib/votes/snapshot.ts";

/**
 * Tests which exercise legacy synchronous selectors must explicitly prove the
 * canonical store answered with no pointer before opening the bundled first
 * seed. Importing a selector never opens tracked runtime truth implicitly.
 */
export async function initializeFederalVoteFirstSeed(): Promise<void> {
  const store = new MemoryRoutineDataStore();
  const [rollCalls, keyVotes] = await Promise.all([
    readFederalRollCallsProjection({ store, bypassCache: true }),
    readFederalKeyVotesProjection({ store, bypassCache: true }),
  ]);
  if (rollCalls.kind !== "BOOTSTRAP") throw new Error(`FEDERAL_ROLL_CALL_TEST_SEED_${rollCalls.kind}`);
  if (keyVotes.kind !== "BOOTSTRAP") throw new Error(`FEDERAL_KEY_VOTE_TEST_SEED_${keyVotes.kind}`);
}
