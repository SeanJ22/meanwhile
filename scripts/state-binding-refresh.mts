/** The standing state binding clock publishes through the same source-verified door as reviewed state packages. */
import { pathToFileURL } from "node:url";
import { parseStateBindingRefreshArguments, refreshStateBinding } from "../lib/civic-data/state-binding-refresh.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

async function main(): Promise<void> {
  const state = parseStateBindingRefreshArguments(process.argv.slice(2));
  installNeonRequestDeadline();
  prepareProductionCivicDataWrite();
  const outcome = await refreshStateBinding({ state, store: new PostgresRoutineDataStore() });
  if (!outcome.promoted && !outcome.confirmed) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
