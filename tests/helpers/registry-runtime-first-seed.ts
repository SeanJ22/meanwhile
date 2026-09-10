import { MemoryRoutineDataStore } from "../../lib/civic-data/store.ts";
import { readCandidateCorpusProjection } from "../../lib/civic-data/manual-read-models.ts";
import { readFundingSnapshot } from "../../lib/funding/snapshot.ts";
import { readFederalDirectoryProjection } from "../../lib/officials/federal-directory-read-model.ts";
import { readOutcomeProjection } from "../../lib/outcomes/store.ts";
import { readRegistryRuntimeProjection } from "../../lib/registry/runtime-read-model.ts";
import { readNjMorrisFiling } from "../../lib/sources/ballot-nj-morris/index.ts";

/** Explicit deterministic first-seed install for tests that call synchronous Reader helpers. */
export async function installRegistryRuntimeFirstSeeds(): Promise<void> {
  const store = new MemoryRoutineDataStore();
  const [federal, registry] = await Promise.all([
    readFederalDirectoryProjection({ store, bypassCache: true }),
    readRegistryRuntimeProjection({ store, bypassCache: true }),
  ]);
  if (federal.kind !== "BOOTSTRAP" || registry.kind !== "BOOTSTRAP") {
    throw new Error(`expected registry first seeds, received ${federal.kind}/${registry.kind}`);
  }
}

/** Explicit deterministic first-seed install for tests using synchronous Morris ballot helpers. */
export async function installNjMorrisFilingFirstSeed(): Promise<void> {
  const result = await readNjMorrisFiling({
    store: new MemoryRoutineDataStore(),
    bypassCache: true,
  });
  if (result.kind !== "BOOTSTRAP") {
    throw new Error(`expected Morris filing first seed, received ${result.kind}`);
  }
}

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

/** Explicit deterministic first-seed install for tests using outcome selectors. */
export async function installOutcomeFirstSeed(): Promise<void> {
  const result = await readOutcomeProjection({
    store: new MemoryRoutineDataStore(),
    bypassCache: true,
  });
  if (result.kind !== "BOOTSTRAP") {
    throw new Error(`expected Pima outcome first seed, received ${result.kind}`);
  }
}

/** Explicit deterministic first-seed install for candidate-publication readers. */
export async function installCandidateCorpusFirstSeed(): Promise<void> {
  const result = await readCandidateCorpusProjection({
    store: new MemoryRoutineDataStore(),
    bypassCache: true,
  });
  if (result.kind !== "BOOTSTRAP") {
    throw new Error(`expected candidate publication first seed, received ${result.kind}`);
  }
}
