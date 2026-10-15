import { acquireStateDatasets } from "../lib/census-geography/acquire.ts";
import { censusGeographyCandidate } from "../lib/census-geography/candidate.ts";
import { CENSUS_GEO_CONTRACT_ID } from "../lib/census-geography/publication.ts";
import { censusStateDataset, publishCensusDistrictStates, readCensusDistrictState } from "../lib/census-geography/district-edge.ts";
import { readCensusGeographyIndex } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { readerQuery } from "../lib/civic-data/promoted-reader-query.ts";
import { resolveReaderArtifactWriteStore } from "../lib/meetings/edge-store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
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
  let candidate: RoutineCandidate;
  const sourceFailures: string[] = [];
  try {
    const artifacts = resolveReaderArtifactWriteStore();
    if (!artifacts) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Census geography artifact storage is unavailable.");
    const index = await withPublisherAcquisitionDeadline(
      "Census geography relationships",
      ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      async signal => {
        const prior = await readCensusGeographyIndex(readerQuery());
        if (prior.kind === "UNREAD") throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", prior.detail);
        const held = prior.kind === "HELD" ? prior.value : undefined;
        const builtAt = new Date().toISOString();
        async function* states() {
          for await (const input of acquireStateDatasets({ signal, discoverPlans: true,
            previousScopes: held?.scopes,
            previousStateDataset: async state => {
              if (!held) return undefined;
              const value = await readCensusDistrictState(held, state, artifacts!);
              return value ? censusStateDataset(value) : undefined;
            },
          })) {
            for (const scope of input.dataset.scopes) if (scope.versionMeta.retrievalComplete === false) {
              throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `Census geography scope ${scope.version} is incomplete.`);
            }
            for (const discrepancy of input.dataset.sourceDiscrepancies ?? []) console.log("GEOGRAPHY_SOURCE_DISCREPANCY=" + JSON.stringify(discrepancy));
            sourceFailures.push(...(input.dataset.sourceFailures ?? []).map(row => `${row.sourceId}: ${row.reason}`));
            yield { ...input, dataset: { ...input.dataset, builtAt } };
          }
        }
        return publishCensusDistrictStates(states(), `refresh:${builtAt}`, artifacts!);
      },
    );
    candidate = censusGeographyCandidate(index);
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
  printSourceRunnerReceipt(CENSUS_GEO_CONTRACT_ID, candidate, outcome);
  if (sourceFailures.length) {
    const failure = await recordRegisteredSourceAcquisitionFailure({ store, contractId: CENSUS_GEO_CONTRACT_ID,
      failure: sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", sourceFailures.join("; ")) });
    console.log(failure.line);
    process.exitCode = 2;
  }
  if (!outcome.promoted) process.exitCode = 2;
}

await main();
