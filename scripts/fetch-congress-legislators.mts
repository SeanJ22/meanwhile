/** @freshness-reads-here — the held capture keeps the date the source bytes were read. */
import { parse } from "yaml";
import { stamp } from "./stamp.mts";
import { failedFederalDirectoryCandidate, federalDirectoryCandidate, type FederalDirectoryAcquisition } from "../lib/officials/federal-directory-data-plane.ts";
import { congressPortraits } from "../lib/officials/congress-portraits.ts";
import { normalizeCongressDirectory } from "../lib/officials/congress-normalize.ts";
import { readFederalDirectoryProjection } from "../lib/officials/federal-directory-read-model.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { acquireCongressSourceRevision } from "../lib/officials/congress-source-revision.ts";
import { acquireKnownRelease } from "../lib/sources/known-release.ts";

const FILES = ["legislators-current", "legislators-social-media", "legislators-district-offices", "committees-current", "committee-membership-current"] as const;
let attemptPersisted = false, writePrepared = false;
async function main() {
  if (!process.argv.includes("--promote")) throw Error("Run with --promote; tracked federal files are first-seed/test evidence only.");
  prepareProductionCivicDataWrite(); writePrepared = true;
  const store = new PostgresRoutineDataStore(), now = stamp();
  const priorRead = await readFederalDirectoryProjection({store,now,bypassCache:true});
  if (priorRead.kind === "STORE_UNREACHABLE") throw Error("CONGRESS_PRIOR_UNAVAILABLE");
  const prior = priorRead.kind === "PROMOTED" || priorRead.kind === "BOOTSTRAP" ? priorRead.value : null;
  const {sha:sourceSha,sourceCheck} = await acquireCongressSourceRevision();
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
      const held = await acquireKnownRelease({sourceId:"congress-directory-project",releaseId:`${sourceSha}/${name}`,url,parserVersion:"congress-directory/3",maxBytes:16*1024*1024,checkAfterMs:365*86400000,signal:AbortSignal.timeout(30000),headers:{accept:"text/plain"},validate:bytes=>{decode(bytes);}});
      const parsed = decode(held.bytes);
      raw[name] = parsed.value; dates[name] = held.retrievedAt;
      acquisitions.push({requestedUrl:held.requestedUrl,finalUrl:held.finalUrl,httpStatus:held.httpStatus,body:parsed.text,retrievedAt:held.retrievedAt,vaultKey:held.vaultKey,sourceCheck});
    } catch (error) {
      if (name === "legislators-current") throw error;
      console.error(`${name}: optional facts retained from last good holding (${error instanceof Error ? error.message : String(error)})`);
    }
    // The core becomes readable immediately; optional files each enrich that same pointer.
    if (!raw["legislators-current"]) continue;
    const projection = normalizeCongressDirectory(raw,sourceSha,dates["legislators-current"]!,prior,dates,now);
    const candidate = federalDirectoryCandidate({acquisitions,retrievedAt:dates["legislators-current"]!,projection});
    const outcome = await processRegisteredManualCandidate(store,"congress-bulk-roster",candidate,now);
    attemptPersisted = true;
    printSourceRunnerReceipt("congress-bulk-roster",candidate,outcome);
    if (!outcome.promoted && !outcome.confirmed) throw Error(`Federal directory held as ${outcome.candidate.state}: ${outcome.candidate.failureDetail ?? "validation refused"}`);
  }
  const latest=await readFederalDirectoryProjection({store,now,bypassCache:true});
  if(latest.kind === "PROMOTED") {
    const projection=await congressPortraits(latest.value,now,AbortSignal.timeout(120000));
    if(JSON.stringify(projection)!==JSON.stringify(latest.value)) {
      const candidate=federalDirectoryCandidate({acquisitions,retrievedAt:dates["legislators-current"]!,projection});
      const outcome=await processRegisteredManualCandidate(store,"congress-bulk-roster",candidate,now);
      printSourceRunnerReceipt("congress-bulk-roster",candidate,outcome);
    }
  }
}
void main().catch(async (error:unknown)=>{
  const detail = error instanceof Error ? error.message : String(error);
  if (writePrepared && !attemptPersisted) {
    try { const now=stamp(), candidate=failedFederalDirectoryCandidate(now,detail); const outcome=await processRegisteredManualCandidate(new PostgresRoutineDataStore(),"congress-bulk-roster",candidate,now); printSourceRunnerReceipt("congress-bulk-roster",candidate,outcome); }
    catch (receiptError) { console.error(`Failed attempt receipt: ${String(receiptError)}`); }
  }
  console.error(detail); process.exitCode=1;
});
