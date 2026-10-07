/** Direct Census ACS retrieval/validation/promotion; writes no repository file. */
import { fetch as acsFetch, KEY_VAR } from "../lib/sources/census-acs-population/index.ts";
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
    const [zcta, state] = await withPublisherAcquisitionDeadline(
      "Census ACS",
      ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      async (signal) => {
        const settled = await Promise.allSettled([
          acsFetch("zcta", key, globalThis.fetch, signal),
          acsFetch("state", key, globalThis.fetch, signal),
        ]);
        if (settled[0].status === "rejected") throw settled[0].reason;
        if (settled[1].status === "rejected") throw settled[1].reason;
        return [settled[0].value, settled[1].value] as const;
      },
    );
    // A truncated-but-valid table parses cleanly and would promote a country
    // with almost no ZCTAs; the adapter cannot see completeness from one call.
    for (const fetched of [zcta, state]) {
      const short = acsTableTooShort(fetched.scope, fetched.rows.length - 1);
      if (short !== null) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", short);
    }
    candidate = censusAcsCandidate(zcta, state);
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
