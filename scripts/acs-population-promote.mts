/** Direct Census ACS retrieval/validation/promotion; writes no repository file. */
import { KEY_VAR } from "../lib/sources/census-acs-population/index.ts";
import { acquireNationalAcs } from "../lib/sources/census-acs-population/national.ts";
import { heldAcsJoinTargets } from "../lib/sources/census-acs-population/held-joins.ts";
import { acsTableTooShort } from "../lib/sources/bulk-completeness.ts";
import { censusAcsCandidate } from "../lib/civic-data/candidate-builders.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import {
  isSourceAcquisitionFailure,
  recordRegisteredSourceAcquisitionFailure,
  sourceAcquisitionFailure,
  withPublisherAcquisitionDeadline,
} from "../lib/civic-data/source-acquisition-failure.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";

installNeonRequestDeadline();
prepareProductionCivicDataWrite();

const store = new PostgresRoutineDataStore();

async function main(): Promise<void> {
  const key = process.env[KEY_VAR];
  let candidate: RoutineCandidate;
  try {
    const national = await withPublisherAcquisitionDeadline("Census ACS", ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      signal => acquireNationalAcs({ key, signal, targets: heldAcsJoinTargets }));
    const zcta = national.captures.find(table => table.scope === "zcta")!;
    const state = national.captures.find(table => table.scope === "state")!;
    for (const fetched of [zcta, state]) {
      const short = acsTableTooShort(fetched.scope as "zcta" | "state", fetched.rows.length - 1);
      if (short !== null) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", short);
    }
    candidate = censusAcsCandidate(zcta, state, national);
    console.log(`CENSUS_ACS_ROWS=${JSON.stringify(national.counts)}`);
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
  const outcome = await processRegisteredRoutineCandidate(store, "census-acs-population", candidate, candidate.retrieval.retrievedAt);
  printSourceRunnerReceipt("census-acs-population", candidate, outcome);
  if (!outcome.promoted) process.exitCode = 2;
}

await main();
