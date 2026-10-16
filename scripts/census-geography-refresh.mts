import { acquireStatePublications } from "../lib/census-geography/acquire.ts";
import { censusGeographyCompletionCandidate } from "../lib/census-geography/candidate.ts";
import { CENSUS_GEO_CONTRACT_ID } from "../lib/census-geography/publication.ts";
import { censusStateDataset, readCensusDistrictState } from "../lib/census-geography/district-edge.ts";
import { readCensusGeographyIndex } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { readerQuery } from "../lib/civic-data/promoted-reader-query.ts";
import { resolveReaderArtifactWriteStore } from "../lib/meetings/edge-store.ts";
import { processRegisteredFanOutCandidate } from "../lib/civic-data/promotion.ts";
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
import { promoteCensusState } from "../lib/census-geography/state-publication.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";

installNeonRequestDeadline();
prepareProductionCivicDataWrite();

const store = new PostgresRoutineDataStore();

async function main(): Promise<void> {
  let completedStates = 0;
  let failedSources = 0;
  let failedStates = 0;
  try {
    const artifacts = resolveReaderArtifactWriteStore();
    if (!artifacts) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "Census geography artifact storage is unavailable.");
    const builtAt = new Date().toISOString();
    await withPublisherAcquisitionDeadline("Census geography relationships", ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      signal => acquireStatePublications({ signal, discoverPlans: true,
        previousStateDataset: async state => {
          const prior = await readCensusGeographyIndex(readerQuery(), state);
          if (prior.kind === "UNREAD") throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", prior.detail);
          if (prior.kind !== "HELD") return undefined;
          const value = await readCensusDistrictState(prior.value, state, artifacts);
          if (!value) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `Census state ${state} artifact is unavailable.`);
          return censusStateDataset(value);
        },
      }, async input => {
        for (const scope of input.dataset.scopes) if (scope.versionMeta.retrievalComplete === false) {
          throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `Census geography scope ${scope.version} is incomplete.`);
        }
        for (const discrepancy of input.dataset.sourceDiscrepancies ?? []) console.log("GEOGRAPHY_SOURCE_DISCREPANCY=" + JSON.stringify(discrepancy));
        for (const failure of input.dataset.sourceFailures ?? []) {
          failedSources++;
          console.error("GEOGRAPHY_SOURCE_FAILURE=" + JSON.stringify({ state: input.state, ...failure }));
        }
        const outcome = await promoteCensusState({ ...input, sourceVersion: `refresh:${builtAt}:${input.state}` }, { store, artifactStore: artifacts });
        if (!outcome.promoted) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `Census state ${input.state} was refused: ${outcome.candidate.receipt?.decision ?? outcome.candidate.state}`);
        console.log("GEOGRAPHY_STATE_PUBLISHED=" + JSON.stringify({ state: input.state, versionId: outcome.promoted.versionId }));
        completedStates++;
      }, async (state, error) => {
        failedStates++;
        console.error("GEOGRAPHY_STATE_FAILED=" + JSON.stringify({ state, detail: sanitizedErrorDiagnostic(error) }));
      }));
    if (failedSources || failedStates) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `${failedStates} state failures and ${failedSources} source failures; completed state publications remain available.`);
    const candidate = censusGeographyCompletionCandidate({ completedAt: new Date().toISOString(), completedStates });
    const outcome = await processRegisteredFanOutCandidate(store, CENSUS_GEO_CONTRACT_ID, candidate, candidate.retrieval.retrievedAt);
    printSourceRunnerReceipt(CENSUS_GEO_CONTRACT_ID, candidate, outcome);
    if (!outcome.promoted || (!outcome.confirmed && outcome.readerReadback?.status !== "PASS")) process.exitCode = 2;
  } catch (error) {
    if (!isSourceAcquisitionFailure(error)) throw error;
    const failed = await recordRegisteredSourceAcquisitionFailure({ store, contractId: CENSUS_GEO_CONTRACT_ID, failure: error });
    console.log(failed.line);
    process.exitCode = 2;
  }
}

await main();
