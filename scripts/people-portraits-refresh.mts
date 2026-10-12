/** Standing own-page portrait work, scheduled separately from roster readers. */
import { pathToFileURL } from "node:url";
import { STATE_PEOPLE_JURISDICTIONS } from "../lib/officials/people-identity.ts";
import { readStatePeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { statePeoplePortraits } from "../lib/civic-data/state-people-publication.ts";
import { readPeopleSourceProjection, publishPeopleSource } from "../lib/civic-data/people-source-publication.ts";
import { readFederalDirectoryProjection } from "../lib/officials/federal-directory-read-model.ts";
import { congressPortraits } from "../lib/officials/congress-portraits.ts";
import { federalDirectoryCandidate, type FederalDirectoryAcquisition } from "../lib/officials/federal-directory-data-plane.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import { promotedInputRef, type DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";
import type { PortraitAttempt, StandingPortraitOptions } from "../lib/photos/portrait-work.ts";
import { portraitHash, type PortraitCapture } from "../lib/photos/evidence.ts";
import { pacedPortraitAcquire, storeStandingPortrait } from "../lib/photos/portrait-work.ts";
import { websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
import type { StatePeopleAcquisition } from "../lib/civic-data/state-people-publication.ts";

export function parsePeoplePortraitArguments(args:readonly string[]):string {
  const state=args.find(arg=>arg.startsWith("--state="))?.slice(8).toLowerCase();
  if (args.filter(arg=>arg === "--promote").length !== 1 || args.length !== 2 ||
    !((args.includes("--federal") && !state) || state && STATE_PEOPLE_JURISDICTIONS.includes(`US-${state.toUpperCase()}`))) throw Error("PEOPLE_PORTRAITS_EXACT_SCOPE_REQUIRED");
  return state ?? "US";
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

async function sourceInputs(store:RoutineDataStore,jurisdiction:string,captures?:PortraitCapture[]):Promise<DerivedInputRef[]> {
  const contracts=[...ROUTINE_SOURCE_CONTRACTS,...MANUAL_PRODUCTION_SOURCE_CONTRACTS]
    .filter(row=>row.sourceId !== "people-portraits" && (jurisdiction === "US" ? row.recordClass === "FEDERAL_DIRECTORY" : ["STATE_LEGISLATOR","FEDERAL_DIRECTORY"].includes(row.recordClass)) &&
      (jurisdiction === "US" ? row.scope.startsWith("US:") : row.scope === jurisdiction || row.scope.startsWith(`${jurisdiction}:`)));
  const found=await Promise.all(contracts.map(async contract=>{
    const promotion=await store.readPromotion(contract.recordClass,contract.scope);
    if (!promotion) return null;
    if(captures){
      const saved=await store.readCandidate(promotion.versionId);
      const acquisitions=(saved?.candidate.normalizedPayload as {acquisitions?:StatePeopleAcquisition[]}|undefined)?.acquisitions ?? [];
      for(const row of acquisitions)if(row.vaultKey || row.artifactId)captures.push({transport:"REACHABLE",partial:false,httpStatus:row.httpStatus,
        observedAt:row.sourceCheck?.checkedAt ?? row.retrievedAt,evidence:{canonicalUrl:row.finalUrl,sourceId:contract.sourceId,
          contentHash:portraitHash(new TextEncoder().encode(row.body)),text:row.body,retrievedAt:row.retrievedAt,
          ...(row.artifactId ? {artifactId:row.artifactId} : {vaultKey:row.vaultKey})}});
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

export async function refreshPeoplePortraits(input:{store:RoutineDataStore;state:string;options?:StandingPortraitOptions}) {
  const {store,state}=input,options=input.options ?? {},clock=options.now ?? (()=>new Date().toISOString());
  const pacing={sizeFor:websiteSizeFromHoldings(state === "US" ? [] : [state])};
  const acquire=options.acquire ?? ((request:Parameters<typeof pacedPortraitAcquire>[0])=>pacedPortraitAcquire(request,pacing));
  const portraitOptions={...options,acquire,storePortrait:options.storePortrait ?? ((...args:Parameters<typeof storeStandingPortrait>)=>storeStandingPortrait(args[0],args[1],args[2],args[3],pacing))};
  const jurisdiction=(state === "US" ? "US" : `US-${state.toUpperCase()}`) as "US" | `US-${string}`;
  const contractId=state === "US" ? "people-portraits-federal" : `people-portraits-${state.toLowerCase()}`;
  const prior=await readPeopleSourceProjection(jurisdiction,"people-portraits",{store,now:clock(),bypassCache:true});
  if(prior.kind === "STORE_UNREACHABLE")throw Error("PEOPLE_PORTRAIT_MARKER_UNAVAILABLE");
  const previous=prior.kind === "PROMOTED" ? await store.readCandidate(prior.metadata.versionId!) : null;
  const priorFacts=previous?.candidate.excludedFacts ?? [];
  const linkingCaptures:PortraitCapture[]=[...(options.linkingCaptures ?? [])];
  await sourceInputs(store,jurisdiction,linkingCaptures);
  let baseRoster:OfficeholderSet|null=null;
  let continuationFacts:readonly PortraitAttempt[]=[];
  let queue=Promise.resolve(),last:Awaited<ReturnType<typeof publishPeopleSource>>|null=null;
  const marker=async(person:Officeholder,facts:readonly PortraitAttempt[])=>{
    const operation=queue.then(async()=>{
      for(;;){
        const held=await readPeopleSourceProjection(jurisdiction,"people-portraits",{store,now:clock(),bypassCache:true});
        if(held.kind === "STORE_UNREACHABLE")throw Error("PEOPLE_PORTRAIT_MARKER_UNAVAILABLE");
        const current=held.kind === "PROMOTED" ? await store.readCandidate(held.metadata.versionId!) : null;
        const personId=person.personId ?? person.id;
        const excludedFacts=[...(current?.candidate.excludedFacts ?? []).filter(row=>(row.record as {personId?:string}|undefined)?.personId !== personId),...facts];
        const roster:OfficeholderSet={scope:state,generatedAt:clock(),officeholders:[portraitPerson(person)],divisions:[],unmatched:[]};
        const publication=await publishPeopleSource({store,state,contractId,sourceId:"people-portraits",roster,acquisitions:[],releaseId:clock(),now:clock(),
          derivedInputs:[...await sourceInputs(store,jurisdiction),...portraitInputs(person,facts)],excludedFacts,confirmUnchanged:false});
        if(publication.outcome.candidate.failureCode === "PROMOTION_BASE_CHANGED")continue;
        if(!publication.outcome.promoted && !publication.outcome.confirmed)throw Error(`PEOPLE_PORTRAIT_PUBLICATION_REFUSED:${publication.outcome.candidate.failureDetail}`);
        last=publication;return;
      }
    });
    queue=operation.catch(()=>{});await operation;
    await options.onPerson?.(person,facts);
  };
  if(state === "US"){
    const read=await readFederalDirectoryProjection({store,now:clock(),bypassCache:true});
    if(read.kind !== "PROMOTED")throw Error("PEOPLE_PORTRAIT_FEDERAL_ROSTER_UNAVAILABLE");
    baseRoster=read.value.roster;
    const result=await congressPortraits(read.value,clock(),options.signal,{...portraitOptions,previousExcludedFacts:priorFacts,onPerson:async(person,facts)=>{
      // The native directory remains the established reader photo holding.
      const operation=queue.then(async()=>{
        for(;;){
          const latest=await readFederalDirectoryProjection({store,now:clock(),bypassCache:true});
          if(latest.kind !== "PROMOTED")throw Error("PEOPLE_PORTRAIT_FEDERAL_ROSTER_UNAVAILABLE");
          const candidateRecord=await store.readCandidate(latest.metadata.versionId!);
          const acquisitions=(candidateRecord?.candidate.normalizedPayload as {acquisitions?:FederalDirectoryAcquisition[]}|undefined)?.acquisitions;
          if(!acquisitions?.length)throw Error("PEOPLE_PORTRAIT_FEDERAL_SOURCE_UNAVAILABLE");
          const personId=person.personId ?? person.id;
          const projection={...latest.value,roster:{...latest.value.roster,officeholders:latest.value.roster.officeholders.map(row=>(row.personId ?? row.id) === personId
            ? {...row,photo:person.photo,profileUrls:[...new Set([...(row.profileUrls ?? []),...(person.profileUrls ?? [])])],
              fieldSources:{...row.fieldSources,...(person.fieldSources?.photo ? {photo:person.fieldSources.photo} : {})}} : row)}};
          const excludedFacts=[...(candidateRecord?.candidate.excludedFacts ?? []).filter(row=>(row.record as {personId?:string}|undefined)?.personId !== personId),...facts];
          const candidate=federalDirectoryCandidate({projection,acquisitions,retrievedAt:candidateRecord!.candidate.retrieval.retrievedAt,excludedFacts});
          const outcome=await processRegisteredManualCandidate(store,"congress-bulk-roster",candidate,clock(),latest.metadata.versionId,{confirmUnchanged:false});
          if(outcome.candidate.failureCode === "PROMOTION_BASE_CHANGED")continue;
          if(!outcome.promoted && !outcome.confirmed)throw Error(`PEOPLE_PORTRAIT_FEDERAL_PUBLICATION_REFUSED:${outcome.candidate.failureDetail}`);
          return;
        }
      });
      queue=operation.catch(()=>{});await operation;
      await marker(person,facts);
    }});
    continuationFacts=result.excludedFacts.filter(fact=>fact.code === "CONGRESS_PORTRAIT_WORK_REMAINS");
  }else{
    const read=await readStatePeopleProjection(jurisdiction as `US-${string}`,{store,now:clock(),bypassCache:true});
    if(read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP")throw Error("PEOPLE_PORTRAIT_STATE_ROSTER_UNAVAILABLE");
    baseRoster=read.value.roster;
    const result=await statePeoplePortraits({roster:read.value.roster,state,now:clock(),signal:options.signal},{...portraitOptions,linkingCaptures,previousExcludedFacts:priorFacts,onPerson:marker});
    continuationFacts=result.excludedFacts.filter(fact=>fact.code === "STATE_PORTRAIT_WORK_REMAINS");
  }
  await queue;
  // A no-work recheck advances its own clock rather than the source roster's.
  if((!last || continuationFacts.length) && baseRoster){
    const current=await readPeopleSourceProjection(jurisdiction,"people-portraits",{store,now:clock(),bypassCache:true});
    if(current.kind === "STORE_UNREACHABLE")throw Error("PEOPLE_PORTRAIT_MARKER_UNAVAILABLE");
    const saved=current.kind === "PROMOTED" ? await store.readCandidate(current.metadata.versionId!) : null;
    const publication=await publishPeopleSource({store,state,contractId,sourceId:"people-portraits",roster:{...baseRoster,officeholders:baseRoster.officeholders.map(portraitPerson)},
      acquisitions:[],releaseId:clock(),now:clock(),derivedInputs:await sourceInputs(store,jurisdiction),
      excludedFacts:[...(saved?.candidate.excludedFacts ?? priorFacts).filter(fact=>!fact.code.endsWith("_WORK_REMAINS")),...continuationFacts],confirmUnchanged:continuationFacts.length === 0});
    last=publication;
  }
  if(!last)throw Error("PEOPLE_PORTRAIT_NO_HELD_PEOPLE");
  printSourceRunnerReceipt(contractId,last.candidate,last.outcome);
  return last;
}

async function main(){
  const state=parsePeoplePortraitArguments(process.argv.slice(2));
  installNeonRequestDeadline();prepareProductionCivicDataWrite();
  await refreshPeoplePortraits({store:new PostgresRoutineDataStore(),state});
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)await main();
