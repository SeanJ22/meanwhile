import { storedKeyEnvironment } from "../lib/core/keys-values.ts";
/** Direct Census ACS retrieval/validation/promotion; writes no repository file. */
import { KEY_VAR } from "../lib/sources/census-acs-population/index.ts";
import { refreshNationalAcs } from "../lib/sources/census-acs-population/refresh.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import {
  isSourceAcquisitionFailure,
  recordRegisteredSourceAcquisitionFailure,
  withPublisherAcquisitionDeadline,
} from "../lib/civic-data/source-acquisition-failure.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { sourceHashReceiptFields } from "../lib/civic-data/source-hash.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";

installNeonRequestDeadline();
prepareProductionCivicDataWrite();

const store = new PostgresRoutineDataStore();

async function main(): Promise<void> {
  const key = storedKeyEnvironment()[KEY_VAR];
  let refreshed:Awaited<ReturnType<typeof refreshNationalAcs>>;
  try {
    refreshed = await withPublisherAcquisitionDeadline("Census ACS", ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      signal => refreshNationalAcs({ key, signal, store }));
  } catch (error) {
    // A missing key stays a configuration failure. Only the source module's
    // narrow publisher/parser brand is permitted to write source state.
    if (!isSourceAcquisitionFailure(error)) throw error;
    const failed = await recordRegisteredSourceAcquisitionFailure({
      store,
      contractId: "census-acs-population",
      failure: error,
    });
    console.log(failed.line);
    process.exitCode = 2;
    return;
  }
  if(refreshed.confirmation){
    console.log("RCD_RECEIPT="+JSON.stringify({source:"census-acs-population",...sourceHashReceiptFields(refreshed.confirmation),structuralReleaseContract:ZERO_RELEASE_EVENTS}));
    return;
  }
  const {candidate,outcome,national}=refreshed.publication!;
  console.log(`CENSUS_ACS_ROWS=${JSON.stringify(national.counts)}`);
  printSourceRunnerReceipt("census-acs-population", candidate, outcome);
  if (!outcome.promoted&&!outcome.confirmed) process.exitCode = 2;
}

await main();
