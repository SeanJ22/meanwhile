import { pathToFileURL } from "node:url";
import { refreshGoogleCivic } from "../lib/sources/google-civic/refresh.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { GOOGLE_CIVIC_SOURCE_ID } from "../lib/sources/google-civic/targets.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { sourceHashReceiptFields } from "../lib/civic-data/source-hash.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { controlPlaneUrlFromEnv,createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import type { AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";

async function main() {
  if (process.argv.slice(2).join(" ") !== "--promote") throw new Error("Google Civic refresh requires --promote.");
  installNeonRequestDeadline(); prepareProductionCivicDataWrite();
  let maxProgressAgeMs=0;
  try {
    const url=controlPlaneUrlFromEnv(),repos=url?await createPgRepositories(url,new Date().toISOString(),{skipBootstrap:true}):null;
    const config=(await repos?.adminConfig.readNarrowed("current",{settings:["facts.freshnessHours","facts.retryMinutes"]}))?.value as AdminConfig|null??null;
    const clocks=factClocks(config);maxProgressAgeMs=Math.min(clocks.windowHours("ballot")*3_600_000,clocks.retryMinutes("ballot")*60_000);
  } catch { /* Source checks continue; unavailable settings disable reuse of older unfinished samples. */ }
  const result = await refreshGoogleCivic({ store: new PostgresRoutineDataStore(), vault: rawCaptureVault(),maxProgressAgeMs,readOptions: { signal: AbortSignal.timeout(20 * 60_000) } });
  if(result.confirmation){console.log("RCD_RECEIPT="+JSON.stringify({source:GOOGLE_CIVIC_SOURCE_ID,...sourceHashReceiptFields(result.confirmation),structuralReleaseContract:ZERO_RELEASE_EVENTS}));return;}
  console.log(`GOOGLE_CIVIC_STATE_ROWS=${JSON.stringify(result.coverage)}`);
  printSourceRunnerReceipt(GOOGLE_CIVIC_SOURCE_ID, result.candidate, result.outcome);
  if (!result.outcome.promoted && !result.outcome.confirmed) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
