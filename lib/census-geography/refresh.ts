import { acquireDataset, type AcquireOptions } from "./acquire.ts";
import { censusGeographyCandidate } from "./candidate.ts";
import { CENSUS_GEO_CONTRACT_ID, CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_REQUIRED_VERSIONS, CENSUS_GEO_SCOPE } from "./publication.ts";
import type { BuiltDataset } from "./dataset.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../civic-data/promotion.ts";
import { sourceAcquisitionFailure, withPublisherAcquisitionDeadline } from "../civic-data/source-acquisition-failure.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../sources/acquisition-deadline.ts";

/** Acquire and publish through the standing door; a replay can supply an isolated store and vault. */
export async function refreshCensusGeography(store: RoutineDataStore, options: AcquireOptions = {}) {
  const dataset = await withPublisherAcquisitionDeadline("Census geography relationships", ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS, async signal => {
    const held = await store.readPromotion<BuiltDataset>(CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE);
    const built = await acquireDataset({ ...options, signal, previousDataset: held?.payload, discoverPlans: true });
    if (!built.scopes.length || built.scopes.some(scope => !scope.zctaEdgeCount || scope.versionMeta.retrievalComplete === false)) {
      throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "A census-geography scope returned zero overlaps.");
    }
    const missing = CENSUS_GEO_REQUIRED_VERSIONS.filter(version => !built.scopes.some(scope => scope.version === version));
    if (missing.length) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `Census geography is missing required election plans: ${missing.join(", ")}`);
    return built;
  });
  const candidate = censusGeographyCandidate(dataset);
  const outcome = await processRegisteredRoutineCandidate(store, CENSUS_GEO_CONTRACT_ID, candidate, candidate.retrieval.retrievedAt);
  return { candidate, outcome };
}
