import { sourceHashReceiptFields } from "../civic-data/source-hash.ts";
import { ZERO_RELEASE_EVENTS } from "../civic-data/release.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { censusGeographyCandidate } from "../census-geography/candidate.ts";
import { processRegisteredRoutineCandidate } from "../civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../civic-data/runner-receipt.ts";
import { isSourceAcquisitionFailure, recordRegisteredSourceFailure, withPublisherAcquisitionDeadline } from "../civic-data/source-acquisition-failure.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../sources/acquisition-deadline.ts";
import type { FactDb, Query } from "../facts/publish.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { refreshStatePlaceMap } from "./refresh.ts";

/** The state's Census block file: the first route every state map reads, and the one its failed attempt names. */
export function placeMapRoute(state: string): string {
  const fips = Object.entries(FIPS_TO_STATE).find(([, entry]) => entry.postal === state)?.[0];
  if (!fips) throw new Error(`No state FIPS for ${state}`);
  return `https://www2.census.gov/geo/docs/maps-data/data/grf/2026/public_grfc_cur26_${fips}.txt`;
}

/** One state's standing map job. Every outcome, including a database failure while the map loads, ends in exactly one
 * receipt for this state; a failure is recorded as the state's failed attempt and its prior map stays live. */
export async function runStatePlaceMapJob(input: {
  readonly facts: FactDb & { readonly query: Query };
  readonly store: RoutineDataStore;
  readonly root: string;
  readonly state: string;
  readonly refresh?: typeof refreshStatePlaceMap;
}): Promise<number> {
  const { state, store } = input, contract = `place-map-${state.toLowerCase()}`, refresh = input.refresh ?? refreshStatePlaceMap;
  let result: Awaited<ReturnType<typeof refreshStatePlaceMap>>;
  try {
    result = await withPublisherAcquisitionDeadline(`${state} Census place map`, ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      signal => refresh(input.facts, input.root, state, store, { signal }));
  } catch (error) {
    const detail = isSourceAcquisitionFailure(error) ? `${error.code}: ${error.message}`
      : `PLACE_MAP_LOAD_FAILED: ${error instanceof Error ? error.message : String(error)}`;
    const failed = await recordRegisteredSourceFailure({ store, contractId: contract, failureDetail: detail.slice(0, 500), requestedUrl: placeMapRoute(state) });
    console.log(failed.line);
    return 2;
  }
  if (result.confirmed) {
    console.log("RCD_RECEIPT=" + JSON.stringify({ source: contract, ...sourceHashReceiptFields(result.confirmed), structuralReleaseContract: ZERO_RELEASE_EVENTS }));
    return 0;
  }
  const candidate = censusGeographyCandidate(result.dataset!, `US-${state}:place-map`, result.sourceProbe!);
  const published = await processRegisteredRoutineCandidate(store, contract, candidate, candidate.retrieval.retrievedAt, result.baseVersionId, { confirmUnchanged: false });
  printSourceRunnerReceipt(contract, candidate, published);
  return published.promoted ? 0 : 2;
}
