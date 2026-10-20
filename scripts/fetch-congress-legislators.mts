/** @freshness-reads-here — the held capture keeps the date the source bytes were read. */
import { pathToFileURL } from "node:url";
import { failedFederalDirectoryCandidate, heldDirectoryCandidate, federalDirectoryContractId, federalDirectoryForState,
  type FederalDirectoryCapture } from "../lib/officials/federal-directory-data-plane.ts";
import { normalizeCongressDirectory } from "../lib/officials/congress-normalize.ts";
import { readStateFederalDirectory } from "../lib/officials/federal-directory-read-model.ts";
import { requiredAssignment } from "./cli-args.mts";
import { processRegisteredManualCandidate, type PromotionOutcome } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import type { EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { acquireCongressSourceRevision } from "../lib/officials/congress-source-revision.ts";
import { acquireCongressSourceFile } from "../lib/officials/congress-source-file.ts";
import { CONGRESS_SOURCE_FILES, readCongressStateSource } from "../lib/officials/congress-source-records.ts";

export async function refreshCongressDirectory(input: {
  state: string;
  store: RoutineDataStore;
  vault: EvidenceStore;
  acquire?: typeof acquireCongressSourceFile;
  revision?: typeof acquireCongressSourceRevision;
  now?: () => string;
}): Promise<void> {
  const {store,vault,state} = input, clock = input.now ?? (() => new Date().toISOString());
  const acquire = input.acquire ?? acquireCongressSourceFile, contractId = federalDirectoryContractId(state);
  let finalReceipt: { candidate: RoutineCandidate; outcome: PromotionOutcome } | null = null;
  try {
    const now = clock();
    const priorRead = await readStateFederalDirectory(state,{store,now,bypassCache:true});
    if (priorRead.kind === "STORE_UNREACHABLE") throw Error("CONGRESS_PRIOR_UNAVAILABLE");
    const prior = priorRead.kind === "PROMOTED" || priorRead.kind === "BOOTSTRAP" ? priorRead.value : null;
    const {sha:sourceSha,sourceCheck} = await (input.revision ?? acquireCongressSourceRevision)();
    const raw: Record<string,unknown> = {}, dates: Record<string,string> = {}, acquisitions: FederalDirectoryCapture[] = [];
    let sourceMembershipComplete: boolean | undefined;
    const memberIds = new Set<string>(), committeeIds = new Set<string>();
    for (const name of CONGRESS_SOURCE_FILES) {
      const url = `https://raw.githubusercontent.com/unitedstates/congress-legislators/${sourceSha}/${name}.yaml`;
      try {
        const held = await acquire({ url, vault, signal: AbortSignal.timeout(30000) });
        try {
          const parsed = await readCongressStateSource({ path: held.path, name, state, asOf: now, memberIds, committeeIds });
          raw[name] = parsed.value; dates[name] = held.retrievedAt;
          if (name === "legislators-current") {
            sourceMembershipComplete = parsed.complete;
            for (const row of parsed.value as {id?:{bioguide?:string}}[]) if (row.id?.bioguide) memberIds.add(row.id.bioguide);
          }
          if (name === "committee-membership-current") for (const id of Object.keys(parsed.value as object)) committeeIds.add(id);
          acquisitions.push({requestedUrl:held.requestedUrl,finalUrl:held.finalUrl,httpStatus:held.httpStatus,raw:held.raw,retrievedAt:held.retrievedAt,sourceCheck});
        } finally { await held.dispose(); }
      } catch (error) {
        if (name === "legislators-current") throw error;
        console.error(`${name}: optional facts retained from last good holding (${error instanceof Error ? error.message : String(error)})`);
      }
      // The core becomes readable immediately; optional files each enrich that same pointer.
      if (!raw["legislators-current"]) continue;
      const projection = federalDirectoryForState(normalizeCongressDirectory(raw,sourceSha,dates["legislators-current"]!,prior,dates,now,sourceMembershipComplete),state);
      const candidate = heldDirectoryCandidate({state,acquisitions,retrievedAt:dates["legislators-current"]!,projection});
      const outcome = await processRegisteredManualCandidate(store,contractId,candidate,clock());
      finalReceipt = {candidate,outcome};
      if (!outcome.promoted && !outcome.confirmed) throw Error(`Federal directory held as ${outcome.candidate.state}: ${outcome.candidate.failureDetail ?? "validation refused"}`);
    }

  } catch (error) {
    if (!finalReceipt) {
      try {
        const now=clock(), candidate=failedFederalDirectoryCandidate(state,now,error instanceof Error ? error.message : String(error));
        const outcome=await processRegisteredManualCandidate(store,contractId,candidate,now);
        finalReceipt={candidate,outcome};
      } catch (receiptError) { console.error(`Failed attempt receipt: ${String(receiptError)}`); }
    }
    throw error;
  } finally {
    // Every file/field promotion is already durable. Only the last outcome represents this child to its supervisor.
    if (finalReceipt) printSourceRunnerReceipt(contractId,finalReceipt.candidate,finalReceipt.outcome);
  }
}
async function main() {
  if (!process.argv.includes("--promote")) throw Error("Run with --promote; tracked federal files are first-seed/test evidence only.");
  prepareProductionCivicDataWrite();
  const state = requiredAssignment(process.argv.slice(2),"state","CONGRESS_STATE_REQUIRED");
  await refreshCongressDirectory({state,store:new PostgresRoutineDataStore(),vault:rawCaptureVault()});
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error:unknown)=>{
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1;
});
