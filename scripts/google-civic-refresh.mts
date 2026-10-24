import { pathToFileURL } from "node:url";
import { refreshGoogleCivic } from "../lib/sources/google-civic/refresh.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { GOOGLE_CIVIC_SOURCE_ID } from "../lib/sources/google-civic/targets.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

async function main() {
  if (process.argv.slice(2).join(" ") !== "--promote") throw new Error("Google Civic refresh requires --promote.");
  installNeonRequestDeadline(); prepareProductionCivicDataWrite();
  const result = await refreshGoogleCivic({ store: new PostgresRoutineDataStore(), vault: rawCaptureVault(), readOptions: { signal: AbortSignal.timeout(20 * 60_000) } });
  console.log(`GOOGLE_CIVIC_STATE_ROWS=${JSON.stringify(result.coverage)}`);
  printSourceRunnerReceipt(GOOGLE_CIVIC_SOURCE_ID, result.candidate, result.outcome);
  if (!result.outcome.promoted && !result.outcome.confirmed) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
