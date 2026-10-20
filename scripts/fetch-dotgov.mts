/** @freshness-reads-here — a complete pinned source streams to disk; each state publishes independently. */
import { acquireDotGov, dotGovArchiveCache } from "../lib/civic-data/dotgov-acquisition.ts";
export { acquireDotGov } from "../lib/civic-data/dotgov-acquisition.ts";
export type { DotGovAcquisition } from "../lib/civic-data/dotgov-acquisition.ts";
export type { DotGovDomain, DotGovSnapshot } from "../lib/civic-data/dotgov.ts";
import { dotGovCandidate } from "../lib/civic-data/dotgov-publication.ts";
import { processRegisteredFanOutCandidate, processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { isSourceAcquisitionFailure, recordRegisteredSourceAcquisitionFailure, withPublisherAcquisitionDeadline } from "../lib/civic-data/source-acquisition-failure.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";

async function main() {
  installNeonRequestDeadline();
  if (!process.argv.includes("--promote")) throw new Error("Run the registered dotgov contract through the installed runtime dispatcher.");
  prepareProductionCivicDataWrite();
  const store = new PostgresRoutineDataStore();
  let acquisition;
  try {
    acquisition = await withPublisherAcquisitionDeadline("CISA dotgov", ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      signal => acquireDotGov(signal, { archive: dotGovArchiveCache(rawCaptureVault()) }));
  } catch (error) {
    if (!isSourceAcquisitionFailure(error)) throw error;
    const failed = await recordRegisteredSourceAcquisitionFailure({ store, contractId: "dotgov", failure: error });
    console.log(failed.line); process.exitCode = 2; return;
  }
  try {
    for (const state of acquisition.states) {
      const candidate = dotGovCandidate({ snapshot: acquisition.snapshot(state), rawHash: acquisition.rawHash,
        finalUrl: acquisition.finalUrl, retrievedAt: acquisition.retrievedAt });
      const outcome = await processRegisteredFanOutCandidate(store, "dotgov", candidate, acquisition.retrievedAt);
      if (!outcome.promoted && !outcome.confirmed) throw new Error(`CISA ${state} domains were not published: ${outcome.candidate.failureDetail}`);
      console.log("RCD_PROGRESS=" + JSON.stringify({ key: candidate.id, records: candidate.identities.length }));
    }
    const marker = dotGovCandidate({ snapshot: acquisition.snapshot(), rawHash: acquisition.rawHash,
      finalUrl: acquisition.finalUrl, retrievedAt: acquisition.retrievedAt });
    const outcome = await processRegisteredRoutineCandidate(store, "dotgov", marker, acquisition.retrievedAt);
    console.log(`dotgov: ${acquisition.counts.domains} domains in ${acquisition.states.length} state partitions at ${acquisition.sourceSha}`);
    printSourceRunnerReceipt("dotgov", marker, outcome);
    if (!outcome.promoted && !outcome.confirmed) process.exitCode = 2;
  } finally { await acquisition.dispose(); }
}

if (process.argv[1]?.endsWith("fetch-dotgov.mts")) await main();
