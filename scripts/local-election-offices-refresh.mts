import { pathToFileURL } from "node:url";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { refreshLocalElectionOffices } from "../lib/sources/local-election-offices/refresh.ts";
import { localElectionOfficesContractId, requireLocalElectionOfficeState } from "../lib/sources/local-election-offices/targets.ts";

export function localElectionOfficeRefreshArguments(args: readonly string[]): string {
  const state = args.filter(arg => arg.startsWith("--state="));
  if (!args.includes("--promote") || state.length !== 1 || args.some(arg => arg !== "--promote" && !arg.startsWith("--state="))) throw new Error("Local election-office refresh requires exactly --promote and --state=XX.");
  return requireLocalElectionOfficeState(state[0].slice("--state=".length));
}

async function main() {
  const state = localElectionOfficeRefreshArguments(process.argv.slice(2));
  installNeonRequestDeadline(); prepareProductionCivicDataWrite();
  const connection = controlPlaneUrlFromEnv();
  if (!connection) throw new Error("The Door Registry connection is unavailable for local election-office refresh.");
  const repos = await createPgRepositories(connection, new Date().toISOString(), { skipBootstrap: true });
  const result = await refreshLocalElectionOffices({ state, store: new PostgresRoutineDataStore(), vault: rawCaptureVault(), doors: repos.doors, pacing: repos.websitePacing });
  console.log(`LOCAL_ELECTION_OFFICE_ROWS=${JSON.stringify({ state, offices: result.projection.offices.length, blanks: result.projection.blanks?.length ?? 0, sourceFailures: result.failures })}`);
  printSourceRunnerReceipt(localElectionOfficesContractId(state), result.candidate, result.outcome);
  if (!result.outcome.promoted && !result.outcome.confirmed) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
