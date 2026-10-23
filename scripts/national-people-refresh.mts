/** One permanent source-state reader; publication and portrait work have independent standing clocks. */
import { pathToFileURL } from "node:url";
import { parsePeopleSourceArguments, runPeopleSourceRefresh } from "../lib/civic-data/people-source-runtime.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

async function main(): Promise<void> {
  const args = parsePeopleSourceArguments(process.argv.slice(2));
  installNeonRequestDeadline();
  prepareProductionCivicDataWrite();
  const result = await runPeopleSourceRefresh({ ...args, store: new PostgresRoutineDataStore(), vault: rawCaptureVault() }, {
    executiveCredentials: { fec: process.env.FEC_API_KEY, congress: process.env.CONGRESS_API_KEY },
  });
  if (!result.succeeded) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
