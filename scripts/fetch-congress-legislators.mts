/** @freshness-reads-here — the held capture keeps the date the source bytes were read. */
import { parse } from "yaml";
import { failedFederalDirectoryCandidate, federalDirectoryCandidate, FEDERAL_DIRECTORY_PARSER_VERSION, type FederalDirectoryAcquisition } from "../lib/officials/federal-directory-data-plane.ts";
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
  const store = new PostgresRoutineDataStore(), now = new Date().toISOString();
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
      const held = await acquireKnownRelease({sourceId:"congress-directory-project",releaseId:`${sourceSha}/${name}`,url,parserVersion:FEDERAL_DIRECTORY_PARSER_VERSION,maxBytes:16*1024*1024,checkAfterMs:365*86400000,signal:AbortSignal.timeout(30000),headers:{accept:"text/plain"},validate:bytes=>{decode(bytes);}});
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
    const outcome = await processRegisteredManualCandidate(store,"congress-bulk-roster",candidate,new Date().toISOString());
    attemptPersisted = true;
    printSourceRunnerReceipt("congress-bulk-roster",candidate,outcome);
    if (!outcome.promoted && !outcome.confirmed) throw Error(`Federal directory held as ${outcome.candidate.state}: ${outcome.candidate.failureDetail ?? "validation refused"}`);
  }
  const latest=await readFederalDirectoryProjection({store,now,bypassCache:true});
  if(latest.kind === "PROMOTED") {
    const previousExcludedFacts = priorRead.kind === "PROMOTED" && priorRead.metadata.versionId
      ? (await store.readCandidate(priorRead.metadata.versionId))?.candidate.excludedFacts : undefined;
    const portraits=await congressPortraits(latest.value,new Date().toISOString(),AbortSignal.timeout(120000),{previousExcludedFacts});
    if(portraits.excludedFacts.length || JSON.stringify(portraits.projection)!==JSON.stringify(latest.value)) {
      const candidate=federalDirectoryCandidate({acquisitions,retrievedAt:dates["legislators-current"]!,projection:portraits.projection,excludedFacts:portraits.excludedFacts});
      // The field-attempt receipt is new evidence even when the accepted person payload is unchanged.
      const outcome=await processRegisteredManualCandidate(store,"congress-bulk-roster",candidate,new Date().toISOString(),undefined,{confirmUnchanged:portraits.excludedFacts.length === 0});
      printSourceRunnerReceipt("congress-bulk-roster",candidate,outcome);
      console.log(`Congress portraits: ${portraits.attempted} known members attempted; ${portraits.excludedFacts.length} source or field gaps recorded.`);
      if (!outcome.promoted && !outcome.confirmed) throw Error(`Federal portraits held as ${outcome.candidate.state}: ${outcome.candidate.failureDetail ?? "validation refused"}`);
    }
  }
}
void main().catch(async (error:unknown)=>{
  const detail = error instanceof Error ? error.message : String(error);
  if (writePrepared && !attemptPersisted) {
    try { const now=new Date().toISOString(), candidate=failedFederalDirectoryCandidate(now,detail); const outcome=await processRegisteredManualCandidate(new PostgresRoutineDataStore(),"congress-bulk-roster",candidate,now); printSourceRunnerReceipt("congress-bulk-roster",candidate,outcome); }
    catch (receiptError) { console.error(`Failed attempt receipt: ${String(receiptError)}`); }
  }
  console.error(detail); process.exitCode=1;
});
