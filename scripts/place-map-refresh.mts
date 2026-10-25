/** The standing source job loads one state, keeping the prior map on failure. */
import { refreshStatePlaceMap } from "../lib/place-map/refresh.ts";
import { readerFactDb } from "../lib/facts/db.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { censusGeographyCandidate } from "../lib/census-geography/candidate.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { isSourceAcquisitionFailure, recordRegisteredSourceAcquisitionFailure, withPublisherAcquisitionDeadline } from "../lib/civic-data/source-acquisition-failure.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

const state = process.argv.find(arg => arg.startsWith("--state="))?.slice(8);
if (!state || !/^[A-Z]{2}$/.test(state)) throw new Error("A state abbreviation is required");
installNeonRequestDeadline();
const prepared = prepareProductionCivicDataWrite(), facts = readerFactDb(prepared.connection);
const store = new PostgresRoutineDataStore(), contract = `place-map-${state.toLowerCase()}`;
try {
  const { dataset } = await withPublisherAcquisitionDeadline(`${state} Census place map`, ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
    signal => refreshStatePlaceMap(facts, process.cwd(), state, { signal }));
  const candidate = censusGeographyCandidate(dataset, `US-${state}:place-map`);
  const result = await processRegisteredRoutineCandidate(store, contract, candidate, candidate.retrieval.retrievedAt);
  printSourceRunnerReceipt(contract, candidate, result);
  if (!result.promoted) process.exitCode = 2;
} catch (error) {
  if (!isSourceAcquisitionFailure(error)) throw error;
  const result = await recordRegisteredSourceAcquisitionFailure({ store, contractId: contract, failure: error });
  console.log(result.line);
  process.exitCode = 2;
}
