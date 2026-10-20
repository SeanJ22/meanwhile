import { MemoryRoutineDataStore } from "../../lib/civic-data/store.ts";
import { readFundingSnapshot } from "../../lib/funding/snapshot.ts";

/** Explicit deterministic first-seed install for tests using FEC selectors. */
export async function installFundingFirstSeed(): Promise<void> {
  const result = await readFundingSnapshot({
    store: new MemoryRoutineDataStore(),
    bypassCache: true,
  });
  if (result.kind !== "BOOTSTRAP") {
    throw new Error(`expected FEC funding first seed, received ${result.kind}`);
  }
}
