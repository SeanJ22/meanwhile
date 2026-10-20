/** One state's Census relationships, acquired and published independently. */
import { pathToFileURL } from "node:url";
import { acquireDataset, type AcquireOptions } from "../lib/census-geography/acquire.ts";
import { censusGeographyCandidate } from "../lib/census-geography/candidate.ts";
import { censusGeographyContractId, censusGeographyState, CENSUS_GEO_SOURCE_ROUTE } from "../lib/census-geography/publication.ts";
import { readCensusStateDataset } from "../lib/census-geography/state-read.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { isSourceAcquisitionFailure, recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure,
  withPublisherAcquisitionDeadline } from "../lib/civic-data/source-acquisition-failure.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";

/** The read-only measurement harness uses the same acquisition and prior read. */
export async function acquireStateGeography(state: string, options: AcquireOptions = {},
  readPrior: (state: string) => Promise<BuiltDataset | null> = readCensusStateDataset): Promise<BuiltDataset> {
  const selected = censusGeographyState(state);
  const dataset = await acquireDataset({ ...options, states: new Set([selected.fips]),
    previousDataset: await readPrior(selected.state) ?? undefined, discoverPlans: true });
  if (!dataset.scopes.length || !dataset.scopes.some(s => s.zctaEdgeCount > 0) ||
    dataset.scopes.some(s => s.versionMeta.retrievalComplete === false)) {
    throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `Census geography is incomplete for ${selected.state}.`);
  }
  return dataset;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2), stateArg = args.find(arg => arg.startsWith("--state="));
  if (args.length !== 1 || !stateArg) throw new Error("CENSUS_GEOGRAPHY_EXACT_STATE_REQUIRED");
  const { state } = censusGeographyState(stateArg.slice(8)), contractId = censusGeographyContractId(state);
  installNeonRequestDeadline(); prepareProductionCivicDataWrite();
  const store = new PostgresRoutineDataStore();
  let candidate: RoutineCandidate;
  try {
    const dataset = await withPublisherAcquisitionDeadline(`Census geography ${state}`, ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      signal => acquireStateGeography(state, { signal }));
    candidate = censusGeographyCandidate(dataset, state);
  } catch (error) {
    if (!isSourceAcquisitionFailure(error)) throw error;
    console.error(`Census geography ${state}: ${error.code}: ${error.message}`);
    console.log((await recordRegisteredSourceAcquisitionFailure({ store, contractId, failure: error, requestedUrl: CENSUS_GEO_SOURCE_ROUTE })).line);
    process.exitCode = 2; return;
  }
  const outcome = await processRegisteredRoutineCandidate(store, contractId, candidate, candidate.retrieval.retrievedAt);
  printSourceRunnerReceipt(contractId, candidate, outcome);
  if (!outcome.promoted && !outcome.confirmed) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
