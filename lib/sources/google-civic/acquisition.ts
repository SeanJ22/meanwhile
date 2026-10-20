import { GOOGLE_CIVIC_API, GOOGLE_CIVIC_CONTRACT_ID } from "./targets.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure } from "../../civic-data/source-acquisition-failure.ts";

export { CivicSourceError, readCivicApi, lookupCivicAddress, type CivicReadOptions } from "./api-read.ts";

/** Only the source refresh persists catalog failures; reader address lookups never write them. */
export async function recordCivicCatalogFailure(store: import("../../civic-data/store.ts").RoutineDataStore, reason: string, at: string) {
  return recordRegisteredSourceAcquisitionFailure({ store, contractId: GOOGLE_CIVIC_CONTRACT_ID, attemptedAt: at,
    requestedUrl: `${GOOGLE_CIVIC_API}elections`, failure: sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", reason) });
}
