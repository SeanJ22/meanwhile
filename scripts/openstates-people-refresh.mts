/** One standing source-state refresh, independent of Sends or paid work. */
import { pathToFileURL } from "node:url";
import { acquireStatePeople } from "../lib/sources/plural/acquisition.ts";
import { PLURAL_REVISION_URL, PLURAL_STATES } from "../lib/sources/plural/targets.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { publishStatePeople } from "../lib/civic-data/state-people-publication.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-vault.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure, withPublisherAcquisitionDeadline } from "../lib/civic-data/source-acquisition-failure.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

export function parseStatePeopleArguments(args: readonly string[]): string {
  const states = args.filter(arg => arg.startsWith("--state="));
  if (args.filter(arg => arg === "--promote").length !== 1 || states.length !== 1 ||
    args.some(arg => arg !== "--promote" && !arg.startsWith("--state="))) throw new Error("OPENSTATES_EXACT_STATE_REQUIRED");
  const state = states[0]!.slice("--state=".length).toLowerCase();
  if (!PLURAL_STATES.includes(state)) throw new Error("OPENSTATES_STATE_UNSUPPORTED");
  return state;
}
async function main() {
  const state = parseStatePeopleArguments(process.argv.slice(2)), contractId = `openstates-people-${state}`;
  installNeonRequestDeadline(); prepareProductionCivicDataWrite();
  const store = new PostgresRoutineDataStore();
  let acquired: Awaited<ReturnType<typeof acquireStatePeople>>;
  try {
    acquired = await withPublisherAcquisitionDeadline(`OpenStates ${state.toUpperCase()}`, ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      signal => acquireStatePeople({ state, signal }));
  } catch (error) {
    const failure = sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", error instanceof Error ? error.message : String(error));
    const failed = await recordRegisteredSourceAcquisitionFailure({ store, contractId, requestedUrl: PLURAL_REVISION_URL, failure });
    console.log(failed.line); process.exitCode = 2; return;
  }
  const publication = await publishStatePeople({ store, vault: rawCaptureVault(), ...acquired, now: new Date().toISOString() });
  if (acquired.gaps.length) console.log(`OPENSTATES_SOURCE_GAPS=${JSON.stringify(acquired.gaps)}`);
  printSourceRunnerReceipt(contractId, publication.candidate, publication.outcome);
  if (!publication.outcome.promoted && !publication.outcome.confirmed) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
