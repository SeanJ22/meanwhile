import { readFundingSnapshot } from "../../lib/funding/snapshot-read.ts";
import { MemoryRoutineDataStore } from "../../lib/civic-data/store.ts";


/** Explicit deterministic first-seed install for tests using FEC selectors. */
export async function installFundingFirstSeed(): Promise<void> {
  const result = await readFundingSnapshot({
    store: new MemoryRoutineDataStore(),

  });
  if (result.kind !== "BOOTSTRAP") {
    throw new Error(`expected FEC funding first seed, received ${result.kind}`);
  }
}
