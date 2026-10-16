/** @freshness-reads-here — the held capture keeps the date the source bytes were read. */
import { parse } from "yaml";
import { pathToFileURL } from "node:url";
import { failedFederalDirectoryCandidate, federalDirectoryCandidate, federalDirectoryContractId, federalDirectoryForState, federalDirectoryScope,
  FEDERAL_DIRECTORY_PARSER_VERSION, type FederalDirectoryAcquisition, type FederalDirectoryReadModel } from "../lib/officials/federal-directory-data-plane.ts";
import { normalizeCongressDirectory } from "../lib/officials/congress-normalize.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { requiredAssignment } from "./cli-args.mts";
import { processRegisteredManualCandidate, type PromotionOutcome } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import type { EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { acquireCongressSourceRevision } from "../lib/officials/congress-source-revision.ts";
import { acquireKnownRelease } from "../lib/sources/known-release.ts";

const FILES = ["legislators-current", "legislators-social-media", "legislators-district-offices", "committees-current", "committee-membership-current"] as const;
export async function refreshCongressDirectory(input: {
  state: string;
  store: RoutineDataStore;
  vault: EvidenceStore;
  acquire?: typeof acquireKnownRelease;
  revision?: typeof acquireCongressSourceRevision;
  now?: () => string;
}): Promise<void> {
  const {store,vault,state} = input, clock = input.now ?? (() => new Date().toISOString());
  const acquire = input.acquire ?? acquireKnownRelease, contractId = federalDirectoryContractId(state);
  let finalReceipt: { candidate: RoutineCandidate; outcome: PromotionOutcome } | null = null;
  try {
    const now = clock();
    const priorRead = await readPromotedCivicData<FederalDirectoryReadModel>("FEDERAL_DIRECTORY",federalDirectoryScope(state),{store,now,bypassCache:true});
    if (priorRead.kind === "STORE_UNREACHABLE") throw Error("CONGRESS_PRIOR_UNAVAILABLE");
    const prior = priorRead.kind === "PROMOTED" || priorRead.kind === "BOOTSTRAP" ? priorRead.value : null;
    const {sha:sourceSha,sourceCheck} = await (input.revision ?? acquireCongressSourceRevision)();
    const raw: Record<string,unknown> = {}, dates: Record<string,string> = {}, acquisitions: FederalDirectoryAcquisition[] = [];
    for (const name of FILES) {
      const url = `https://raw.githubusercontent.com/unitedstates/congress-legislators/${sourceSha}/${name}.yaml`;
      try {
        const decode = (bytes: Uint8Array) => {
          const text = new TextDecoder("utf-8",{fatal:true}).decode(bytes);
          if (text.trimStart().startsWith("<")) throw Error("CONGRESS_HTML_RESPONSE");
          const value: unknown = parse(text,{maxAliasCount:0,uniqueKeys:true});
          if (name === "committee-membership-current" ? !value || typeof value !== "object" || Array.isArray(value) : !Array.isArray(value)) throw Error("CONGRESS_FILE_SHAPE_INVALID");
          if (name === "legislators-current" && !(value as unknown[]).length) throw Error("CONGRESS_CORE_EMPTY");
          return {text,value};
        };
        const held = await acquire({sourceId:"congress-directory-project",releaseId:`${sourceSha}/${name}`,url,parserVersion:FEDERAL_DIRECTORY_PARSER_VERSION,maxBytes:16*1024*1024,checkAfterMs:365*86400000,signal:AbortSignal.timeout(30000),headers:{accept:"text/plain"},validate:bytes=>{decode(bytes);}});
        const parsed = decode(held.bytes);
        raw[name] = parsed.value; dates[name] = held.retrievedAt;
        acquisitions.push({requestedUrl:held.requestedUrl,finalUrl:held.finalUrl,httpStatus:held.httpStatus,body:parsed.text,retrievedAt:held.retrievedAt,sourceCheck});
      } catch (error) {
        if (name === "legislators-current") throw error;
        console.error(`${name}: optional facts retained from last good holding (${error instanceof Error ? error.message : String(error)})`);
      }
      // The core becomes readable immediately; optional files each enrich that same pointer.
      if (!raw["legislators-current"]) continue;
      const projection = federalDirectoryForState(normalizeCongressDirectory(raw,sourceSha,dates["legislators-current"]!,prior,dates,now),state);
      const candidate = await federalDirectoryCandidate({state,acquisitions,vault,retrievedAt:dates["legislators-current"]!,projection});
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
