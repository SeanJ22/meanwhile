/** Standing own-page portrait work, scheduled separately from roster readers. */
import { pathToFileURL } from "node:url";
import { STATE_PEOPLE_JURISDICTIONS } from "../lib/officials/people-identity.ts";
import { readStatePeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { statePeoplePortraits } from "../lib/civic-data/state-people-publication.ts";
import { readPeopleSourceProjection, publishPeopleSource } from "../lib/civic-data/people-source-publication.ts";
import { readStateFederalDirectory } from "../lib/officials/federal-directory-read-model.ts";
import { congressPortraits } from "../lib/officials/congress-portraits.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import { promotedInputRef, type DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";
import type { PortraitAttempt, StandingPortraitOptions } from "../lib/photos/portrait-work.ts";
import { portraitHash, type PortraitCapture } from "../lib/photos/evidence.ts";
import { pacedPortraitAcquire, storeStandingPortrait } from "../lib/photos/portrait-work.ts";
import { websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
import { capturedText, type StatePeopleCapture } from "../lib/civic-data/state-people-publication.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import type { EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { isOfficialSource } from "../lib/civic-data/source-authority.ts";

export function parsePeoplePortraitArguments(args:readonly string[]):string {
  const state=args.find(arg=>arg.startsWith("--state="))?.slice(8).toLowerCase();
  if (args.filter(arg=>arg === "--promote").length !== 1 || args.length !== 2 ||
    !state || !STATE_PEOPLE_JURISDICTIONS.includes(`US-${state.toUpperCase()}`)) throw Error("PEOPLE_PORTRAITS_EXACT_SCOPE_REQUIRED");
  return state;
}

function portraitPerson(person:Officeholder):Officeholder {
  return {id:person.id,personId:person.personId ?? person.id,nativeIds:person.nativeIds,
    name:person.name,officeTitle:person.officeTitle,level:person.level,state:person.state,chamber:person.chamber,
    profileUrls:[...new Set([person.websiteUrl,...(person.profileUrls ?? [])].filter((url):url is string=>Boolean(url)))],
    termStart:"",termEnd:"",birthDate:null,partyLabel:null,websiteUrl:null,contactFormUrl:null,phone:null,email:null,campaignUrl:null,
    photo:person.photo,social:{},provenance:person.provenance,
    fieldSources:{name:person.fieldSources?.name ?? person.provenance,officeTitle:person.fieldSources?.officeTitle ?? person.provenance,
      ...(person.fieldSources?.photo ? {photo:person.fieldSources.photo} : {})}};
}

async function sourceInputs(store:RoutineDataStore,jurisdiction:string,linking?:{vault:EvidenceStore;captures:PortraitCapture[];gaps:PortraitAttempt[];at:string}):Promise<DerivedInputRef[]> {
  const contracts=[...ROUTINE_SOURCE_CONTRACTS,...MANUAL_PRODUCTION_SOURCE_CONTRACTS]
    .filter(row=>row.sourceId !== "people-portraits" && ["STATE_LEGISLATOR","FEDERAL_DIRECTORY"].includes(row.recordClass) &&
      (row.scope === jurisdiction || row.scope.startsWith(`${jurisdiction}:`)));
  const found=await Promise.all(contracts.map(async contract=>{
    const promotion=await store.readPromotion(contract.recordClass,contract.scope);
    if (!promotion) return null;
    if(linking){
      const saved=await store.readCandidate(promotion.versionId);
      const captures=(saved?.candidate.normalizedPayload as {captures?:StatePeopleCapture[]}|undefined)?.captures ?? [];
      for(const row of captures){
        // A national directory is a route index; own-page portrait evidence comes from the person's government.
        const sourceUrl=new URL(row.finalUrl);
        if(row.indexOnly || !isOfficialSource(row.finalUrl) || sourceUrl.hostname === "api.govinfo.gov" &&
          (/^\/collections\/CDIR\//.test(sourceUrl.pathname) || /^\/packages\/[^/]+\/granules\/?$/.test(sourceUrl.pathname)))continue;
        try {
          const text=await capturedText(linking.vault,row);
          linking.captures.push({transport:"REACHABLE",partial:false,httpStatus:row.httpStatus,
            observedAt:row.sourceCheck?.checkedAt ?? row.retrievedAt,evidence:{canonicalUrl:row.finalUrl,sourceId:contract.sourceId,
              contentHash:portraitHash(new TextEncoder().encode(text)),text,retrievedAt:row.retrievedAt,vaultKey:row.capture.vaultKey}});
        } catch(error) {
          linking.gaps.push({key:`held-portrait-source:${row.finalUrl}`,code:"PEOPLE_PORTRAIT_HELD_SOURCE_UNAVAILABLE",
            detail:`The held portrait linking page could not be read; the current own-page reader still runs: ${error instanceof Error ? error.message : String(error)}`,
            record:{sourceUrl:row.finalUrl,vaultKey:row.capture.vaultKey,attemptedAt:linking.at}});
        }
      }
    }
    return promotedInputRef(contract.recordClass,contract.scope,promotion.versionId,promotion.payload,promotion.promotedAt);
  }));
  return found.filter((ref):ref is DerivedInputRef=>ref !== null);
}

function portraitInputs(person:Officeholder,facts:readonly PortraitAttempt[]):DerivedInputRef[] {
  const saved=(person.photo?.verification?.sources ?? []).flatMap(row=>row.artifactId || row.vaultKey ? [{
    kind:"VAULTED_EVIDENCE" as const,artifactId:row.artifactId ?? row.vaultKey!,contentHash:row.contentHash,tier:"RAW" as const,retrievedAt:row.retrievedAt,
  }] : []);
  for (const fact of facts) {
    const record=fact.record as {vaultKey?:string;rawHash?:string;sourceRetrievedAt?:string}|undefined;
    if (record?.vaultKey && record.rawHash && record.sourceRetrievedAt) saved.push({kind:"VAULTED_EVIDENCE",artifactId:record.vaultKey,
      contentHash:`sha256-${record.rawHash}`,tier:"RAW",retrievedAt:record.sourceRetrievedAt});
  }
  return saved;
}

/** Finished portraits publish together once this long has passed, and at the end, so a cut-off run keeps its work. */
const PORTRAIT_PUBLISH_BATCH_MS = 10 * 60_000;

export async function refreshPeoplePortraits(input:{store:RoutineDataStore;vault:EvidenceStore;state:string;options?:StandingPortraitOptions}) {
  const {store,vault,state}=input,options=input.options ?? {},clock=options.now ?? (()=>new Date().toISOString());
  const pacing={sizeFor:websiteSizeFromHoldings([state])};
  const acquire=options.acquire ?? ((request:Parameters<typeof pacedPortraitAcquire>[0])=>pacedPortraitAcquire(request,pacing));
  const portraitOptions={...options,acquire,storePortrait:options.storePortrait ?? ((...args:Parameters<typeof storeStandingPortrait>)=>storeStandingPortrait(args[0],args[1],args[2],args[3],pacing))};
  const jurisdiction=`US-${state.toUpperCase()}` as const;
  const contractId=`people-portraits-${state.toLowerCase()}`;
  const prior=await readPeopleSourceProjection(jurisdiction,"people-portraits",{store,now:clock(),bypassCache:true});
  if(prior.kind === "STORE_UNREACHABLE")throw Error("PEOPLE_PORTRAIT_MARKER_UNAVAILABLE");
  const previous=prior.kind === "PROMOTED" ? await store.readCandidate(prior.metadata.versionId!) : null;
  const sourceGaps:PortraitAttempt[]=[];
  const linkingCaptures:PortraitCapture[]=[...(options.linkingCaptures ?? [])];
  const sources=await sourceInputs(store,jurisdiction,{vault,captures:linkingCaptures,gaps:sourceGaps,at:clock()});
  const unavailable=new Set(sourceGaps.map(gap=>gap.key));
  const priorFacts=[...(previous?.candidate.excludedFacts ?? []).filter(fact=>!unavailable.has(fact.key)),...sourceGaps];
  let baseRoster:OfficeholderSet|null=null,last=null as Awaited<ReturnType<typeof publishPeopleSource>>|null;
  let finished=new Map<string,{person:Officeholder;facts:readonly PortraitAttempt[]}>(),batchStarted=Date.now(),queue=Promise.resolve();
  const publish=async(continuation:readonly PortraitAttempt[]|null)=>{
    const batch=[...finished.values()];
    finished=new Map();batchStarted=Date.now();
    const people=new Set(batch.map(row=>row.person.personId ?? row.person.id));
    const officeholders=batch.length ? batch.map(row=>portraitPerson(row.person)) : baseRoster!.officeholders.map(portraitPerson);
    for(;;){
      const held=await readPeopleSourceProjection(jurisdiction,"people-portraits",{store,now:clock(),bypassCache:true});
      if(held.kind === "STORE_UNREACHABLE")throw Error("PEOPLE_PORTRAIT_MARKER_UNAVAILABLE");
      const current=held.kind === "PROMOTED" ? await store.readCandidate(held.metadata.versionId!) : null;
      const kept=(current?.candidate.excludedFacts ?? priorFacts).filter(fact=>fact.code !== "PEOPLE_PORTRAIT_HELD_SOURCE_UNAVAILABLE" &&
        !people.has((fact.record as {personId?:string}|undefined)?.personId ?? "") &&
        !(continuation && fact.code.endsWith("_WORK_REMAINS")));
      const publication=await publishPeopleSource({store,vault,state,contractId,sourceId:"people-portraits",
        roster:{scope:state,generatedAt:clock(),officeholders,divisions:[],unmatched:[]},acquisitions:[],releaseId:clock(),now:clock(),
        derivedInputs:[...sources,...batch.flatMap(row=>portraitInputs(row.person,row.facts))],
        excludedFacts:[...kept,...sourceGaps,...batch.flatMap(row=>row.facts),...continuation ?? []],confirmUnchanged:true});
      if(publication.outcome.candidate.failureCode === "PROMOTION_BASE_CHANGED")continue;
      if(!publication.outcome.promoted && !publication.outcome.confirmed)throw Error(`PEOPLE_PORTRAIT_PUBLICATION_REFUSED:${publication.outcome.candidate.failureDetail}`);
      last=publication;return;
    }
  };
  const marker=async(person:Officeholder,facts:readonly PortraitAttempt[])=>{
    finished.set(person.personId ?? person.id,{person,facts});
    if(Date.now()-batchStarted >= PORTRAIT_PUBLISH_BATCH_MS){
      const operation=queue.then(()=>publish(null));
      queue=operation.catch(()=>{});await operation;
    }
    await options.onPerson?.(person,facts);
  };
  // The place's members of Congress share its portrait record; readers lay their photos on the place directory.
  const [peopleRead,placeRead]=await Promise.all([readStatePeopleProjection(jurisdiction,{store,now:clock(),bypassCache:true}),
    readStateFederalDirectory(state,{store,now:clock(),bypassCache:true})]);
  const people=peopleRead.kind === "PROMOTED" || peopleRead.kind === "BOOTSTRAP" ? peopleRead.value.roster : null;
  const place=placeRead.kind === "PROMOTED" ? placeRead.value : null;
  if(!people && !place)throw Error("PEOPLE_PORTRAIT_ROSTER_UNAVAILABLE");
  baseRoster={...(people ?? place!.roster),officeholders:[...people?.officeholders ?? [],...place?.roster.officeholders ?? []]};
  const stateResult=people ? await statePeoplePortraits({roster:people,state,now:clock(),signal:options.signal},{...portraitOptions,linkingCaptures,previousExcludedFacts:priorFacts,onPerson:marker}) : null;
  const congressResult=place ? await congressPortraits(place,clock(),options.signal,{...portraitOptions,previousExcludedFacts:priorFacts,onPerson:marker}) : null;
  const continuationFacts=[...stateResult?.excludedFacts.filter(fact=>fact.code === "STATE_PORTRAIT_WORK_REMAINS") ?? [],
    ...congressResult?.excludedFacts.filter(fact=>fact.code === "CONGRESS_PORTRAIT_WORK_REMAINS") ?? []];
  await queue;
  // The last batch carries the remaining work; a run that finished nothing still advances its own clock.
  if(finished.size || !last || continuationFacts.length)await publish(continuationFacts);
  if(!last)throw Error("PEOPLE_PORTRAIT_NO_HELD_PEOPLE");
  printSourceRunnerReceipt(contractId,last.candidate,last.outcome);
  return last;
}


async function main(){
  const state=parsePeoplePortraitArguments(process.argv.slice(2));
  installNeonRequestDeadline();prepareProductionCivicDataWrite();
  await refreshPeoplePortraits({store:new PostgresRoutineDataStore(),vault:rawCaptureVault(),state});
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)await main();
