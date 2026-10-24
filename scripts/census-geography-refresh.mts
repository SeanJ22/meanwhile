/**
 * Routine acquisition + automatic promotion of the census-geography
 * ZCTA-overlap dataset. The standing runner invokes this on the contract's
 * cadence (see ROUTINE_SOURCE_CONTRACTS). It fetches the Census tab20 files,
 * builds the dataset in memory, and promotes through the authorized routine
 * door. It writes no file — official .gov geography publishes automatically
 * when every validation check passes; a failure records its reason and leaves
 * the last GOOD version live.
 */
import { refreshCensusGeography } from "../lib/census-geography/refresh.ts";
import { CENSUS_GEO_CONTRACT_ID } from "../lib/census-geography/publication.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import {
  isSourceAcquisitionFailure,
  recordRegisteredSourceAcquisitionFailure,
} from "../lib/civic-data/source-acquisition-failure.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

installNeonRequestDeadline();
prepareProductionCivicDataWrite();

const store = new PostgresRoutineDataStore();

async function main(): Promise<void> {
  try {
    const { candidate, outcome } = await refreshCensusGeography(store);
    printSourceRunnerReceipt(CENSUS_GEO_CONTRACT_ID, candidate, outcome);
    if (!outcome.promoted) process.exitCode = 2;
  } catch (error) {
    if (!isSourceAcquisitionFailure(error)) throw error;
    const failed = await recordRegisteredSourceAcquisitionFailure({
      store,
      contractId: CENSUS_GEO_CONTRACT_ID,
      failure: error,
    });
    console.log(failed.line);
    process.exitCode = 2;
    return;
  }
}

await main();
