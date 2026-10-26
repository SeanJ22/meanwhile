/** @freshness-reads-here — the held capture keeps the date the source bytes were read. */
import { parse } from "yaml";
import { pathToFileURL } from "node:url";
import { failedFederalDirectoryCandidate, heldDirectoryCandidate, federalDirectoryContractId, federalDirectoryForState, federalDirectoryStateOf,
  FEDERAL_DIRECTORY_PARSER_VERSION, federalDirectoryScope, federalDirectorySourceContentHash, federalDirectoryCaptureHash, type FederalDirectoryCapture } from "../lib/officials/federal-directory-data-plane.ts";
import { normalizeCongressDirectory } from "../lib/officials/congress-normalize.ts";
import { publishFederalDirectoryOfficePoints } from "../lib/officials/office-points-publication.ts";
import { readStateFederalDirectory } from "../lib/officials/federal-directory-read-model.ts";
import { requiredAssignment } from "./cli-args.mts";
import { readContractHandoff } from "../lib/civic-data/contract-handoff.ts";
import { holdRawCapture } from "../lib/civic-data/raw-capture-vault.ts";
import { passDeadlineFromEnv } from "../lib/ops/independent-runtime-pass.ts";
import { processRegisteredManualCandidate, type PromotionOutcome } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import type { EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { acquireCongressSourceRevision } from "../lib/officials/congress-source-revision.ts";
import { acquireKnownRelease, knownReleaseSourceCheck } from "../lib/sources/known-release.ts";
import { peopleNormalizationInputHash } from "../lib/civic-data/people-source-hash.ts";
import { confirmSourceHashUnchanged, sourceHashReceiptFields, type SourceHashConfirmation } from "../lib/civic-data/source-hash.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { rosterChanges } from "../lib/officials/roster-changes.ts";
import { CHAMBER_DIRECTORY_URLS, parseChamberDirectory, withChamberDirectories } from "../lib/officials/chamber-directory.ts";
import type { FederalDirectoryReadModel } from "../lib/officials/federal-directory-data-plane.ts";

const changesFrom = (prior: FederalDirectoryReadModel | null, next: FederalDirectoryReadModel) =>
  rosterChanges(prior?.roster ?? null, next.roster, { prior: prior?.vacancies ?? [], next: next.vacancies ?? [] });
const FILES = ["legislators-current", "legislators-social-media", "legislators-district-offices", "committees-current", "committee-membership-current"] as const;
export async function refreshCongressDirectory(input: {
  state?: string;
  states?: readonly string[];
  store: RoutineDataStore;
  vault: EvidenceStore;
  acquire?: typeof acquireKnownRelease;
  revision?: typeof acquireCongressSourceRevision;
  now?: () => string;
}): Promise<void> {
  const { store, vault } = input, clock = input.now ?? (() => new Date().toISOString());
  const states = [...new Set(input.states ?? (input.state ? [input.state] : []))];
  if (!states.length) throw Error("CONGRESS_STATE_REQUIRED");
  const acquire = input.acquire ?? acquireKnownRelease;
  const priors = new Map<string, FederalDirectoryReadModel | null>(), latest = new Map<string, FederalDirectoryReadModel>(),baseVersions=new Map<string,string|null>();
  const receipts = new Map<string, {candidate:RoutineCandidate;outcome:PromotionOutcome}|{confirmation:SourceHashConfirmation}>();
  const priorSources=new Map<string,{inputHash:string;captures:readonly FederalDirectoryCapture[]}>(),changed=new Set<string>();
  const acquisitions:FederalDirectoryCapture[]=[],chambers:Parameters<typeof withChamberDirectories>[2][number][]=[];
  let sourceInputHash="",optionalFailures=0;
  const sourceComplete=()=>acquisitions.length===FILES.length+Object.keys(CHAMBER_DIRECTORY_URLS).length && optionalFailures===0;
  const priorFor=async(state:string)=>{
    if(priors.has(state))return priors.get(state)??null;
    const prior=await readStateFederalDirectory(state,{store,now:clock()});
    if(prior.kind==="STORE_UNREACHABLE")throw Error(`CONGRESS_PRIOR_UNAVAILABLE:${state}`);
    const value=prior.kind==="PROMOTED"||prior.kind==="BOOTSTRAP"?prior.value:null;
    priors.set(state,value);baseVersions.set(state,prior.metadata.versionId??null);return value;
  };
  const sourceChanged=(state:string)=>{
    if(changed.has(state))return true;
    const previous=priorSources.get(state);
    const signature=federalDirectoryCaptureHash;
    if(previous?.inputHash===sourceInputHash && acquisitions.every(capture=>previous.captures.some(old=>signature(old)===signature(capture))))return false;
    changed.add(state);return true;
  };
  const failures: unknown[] = [];
  const deadline = passDeadlineFromEnv(process.env) ?? Infinity;
  const publish = async (state: string, acquisitions: readonly FederalDirectoryCapture[], projection: FederalDirectoryReadModel, retrievedAt: string) => {
    if (Date.now() >= deadline) return;
    try {
      // Office points found while publishing are saved with the state's directory and reused by its next publication.
      const pointed = await publishFederalDirectoryOfficePoints(projection, latest.get(state) ?? priors.get(state) ?? null);
      const candidate = heldDirectoryCandidate({ state, acquisitions, retrievedAt, projection: pointed, changes: changesFrom(priors.get(state) ?? null, pointed),
        sourceInputHash,sourceComplete:sourceComplete() });
      const outcome = await processRegisteredManualCandidate(store, federalDirectoryContractId(state), candidate, clock(),baseVersions.get(state));
      receipts.set(state, { candidate, outcome });
      if (!outcome.promoted && !outcome.confirmed) throw Error(`Federal directory held as ${outcome.candidate.state}: ${outcome.candidate.failureDetail ?? "validation refused"}`);
      baseVersions.set(state,outcome.promoted?.versionId??outcome.confirmed?.versionId??null);
      latest.set(state, candidate.readModel as FederalDirectoryReadModel);
    } catch (error) { failures.push(error); console.error(`${state}: ${String(error)}`); }
  };
  try {
    const now = clock();
    const revision=await (input.revision ?? acquireCongressSourceRevision)();
    if(revision.outage)throw Error(`CONGRESS_REVISION_RECHECK_UNAVAILABLE:${revision.outage}`);
    const {sha:sourceSha,sourceCheck}=revision;
    for(const state of states){
      const head=await store.readSourceHead("FEDERAL_DIRECTORY",federalDirectoryScope(state));
      if(!head || head.sourceId!=="congress-directory-project" || head.parserVersion!==FEDERAL_DIRECTORY_PARSER_VERSION ||
        head.rawHashBasis!=="SOURCE_CONTENT_V1" || head.imported || head.candidateState!=="PROMOTED" || !head.acquisitionSucceeded || head.versionId!==head.lastKnownGoodVersionId)continue;
      const [inputHash,captures]=await Promise.all([store.readCandidatePath<string>(head.versionId,["normalizedPayload","sourceInputHash"]),
        store.readCandidatePath<readonly FederalDirectoryCapture[]>(head.versionId,["normalizedPayload","acquisitions"])]);
      if(typeof inputHash==="string" && Array.isArray(captures))priorSources.set(state,{inputHash,captures});
    }
    const raw: Record<string, unknown> = {}, dates: Record<string, string> = {};
    const projectionFor=async(state:string)=>{
      const prior=await priorFor(state);
      return withChamberDirectories(federalDirectoryForState(normalizeCongressDirectory(raw,sourceSha,dates["legislators-current"]!,prior,dates,now),state),state,chambers,latest.get(state)??prior);
    };
    for (const name of FILES) {
      if (Date.now() >= deadline) break;
      const url = `https://raw.githubusercontent.com/unitedstates/congress-legislators/${sourceSha}/${name}.yaml`;
      try {
        let decoded: { text: string; value: unknown } | undefined;
        const decode = (bytes: Uint8Array) => {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          if (text.trimStart().startsWith("<")) throw Error("CONGRESS_HTML_RESPONSE");
          const value: unknown = parse(text, { maxAliasCount: 0, uniqueKeys: true });
          if (name === "committee-membership-current" ? !value || typeof value !== "object" || Array.isArray(value) : !Array.isArray(value)) throw Error("CONGRESS_FILE_SHAPE_INVALID");
          if (name === "legislators-current" && !(value as unknown[]).length) throw Error("CONGRESS_CORE_EMPTY");
          return { text, value };
        };
        const held = await acquire({ sourceId: "congress-directory-project", releaseId: `${sourceSha}/${name}`, url,
          parserVersion: FEDERAL_DIRECTORY_PARSER_VERSION, maxBytes: 16 * 1024 * 1024, checkAfterMs: 365 * 86400000,
          signal: AbortSignal.timeout(Math.max(1, Math.min(30000, deadline - Date.now()))), headers: { accept: "text/plain" },
          validate: bytes => { decoded = decode(bytes); } });
        if(held.outage)throw Error(`CONGRESS_PROVIDER_RECHECK_UNAVAILABLE:${held.outage}`);
        const parsed = decoded ?? decode(held.bytes);
        raw[name] = parsed.value; dates[name] = held.retrievedAt;
        acquisitions.push({ requestedUrl: held.requestedUrl, finalUrl: held.finalUrl, httpStatus: held.httpStatus,
          raw: await holdRawCapture(vault, "congress-directory-project", held.bytes, "text/plain"), retrievedAt: held.retrievedAt, sourceCheck });
      } catch (error) {
        if (name === "legislators-current") throw error;
        optionalFailures++;for(const state of states)changed.add(state);
        console.error(`${name}: optional facts retained from last good holding (${String(error)})`);
      }
      // One national acquisition feeds every due place before the next optional file is read.
      if(name==="legislators-current")sourceInputHash=peopleNormalizationInputHash(normalizeCongressDirectory(raw,sourceSha,dates["legislators-current"]!,null,dates,now).roster);
      for (const state of states) {
        if(sourceChanged(state))await publish(state,acquisitions,await projectionFor(state),dates["legislators-current"]!);
      }
    }
    for (const [chamber, url] of Object.entries(CHAMBER_DIRECTORY_URLS)) {
      if (Date.now() >= deadline) break;
      try {
        const held = await acquire({ sourceId: "congress-directory-project", releaseId: `chamber-directory:${chamber}`, url,
          parserVersion: FEDERAL_DIRECTORY_PARSER_VERSION, maxBytes: 4 * 1024 * 1024, checkAfterMs: 86400000,
          signal: AbortSignal.timeout(Math.max(1, Math.min(30000, deadline - Date.now()))), headers: { accept: "application/xml" },
          validate: bytes => { parseChamberDirectory({ body: new TextDecoder().decode(bytes), finalUrl: url, retrievedAt: clock() }, states[0]!); } });
        if(held.outage)throw Error(`CONGRESS_PROVIDER_RECHECK_UNAVAILABLE:${held.outage}`);
        const body = new TextDecoder("utf-8", { fatal: true }).decode(held.bytes);
        const capture = { requestedUrl: held.requestedUrl, finalUrl: held.finalUrl, httpStatus: held.httpStatus,
          body, retrievedAt: held.retrievedAt, sourceCheck: knownReleaseSourceCheck(held) };
        acquisitions.push({ ...capture, raw: await holdRawCapture(vault, "congress-directory-project", held.bytes, "text/plain") });
        chambers.push(capture);
        for (const state of states) if(sourceChanged(state))await publish(state,acquisitions,await projectionFor(state),held.retrievedAt);
      } catch (error) {optionalFailures++;for(const state of states)changed.add(state);console.error(`${chamber} directory: contacts retained; ${String(error)}`); }
    }
    for(const state of states){
      if(Date.now()>=deadline)break;
      if(!changed.has(state) && sourceComplete()){
        const rawHash=federalDirectorySourceContentHash(acquisitions,sourceInputHash),first=acquisitions[0];
        const check=acquisitions.flatMap(row=>row.sourceCheck?[row.sourceCheck]:[]).sort((a,b)=>a.checkedAt.localeCompare(b.checkedAt))[0];
        const confirmed=await confirmSourceHashUnchanged({store,sourceId:"congress-directory-project",recordClass:"FEDERAL_DIRECTORY",scope:federalDirectoryScope(state),
          parserVersion:FEDERAL_DIRECTORY_PARSER_VERSION,rawHash,now:clock(),complete:true,
          retrieval:{requestedUrl:first.requestedUrl,finalUrl:first.finalUrl,httpStatus:first.httpStatus,rawHash,retrievedAt:first.retrievedAt??now,...(check?{sourceCheck:check}:{})}});
        if(confirmed){receipts.set(state,{confirmation:confirmed});continue;}
      }
      if(!receipts.has(state))await publish(state,acquisitions,await projectionFor(state),dates["legislators-current"]!);
    }
  } catch (error) {
    failures.push(error);
    for (const state of states) {
      if (receipts.has(state) || Date.now() >= deadline) continue;
      try {
        const now = clock(), candidate = failedFederalDirectoryCandidate(state, now, String(error));
        const outcome = await processRegisteredManualCandidate(store, federalDirectoryContractId(state), candidate, now);
        receipts.set(state, { candidate, outcome });
      } catch (receiptError) { console.error(`Failed attempt receipt ${state}: ${String(receiptError)}`); }
    }
  } finally {
    for (const state of states) {
      const receipt = receipts.get(state);
      if(receipt && "confirmation" in receipt)console.log("RCD_RECEIPT="+JSON.stringify({source:federalDirectoryContractId(state),...sourceHashReceiptFields(receipt.confirmation),structuralReleaseContract:ZERO_RELEASE_EVENTS}));
      else if (receipt) printSourceRunnerReceipt(federalDirectoryContractId(state), receipt.candidate, receipt.outcome);
    }
  }
  if (failures.length) throw failures[0];
}

async function main() {
  if (!process.argv.includes("--promote")) throw Error("Run with --promote; tracked federal files are first-seed/test evidence only.");
  prepareProductionCivicDataWrite();
  const args = process.argv.slice(2);
  const states = args.some(arg => arg.startsWith("--contracts-file="))
    ? readContractHandoff<string>(args).map(id => { const state = federalDirectoryStateOf(id); if (!state) throw Error(`CONGRESS_CONTRACT_INVALID:${id}`); return state; })
    : [requiredAssignment(args, "state", "CONGRESS_STATE_REQUIRED")];
  await refreshCongressDirectory({ states, store: new PostgresRoutineDataStore(), vault: rawCaptureVault() });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error:unknown)=>{
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1;
});
