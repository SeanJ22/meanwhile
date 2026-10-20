/** Direct, independently published ACS source work for one state. */
import { pathToFileURL } from "node:url";
import { KEY_VAR } from "../lib/sources/census-acs-population/index.ts";
import { acquireStateAcs } from "../lib/sources/census-acs-population/national.ts";
import { acsContractId, acsState } from "../lib/sources/census-acs-population/publication.ts";
import { heldAcsJoinTargets } from "../lib/sources/census-acs-population/held-joins.ts";
import { censusAcsCandidate } from "../lib/civic-data/candidate-builders.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { isSourceAcquisitionFailure, recordRegisteredSourceAcquisitionFailure, withPublisherAcquisitionDeadline } from "../lib/civic-data/source-acquisition-failure.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";

export async function acquireAcsStateCandidate(state: string, options: Partial<Omit<Parameters<typeof acquireStateAcs>[0], "state">> = {}): Promise<RoutineCandidate> {
  const load = await acquireStateAcs({ state, key: process.env[KEY_VAR], targets: heldAcsJoinTargets, ...options });
  return censusAcsCandidate(load);
}
async function main(): Promise<void> {
  const args = process.argv.slice(2), arg = args.find(value => value.startsWith("--state="));
  if (args.length !== 1 || !arg) throw new Error("ACS_EXACT_STATE_REQUIRED");
  const { state } = acsState(arg.slice(8)), contractId = acsContractId(state);
  installNeonRequestDeadline(); prepareProductionCivicDataWrite();
  const store = new PostgresRoutineDataStore();
  let candidate: RoutineCandidate;
  try {
    candidate = await withPublisherAcquisitionDeadline(`Census ACS ${state}`, ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      signal => acquireAcsStateCandidate(state, { signal }));
  } catch (error) {
    if (!isSourceAcquisitionFailure(error)) throw error;
    console.log((await recordRegisteredSourceAcquisitionFailure({ store, contractId, failure: error })).line);
    process.exitCode = 2; return;
  }
  const outcome = await processRegisteredRoutineCandidate(store, contractId, candidate, candidate.retrieval.retrievedAt);
  printSourceRunnerReceipt(contractId, candidate, outcome);
  if (!outcome.promoted && !outcome.confirmed) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
