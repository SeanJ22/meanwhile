/**
 * Routine acquisition + automatic promotion of the census-geography
 * ZCTA-overlap dataset. The standing runner invokes this on the contract's
 * cadence (see ROUTINE_SOURCE_CONTRACTS). It fetches the Census tab20 files,
 * builds the dataset in memory, and promotes through the authorized routine
 * door. It writes no file — official .gov geography publishes automatically
 * when every validation check passes; a failure records its reason and leaves
 * the last GOOD version live.
 */
import { acquireDataset } from "../lib/census-geography/acquire.ts";
import { censusGeographyCandidate } from "../lib/census-geography/candidate.ts";
import { CENSUS_GEO_CONTRACT_ID } from "../lib/census-geography/publication.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
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
  let candidate: RoutineCandidate;
  try {
    const dataset = await withPublisherAcquisitionDeadline(
      "Census geography relationships",
      ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      async (signal): Promise<BuiltDataset> => {
        const built = await acquireDataset({ signal });
        // A zero-overlap scope is a failed extraction (RULING 269), never an
        // empty publication.
        if (built.scopes.length === 0 || built.scopes.some((s) => s.zctaEdgeCount === 0)) {
          throw sourceAcquisitionFailure(
            "PUBLISHER_DOCUMENT_INVALID",
            "A census-geography scope returned zero overlaps.",
          );
        }
        return built;
      },
    );
    candidate = censusGeographyCandidate(dataset);
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
  const outcome = await processRegisteredRoutineCandidate(
    store,
    CENSUS_GEO_CONTRACT_ID,
    candidate,
    candidate.retrieval.retrievedAt,
  );
  console.log(
    "RCD_RECEIPT=" +
      JSON.stringify({
        source: CENSUS_GEO_CONTRACT_ID,
        candidateId: candidate.id,
        coverage: (candidate.readModel as BuiltDataset).coverage,
        acquisitionSucceeded: outcome.candidate.acquisitionSucceeded,
        state: outcome.candidate.state,
        decision: outcome.candidate.receipt?.decision ?? null,
        promotedVersion: outcome.promoted?.versionId ?? null,
        lastKnownGoodVersion: outcome.candidate.lastKnownGoodVersion,
        structuralReleaseContract: ZERO_RELEASE_EVENTS,
      }),
  );
  if (!outcome.promoted) process.exitCode = 2;
}

await main();
